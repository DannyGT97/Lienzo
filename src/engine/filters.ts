import type { StrokePatch } from './brush';
import type { Selection } from './selection';
import { mapPixels } from './selection';
import type { Rect, TiledSurface } from './tiles';
import { TileRecorder } from './transform';

export type RGB = readonly [number, number, number];

/** A number the user sets for a filter. */
export interface FilterParam {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
}

/** Colours some filters use: the main and the secondary colour. */
export interface FilterContext {
  main: RGB;
  sub: RGB;
}

type Values = Record<string, number>;

/** One pixel at a time: `make` gets the values and returns the function that changes [r, g, b, a] (0..255, straight alpha) in place. */
export interface PixelFilter {
  kind: 'pixel';
  id: string;
  title: string;
  params: FilterParam[];
  make(v: Values, ctx: FilterContext): (c: number[]) => void;
}

/** Looks at the neighbours: runs on a block of premultiplied RGBA (0..1) of `w` × `h`, that has `margin` extra pixels all round. */
export interface AreaFilter {
  kind: 'area';
  id: string;
  title: string;
  params: FilterParam[];
  margin(v: Values): number;
  run(buf: Float32Array, w: number, h: number, v: Values, ctx: FilterContext): void;
}

export type Filter = PixelFilter | AreaFilter;

const p = (id: string, label: string, min: number, max: number, value: number, step = 1, unit?: string): FilterParam => ({ id, label, min, max, step, value, ...(unit ? { unit } : {}) });
const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
const luma = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

// ---- colour spaces ---------------------------------------------------------------------------------
/** r, g, b in 0..255 -> h in degrees, s and l in 0..1. */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

// ---- filters that change each pixel on its own -----------------------------------------------------
const invert: PixelFilter = {
  kind: 'pixel',
  id: 'invert',
  title: 'Invertir',
  params: [],
  make: () => (c) => {
    c[0] = 255 - c[0]!;
    c[1] = 255 - c[1]!;
    c[2] = 255 - c[2]!;
  },
};

const brightnessContrast: PixelFilter = {
  kind: 'pixel',
  id: 'brightness',
  title: 'Brillo y contraste',
  params: [p('brightness', 'Brillo', -100, 100, 0), p('contrast', 'Contraste', -100, 100, 0)],
  make: (v) => {
    const add = (v.brightness! / 100) * 255;
    const k = v.contrast! >= 0 ? 1 / (1 - (v.contrast! / 100) * 0.99) : 1 + v.contrast! / 100;
    return (c) => {
      for (let i = 0; i < 3; i++) c[i] = clamp255((c[i]! - 128) * k + 128 + add);
    };
  },
};

const hsv: PixelFilter = {
  kind: 'pixel',
  id: 'hsv',
  title: 'Tono, saturación y luminosidad',
  params: [p('hue', 'Tono', -180, 180, 0, 1, '°'), p('sat', 'Saturación', -100, 100, 0), p('light', 'Luminosidad', -100, 100, 0)],
  make: (v) => (c) => {
    const [h, s, l] = rgbToHsl(c[0]!, c[1]!, c[2]!);
    const s2 = Math.min(1, Math.max(0, v.sat! >= 0 ? s + (1 - s) * (v.sat! / 100) * s : s * (1 + v.sat! / 100)));
    const l2 = Math.min(1, Math.max(0, v.light! >= 0 ? l + (1 - l) * (v.light! / 100) : l * (1 + v.light! / 100)));
    const [r, g, b] = hslToRgb((h + v.hue! + 360) % 360, s2, l2);
    c[0] = clamp255(r);
    c[1] = clamp255(g);
    c[2] = clamp255(b);
  },
};

const posterize: PixelFilter = {
  kind: 'pixel',
  id: 'posterize',
  title: 'Posterizar',
  params: [p('levels', 'Niveles', 2, 16, 4)],
  make: (v) => {
    const n = v.levels! - 1;
    return (c) => {
      for (let i = 0; i < 3; i++) c[i] = Math.round(Math.round((c[i]! / 255) * n) * (255 / n));
    };
  },
};

