import type { Pt } from './geometry';

type PixelFn = (x: number, y: number) => [number, number, number, number];

export interface LivewireOptions {
  /** Extra room around the two points in which the path may wander (pixels). */
  margin?: number;
  /** Windows larger than this (pixels per side) fall back to a straight line. */
  maxSide?: number;
}

/** Lightness of a pixel as it shows over a mid grey, so both colour edges and edges against transparency count. */
function tone(p: [number, number, number, number]): number {
  const a = p[3] / 255;
  return (0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2]) * a + 128 * (1 - a);
}

/** A binary min-heap of (priority, node) pairs. */
class Heap {
  private pri: number[] = [];
  private node: number[] = [];
  get size(): number {
    return this.pri.length;
  }
  push(p: number, n: number): void {
    let i = this.pri.length;
    this.pri.push(p);
    this.node.push(n);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.pri[up]! <= p) break;
      this.pri[i] = this.pri[up]!;
      this.node[i] = this.node[up]!;
      i = up;
    }
    this.pri[i] = p;
    this.node[i] = n;
  }
  pop(): number {
    const top = this.node[0]!;
    const p = this.pri.pop()!;
    const n = this.node.pop()!;
    const len = this.pri.length;
    if (len > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= len) break;
        if (c + 1 < len && this.pri[c + 1]! < this.pri[c]!) c++;
        if (this.pri[c]! >= p) break;
        this.pri[i] = this.pri[c]!;
        this.node[i] = this.node[c]!;
        i = c;
      }
      this.pri[i] = p;
      this.node[i] = n;
    }
    return top;
  }
}

/**
 * The path between two points that follows the strongest edges of the picture ("magnetic" lasso). Every pixel
 * has a cost that is low where the lightness changes quickly; the cheapest 8-connected route is found with
 * Dijkstra's algorithm inside a window around the two points. Returns pixel centres from `from` to `to`.
 */
export function livewire(width: number, height: number, pixel: PixelFn, from: Pt, to: Pt, opts: LivewireOptions = {}): Pt[] {
  const margin = opts.margin ?? 24;
  const maxSide = opts.maxSide ?? 480;
  const fx = Math.min(width - 1, Math.max(0, Math.floor(from.x)));
  const fy = Math.min(height - 1, Math.max(0, Math.floor(from.y)));
  const tx = Math.min(width - 1, Math.max(0, Math.floor(to.x)));
  const ty = Math.min(height - 1, Math.max(0, Math.floor(to.y)));
  const x0 = Math.max(0, Math.min(fx, tx) - margin);
  const y0 = Math.max(0, Math.min(fy, ty) - margin);
  const x1 = Math.min(width - 1, Math.max(fx, tx) + margin);
  const y1 = Math.min(height - 1, Math.max(fy, ty) + margin);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const straight = [from, to];
  if (w > maxSide || h > maxSide || (fx === tx && fy === ty)) return straight;

  // Lightness of the window, then the gradient magnitude (Sobel) normalised to 0..1.
  const lum = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) lum[y * w + x] = tone(pixel(x0 + x, y0 + y));
  const at = (x: number, y: number): number => lum[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!;
  const grad = new Float32Array(w * h);
  let peak = 1e-6;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      const g = Math.hypot(gx, gy);
      grad[y * w + x] = g;
      if (g > peak) peak = g;
    }
  }
  const cost = new Float32Array(w * h);
  for (let i = 0; i < cost.length; i++) {
    const g = grad[i]! / peak;
    cost[i] = 0.02 + (1 - g) * (1 - g);
  }

  const start = (fy - y0) * w + (fx - x0);
  const goal = (ty - y0) * w + (tx - x0);
  const dist = new Float32Array(w * h).fill(Infinity);
  const prev = new Int32Array(w * h).fill(-1);
  const done = new Uint8Array(w * h);
  const heap = new Heap();
  dist[start] = 0;
  heap.push(0, start);
  while (heap.size) {
    const cur = heap.pop();
    if (done[cur]) continue;
    done[cur] = 1;
    if (cur === goal) break;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (done[n]) continue;
        const nd = dist[cur]! + cost[n]! * (dx && dy ? Math.SQRT2 : 1);
        if (nd < dist[n]!) {
          dist[n] = nd;
          prev[n] = cur;
          heap.push(nd, n);
        }
      }
    }
  }
  if (!done[goal]) return straight;
  const out: Pt[] = [];
  for (let n = goal; n !== -1; n = prev[n]!) out.push({ x: x0 + (n % w) + 0.5, y: y0 + Math.floor(n / w) + 0.5 });
  return out.reverse();
}
