import { TILE, tileRange, type Rect, type TiledSurface } from './tiles';

export type ToneShape = 'dot' | 'line' | 'cross';

export interface ToneSettings {
  shape: ToneShape;
  /** Lines per inch of the halftone screen. */
  lpi: number;
  /** Screen angle in degrees (45° is the classic manga dot angle). */
  angle: number;
  /** Ink coverage 0..1 (0 = paper, 1 = solid). */
  density: number;
  color: readonly [number, number, number];
}

export const defaultTone: ToneSettings = {
  shape: 'dot',
  lpi: 60,
  angle: 45,
  density: 0.5,
  color: [0, 0, 0],
};

const DOT_KNEE = Math.PI / 4; // coverage at which a round dot touches its neighbours
const HALF_DIAG = Math.SQRT1_2;

/** Screen cell edge in pixels for a document of `dpi` pixels per inch. */
export const cellSize = (dpi: number, lpi: number): number => Math.max(2, dpi / Math.max(1, lpi));

const frac = (v: number): number => v - Math.floor(v);

/**
 * Spot-function rank in [0,1] for a point inside a screen cell
 * (u, v in [-0.5, 0.5], cell centre at the origin). The pixel is ink when
 * rank < threshold; the rank distribution makes the inked area match the
 * threshold, for a round dot up to a small approximation past the knee.
 */
function rank(shape: ToneShape, u: number, v: number): number {
  switch (shape) {
    case 'dot': {
      const d = Math.hypot(u, v);
      return d <= 0.5 ? Math.PI * d * d : DOT_KNEE + ((d - 0.5) / (HALF_DIAG - 0.5)) * (1 - DOT_KNEE);
    }
    case 'line':
      return 2 * Math.abs(v);
    case 'cross':
      return Math.min(2 * Math.abs(u), 2 * Math.abs(v));
  }
}

/** The union of two bars covers 1-(1-t)², so the threshold is mapped to keep area = density. */
const threshold = (shape: ToneShape, density: number): number =>
  shape === 'cross' ? 1 - Math.sqrt(1 - density) : density;

const SUB = [1 / 6, 3 / 6, 5 / 6] as const; // 3×3 supersampling offsets within a pixel

/** Ink coverage 0..1 of the halftone screen for pixel (x, y), anti-aliased. */
export function toneCoverage(s: ToneSettings, cell: number, x: number, y: number): number {
  if (s.density <= 0) return 0;
  if (s.density >= 1) return 1;
  const th = threshold(s.shape, s.density);
  const rad = (s.angle * Math.PI) / 180;
  const c = Math.cos(rad);
  const sn = Math.sin(rad);
  let hits = 0;
  for (const oy of SUB) {
    for (const ox of SUB) {
      const px = x + ox;
      const py = y + oy;
      const xr = (px * c + py * sn) / cell;
      const yr = (-px * sn + py * c) / cell;
      if (rank(s.shape, frac(xr + 0.5) - 0.5, frac(yr + 0.5) - 0.5) < th) hits++;
    }
  }
  return hits / 9;
}

/**
 * Re-render a tone layer: `source` holds the painted area (its alpha is the
 * mask); `out` receives the halftone clipped to that area. Only the tiles
 * overlapping `rect` are touched, and tiles with no ink are not kept.
 */
export function renderTone(
  s: ToneSettings,
  dpi: number,
  source: TiledSurface,
  out: TiledSurface,
  rect: Rect,
): void {
  const cell = cellSize(dpi, s.lpi);
  const { tx0, ty0, tx1, ty1 } = tileRange(out, rect);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const ox = tx * TILE;
      const oy = ty * TILE;
      const x0 = Math.max(rect.x, ox);
      const y0 = Math.max(rect.y, oy);
      const x1 = Math.min(rect.x + rect.w, ox + TILE, out.width);
      const y1 = Math.min(rect.y + rect.h, oy + TILE, out.height);
      const src = source.get(tx, ty);
      let dst = out.get(tx, ty);
      if (!src) {
        // Nothing painted here: clear whatever screen was left over.
        if (dst) {
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) dst[((y - oy) * TILE + (x - ox)) * 4 + 3] = 0;
          out.touch(tx, ty);
          out.dropIfEmpty(tx, ty);
        }
        continue;
      }
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = ((y - oy) * TILE + (x - ox)) * 4;
          const a = src[p + 3]! / 255;
          const alpha = a > 0 ? a * toneCoverage(s, cell, x, y) * 255 : 0;
          if (alpha === 0 && !dst) continue;
          dst ??= out.ensure(tx, ty);
          dst[p] = s.color[0];
          dst[p + 1] = s.color[1];
          dst[p + 2] = s.color[2];
          dst[p + 3] = alpha;
        }
      }
      if (dst) {
        out.touch(tx, ty);
        out.dropIfEmpty(tx, ty);
      }
    }
  }
}
