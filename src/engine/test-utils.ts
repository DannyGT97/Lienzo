import type { Layer } from './document';

/** Fill a whole layer with one RGBA colour. */
export function fillLayer(layer: Layer, rgba: readonly [number, number, number, number]): void {
  const { width, height } = layer.surface;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  layer.surface.writeRect({ x: 0, y: 0, w: width, h: height }, data);
}

/** Set a single pixel. */
export function setPixel(layer: Layer, x: number, y: number, rgba: readonly [number, number, number, number]): void {
  layer.surface.writeRect({ x, y, w: 1, h: 1 }, new Uint8ClampedArray(rgba));
}

/** Pixel of a flattened buffer. */
export function bufPixel(data: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const i = (y * width + x) * 4;
  return Array.from(data.subarray(i, i + 4));
}

/** Number of pixels with any alpha on a layer. */
export function inkCount(layer: Layer): number {
  let n = 0;
  for (const [, , t] of layer.surface.entries()) for (let i = 3; i < t.length; i += 4) if (t[i]) n++;
  return n;
}
