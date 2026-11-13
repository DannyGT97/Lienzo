import type { Command } from './history';
import type { Pt } from './geometry';

/** Ruler guides of a page: vertical lines at the given x, horizontal lines at the given y (page pixels). */
export interface Guides {
  v: number[];
  h: number[];
}

export const emptyGuides = (): Guides => ({ v: [], h: [] });

export interface SnapOptions {
  /** Snap to the guide lines. */
  guides: boolean;
  /** Snap to a grid with this step (page pixels); 0 = no grid snapping. */
  gridStep: number;
  /** How close (page pixels) a point has to be to be pulled in. */
  tolerance: number;
}

/** The closest target within `tol` of `value`, or null. */
function nearest(value: number, targets: readonly number[], tol: number): number | null {
  let best: number | null = null;
  let bestD = tol;
  for (const t of targets) {
    const d = Math.abs(t - value);
    if (d <= bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/** Pull a point onto a guide or a grid line, each axis on its own. Guides win over the grid. */
export function snapPoint(p: Pt, guides: Guides, o: SnapOptions): Pt {
  const axis = (value: number, lines: readonly number[]): number => {
    if (o.guides) {
      const g = nearest(value, lines, o.tolerance);
      if (g !== null) return g;
    }
    if (o.gridStep > 0) {
      const g = Math.round(value / o.gridStep) * o.gridStep;
      if (Math.abs(g - value) <= o.tolerance) return g;
    }
    return value;
  };
  return { x: axis(p.x, guides.v), y: axis(p.y, guides.h) };
}

/** Which guide is under a point: its axis and position in the list, or null. */
export function guideAt(p: Pt, guides: Guides, tol: number): { axis: 'v' | 'h'; index: number } | null {
  let best: { axis: 'v' | 'h'; index: number } | null = null;
  let bestD = tol;
  guides.v.forEach((x, index) => {
    const d = Math.abs(x - p.x);
    if (d <= bestD) {
      best = { axis: 'v', index };
      bestD = d;
    }
  });
  guides.h.forEach((y, index) => {
    const d = Math.abs(y - p.y);
    if (d <= bestD) {
      best = { axis: 'h', index };
      bestD = d;
    }
  });
  return best;
}

const copy = (g: Guides): Guides => ({ v: [...g.v], h: [...g.h] });

/** Run `change` on a document's guides and return the history step for it (null when nothing changed). */
export function recordGuides(owner: { guides: Guides }, label: string, change: () => void): Command | null {
  const before = copy(owner.guides);
  change();
  const after = copy(owner.guides);
  if (before.v.join() === after.v.join() && before.h.join() === after.h.join()) return null;
  return {
    label,
    region: null,
    undo: () => void (owner.guides = copy(before)),
    redo: () => void (owner.guides = copy(after)),
  };
}