const levels: PixelFilter = {
  kind: 'pixel',
  id: 'levels',
  title: 'Corrección de niveles',
  params: [p('black', 'Negro de entrada', 0, 254, 0), p('white', 'Blanco de entrada', 1, 255, 255), p('gamma', 'Medios tonos', 10, 400, 100, 1, '%')],
  make: (v) => {
    const lo = Math.min(v.black!, v.white! - 1);
    const span = Math.max(1, v.white! - lo);
    const g = 100 / v.gamma!;
    return (c) => {
      for (let i = 0; i < 3; i++) c[i] = clamp255(Math.pow(Math.min(1, Math.max(0, (c[i]! - lo) / span)), g) * 255);
    };
  },
};

const colorBalance: PixelFilter = {
  kind: 'pixel',
  id: 'balance',
  title: 'Balance de color',
  params: [p('r', 'Cian ⟷ Rojo', -100, 100, 0), p('g', 'Magenta ⟷ Verde', -100, 100, 0), p('b', 'Amarillo ⟷ Azul', -100, 100, 0)],
  make: (v) => (c) => {
    c[0] = clamp255(c[0]! + (v.r! / 100) * 100);
    c[1] = clamp255(c[1]! + (v.g! / 100) * 100);
    c[2] = clamp255(c[2]! + (v.b! / 100) * 100);
  },
};

const binarize: PixelFilter = {
  kind: 'pixel',
  id: 'binarize',
  title: 'Binarización',
  params: [p('threshold', 'Umbral', 1, 254, 128)],
  make: (v) => (c) => {
    const w = luma(c[0]!, c[1]!, c[2]!) >= v.threshold! ? 255 : 0;
    c[0] = c[1] = c[2] = w;
  },
};

const gradientMap: PixelFilter = {
  kind: 'pixel',
  id: 'gradientmap',
  title: 'Mapa de degradado (color principal → secundario)',
  params: [],
  make: (_v, ctx) => (c) => {
    const t = luma(c[0]!, c[1]!, c[2]!) / 255; // dark = main colour, light = secondary colour
    for (let i = 0; i < 3; i++) c[i] = ctx.main[i]! + (ctx.sub[i]! - ctx.main[i]!) * t;
  },
};

const brightnessToAlpha: PixelFilter = {
  kind: 'pixel',
  id: 'brightnessalpha',
  title: 'Convertir brillo en opacidad',
  params: [],
  make: (_v, ctx) => (c) => {
    // White becomes see-through, black stays solid: scanned line art turns into ink in the main colour.
    c[3] = c[3]! * (1 - luma(c[0]!, c[1]!, c[2]!) / 255);
    c[0] = ctx.main[0]!;
    c[1] = ctx.main[1]!;
    c[2] = ctx.main[2]!;
  },
};

// ---- filters that look at the neighbours -----------------------------------------------------------
/** Sizes of three box blurs that together approximate a gaussian of the given sigma. */
function boxSizes(sigma: number, n = 3): number[] {
  const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  const upper = lower + 2;
  const m = Math.round((12 * sigma * sigma - n * lower * lower - 4 * n * lower - 3 * n) / (-4 * lower - 4));
  return Array.from({ length: n }, (_, i) => (i < m ? lower : upper));
}

/** One box blur of the given radius along one axis (zero outside the block). */
function boxBlur(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean): void {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const stepIn = horizontal ? 4 : w * 4;
  const stepLine = horizontal ? w * 4 : 4;
  const inv = 1 / (2 * r + 1);
  for (let line = 0; line < lines; line++) {
    const base = line * stepLine;
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) if (i >= 0 && i < len) sum += src[base + i * stepIn + c]!;
      for (let i = 0; i < len; i++) {
        dst[base + i * stepIn + c] = sum * inv;
        const out = i - r;
        const inn = i + r + 1;
        if (out >= 0) sum -= src[base + out * stepIn + c]!;
        if (inn < len) sum += src[base + inn * stepIn + c]!;
      }
    }
  }
}

/** Gaussian blur in place. */
export function gaussianBlur(buf: Float32Array, w: number, h: number, sigma: number): void {
  if (sigma <= 0) return;
  const tmp = new Float32Array(buf.length);
  for (const size of boxSizes(sigma)) {
    const r = (size - 1) / 2;
    boxBlur(buf, tmp, w, h, r, true);
    boxBlur(tmp, buf, w, h, r, false);
  }
}

const gaussian: AreaFilter = {
  kind: 'area',
  id: 'gaussian',
  title: 'Desenfoque gaussiano',
  params: [p('radius', 'Radio', 1, 100, 6, 1, 'px')],
  margin: (v) => Math.ceil(v.radius! * 3),
  run: (buf, w, h, v) => gaussianBlur(buf, w, h, v.radius! / 2),
};

