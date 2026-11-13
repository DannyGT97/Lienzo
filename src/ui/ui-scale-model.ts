// The interface scale as numbers: the range the person may choose, the factor really applied in a window and the layout
// it leaves room for. No DOM here, so preferences and tests can use it on their own; ui-scale.ts applies it to the page.

export const UI_SCALE_MIN = 50;
export const UI_SCALE_MAX = 200;
export const UI_SCALE_STEP = 5;
export const UI_SCALE_DEFAULT = 100;
/** Quick choices offered next to the slider. */
export const UI_SCALE_PRESETS: readonly number[] = [75, 100, 125, 150, 200];

/** A percentage the person typed or stored → a whole number inside the range, on the step grid. */
export function clampUiScale(value: unknown): number {
  // Only numbers and numeric text count: Number(null) and Number('') are 0, which is not a choice the person made.
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return UI_SCALE_DEFAULT;
  const stepped = Math.round(n / UI_SCALE_STEP) * UI_SCALE_STEP;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, stepped));
}

/**
 * Narrowest the zoomed chrome may become, in its own pixels: a window never has to fit a bar wider than this, whatever
 * the preference says. (A 375 px phone allows up to ~117 %; a 1280 px desktop window the whole range.)
 */
const CHROME_MIN_WIDTH = 320;

/** The factor really applied in a window of this width: the preference, held back only where the chrome could not fit. */
export function effectiveUiScale(percent: number, viewportWidth: number): number {
  const wanted = clampUiScale(percent) / 100;
  const room = Math.max(1, viewportWidth / CHROME_MIN_WIDTH);
  return Math.min(wanted, room);
}

/**
 * Width (screen px) at and below which the docks turn into side drawers. At 100 % that is 1000 px, as it always was:
 * 572 px of docks plus a canvas of at least ~428 px. Larger scales need more room for the same docks; smaller scales
 * keep drawers on a narrow window instead of squeezing the canvas.
 */
export function drawerBreakpoint(scale: number): number {
  return Math.max(1000, Math.round(428 + 572 * scale));
}

export const wantsDrawers = (viewportWidth: number, scale: number): boolean => viewportWidth <= drawerBreakpoint(scale);
