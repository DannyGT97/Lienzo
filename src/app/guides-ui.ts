import type { Document } from '../engine/document';
import { guideAt, recordGuides, snapPoint, type Guides } from '../engine/guides';
import type { History } from '../engine/history';
import type { Pt } from '../engine/geometry';

export interface GuidesDeps {
  doc: () => Document;
  view: { x: number; y: number; scale: number };
  stage: HTMLElement;
  /** The page point under a pointer position, whatever way the view is turned. */
  toDoc: (clientX: number, clientY: number) => Pt;
  history: () => History;
  redraw: () => void;
  /** Spacing of the grid in page pixels, for snapping to it. */
  gridStep: () => number;
}

const RULER = 20; // thickness of the rulers (see rulers.ts)

/** Ruler guides: drag them out of the rulers, move them, drag them back to delete them, and snap tools to them. */
export function createGuidesUi(d: GuidesDeps): {
  /** A drag that starts on a ruler makes a new guide ('h' = from the top ruler, a horizontal line). */
  startNew(axis: 'v' | 'h', e: PointerEvent): void;
  /** Start moving the guide under `p`, if there is one. */
  grab(p: Pt, e: PointerEvent): boolean;
  hover(p: Pt): boolean;
  draw(ctx: CanvasRenderingContext2D): void;
  snap(p: Pt): Pt;
  readonly snapToGuides: boolean;
  readonly snapToGrid: boolean;
  toggleSnapGuides(): void;
  toggleSnapGrid(): void;
  clear(): void;
  readonly any: boolean;
} {
  let snapGuides = true;
  let snapGrid = false;
  let live: { outside: boolean } | null = null;

  const copy = (g: Guides): Guides => ({ v: [...g.v], h: [...g.h] });
  const pageOf = (e: PointerEvent): Pt => d.toDoc(e.clientX, e.clientY);
  /** True when the pointer is over a ruler or off the stage: letting go there throws the guide away. */
  const overRuler = (e: PointerEvent, axis: 'v' | 'h'): boolean => {
    const r = d.stage.getBoundingClientRect();
    return axis === 'v' ? e.clientX - r.left < RULER || e.clientX > r.right : e.clientY - r.top < RULER || e.clientY > r.bottom;
  };

  function begin(axis: 'v' | 'h', existing: number | null, e: PointerEvent): void {
    const doc = d.doc();
    const before = copy(doc.guides);
    const lineOf = (g: Guides): number[] => (axis === 'v' ? g.v : g.h);
    const posOf = (ev: PointerEvent): number => Math.round(axis === 'v' ? pageOf(ev).x : pageOf(ev).y);
    const isNew = existing === null;
    if (isNew) lineOf(doc.guides).push(posOf(e));
    const i = isNew ? lineOf(doc.guides).length - 1 : existing;
    live = { outside: isNew };
    const move = (ev: PointerEvent): void => {
      if (!live) return;
      lineOf(doc.guides)[i] = posOf(ev);
      live.outside = overRuler(ev, axis);
      d.redraw();
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!live) return;
      const finalPos = lineOf(doc.guides)[i]!;
      const outside = live.outside;
      live = null;
      // Put the guides back as they were and apply the result as one undoable step.
      doc.guides.v = [...before.v];
      doc.guides.h = [...before.h];
      const label = isNew ? 'Nueva guía' : outside ? 'Borrar guía' : 'Mover guía';
      const cmd = recordGuides(doc, label, () => {
        const arr = lineOf(doc.guides);
        if (isNew) {
          if (!outside) arr.push(finalPos);
        } else if (outside) arr.splice(i, 1);
        else arr[i] = finalPos;
      });
      if (cmd) d.history().push(cmd);
      d.redraw();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    d.redraw();
  }

  return {
    startNew: (axis, e) => begin(axis, null, e),
    grab(p, e) {
      const hit = guideAt(p, d.doc().guides, 6 / d.view.scale);
      if (!hit) return false;
      begin(hit.axis, hit.index, e);
      return true;
    },
    hover: (p) => guideAt(p, d.doc().guides, 6 / d.view.scale) !== null,
    draw(ctx) {
      const g = d.doc().guides;
      if (!g.v.length && !g.h.length) return;
      const s = d.view.scale;
      ctx.save();
      ctx.lineWidth = 1 / s;
      ctx.strokeStyle = live?.outside ? 'rgba(255, 90, 90, 0.9)' : 'rgba(40, 200, 255, 0.9)';
      ctx.beginPath();
      const far = 1e6;
      for (const x of g.v) {
        ctx.moveTo(x, -far);
        ctx.lineTo(x, far);
      }
      for (const y of g.h) {
        ctx.moveTo(-far, y);
        ctx.lineTo(far, y);
      }
      ctx.stroke();
      ctx.restore();
    },
    snap(p) {
      return snapPoint(p, d.doc().guides, { guides: snapGuides, gridStep: snapGrid ? d.gridStep() : 0, tolerance: 8 / d.view.scale });
    },
    get snapToGuides() {
      return snapGuides;
    },
    get snapToGrid() {
      return snapGrid;
    },
    toggleSnapGuides() {
      snapGuides = !snapGuides;
    },
    toggleSnapGrid() {
      snapGrid = !snapGrid;
    },
    clear() {
      const cmd = recordGuides(d.doc(), 'Borrar guías', () => {
        d.doc().guides.v = [];
        d.doc().guides.h = [];
      });
      if (cmd) d.history().push(cmd);
      d.redraw();
    },
    get any() {
      const g = d.doc().guides;
      return g.v.length + g.h.length > 0;
    },
  };
}
