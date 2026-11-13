import { Stroke, type BrushSettings, type PenStroke, type StrokePatch } from '../engine/brush';
import type { Document, Layer } from '../engine/document';
import type { Pt } from '../engine/geometry';
import type { Rect } from '../engine/tiles';
import type { Command, History } from '../engine/history';
import {
  adjustWidthNear,
  controlIndexes,
  correctPoints,
  eraseTouching,
  paintVectorStroke,
  pinch,
  rasterizeVector,
  reshape,
  scaleBrush,
  strokesAt,
  union,
  vectorBrush,
  type VectorPoint,
  type VectorStroke,
} from '../engine/vector';

/** The tools of the "Corregir línea" group that act on the lines of a vector layer. */
export type VectorTool = 'vcontrol' | 'vpinch' | 'vsimplify' | 'vwidth';
const VECTOR_TOOLS: ReadonlySet<string> = new Set<VectorTool>(['vcontrol', 'vpinch', 'vsimplify', 'vwidth']);
export const isVectorTool = (t: string): t is VectorTool => VECTOR_TOOLS.has(t);

export interface VectorOptions {
  /** How much a finished line is corrected, 0..1 (0 keeps every sample). */
  strength: number;
  /** Radius, in page pixels, within which pinch and width act. */
  reach: number;
  /** Adjust width: make the line thicker (true) or thinner (false). */
  thicker: boolean;
}

export interface VectorDeps {
  doc: () => Document;
  view: { x: number; y: number; scale: number };
  history: () => History;
  options: () => VectorOptions;
  /** The brush used to draw (size, colour, pressure response). */
  brush: () => BrushSettings;
  /** Repaint after the layer's picture changed. */
  changed: (layer: Layer, rect: Rect) => void;
  redraw: () => void;
  say: (msg: string) => void;
}

const fullRect = (layer: Layer): Rect => ({ x: 0, y: 0, w: layer.surface.width, h: layer.surface.height });

/**
 * Vector layers: the lines are kept as points and brush, the layer's pixels are a picture of them (see engine/vector.ts).
 * Lines are never changed in place, only replaced, so a history step can hold the whole list before and after by sharing
 * the lines that did not change.
 */
