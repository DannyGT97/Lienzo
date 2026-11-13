import type { Pt } from '../engine/geometry';
import type { Rect } from '../engine/tiles';

// The geometry of the "canvas size" mode: the new page is a window over the old one, with a handle on each corner
// and side. Everything is in old-page pixels; nothing here knows about the screen except the reach of a handle.

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Where the old page sits inside the new one on each axis: 0 = start, 0.5 = centre, 1 = end. */
export interface Anchor {
  x: 0 | 0.5 | 1;
  y: 0 | 0.5 | 1;
}
export const CENTER: Anchor = { x: 0.5, y: 0.5 };

export function handlePoint(r: Rect, h: Handle): Pt {
  const x = h.includes('w') ? r.x : h.includes('e') ? r.x + r.w : r.x + r.w / 2;
  const y = h.includes('n') ? r.y : h.includes('s') ? r.y + r.h : r.y + r.h / 2;
  return { x, y };
}

/** The handle nearest to `p` within `reach` (both in page pixels), or null. */
export function hitHandle(r: Rect, p: Pt, reach: number): Handle | null {
  let best: Handle | null = null;
  let bestD = Infinity;
  for (const h of HANDLES) {
    const q = handlePoint(r, h);
    const d = Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));
    if (d <= reach && d < bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

/** The window after dragging `h` to `p`: only the edges that handle owns move, and the window never gets smaller than 1 px. */
export function dragHandle(r: Rect, h: Handle, p: Pt): Rect {
  let left = r.x;
  let top = r.y;
  let right = r.x + r.w;
  let bottom = r.y + r.h;
  if (h.includes('w')) left = Math.min(Math.round(p.x), right - 1);
  if (h.includes('e')) right = Math.max(Math.round(p.x), left + 1);
  if (h.includes('n')) top = Math.min(Math.round(p.y), bottom - 1);
  if (h.includes('s')) bottom = Math.max(Math.round(p.y), top + 1);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Resize cursor for a handle. */
export function handleCursor(h: Handle): string {
  return h === 'n' || h === 's' ? 'ns-resize' : h === 'e' || h === 'w' ? 'ew-resize' : h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize';
}
