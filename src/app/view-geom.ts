import type { Pt } from '../engine/geometry';

/**
 * Where the page is on screen. The page is placed on a "plane" (the stage turned back to the page's own orientation)
 * with an offset and a zoom; the plane is then turned by quarter turns and optionally mirrored to fit the screen.
 * All of x, y and scale describe the plane, so panning and zooming maths stays the same however the view is turned.
 */
export interface ViewState {
  x: number;
  y: number;
  scale: number;
  /** Quarter turns clockwise (0..3). */
  rot: 0 | 1 | 2 | 3;
  /** Mirrored left to right (on the plane, before turning). */
  flip: boolean;
  /** A free turn in radians, clockwise, applied about the middle of the stage after the quarter turns (default 0). */
  tilt?: number;
}

export interface StageSize {
  w: number;
  h: number;
}

export const isTurned = (v: Pick<ViewState, 'rot' | 'flip' | 'tilt'>): boolean => v.rot !== 0 || v.flip || !!v.tilt;

/**
 * Size of the plane: the stage, swapped when the view is turned a quarter. A freely turned view needs a square as
 * long as the stage's diagonal, so the page still fills the corners of the stage.
 */
export const planeSize = (v: Pick<ViewState, 'rot' | 'tilt'>, s: StageSize): StageSize => {
  if (v.tilt) {
    const side = Math.ceil(Math.hypot(s.w, s.h));
    return { w: side, h: side };
  }
  return v.rot % 2 ? { w: s.h, h: s.w } : s;
};

/** A point of the stage (CSS pixels from its top left corner) -> the same point on the plane. */
export function screenToPlane(v: ViewState, s: StageSize, sx: number, sy: number): Pt {
  const { w: cw, h: ch } = planeSize(v, s);
  if (v.tilt) {
    // Undo the free turn about the middle of the stage; what is left is the quarter-turned plane.
    const cos = Math.cos(v.tilt);
    const sin = Math.sin(v.tilt);
    const dx = sx - s.w / 2;
    const dy = sy - s.h / 2;
    sx = dx * cos + dy * sin + cw / 2;
    sy = -dx * sin + dy * cos + ch / 2;
  }
  let u: number;
  let w: number;
  switch (v.rot) {
    case 0:
      u = sx;
      w = sy;
      break;
    case 1:
      u = sy;
      w = ch - sx;
      break;
    case 2:
      u = cw - sx;
      w = ch - sy;
      break;
    default:
      u = cw - sy;
      w = sx;
  }
  return { x: v.flip ? cw - u : u, y: w };
}

export function planeToScreen(v: ViewState, s: StageSize, px: number, py: number): Pt {
  const { w: cw, h: ch } = planeSize(v, s);
  const u = v.flip ? cw - px : px;
  let x: number;
  let y: number;
  switch (v.rot) {
    case 0:
      x = u;
      y = py;
      break;
    case 1:
      x = ch - py;
      y = u;
      break;
    case 2:
      x = cw - u;
      y = ch - py;
      break;
    default:
      x = py;
      y = cw - u;
  }
  if (!v.tilt) return { x, y };
  const cos = Math.cos(v.tilt);
  const sin = Math.sin(v.tilt);
  const dx = x - cw / 2;
  const dy = y - ch / 2;
  return { x: dx * cos - dy * sin + s.w / 2, y: dx * sin + dy * cos + s.h / 2 };
}

/** A point of the stage -> the page point under it. */
export function screenToDoc(v: ViewState, s: StageSize, sx: number, sy: number): Pt {
  const p = screenToPlane(v, s, sx, sy);
  return { x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale };
}

/** A page point -> where it is on the stage. */
export function docToScreen(v: ViewState, s: StageSize, x: number, y: number): Pt {
  return planeToScreen(v, s, v.x + x * v.scale, v.y + y * v.scale);
}

/** The page -> stage map as a canvas matrix [a, b, c, d, e, f]. */
export function docMatrix(v: ViewState, s: StageSize): [number, number, number, number, number, number] {
  const o = docToScreen(v, s, 0, 0);
  const ex = docToScreen(v, s, 1, 0);
  const ey = docToScreen(v, s, 0, 1);
  return [ex.x - o.x, ex.y - o.y, ey.x - o.x, ey.y - o.y, o.x, o.y];
}

/** A movement on the stage (a drag) as a movement on the plane. */
export function screenDeltaToPlane(v: ViewState, s: StageSize, dx: number, dy: number): Pt {
  const a = screenToPlane(v, s, 0, 0);
  const b = screenToPlane(v, s, dx, dy);
  return { x: b.x - a.x, y: b.y - a.y };
}

/** The page area that shows on the stage, as the outline of its four corners (the area is tilted when the view is turned). */
export function visibleOutline(v: ViewState, s: StageSize): Pt[] {
  return [screenToDoc(v, s, 0, 0), screenToDoc(v, s, s.w, 0), screenToDoc(v, s, s.w, s.h), screenToDoc(v, s, 0, s.h)];
}