const motionBlur: AreaFilter = {
  kind: 'area',
  id: 'motion',
  title: 'Desenfoque de movimiento',
  params: [p('angle', 'Ángulo', 0, 179, 0, 1, '°'), p('distance', 'Distancia', 1, 150, 20, 1, 'px')],
  margin: (v) => Math.ceil(v.distance! / 2) + 1,
  run: (buf, w, h, v) => {
    const out = new Float32Array(buf.length);
    const a = (v.angle! * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = -Math.sin(a);
    const n = Math.max(1, Math.round(v.distance!));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let al = 0;
        for (let k = 0; k < n; k++) {
          const t = k - (n - 1) / 2;
          const sx = Math.round(x + dx * t);
          const sy = Math.round(y + dy * t);
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
          const i = (sy * w + sx) * 4;
          r += buf[i]!;
          g += buf[i + 1]!;
          b += buf[i + 2]!;
          al += buf[i + 3]!;
        }
        const o = (y * w + x) * 4;
        out[o] = r / n;
        out[o + 1] = g / n;
        out[o + 2] = b / n;
        out[o + 3] = al / n;
      }
    }
    buf.set(out);
  },
};

const sharpen: AreaFilter = {
  kind: 'area',
  id: 'sharpen',
  title: 'Enfocar (máscara de enfoque)',
  params: [p('amount', 'Cantidad', 1, 300, 100, 1, '%'), p('radius', 'Radio', 1, 30, 2, 1, 'px')],
  margin: (v) => Math.ceil(v.radius! * 3),
  run: (buf, w, h, v) => {
    const blurred = buf.slice();
    gaussianBlur(blurred, w, h, v.radius! / 2);
    const k = v.amount! / 100;
    for (let i = 0; i < buf.length; i += 4) {
      const a = Math.min(1, Math.max(0, buf[i + 3]! + (buf[i + 3]! - blurred[i + 3]!) * k));
      for (let c = 0; c < 3; c++) buf[i + c] = Math.min(a, Math.max(0, buf[i + c]! + (buf[i + c]! - blurred[i + c]!) * k));
      buf[i + 3] = a;
    }
  },
};

const pixelate: AreaFilter = {
  kind: 'area',
  id: 'pixelate',
  title: 'Pixelar',
  params: [p('size', 'Tamaño del bloque', 2, 100, 8, 1, 'px')],
  margin: () => 0,
  run: (buf, w, h, v) => {
    const s = Math.max(1, Math.round(v.size!));
    for (let by = 0; by < h; by += s) {
      for (let bx = 0; bx < w; bx += s) {
        const x1 = Math.min(w, bx + s);
        const y1 = Math.min(h, by + s);
        const sum = [0, 0, 0, 0];
        for (let y = by; y < y1; y++) for (let x = bx; x < x1; x++) for (let c = 0; c < 4; c++) sum[c]! += buf[(y * w + x) * 4 + c]!;
        const n = (x1 - bx) * (y1 - by);
        for (let y = by; y < y1; y++) for (let x = bx; x < x1; x++) for (let c = 0; c < 4; c++) buf[(y * w + x) * 4 + c] = sum[c]! / n;
      }
    }
  },
};

// ---- tone curve ------------------------------------------------------------------------------------
/** Input levels the tone curve lets the user move; the ends are 0 and 255. Own design: five handles instead of a free-form editor. */
const CURVE_INPUTS = [0, 64, 128, 192, 255] as const;

/**
 * A 256-entry table from control points (x ascending, both 0..255) using a monotone cubic (Fritsch-Carlson), so the curve
 * never overshoots between handles and never inverts a region the handles did not invert.
 */
