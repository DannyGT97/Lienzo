import type { StrokePatch } from './brush';
import type { Pt } from './geometry';
import type { Selection } from './selection';
import { cellSize, toneCoverage, type ToneSettings, type ToneShape } from './tone';
import { TILE, type Rect, type TiledSurface } from './tiles';
import { TileRecorder } from './transform';

/** A colour along the gradient: t from 0 (start) to 1 (end), colour 0..255, alpha 0..1. */
export interface GradientStop {
  t: number;
  color: readonly [number, number, number];
  alpha: number;
}

export type GradientShape = 'linear' | 'radial' | 'mirrored' | 'conic';

/** What happens past the ends of the gradient (repeat modes 0..3): hold the end colour, repeat, fold back and forth, or leave it empty. */
export type GradientRepeat = 'clamp' | 'repeat' | 'mirror' | 'none';

export interface GradientSpec {
  shape: GradientShape;
  from: Pt;
  to: Pt;
  stops: GradientStop[];
  /** How much of what is there stays: 1 = the gradient is laid over it, 0 = erases (the stops' alpha is then how much is taken away). */
  mode?: 'paint' | 'erase';
  /** Past the ends of the gradient; 'clamp' when absent. */
  repeat?: GradientRepeat;
  /** Ordered 16x16 dither when rounding the gradient to 8 bits. */
  dither?: boolean;
  /**
   * Manga gradient (own design): the gradient is not laid down as smooth colour but as a halftone screen whose ink grows with it.
   * The ink amount at a point is what the gradient would cover on white paper, alpha * (1 - luminance), so black to
   * transparent and black to white both give a screen from solid to nothing. The dots are drawn in `ink`.
   * When it is on, `dither` has no effect.
   */
  halftone?: { shape: ToneShape; lpi: number; angle: number; dpi: number; ink: readonly [number, number, number] };
}

/**
 * Where the position `t` falls inside the gradient once the repeat type is applied (0..1), or null when it falls on nothing.
 * Repeat takes the fraction of t; mirror folds frac(t / 2) * 2 back at 1; none leaves everything outside 0..1 empty.
 */
export function extendPosition(t: number, repeat: GradientRepeat = 'clamp'): number | null {
  switch (repeat) {
    case 'repeat':
      return t - Math.floor(t);
    case 'mirror': {
      const h = t * 0.5;
      const u = (h - Math.floor(h)) * 2;
      return u > 1 ? 2 - u : u;
    }
    case 'none':
      return t < 0 || t > 1 ? null : t;
    default:
      return t <= 0 ? 0 : t >= 1 ? 1 : t;
  }
}

/** Ordered-dither thresholds (0..255): the 16x16 Bayer matrix, built from the bits of x and y; index (y & 15) * 16 + (x & 15). */
export const DITHER_16 = ((): Uint8Array => {
  const t = new Uint8Array(256);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let v = 0;
      for (let i = 0; i < 4; i++) {
        const shift = 2 * (3 - i);
        v |= ((((x >> i) & 1) ^ ((y >> i) & 1)) << (shift + 1)) | (((y >> i) & 1) << shift);
      }
      t[y * 16 + x] = v;
    }
  }
  return t;
})();

/** A 0..255 channel rounded to a whole number with the ordered dither: the threshold is added to the 16-bit value (full scale 0xffff, less 0xff) before dropping the low byte. */
export function ditherChannel(v: number, x: number, y: number): number {
  const thr = DITHER_16[(y & 15) * 16 + (x & 15)]!;
  const out = Math.floor((v * 257 - 255 + thr) / 256);
  return out < 0 ? 0 : out > 255 ? 255 : out;
}

/** The colour of the gradient at t (0..1, clamped), as straight RGB and alpha. */
export function colorAt(stops: readonly GradientStop[], t: number): { r: number; g: number; b: number; a: number } {
  const u = Math.min(1, Math.max(0, t));
  let lo = stops[0]!;
  let hi = stops[stops.length - 1]!;
  for (let i = 0; i < stops.length - 1; i++) {
    if (u >= stops[i]!.t && u <= stops[i + 1]!.t) {
      lo = stops[i]!;
      hi = stops[i + 1]!;
      break;
    }
  }
  if (u <= stops[0]!.t) return { r: stops[0]!.color[0], g: stops[0]!.color[1], b: stops[0]!.color[2], a: stops[0]!.alpha };
  if (u >= stops[stops.length - 1]!.t) {
    const e = stops[stops.length - 1]!;
    return { r: e.color[0], g: e.color[1], b: e.color[2], a: e.alpha };
  }
  const k = hi.t === lo.t ? 0 : (u - lo.t) / (hi.t - lo.t);
  const a = lo.alpha + (hi.alpha - lo.alpha) * k;
  // The channels are mixed as they are and the other end's colour is only borrowed the other end's colour when one end is empty,
  // so a fade to transparent keeps its colour.
  const mix = (i: number): number => {
    if (lo.alpha === 0) return hi.color[i]!;
    if (hi.alpha === 0) return lo.color[i]!;
    return lo.color[i]! + (hi.color[i]! - lo.color[i]!) * k;
  };
  return { r: mix(0), g: mix(1), b: mix(2), a };
}

