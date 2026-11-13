import type { Document } from './document';
import type { Guides } from './guides';
import { recordGuides } from './guides';
import { combineCommands, type Command } from './history';
import { applyPageOp } from './page-ops';
import type { ResampleMethod } from './resample';
import type { Rect } from './tiles';

/** What the "Propiedades básicas del lienzo" dialog can change; a missing field is left as it is. */
export interface CanvasProps {
  /** The new page as a window over the old one (see page-ops `resize`). */
  rect?: Rect;
  dpi?: number;
  /** A colour turns the paper on with that colour; null turns it off (transparent page). */
  paper?: [number, number, number] | null;
  /** Distances from each edge of the new page (px) that get a guide on every side. */
  frame?: number[];
}

/** A guide on each side at every distance that fits inside the page; zero and repeated distances are skipped. */
export function frameGuides(width: number, height: number, insets: readonly number[]): Guides {
  const at = (limit: number, d: number): number[] => (d > 0 && d * 2 < limit ? [d, limit - d] : []);
  const list = [...new Set(insets.map((d) => Math.round(d)))];
  return { v: list.flatMap((d) => at(width, d)), h: list.flatMap((d) => at(height, d)) };
}

/** Paper that the dialog shows: its colour, or null when there is no visible paper. */
export function paperOf(doc: Document): [number, number, number] | null {
  const l = doc.layers.find((x) => x.kind === 'paper');
  return l && l.visible ? (l.paperColor ?? [255, 255, 255]) : null;
}

/** True when the document has a paper layer that the dialog can switch. */
export const hasPaper = (doc: Document): boolean => doc.layers.some((l) => l.kind === 'paper');

/** Set the resolution (dots per inch) as a history step (already applied); null when it is the same. */
function dpiStep(doc: Document, dpi: number | undefined, label: string): Command | null {
  if (dpi === undefined || dpi === doc.dpi) return null;
  const before = doc.dpi;
  doc.dpi = dpi;
  return { label, region: null, undo: () => void (doc.dpi = before), redo: () => void (doc.dpi = dpi) };
}

/** What "Cambiar resolución de imagen" can change: the picture re-sampled to a size, and the resolution it is printed at. */
export interface Resolution {
  /** Re-sample the picture to this size (px); leave it out to keep the pixels as they are. */
  size?: { width: number; height: number; method: ResampleMethod };
  dpi: number;
}

/** Re-sample the picture and/or set the resolution as one history step (already applied); null when nothing changes. */
export function applyResolution(doc: Document, r: Resolution, label: string): Command | null {
  const steps: Command[] = [];
  if (r.size) {
    const scaled = applyPageOp(doc, { kind: 'scale', ...r.size }, label);
    if (scaled) steps.push(scaled);
  }
  const dpi = dpiStep(doc, r.dpi, label);
  if (dpi) steps.push(dpi);
  const step = combineCommands(label, steps);
  return step ? { ...step, region: null, pageChange: true } : null;
}

/**
 * Apply the size, resolution, paper and frame guides as one history step (already applied). Returns null when
 * nothing changes. The step is a page change: the interface sets itself up for the page again.
 */
export function applyCanvasProps(doc: Document, p: CanvasProps, label: string): Command | null {
  const steps: Command[] = [];

  if (p.rect) {
    const resize = applyPageOp(doc, { kind: 'resize', rect: p.rect }, label);
    if (resize) steps.push(resize);
  }

  const dpi = dpiStep(doc, p.dpi, label);
  if (dpi) steps.push(dpi);

  const paper = doc.layers.find((l) => l.kind === 'paper');
  if (paper && p.paper !== undefined) {
    const was = { visible: paper.visible, color: paper.paperColor };
    const now = p.paper === null ? { visible: false, color: paper.paperColor } : { visible: true, color: p.paper };
    if (was.visible !== now.visible || was.color?.join() !== now.color?.join()) {
      const put = (s: typeof was): void => {
        paper.visible = s.visible;
        paper.paperColor = s.color;
      };
      put(now);
      steps.push({ label, region: null, undo: () => put(was), redo: () => put(now) });
    }
  }

  if (p.frame?.length) {
    const lines = frameGuides(doc.width, doc.height, p.frame);
    const guides = recordGuides(doc, label, () => {
      doc.guides = { v: [...new Set([...doc.guides.v, ...lines.v])].sort((a, b) => a - b), h: [...new Set([...doc.guides.h, ...lines.h])].sort((a, b) => a - b) };
    });
    if (guides) steps.push(guides);
  }

  const step = combineCommands(label, steps);
  if (!step) return null;
  return { ...step, region: null, pageChange: true };
}