export function createVectorUi(d: VectorDeps): {
  /** A pen stroke that records a line on a vector layer. */
  drawing(layer: Layer): PenStroke;
  /** An eraser that removes the lines it touches. */
  erasing(layer: Layer): PenStroke;
  down(tool: VectorTool, layer: Layer, p: Pt): void;
  move(p: Pt): void;
  up(): void;
  readonly dragging: boolean;
  /** Forget the selected line (the layer or the tool changed). */
  deselect(): void;
  drawOverlay(ctx: CanvasRenderingContext2D): void;
} {
  /** The line the control point tool shows, and the point being dragged. */
  let selectedId: number | null = null;
  let controls: number[] = [];
  interface Drag {
    layer: Layer;
    before: VectorStroke[];
    tool: VectorTool;
    start: Pt;
    /** Control point: the line as it was, and which point is held. */
    orig?: VectorStroke;
    which?: number;
    /** Lines already simplified in this gesture. */
    done: Set<number>;
  }
  let drag: Drag | null = null;

  const list = (layer: Layer): VectorStroke[] => (layer.vector ??= []);

  function setStrokes(layer: Layer, strokes: VectorStroke[]): Rect {
    layer.vector = strokes;
    return rasterizeVector(layer) ?? fullRect(layer);
  }

  function step(layer: Layer, before: VectorStroke[], after: VectorStroke[], label: string): Command {
    const bytes = (before.length + after.length) * 64;
    return {
      region: fullRect(layer),
      label,
      bytes,
      undo: () => void setStrokes(layer, before.slice()),
      redo: () => void setStrokes(layer, after.slice()),
    };
  }

  function replace(layer: Layer, id: number, change: (s: VectorStroke) => VectorStroke): boolean {
    const strokes = list(layer);
    const i = strokes.findIndex((s) => s.id === id);
    if (i < 0) return false;
    const next = strokes.slice();
    next[i] = change(strokes[i]!);
    d.changed(layer, setStrokes(layer, next));
    return true;
  }

  const nextId = (layer: Layer): number => list(layer).reduce((m, s) => Math.max(m, s.id), 0) + 1;
  const stroke = (layer: Layer, id: number): VectorStroke | undefined => list(layer).find((s) => s.id === id);
  const reachDoc = (px: number): number => px / d.view.scale;

  /** Dragging a line to a new place: control points need a tolerance in page pixels, a few screen pixels' worth. */
  const controlTolerance = (): number => Math.max(1, reachDoc(3));

  function showControls(layer: Layer, id: number | null): void {
    selectedId = id;
    const s = id === null ? undefined : stroke(layer, id);
    controls = s ? controlIndexes(s.points, controlTolerance()) : [];
  }

  // ---- drawing ------------------------------------------------------------------------------------

  class VectorPen implements PenStroke {
    private readonly raw: VectorPoint[] = [];
    private readonly preview: Stroke;
    constructor(private readonly layer: Layer) {
      // The live preview is the raw line with no smoothing: the correction happens when the pen is lifted.
      this.preview = new Stroke({ id: layer.id, surface: layer.surface, lockAlpha: false }, vectorBrush(d.brush()));
    }
    addPoint(x: number, y: number, pressure = 1): Rect | null {
      this.raw.push({ x, y, p: pressure });
      return this.preview.addPoint(x, y, pressure);
    }
    skipPoint(x: number, y: number, pressure = 1): void {
      this.raw.push({ x, y, p: pressure });
      this.preview.skipPoint(x, y, pressure);
    }
    cancel(): Rect | null {
      return this.preview.cancel();
    }
    finish(): StrokePatch | null {
      const undone = this.preview.cancel();
      if (this.raw.length === 0) return null;
      const brush = vectorBrush(d.brush());
      const line: VectorStroke = { id: nextId(this.layer), points: correctPoints(this.raw, d.options().strength, brush.size), brush };
      const before = list(this.layer).slice();
      this.layer.vector = [...before, line];
      // Only the new line is painted; the preview of the raw samples was taken off first.
      const rect = paintVectorStroke({ id: this.layer.id, surface: this.layer.surface, lockAlpha: false }, line);
      d.history().push(step(this.layer, before, this.layer.vector.slice(), 'Trazo vectorial'));
      d.changed(this.layer, union(undone, rect) ?? fullRect(this.layer));
      return null;
    }
  }

  class VectorEraser implements PenStroke {
    private readonly before: VectorStroke[];
    private removed = 0;
    constructor(private readonly layer: Layer) {
      this.before = list(layer).slice();
    }
    addPoint(x: number, y: number): Rect | null {
      const { kept, removed } = eraseTouching(list(this.layer), x, y, Math.max(1, d.brush().size / 2));
      if (removed.length === 0) return null;
      this.removed += removed.length;
      const rect = setStrokes(this.layer, kept);
      return rect;
    }
    skipPoint(x: number, y: number): void {
      this.addPoint(x, y);
    }
    cancel(): Rect | null {
      if (this.removed === 0) return null;
      return setStrokes(this.layer, this.before.slice());
    }
    finish(): StrokePatch | null {
      if (this.removed > 0) d.history().push(step(this.layer, this.before, list(this.layer).slice(), 'Borrar líneas vectoriales'));
      return null;
    }
  }

  // ---- correction tools -----------------------------------------------------------------------------

  function topLine(layer: Layer, p: Pt): VectorStroke | undefined {
    return strokesAt(list(layer), p.x, p.y, reachDoc(6))[0];
  }

  /**
   * "Ajustar grosor": a stretch of the line gets thicker or thinner through the pressure of its points. A brush that ignores
   * pressure, or a line already at full pressure, cannot swell that way, so the whole line is scaled instead (once per gesture).
   * Own design.
   */
  function widen(layer: Layer, hit: VectorStroke, p: Pt, o: VectorOptions): void {
    if (!drag) return;
    const local = hit.brush.pressureSize ? adjustWidthNear(hit.points, p.x, p.y, o.reach, o.thicker ? 1.12 : 0.89) : null;
    const moved = local !== null && (local.length !== hit.points.length || local.some((q, i) => Math.abs(q.p - hit.points[i]!.p) > 1e-6));
    if (local && moved) {
      replace(layer, hit.id, (s) => ({ ...s, points: local }));
    } else if (!drag.done.has(hit.id)) {
      drag.done.add(hit.id);
      replace(layer, hit.id, (s) => scaleBrush(s, o.thicker ? 1.25 : 0.8));
    }
  }

  function applyAt(tool: VectorTool, layer: Layer, p: Pt, first: boolean): void {
    const o = d.options();
    if (tool === 'vsimplify') {
      const hit = topLine(layer, p);
      if (!hit || !drag || drag.done.has(hit.id)) return;
      drag.done.add(hit.id);
      replace(layer, hit.id, (s) => ({ ...s, points: correctPoints(s.points, Math.max(0.3, o.strength), s.brush.size) }));
      return;
    }
    const near = strokesAt(list(layer), p.x, p.y, o.reach);
    for (const hit of near) {
      if (tool === 'vpinch') replace(layer, hit.id, (s) => ({ ...s, points: pinch(s.points, p.x, p.y, o.reach, first ? 0.15 : 0.3) }));
      else if (tool === 'vwidth') widen(layer, hit, p, o);
    }
  }

  const api = {
    drawing: (layer: Layer): PenStroke => new VectorPen(layer),
    erasing: (layer: Layer): PenStroke => new VectorEraser(layer),
    get dragging() {
      return drag !== null;
    },
    deselect(): void {
      selectedId = null;
      controls = [];
    },
    down(tool: VectorTool, layer: Layer, p: Pt): void {
      if (layer.kind !== 'vector') {
        d.say('Estas herramientas actúan sobre una capa vectorial (Capa > Nueva capa > Vectorial).');
        return;
      }
      if (layer.locked) {
        d.say('La capa está bloqueada: desbloquéala para corregir sus líneas.');
        return;
      }
      drag = { layer, before: list(layer).slice(), tool, start: p, done: new Set() };
      if (tool === 'vcontrol') {
        const current = selectedId === null ? undefined : stroke(layer, selectedId);
        const grab = reachDoc(10);
        const held = current ? controls.findIndex((i) => Math.hypot(current.points[i]!.x - p.x, current.points[i]!.y - p.y) <= grab) : -1;
        if (current && held >= 0) {
          drag.orig = current;
          drag.which = held;
          return;
        }
        const hit = topLine(layer, p);
        showControls(layer, hit?.id ?? null);
        drag = null; // choosing a line changes nothing
        d.redraw();
        return;
      }
      applyAt(tool, layer, p, true);
    },
    move(p: Pt): void {
      if (!drag) return;
      const { tool, layer } = drag;
      if (tool === 'vcontrol') {
        if (!drag.orig || drag.which === undefined || selectedId === null) return;
        const { orig, which, start } = drag;
        replace(layer, selectedId, () => ({ ...orig, points: reshape(orig.points, controls, which, p.x - start.x, p.y - start.y) }));
        d.redraw();
        return;
      }
      applyAt(tool, layer, p, false);
    },
    up(): void {
      if (!drag) return;
      const { layer, before, tool } = drag;
      drag = null;
      const after = list(layer).slice();
      if (after.length === before.length && after.every((s, i) => s === before[i])) return;
      const labels: Record<VectorTool, string> = {
        vcontrol: 'Mover punto de control',
        vpinch: 'Pellizcar línea vectorial',
        vsimplify: 'Simplificar línea vectorial',
        vwidth: 'Ajustar grosor de línea',
      };
      d.history().push(step(layer, before, after, labels[tool]));
      if (tool === 'vcontrol') showControls(layer, selectedId); // the line has new corners to hold
      d.redraw();
    },
    drawOverlay(ctx: CanvasRenderingContext2D): void {
      const layer = d.doc().layers.find((l) => l.kind === 'vector' && l.vector?.some((s) => s.id === selectedId));
      const s = layer && selectedId !== null ? stroke(layer, selectedId) : undefined;
      if (!s) return;
      const r = 5 / d.view.scale;
      ctx.save();
      ctx.lineWidth = 1 / d.view.scale;
      ctx.strokeStyle = '#2a6df4';
      ctx.fillStyle = '#ffffff';
      for (const i of controls) {
        const q = s.points[i];
        if (!q) continue;
        ctx.beginPath();
        ctx.rect(q.x - r, q.y - r, 2 * r, 2 * r);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    },
  };
  return api;
}
