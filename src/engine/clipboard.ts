import type { Selection } from './selection';
import type { Rect, TiledSurface } from './tiles';

/** Pixels taken from a layer: straight RGBA of `rect`, with the selection's coverage folded into alpha. */
export interface Clip {
  rect: Rect;
  pixels: Uint8ClampedArray;
}

/**
 * Copy the selected pixels of a layer (all of them when nothing is selected), cropped to what is visible.
 * Returns null when there is nothing to copy.
 */
export function copyPixels(surface: TiledSurface, sel: Selection | null): Clip | null {
  const area = sel ? sel.bounds() : surface.contentBounds();
  if (!area) return null;
  const x0 = Math.max(0, Math.floor(area.x));
  const y0 = Math.max(0, Math.floor(area.y));
  const x1 = Math.min(surface.width, Math.ceil(area.x + area.w));
  const y1 = Math.min(surface.height, Math.ceil(area.y + area.h));
  if (x1 <= x0 || y1 <= y0) return null;
  const r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const data = surface.readRect(r);
  let minX = r.w;
  let minY = r.h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = (y * r.w + x) * 4;
      const cov = sel ? sel.at(r.x + x, r.y + y) : 255;
      data[i + 3] = (data[i + 3]! * cov) / 255;
      if (data[i + 3]! > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  // Crop to the visible part.
  const rect = { x: r.x + minX, y: r.y + minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  const pixels = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++) {
    const from = ((minY + y) * r.w + minX) * 4;
    pixels.set(data.subarray(from, from + rect.w * 4), y * rect.w * 4);
  }
  return { rect, pixels };
}

/** Write a clip onto a surface, moved by (dx, dy); whatever falls outside the surface is dropped. Returns the area written. */
export function pasteClip(surface: TiledSurface, clip: Clip, dx: number, dy: number): Rect | null {
  const ox = Math.round(clip.rect.x + dx);
  const oy = Math.round(clip.rect.y + dy);
  const x0 = Math.max(0, ox);
  const y0 = Math.max(0, oy);
  const x1 = Math.min(surface.width, ox + clip.rect.w);
  const y1 = Math.min(surface.height, oy + clip.rect.h);
  if (x1 <= x0 || y1 <= y0) return null;
  const r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const from = ((y0 + y - oy) * clip.rect.w + (x0 - ox)) * 4;
    out.set(clip.pixels.subarray(from, from + r.w * 4), y * r.w * 4);
  }
  surface.writeRect(r, out);
  return r;
}
