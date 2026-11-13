import type { RGB } from './blend';
import { FILTERS, defaultValues, type FilterContext } from './filters';

/**
 * Adjustment layers: instead of pixels they hold a colour correction that is applied to everything composited below them
 * (inside their folder, or the whole page for a pass-through folder), limited by their opacity, mask and clipping.
 * Own design: nothing about Clip Studio's adjustment layers is known beyond their names.
 *
 * An adjustment is kept as the filter it came from plus its values, and is evaluated through a look-up table so the
 * CPU compositor (export, flatten, eyedropper) and the GL shader (screen) share one definition and agree exactly:
 *   - `channel` filters change each channel on its own, so the table is read with the channel's own value;
 *   - `luma` filters (threshold, gradient map) depend on the brightness only, so every channel reads its table at the
 *     pixel's brightness.
 * Filters that mix channels in other ways (hue/saturation, colour matching) cannot be expressed this way and are not offered.
 */
export interface AdjustSettings {
  /** An id of `ADJUSTMENTS`. */
  filter: string;
  values: Record<string, number>;
  /** The colours the filter used (gradient map) when the layer was made: an adjustment does not follow later colour changes. */
  main: RGB;
  sub: RGB;
}

/** The filters offered as adjustment layers, and how each is evaluated. */
export const ADJUSTMENTS: Readonly<Record<string, 'channel' | 'luma'>> = {
  brightness: 'channel',
  levels: 'channel',
  tonecurve: 'channel',
  posterize: 'channel',
  balance: 'channel',
  invert: 'channel',
  binarize: 'luma',
  gradientmap: 'luma',
};

export const isAdjustable = (id: string): boolean => Object.hasOwn(ADJUSTMENTS, id);

export function defaultAdjust(filter: string, ctx: FilterContext): AdjustSettings {
  const def = FILTERS[filter];
  if (!def || !isAdjustable(filter)) throw new Error(`"${filter}" is not an adjustment`);
  return { filter, values: defaultValues(def), main: [...ctx.main], sub: [...ctx.sub] };
}

/** Three 256-entry tables (red, green, blue) laid out one after the other, and how they are read. */
export interface AdjustLut {
  mode: 'channel' | 'luma';
  /** 768 bytes: red[0..255], green[256..511], blue[512..767]. */
  table: Uint8Array;
}

/** Build the tables by running the filter on grey ramps: for a separable or brightness-only filter that is all there is to it. */
export function adjustLut(a: AdjustSettings): AdjustLut | null {
  const def = FILTERS[a.filter];
  const mode = ADJUSTMENTS[a.filter];
  if (!def || def.kind !== 'pixel' || !mode) return null;
  const run = def.make({ ...defaultValues(def), ...a.values }, { main: a.main, sub: a.sub });
  const table = new Uint8Array(768);
  const c = [0, 0, 0, 255];
  for (let i = 0; i < 256; i++) {
    c[0] = c[1] = c[2] = i;
    c[3] = 255;
    run(c);
    for (let k = 0; k < 3; k++) table[k * 256 + i] = Math.round(Math.min(255, Math.max(0, c[k]!)));
  }
  return { mode, table };
}

/** Adjust one colour (0..1 floats) in place. */
export function applyAdjustLut(lut: AdjustLut, rgb: number[]): void {
  const t = lut.table;
  if (lut.mode === 'luma') {
    const i = Math.round(Math.min(1, Math.max(0, 0.299 * rgb[0]! + 0.587 * rgb[1]! + 0.114 * rgb[2]!)) * 255);
    for (let k = 0; k < 3; k++) rgb[k] = t[k * 256 + i]! / 255;
    return;
  }
  for (let k = 0; k < 3; k++) rgb[k] = t[k * 256 + Math.round(Math.min(1, Math.max(0, rgb[k]!)) * 255)]! / 255;
}
