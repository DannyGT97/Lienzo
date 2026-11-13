export type RGB = [number, number, number];
export type HSV = [number, number, number];

/** RGB 0..255 -> hue 0..360, saturation 0..1, value 0..1. */
export function rgbToHsv(r: number, g: number, b: number): HSV {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

/** Hue 0..360, saturation and value 0..1 -> RGB 0..255 (rounded). */
export function hsvToRgb(h: number, s: number, v: number): RGB {
  const H = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (H < 60) [r, g, b] = [c, x, 0];
  else if (H < 120) [r, g, b] = [x, c, 0];
  else if (H < 180) [r, g, b] = [0, c, x];
  else if (H < 240) [r, g, b] = [0, x, c];
  else if (H < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** CIE L*a*b* (D65): L 0..100, a and b about -128..127. */
export type Lab = [number, number, number];
/** Cyan, magenta, yellow and key (black), each 0..100 (a plain device conversion, no ink profile). */
export type CMYK = [number, number, number, number];

const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gam = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const LAB_E = 216 / 24389;
const LAB_K = 24389 / 27;
const WHITE = [0.95047, 1, 1.08883] as const;

export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = lin(r / 255);
  const G = lin(g / 255);
  const B = lin(b / 255);
  const xyz = [
    (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / WHITE[0],
    (0.2126729 * R + 0.7151522 * G + 0.072175 * B) / WHITE[1],
    (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / WHITE[2],
  ];
  const [fx, fy, fz] = xyz.map((t) => (t > LAB_E ? Math.cbrt(t) : (LAB_K * t + 16) / 116)) as [number, number, number];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Lab -> RGB 0..255 (rounded). Colours outside the screen's range are clipped to it. */
export function labToRgb(L: number, a: number, b: number): RGB {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (f: number): number => (f ** 3 > LAB_E ? f ** 3 : (116 * f - 16) / LAB_K);
  const X = inv(fx) * WHITE[0];
  const Y = (L > LAB_K * LAB_E ? fy ** 3 : L / LAB_K) * WHITE[1];
  const Z = inv(fz) * WHITE[2];
  const lr = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  const lg = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z;
  const lb = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  return [lr, lg, lb].map((v) => Math.round(Math.min(1, Math.max(0, gam(Math.min(1, Math.max(0, v))))) * 255)) as RGB;
}

export function rgbToCmyk(r: number, g: number, b: number): CMYK {
  const k = 1 - Math.max(r, g, b) / 255;
  if (k >= 1) return [0, 0, 0, 100];
  return [((1 - r / 255 - k) / (1 - k)) * 100, ((1 - g / 255 - k) / (1 - k)) * 100, ((1 - b / 255 - k) / (1 - k)) * 100, k * 100];
}

export function cmykToRgb(c: number, m: number, y: number, k: number): RGB {
  const K = 1 - Math.min(100, Math.max(0, k)) / 100;
  const f = (v: number): number => Math.round(255 * (1 - Math.min(100, Math.max(0, v)) / 100) * K);
  return [f(c), f(m), f(y)];
}

export const toHex = (c: readonly number[]): string => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

export function fromHex(hex: string): RGB {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** A neutral starting palette for the colour set: pure hues, tints and greys (our own selection). */
export const DEFAULT_COLOR_SET: string[] = [
  '#000000', '#3a3a3a', '#707070', '#a8a8a8', '#d8d8d8', '#ffffff',
  '#7a1f1f', '#c0392b', '#e8553e', '#f08a5d', '#f6b98a', '#fbe0c8',
  '#7a4a14', '#b9770e', '#e0a030', '#f2c94c', '#f7e08a', '#fcf1c4',
  '#245c2e', '#2e8b57', '#52b36a', '#8fd19e', '#c3e8c9', '#e6f5e8',
  '#14506b', '#1f77b4', '#4da3d9', '#8ec9ee', '#c2e2f5', '#e4f2fb',
  '#3b2a7a', '#6c4ab6', '#9b7fd6', '#c4b0ea', '#7a1f5a', '#c0398f',
];
