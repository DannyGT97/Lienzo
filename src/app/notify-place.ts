/**
 * Where the notices go, as plain geometry (the view measures and applies it).
 * The notices sit at the bottom, above the status bar. A dialog the person moved there would be covered, so the
 * notices first try the other candidate side; when a dialog covers both, the dialog is nudged aside (just enough, and
 * only while a notice with buttons needs the person's finger) and goes back to where it was put afterwards.
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** br/bl: bottom right/left (desktop). bc/tc: bottom/top centre (touch). */
export type Spot = 'br' | 'bl' | 'bc' | 'tc';

export const candidateSpots = (touch: boolean): [Spot, Spot] => (touch ? ['bc', 'tc'] : ['br', 'bl']);

export const overlaps = (a: Box, b: Box): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

export interface SpotChoice {
  spot: Spot;
  /** Every candidate is covered by a dialog. */
  blocked: boolean;
}

/** The first candidate whose notices overlap no dialog; when none is free, the usual one, flagged as blocked. */
export function chooseSpot(candidates: readonly Spot[], boxAt: (spot: Spot) => Box, dialogs: readonly Box[]): SpotChoice {
  for (const spot of candidates) {
    const box = boxAt(spot);
    if (!dialogs.some((d) => overlaps(d, box))) return { spot, blocked: false };
  }
  return { spot: candidates[0]!, blocked: true };
}

/**
 * How far to move `dialog` vertically (negative = up) so it clears `notices`, without leaving `area`.
 * Away from the side the notices are on; 0 when it cannot help or nothing overlaps.
 */
export function nudgeFor(dialog: Box, notices: Box, area: { top: number; bottom: number }, gap = 8): number {
  if (!overlaps(dialog, notices)) return 0;
  const noticesAtTop = (notices.top + notices.bottom) / 2 < (area.top + area.bottom) / 2;
  if (noticesAtTop) {
    const want = notices.bottom + gap - dialog.top; // down
    const room = area.bottom - dialog.bottom;
    return Math.max(0, Math.min(want, room));
  }
  const want = dialog.bottom - (notices.top - gap); // up
  const room = dialog.top - area.top;
  return -Math.max(0, Math.min(want, room));
}
