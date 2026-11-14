/**
 * Maths of the canvas scrollbars and of how far the page may be moved off the screen.
 *
 * Everything is along one screen axis, in CSS pixels of the stage: the viewport is [0, vp] and the page (its four corners,
 * wherever the view is turned or mirrored) covers `page`. The page may be moved until the middle of the stage meets its edge
 * (main.ts keeps it so), so a margin of half the viewport is allowed around it and the page can never be lost from sight.
 */
export interface Span {
  lo: number;
  hi: number;
}

export const spanOf = (values: number[]): Span => ({ lo: Math.min(...values), hi: Math.max(...values) });

/** Where the viewport's start may be (stage coordinates): the page edges, less/plus half a viewport. */
export function startRange(page: Span, vp: number): Span {
  return { lo: page.lo - vp / 2, hi: page.hi - vp / 2 };
}

export interface Thumb {
  /** False when there is nothing to scroll (no room to move). */
  scrollable: boolean;
  /** Thumb length and offset along the track, in px. */
  size: number;
  pos: number;
}

/** The thumb on a track of `track` px: its size is the share of the whole scrollable extent that is on screen. */
export function thumbOf(page: Span, vp: number, track: number, minSize: number): Thumb {
  const r = startRange(page, vp);
  const range = r.hi - r.lo;
  if (!(track > 0) || !(range > 0) || !(vp > 0)) return { scrollable: false, size: Math.max(0, track), pos: 0 };
  const size = Math.min(track, Math.max(minSize, (vp / (range + vp)) * track));
  const t = Math.min(1, Math.max(0, (0 - r.lo) / range));
  return { scrollable: true, size, pos: t * (track - size) };
}

/** Dragging the thumb by `deltaPx` along the track: how much the content moves (opposite to the viewport). */
export function shiftForThumbDrag(page: Span, vp: number, track: number, minSize: number, deltaPx: number): number {
  const t = thumbOf(page, vp, track, minSize);
  const free = track - t.size;
  if (!t.scrollable || !(free > 0)) return 0;
  const r = startRange(page, vp);
  return -(deltaPx / free) * (r.hi - r.lo);
}

/** A click on the track beside the thumb: a page of scrolling (a little less than the viewport) towards the click. */
export const shiftForTrackClick = (vp: number, towardsEnd: boolean): number => (towardsEnd ? -1 : 1) * vp * 0.9;