export function curveLut(xs: readonly number[], ys: readonly number[]): Uint8Array {
  const n = xs.length;
  const lut = new Uint8Array(256);
  if (n === 0) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  if (n === 1) return lut.fill(clamp255(Math.round(ys[0]!)));
  const d = new Array<number>(n - 1);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1]! - ys[i]!) / Math.max(1e-9, xs[i + 1]! - xs[i]!);
  const m = new Array<number>(n);
  m[0] = d[0]!;
  m[n - 1] = d[n - 2]!;
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d[i]!;
    const b = m[i + 1]! / d[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i]!;
      m[i + 1] = t * b * d[i]!;
    }
  }
  let seg = 0;
  for (let x = 0; x < 256; x++) {
    if (x <= xs[0]!) {
      lut[x] = clamp255(Math.round(ys[0]!));
      continue;
    }
    if (x >= xs[n - 1]!) {
      lut[x] = clamp255(Math.round(ys[n - 1]!));
      continue;
    }
    while (seg < n - 2 && x > xs[seg + 1]!) seg++;
    const h = xs[seg + 1]! - xs[seg]!;
    const t = (x - xs[seg]!) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * ys[seg]! + (t3 - 2 * t2 + t) * h * m[seg]! + (-2 * t3 + 3 * t2) * ys[seg + 1]! + (t3 - t2) * h * m[seg + 1]!;
    lut[x] = clamp255(Math.round(y));
  }
  return lut;
}

const toneCurve: PixelFilter = {
  kind: 'pixel',
  id: 'tonecurve',
  title: 'Curva de tonos',
  params: [
    p('c0', 'Negro (0 →)', 0, 255, 0),
    p('c64', 'Sombras (64 →)', 0, 255, 64),
    p('c128', 'Medios tonos (128 →)', 0, 255, 128),
    p('c192', 'Luces (192 →)', 0, 255, 192),
    p('c255', 'Blanco (255 →)', 0, 255, 255),
  ],
  make: (v) => {
    const lut = curveLut(CURVE_INPUTS, [v.c0!, v.c64!, v.c128!, v.c192!, v.c255!]);
    return (c) => {
      c[0] = lut[Math.round(clamp255(c[0]!))]!;
      c[1] = lut[Math.round(clamp255(c[1]!))]!;
      c[2] = lut[Math.round(clamp255(c[2]!))]!;
    };
  },
};

/** Pushes the layer's colour towards the main colour's hue and saturation but keeps its own lightness. Own design for "Igualar color". */
const colorMatch: PixelFilter = {
  kind: 'pixel',
  id: 'colormatch',
  title: 'Igualar color (al color principal)',
  params: [p('amount', 'Intensidad', 0, 100, 100, 1, '%')],
  make: (v, ctx) => {
    const [h, s] = rgbToHsl(ctx.main[0], ctx.main[1], ctx.main[2]);
    const k = v.amount! / 100;
    return (c) => {
      const l = rgbToHsl(c[0]!, c[1]!, c[2]!)[2];
      const t = hslToRgb(h, s, l);
      for (let i = 0; i < 3; i++) c[i] = clamp255(c[i]! + (t[i]! - c[i]!) * k);
    };
  },
};

// ---- more neighbourhood filters --------------------------------------------------------------------
/** Sample a premultiplied block with bilinear filtering; outside the block is transparent. */
function sampleBilinear(buf: Float32Array, w: number, h: number, x: number, y: number, out: number[]): void {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  out[0] = out[1] = out[2] = out[3] = 0;
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const sx = x0 + i;
      const sy = y0 + j;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const wt = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
      const o = (sy * w + sx) * 4;
      for (let c = 0; c < 4; c++) out[c]! += buf[o + c]! * wt;
    }
  }
}

const radialBlur: AreaFilter = {
  kind: 'area',
  id: 'radialblur',
  title: 'Desenfoque radial',
  params: [p('mode', 'Tipo (0 giro, 1 zoom)', 0, 1, 0), p('amount', 'Cantidad', 1, 100, 20), p('cx', 'Centro X', 0, 100, 50, 1, '%'), p('cy', 'Centro Y', 0, 100, 50, 1, '%')],
  margin: () => 0,
  run: (buf, w, h, v) => {
    const out = new Float32Array(buf.length);
    const cx = (v.cx! / 100) * w;
    const cy = (v.cy! / 100) * h;
    const zoom = v.mode! >= 0.5;
    const span = zoom ? v.amount! / 100 : (v.amount! * Math.PI) / 180; // zoom: fraction of the radius; spin: arc in radians
    const reach = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
    const n = Math.max(3, Math.min(48, Math.ceil(zoom ? span * reach : span * reach * 0.5)));
    const px = [0, 0, 0, 0];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const dy = y - cy;
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let k = 0; k < n; k++) {
          const t = n === 1 ? 0 : k / (n - 1) - 0.5;
          let sx: number;
          let sy: number;
          if (zoom) {
            const s = 1 + t * span;
            sx = cx + dx * s;
            sy = cy + dy * s;
          } else {
            const ang = t * span;
            const co = Math.cos(ang);
            const si = Math.sin(ang);
            sx = cx + dx * co - dy * si;
            sy = cy + dx * si + dy * co;
          }
          sampleBilinear(buf, w, h, sx, sy, px);
          r += px[0]!;
          g += px[1]!;
          b += px[2]!;
          a += px[3]!;
        }
        const o = (y * w + x) * 4;
        out[o] = r / n;
        out[o + 1] = g / n;
        out[o + 2] = b / n;
        out[o + 3] = a / n;
      }
    }
    buf.set(out);
  },
};

