// Blend modes. Formulas follow the public W3C Compositing and Blending spec plus the usual
// definitions of the extra modes, written here from scratch. A few details are choices of this implementation (small
// denominators in the dodge/burn/divide family, the hard-mix threshold, the glow modes, and the
// alpha rules in compositePixel).

export const BLEND_MODES = [
  'normal',
  'darken',
  'multiply',
  'colorBurn',
  'linearBurn',
  'subtract',
  'darkerColor',
  'lighten',
  'screen',
  'colorDodge',
  'glowDodge',
  'add',
  'addGlow',
  'lighterColor',
  'overlay',
  'softLight',
  'hardLight',
  'vividLight',
  'linearLight',
  'pinLight',
  'hardMix',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'divide',
] as const;

export type BlendMode = (typeof BLEND_MODES)[number];

export type RGB = readonly [number, number, number];

/** Tolerance for the modes that switch abruptly (darker/lighter colour); the GPU shader uses the same value. */
export const TIE = 1e-6;

/** Smallest denominator the dodge, burn and divide families divide by. */
export const EPS = 0.001;

/** Hard mix on a dark backdrop needs this much less than a full sum to flip, so mid greys do not flicker. */
export const HARD_MIX_BIAS = 1 / 256;

/** Modes whose result alpha is the (clamped) sum of both alphas instead of the usual union. */
export const ALPHA_ADD_MODES: ReadonlySet<BlendMode> = new Set<BlendMode>(['screen', 'colorDodge', 'glowDodge', 'softLight', 'hardLight']);

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

type Channel = (cb: number, cs: number) => number;

const colorDodge: Channel = (cb, cs) => Math.min(1, cb / Math.max(1 - cs, EPS));
const colorBurn: Channel = (cb, cs) => 1 - Math.min(1, (1 - cb) / Math.max(cs, EPS));
const hardLight: Channel = (cb, cs) =>
  cs <= 0.5 ? cb * 2 * cs : 1 - (1 - cb) * (1 - (2 * cs - 1));

const softLight: Channel = (cb, cs) => {
  if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
  const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
  return cb + (2 * cs - 1) * (d - cb);
};

const separable: Partial<Record<BlendMode, Channel>> = {
  normal: (_cb, cs) => cs,
  darken: Math.min,
  multiply: (cb, cs) => cb * cs,
  colorBurn,
  linearBurn: (cb, cs) => clamp01(cb + cs - 1),
  subtract: (cb, cs) => clamp01(cb - cs),
  lighten: Math.max,
  screen: (cb, cs) => cb + cs - cb * cs,
  colorDodge,
  // Glow dodge is a dodge whose source is weighted by its own alpha (handled in blendColor).
  glowDodge: colorDodge,
  add: (cb, cs) => clamp01(cb + cs),
  // Left unclamped: the compositor clamps after weighting by the alpha, which is what makes it glow.
  addGlow: (cb, cs) => cb + cs,
  overlay: (cb, cs) => hardLight(cs, cb),
  softLight,
  hardLight,
  vividLight: (cb, cs) => (cs <= 0.5 ? colorBurn(cb, 2 * cs) : colorDodge(cb, 2 * cs - 1)),
  linearLight: (cb, cs) => clamp01(cb + 2 * cs - 1),
  pinLight: (cb, cs) => (cs <= 0.5 ? Math.min(cb, 2 * cs) : Math.max(cb, 2 * cs - 1)),
  hardMix: (cb, cs) => (cb + cs - (cb < 0.5 ? HARD_MIX_BIAS : 0) >= 1 ? 1 : 0),
  difference: (cb, cs) => Math.abs(cb - cs),
  exclusion: (cb, cs) => cb + cs - 2 * cb * cs,
  divide: (cb, cs) => Math.min(1, cb / (cs + EPS)),
};

const lum = (c: RGB): number => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

function clipColor(r: number, g: number, b: number): RGB {
  const l = 0.3 * r + 0.59 * g + 0.11 * b;
  const n = Math.min(r, g, b);
  const x = Math.max(r, g, b);
  if (n < 0) {
    const k = l / (l - n);
    r = l + (r - l) * k;
    g = l + (g - l) * k;
    b = l + (b - l) * k;
  }
  if (x > 1) {
    const k = (1 - l) / (x - l);
    r = l + (r - l) * k;
    g = l + (g - l) * k;
    b = l + (b - l) * k;
  }
  return [r, g, b];
}

function setLum(c: RGB, l: number): RGB {
  const d = l - lum(c);
  return clipColor(c[0] + d, c[1] + d, c[2] + d);
}

const sat = (c: RGB): number => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);

function setSat(c: RGB, s: number): RGB {
  const out = [c[0], c[1], c[2]];
  const idx = [0, 1, 2].sort((i, j) => out[i]! - out[j]!);
  const [lo, mid, hi] = idx as [number, number, number];
  if (out[hi]! > out[lo]!) {
    out[mid] = ((out[mid]! - out[lo]!) * s) / (out[hi]! - out[lo]!);
    out[hi] = s;
  } else {
    out[mid] = 0;
    out[hi] = 0;
  }
  out[lo] = 0;
  return [out[0]!, out[1]!, out[2]!];
}

/**
 * B(cb, cs): blended colour before alpha compositing. Inputs in [0,1]; `as` is the source alpha, which
 * only glow dodge uses. The result is clamped to [0,1] unless `clamp` is false (add glow can exceed 1).
 */
export function blendColor(mode: BlendMode, cb: RGB, cs: RGB, as = 1, clamp = true): RGB {
  if (mode === 'glowDodge') return [colorDodge(cb[0], cs[0] * as), colorDodge(cb[1], cs[1] * as), colorDodge(cb[2], cs[2] * as)];
  const f = separable[mode];
  if (f) {
    const o: RGB = [f(cb[0], cs[0]), f(cb[1], cs[1]), f(cb[2], cs[2])];
    return clamp ? [clamp01(o[0]), clamp01(o[1]), clamp01(o[2])] : o;
  }
  switch (mode) {
    case 'darkerColor':
      return lum(cs) < lum(cb) - TIE ? cs : cb;
    case 'lighterColor':
      return lum(cs) > lum(cb) + TIE ? cs : cb;
    case 'hue':
      return setLum(setSat(cs, sat(cb)), lum(cb));
    case 'saturation':
      return setLum(setSat(cb, sat(cs)), lum(cb));
    case 'color':
      return setLum(cs, lum(cb));
    case 'luminosity':
      return setLum(cb, lum(cs));
    default:
      return cs;
  }
}
