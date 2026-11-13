/**
 * Brush size on a logarithmic scale: dragging the slider changes the size by a
 * constant *ratio*, so thin lines get fine steps and a thick brush is reachable
 * without dragging past thousands of pixels (the way Clip Studio's size slider works).
 */
export const MIN_SIZE = 1;
export const MAX_SIZE = 2000;
export const SLIDER_STEPS = 1000;

/** Sizes the [ and ] keys step through. */
export const SIZE_PRESETS = [
  1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1500,
  2000,
] as const;

export const clampSize = (size: number): number => Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(size)));

/** Slider position 0..SLIDER_STEPS → size in pixels. */
export function posToSize(pos: number): number {
  const t = Math.min(1, Math.max(0, pos / SLIDER_STEPS));
  return clampSize(MIN_SIZE * Math.pow(MAX_SIZE / MIN_SIZE, t));
}

/** Size in pixels → slider position. */
export function sizeToPos(size: number): number {
  const s = clampSize(size);
  return Math.round((Math.log(s / MIN_SIZE) / Math.log(MAX_SIZE / MIN_SIZE)) * SLIDER_STEPS);
}

/** The next preset above (dir = 1) or below (dir = -1) the current size. */
export function stepSize(current: number, dir: 1 | -1): number {
  const s = clampSize(current);
  if (dir === 1) return SIZE_PRESETS.find((p) => p > s) ?? MAX_SIZE;
  for (let i = SIZE_PRESETS.length - 1; i >= 0; i--) if (SIZE_PRESETS[i]! < s) return SIZE_PRESETS[i]!;
  return MIN_SIZE;
}

const tenth = (v: number): number => Math.round(v * 10) / 10;

/** A size to a tenth of a pixel (the arrows of the quick size popup move it by 0.1). */
export const clampSizeFine = (size: number): number => Math.min(MAX_SIZE, Math.max(MIN_SIZE, tenth(size)));

/** The size as the round readout shows it: 12.0 for fine brushes, whole pixels once it is big. */
export const formatSize = (size: number): string => (size >= 100 ? String(Math.round(size)) : size.toFixed(1));

/** Opacity in percent, to a tenth, never fully transparent (a stroke at 0 % paints nothing). */
export const clampOpacityPct = (pct: number): number => Math.min(100, Math.max(0.1, tenth(pct)));

export const formatOpacity = (pct: number): string => (Number.isInteger(pct) ? String(pct) : pct.toFixed(1));