/** Disc ("bokeh") blur: every pixel is the mean of a disc, with one prefix sum per row so the cost is linear in the radius. */
export function discBlur(buf: Float32Array, w: number, h: number, radius: number): void {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return;
  const half: number[] = [];
  let count = 0;
  for (let dy = -r; dy <= r; dy++) {
    const hw = Math.floor(Math.sqrt(r * r + r - dy * dy)); // a slightly fatter disc, so radius 1 is a plus with corners filled
    half.push(hw);
    count += 2 * hw + 1;
  }
  const out = new Float32Array(buf.length);
  const prefix = new Float64Array(h * (w + 1));
  for (let c = 0; c < 4; c++) {
    for (let y = 0; y < h; y++) {
      const row = y * (w + 1);
      prefix[row] = 0;
      for (let x = 0; x < w; x++) prefix[row + x + 1] = prefix[row + x]! + buf[(y * w + x) * 4 + c]!;
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let dy = -r; dy <= r; dy++) {
          const sy = y + dy;
          if (sy < 0 || sy >= h) continue;
          const hw = half[dy + r]!;
          const lo = Math.max(0, x - hw);
          const hi = Math.min(w - 1, x + hw);
          sum += prefix[sy * (w + 1) + hi + 1]! - prefix[sy * (w + 1) + lo]!;
        }
        out[(y * w + x) * 4 + c] = sum / count;
      }
    }
  }
  buf.set(out);
}

const lensBlur: AreaFilter = {
  kind: 'area',
  id: 'lensblur',
  title: 'Desenfoque de lente',
  params: [p('radius', 'Radio', 1, 60, 8, 1, 'px')],
  margin: (v) => Math.ceil(v.radius!) + 1,
  run: (buf, w, h, v) => discBlur(buf, w, h, v.radius!),
};

/** A small deterministic hash in 0..1 for the crystallize seeds (same picture, same cells). */
function hash2(x: number, y: number, salt: number): number {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 2147483647);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const crystallize: AreaFilter = {
  kind: 'area',
  id: 'crystallize',
  title: 'Cristalizar',
  params: [p('size', 'Tamaño de celda', 3, 200, 24, 1, 'px')],
  margin: () => 0,
  run: (buf, w, h, v) => {
    const s = Math.max(2, Math.round(v.size!));
    const gw = Math.ceil(w / s) + 2;
    const gh = Math.ceil(h / s) + 2;
    const sx = new Float32Array(gw * gh);
    const sy = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        sx[gy * gw + gx] = (gx - 1 + 0.15 + 0.7 * hash2(gx, gy, 1)) * s;
        sy[gy * gw + gx] = (gy - 1 + 0.15 + 0.7 * hash2(gx, gy, 2)) * s;
      }
    }
    const owner = new Int32Array(w * h);
    const sum = new Float64Array(gw * gh * 5);
    for (let y = 0; y < h; y++) {
      const cy = Math.floor(y / s) + 1;
      for (let x = 0; x < w; x++) {
        const cx = Math.floor(x / s) + 1;
        let best = -1;
        let bestD = Infinity;
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            const id = (cy + j) * gw + cx + i;
            const d = (sx[id]! - x) ** 2 + (sy[id]! - y) ** 2;
            if (d < bestD) {
              bestD = d;
              best = id;
            }
          }
        }
        owner[y * w + x] = best;
        const o = (y * w + x) * 4;
        const t = best * 5;
        sum[t]! += buf[o]!;
        sum[t + 1]! += buf[o + 1]!;
        sum[t + 2]! += buf[o + 2]!;
        sum[t + 3]! += buf[o + 3]!;
        sum[t + 4]! += 1;
      }
    }
    for (let i = 0; i < w * h; i++) {
      const t = owner[i]! * 5;
      const n = sum[t + 4]!;
      for (let c = 0; c < 4; c++) buf[i * 4 + c] = sum[t + c]! / n;
    }
  },
};

