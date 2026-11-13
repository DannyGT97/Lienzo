import type { Rect, StrokePatch } from './brush';
import { paintTarget, type Document } from './document';
import { renderTone } from './tone';

/** One undoable step. `region` is the area to repaint afterwards (null = everything). */
export interface Command {
  undo(): void;
  redo(): void;
  region: Rect | null;
  /** Approximate memory the step holds; steps beyond the budget are forgotten, oldest first. */
  bytes?: number;
  /** Short description shown in the history palette. */
  label?: string;
  /** The step changed the page itself (size, layer objects): the interface must set itself up for the page again. */
  pageChange?: boolean;
}

const DEFAULT_BUDGET = 256 * 1024 * 1024;

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private used = 0;
  private changes = 0;

  constructor(
    private limit = 200,
    private budgetBytes = DEFAULT_BUDGET,
  ) {}

  /** New limits take effect at once: steps over them are forgotten, oldest first. Returns how many were forgotten. */
  setLimits(limit: number, budgetBytes: number): number {
    this.limit = limit;
    this.budgetBytes = budgetBytes;
    return this.trim();
  }

  /** Changes whenever a step is added, undone or redone: equal values mean the document is as it was. */
  get revision(): number {
    return this.changes;
  }

  push(cmd: Command): void {
    this.changes++;
    this.undoStack.push(cmd);
    this.used += cmd.bytes ?? 0;
    for (const dropped of this.redoStack) this.used -= dropped.bytes ?? 0;
    this.redoStack = [];
    this.trim();
  }

  private trim(): number {
    let forgotten = 0;
    // Always keep the newest step, even if it alone is over budget.
    while (this.undoStack.length > 1 && (this.undoStack.length > this.limit || this.used > this.budgetBytes)) {
      this.used -= this.undoStack.shift()!.bytes ?? 0;
      forgotten++;
    }
    return forgotten;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Labels of the steps that can be undone, oldest first. */
  undoLabels(): string[] {
    return this.undoStack.map((c) => c.label ?? 'Cambio');
  }

  /** Labels of the steps that can be redone, next one first. */
  redoLabels(): string[] {
    return this.redoStack.map((c) => c.label ?? 'Cambio').reverse();
  }

  /** Bytes held by remembered steps (for diagnostics). */
  get memory(): number {
    return this.used;
  }

  undo(): Command | null {
    const c = this.undoStack.pop();
    if (!c) return null;
    c.undo();
    this.changes++;
    this.redoStack.push(c);
    return c;
  }

  redo(): Command | null {
    const c = this.redoStack.pop();
    if (!c) return null;
    c.redo();
    this.changes++;
    this.undoStack.push(c);
    return c;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.used = 0;
  }
}

/** What applying new limits to every open document's history did. */
export interface LimitsResult {
  /** Undo steps forgotten across all the histories. */
  forgotten: number;
  /** Histories that lost at least one step. */
  affected: number;
}

/** Gives every history (each open document keeps its own; the same one is counted once) the same limits. */
export function applyLimits(histories: Iterable<History>, limit: number, budgetBytes: number): LimitsResult {
  const result: LimitsResult = { forgotten: 0, affected: 0 };
  for (const h of new Set(histories)) {
    const n = h.setLimits(limit, budgetBytes);
    result.forgotten += n;
    if (n > 0) result.affected++;
  }
  return result;
}

/** The sentence that tells the user what lower limits cost; null when nothing was forgotten. */
export function limitsNotice(r: LimitsResult): string | null {
  if (r.forgotten === 0) return null;
  const steps = r.forgotten === 1 ? 'Se olvidó 1 paso antiguo' : `Se olvidaron ${r.forgotten} pasos antiguos`;
  const docs = r.affected === 1 ? 'de 1 documento' : `de ${r.affected} documentos`;
  return `${steps} del historial ${docs} por los nuevos límites; ya no se pueden deshacer.`;
}

/** Several steps that happened together, undone and redone as one. */
export function combineCommands(label: string, steps: Command[]): Command | null {
  const list = steps.filter((c) => c);
  if (!list.length) return null;
  if (list.length === 1) return { ...list[0]!, label };
  let region: Rect | null = null;
  for (const c of list) {
    if (!c.region) continue;
    region = region
      ? { x: Math.min(region.x, c.region.x), y: Math.min(region.y, c.region.y), w: Math.max(region.x + region.w, c.region.x + c.region.w) - Math.min(region.x, c.region.x), h: Math.max(region.y + region.h, c.region.y + c.region.h) - Math.min(region.y, c.region.y) }
      : c.region;
  }
  return {
    label,
    region,
    bytes: list.reduce((n, c) => n + (c.bytes ?? 0), 0),
    undo: () => [...list].reverse().forEach((c) => c.undo()),
    redo: () => list.forEach((c) => c.redo()),
  };
}

/** Undo/redo of a brush stroke (tile snapshots); tone layers re-render their screen. */
export function patchCommand(doc: Document, patch: StrokePatch, label = 'Trazo'): Command {
  const apply = (which: 'before' | 'after'): void => {
    const layer = doc.layers.find((l) => l.id === patch.layerId);
    if (!layer) return;
    const surface = patch.onMask && layer.mask ? layer.mask.surface : paintTarget(layer).surface;
    for (const t of patch.tiles) {
      const tile = t[which];
      surface.put(t.tx, t.ty, tile ? tile.slice() : undefined);
    }
    if (layer.kind === 'tone' && layer.tone && layer.source) {
      renderTone(layer.tone, doc.dpi, layer.source, layer.surface, patch.rect);
    }
  };
  return { undo: () => apply('before'), redo: () => apply('after'), region: patch.rect, bytes: patch.bytes, label };
}