/** Position along the gradient (0 at `from`, 1 at `to`) of the pixel centre (x, y). */
function position(spec: GradientSpec, x: number, y: number): number {
  const dx = spec.to.x - spec.from.x;
  const dy = spec.to.y - spec.from.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 1;
  if (spec.shape === 'radial') return Math.hypot(x - spec.from.x, y - spec.from.y) / Math.sqrt(len2);
  if (spec.shape === 'conic') {
    // A turn around `from`, starting in the direction of `to` and going clockwise on screen.
    const turn = (Math.atan2(y - spec.from.y, x - spec.from.x) - Math.atan2(dy, dx)) / (2 * Math.PI);
    return turn - Math.floor(turn);
  }
  const t = ((x - spec.from.x) * dx + (y - spec.from.y) * dy) / len2;
  return spec.shape === 'mirrored' ? Math.abs(t) : t;
}

/**
 * Lay a gradient over a layer (inside the selection when there is one) and describe the change for the history.
 * Returns null when nothing changed.
 */
export function applyGradient(surface: TiledSurface, layerId: number, sel: Selection | null, spec: GradientSpec): StrokePatch | null {
  const area: Rect | null = sel ? sel.bounds() : { x: 0, y: 0, w: surface.width, h: surface.height };
  if (!area) return null;
  const x0 = Math.max(0, Math.floor(area.x));
  const y0 = Math.max(0, Math.floor(area.y));
  const x1 = Math.min(surface.width, Math.ceil(area.x + area.w));
  const y1 = Math.min(surface.height, Math.ceil(area.y + area.h));
  if (x1 <= x0 || y1 <= y0) return null;
  const rec = new TileRecorder(surface, layerId);
  rec.watch({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  const erase = spec.mode === 'erase';
  // The colours along the gradient, sampled once: the loop below visits every pixel.
  const LUT = 1024;
  const lut = new Float32Array((LUT + 1) * 4);
  for (let i = 0; i <= LUT; i++) {
    const c = colorAt(spec.stops, i / LUT);
    lut[i * 4] = c.r;
    lut[i * 4 + 1] = c.g;
    lut[i * 4 + 2] = c.b;
    lut[i * 4 + 3] = c.a;
  }
  const ht = spec.halftone;
  const screen: ToneSettings | null = ht ? { shape: ht.shape, lpi: ht.lpi, angle: ht.angle, density: 0, color: ht.ink } : null;
  const cell = ht ? cellSize(ht.dpi, ht.lpi) : 0;
  const ink = new Float32Array(LUT + 1); // the ink amount along the gradient, for the halftone
  if (ht) for (let i = 0; i <= LUT; i++) ink[i] = erase ? lut[i * 4 + 3]! : lut[i * 4 + 3]! * (1 - (0.299 * lut[i * 4]! + 0.587 * lut[i * 4 + 1]! + 0.114 * lut[i * 4 + 2]!) / 255);
  let changed = false;
  for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y1 - 1) / TILE); ty++) {
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x1 - 1) / TILE); tx++) {
      const cov = sel ? sel.tile(tx, ty) : 255;
      if (cov === 0) continue;
      const existing = surface.get(tx, ty);
      if (erase && !existing) continue;
      const tile = existing ?? surface.ensure(tx, ty);
      const ya = Math.max(y0, ty * TILE);
      const yb = Math.min(y1, ty * TILE + TILE);
      const xa = Math.max(x0, tx * TILE);
      const xb = Math.min(x1, tx * TILE + TILE);
      for (let y = ya; y < yb; y++) {
        for (let x = xa; x < xb; x++) {
          const c = cov === 255 ? 1 : cov[(y - ty * TILE) * TILE + (x - tx * TILE)]! / 255;
          if (c === 0) continue;
          const u = extendPosition(position(spec, x + 0.5, y + 0.5), spec.repeat);
          if (u === null) continue;
          const li = Math.round(u * LUT) * 4;
          let ga = lut[li + 3]!;
          let gr = lut[li]!;
          let gg = lut[li + 1]!;
          let gb = lut[li + 2]!;
          if (screen && ht) {
            screen.density = ink[Math.round(u * LUT)]!;
            ga = toneCoverage(screen, cell, x, y);
            gr = ht.ink[0];
            gg = ht.ink[1];
            gb = ht.ink[2];
          } else if (spec.dither) {
            ga = ditherChannel(ga * 255, x, y) / 255;
            gr = ditherChannel(gr, x, y);
            gg = ditherChannel(gg, x, y);
            gb = ditherChannel(gb, x, y);
          }
          const o = ((y - ty * TILE) * TILE + (x - tx * TILE)) * 4;
          const ba = tile[o + 3]! / 255;
          if (erase) {
            tile[o + 3] = ba * (1 - ga * c) * 255;
            changed = true;
            continue;
          }
          const ta = ga * c;
          if (ta <= 0) continue;
          const ra = ta + ba * (1 - ta);
          const w = (1 - ta) * ba;
          tile[o] = (ta * gr + w * tile[o]!) / ra;
          tile[o + 1] = (ta * gg + w * tile[o + 1]!) / ra;
          tile[o + 2] = (ta * gb + w * tile[o + 2]!) / ra;
          tile[o + 3] = ra * 255;
          changed = true;
        }
      }
      surface.touch(tx, ty);
    }
  }
  if (!changed) {
    rec.restore();
    return null;
  }
  return rec.patch({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}