const glow: AreaFilter = {
  kind: 'area',
  id: 'glow',
  title: 'Resplandor',
  params: [p('radius', 'Radio', 1, 100, 12, 1, 'px'), p('strength', 'Intensidad', 0, 300, 100, 1, '%'), p('threshold', 'Solo por encima de brillo', 0, 254, 0)],
  margin: (v) => Math.ceil(v.radius! * 3),
  run: (buf, w, h, v) => {
    const halo = new Float32Array(buf.length);
    const th = v.threshold! / 255;
    for (let i = 0; i < buf.length; i += 4) {
      const a = buf[i + 3]!;
      if (a <= 0) continue;
      const l = luma(buf[i]!, buf[i + 1]!, buf[i + 2]!) / a; // lightness of the un-premultiplied colour, 0..1
      if (l < th) continue;
      for (let c = 0; c < 4; c++) halo[i + c] = buf[i + c]!;
    }
    gaussianBlur(halo, w, h, v.radius! / 2);
    const k = v.strength! / 100;
    for (let i = 0; i < buf.length; i += 4) {
      // Screen, on premultiplied values: the glow lightens the shape and spills over transparent surroundings.
      for (let c = 0; c < 4; c++) {
        const g = Math.min(1, halo[i + c]! * k);
        buf[i + c] = buf[i + c]! + g - buf[i + c]! * g;
      }
      buf[i + 3] = Math.min(1, buf[i + 3]!);
      for (let c = 0; c < 3; c++) buf[i + c] = Math.min(buf[i + 3]!, buf[i + c]!);
    }
  },
};

const dropShadow: AreaFilter = {
  kind: 'area',
  id: 'dropshadow',
  title: 'Sombra paralela (color principal)',
  params: [p('dx', 'Desplazamiento X', -100, 100, 6, 1, 'px'), p('dy', 'Desplazamiento Y', -100, 100, 6, 1, 'px'), p('blur', 'Desenfoque', 0, 60, 4, 1, 'px'), p('opacity', 'Opacidad', 0, 100, 70, 1, '%')],
  margin: (v) => Math.ceil(Math.max(Math.abs(v.dx!), Math.abs(v.dy!)) + v.blur! * 3),
  run: (buf, w, h, v, ctx) => {
    const sh = new Float32Array(w * h * 4);
    const dx = Math.round(v.dx!);
    const dy = Math.round(v.dy!);
    for (let y = 0; y < h; y++) {
      const ty = y + dy;
      if (ty < 0 || ty >= h) continue;
      for (let x = 0; x < w; x++) {
        const tx = x + dx;
        if (tx < 0 || tx >= w) continue;
        sh[(ty * w + tx) * 4 + 3] = buf[(y * w + x) * 4 + 3]!;
      }
    }
    gaussianBlur(sh, w, h, v.blur! / 2);
    const k = v.opacity! / 100;
    for (let i = 0; i < buf.length; i += 4) {
      const a = sh[i + 3]! * k;
      const under = a * (1 - buf[i + 3]!); // the shadow only shows where the layer is not opaque
      for (let c = 0; c < 3; c++) buf[i + c] = buf[i + c]! + (ctx.main[c]! / 255) * under;
      buf[i + 3] = buf[i + 3]! + under;
    }
  },
};

const wave: AreaFilter = {
  kind: 'area',
  id: 'wave',
  title: 'Ondas',
  params: [p('ampx', 'Amplitud horizontal', 0, 100, 8, 1, 'px'), p('lenx', 'Longitud de onda horizontal', 4, 500, 60, 1, 'px'), p('ampy', 'Amplitud vertical', 0, 100, 0, 1, 'px'), p('leny', 'Longitud de onda vertical', 4, 500, 60, 1, 'px')],
  margin: (v) => Math.ceil(Math.max(v.ampx!, v.ampy!)),
  run: (buf, w, h, v) => {
    const out = new Float32Array(buf.length);
    const px = [0, 0, 0, 0];
    for (let y = 0; y < h; y++) {
      const shiftX = v.ampx! * Math.sin((2 * Math.PI * y) / v.lenx!); // rows slide sideways
      for (let x = 0; x < w; x++) {
        const shiftY = v.ampy! * Math.sin((2 * Math.PI * x) / v.leny!); // columns slide up and down
        sampleBilinear(buf, w, h, x - shiftX, y - shiftY, px);
        const o = (y * w + x) * 4;
        out[o] = px[0]!;
        out[o + 1] = px[1]!;
        out[o + 2] = px[2]!;
        out[o + 3] = px[3]!;
      }
    }
    buf.set(out);
  },
};

export const FILTERS: Record<string, Filter> = Object.fromEntries(
  [
    invert, brightnessContrast, hsv, posterize, levels, toneCurve, colorBalance, binarize, gradientMap, brightnessToAlpha, colorMatch,
    gaussian, motionBlur, radialBlur, lensBlur, sharpen, pixelate, crystallize, glow, dropShadow, wave,
  ].map((f) => [f.id, f]),
);

// ---- applying a filter to a layer ------------------------------------------------------------------
/** The values a filter starts with. */
export const defaultValues = (f: Filter): Values => Object.fromEntries(f.params.map((q) => [q.id, q.value]));

/** Blocks bigger than this many pixels are refused (the work is done on one block of memory). */
export const MAX_AREA = 40_000_000;

/** Run a per-pixel filter over the layer (or the selection) and describe the change for the history. */
export function applyPixelFilter(surface: TiledSurface, layerId: number, sel: Selection | null, f: PixelFilter, v: Values, ctx: FilterContext): StrokePatch | null {
  const run = f.make(v, ctx);
  const px = [0, 0, 0, 0];
  return mapPixels(surface, layerId, sel, (t, o, cov) => {
    if (t[o + 3] === 0) return;
    px[0] = t[o]!;
    px[1] = t[o + 1]!;
    px[2] = t[o + 2]!;
    px[3] = t[o + 3]!;
    run(px);
    const k = cov / 255;
    for (let i = 0; i < 4; i++) t[o + i] = t[o + i]! + (clamp255(px[i]!) - t[o + i]!) * k;
  });
}

export type AreaResult = { patch: StrokePatch | null; rect: Rect } | { tooLarge: true } | null;

/** Run a neighbourhood filter on the layer (or the selection). Returns null when there is nothing to filter. */
export function applyAreaFilter(surface: TiledSurface, layerId: number, sel: Selection | null, f: AreaFilter, v: Values, ctx: FilterContext): AreaResult {
  const base = sel ? sel.bounds() : surface.contentBounds();
  if (!base) return null;
  const m = f.margin(v);
  const x0 = Math.max(0, Math.floor(base.x) - m);
  const y0 = Math.max(0, Math.floor(base.y) - m);
  const x1 = Math.min(surface.width, Math.ceil(base.x + base.w) + m);
  const y1 = Math.min(surface.height, Math.ceil(base.y + base.h) + m);
  const region = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  if (region.w < 1 || region.h < 1) return null;
  if (region.w * region.h > MAX_AREA) return { tooLarge: true };
  const rec = new TileRecorder(surface, layerId);
  rec.watch(region);
  const src = surface.readRect(region);
  const n = region.w * region.h;
  const orig = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = src[i * 4 + 3]! / 255;
    orig[i * 4] = (src[i * 4]! / 255) * a;
    orig[i * 4 + 1] = (src[i * 4 + 1]! / 255) * a;
    orig[i * 4 + 2] = (src[i * 4 + 2]! / 255) * a;
    orig[i * 4 + 3] = a;
  }
  const buf = orig.slice();
  f.run(buf, region.w, region.h, v, ctx);
  const out = new Uint8ClampedArray(n * 4);
  for (let y = 0; y < region.h; y++) {
    for (let x = 0; x < region.w; x++) {
      const i = y * region.w + x;
      const cov = sel ? sel.at(region.x + x, region.y + y) / 255 : 1;
      const a = orig[i * 4 + 3]! + (buf[i * 4 + 3]! - orig[i * 4 + 3]!) * cov;
      if (a <= 0.0005) continue;
      for (let c = 0; c < 3; c++) {
        const pm = orig[i * 4 + c]! + (buf[i * 4 + c]! - orig[i * 4 + c]!) * cov;
        out[i * 4 + c] = Math.min(255, (pm / a) * 255);
      }
      out[i * 4 + 3] = a * 255;
    }
  }
  surface.writeRect(region, out);
  return { patch: rec.patch(region), rect: region };
}
