/** A pressure response drawn as control points: x = pen pressure, y = the result (both 0..1). */
export type PressureGraph = readonly (readonly [number, number])[];

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * The function through the points, as a monotone cubic (Fritsch–Carlson): it passes through every point,
 * never overshoots between them and is flat outside the first and last, so a soft or hard response drawn
 * with a handful of points behaves like the smooth curve it was meant to be.
 */
export function pressureResponse(graph: PressureGraph): (pressure: number) => number {
  const pts = [...graph].sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  if (n === 0) return clamp01;
  if (n === 1) return () => clamp01(pts[0]![1]);
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]![0] - pts[i]![0]);
    slope.push(dx[i]! > 0 ? (pts[i + 1]![1] - pts[i]![1]) / dx[i]! : 0);
  }
  const tangent: number[] = new Array<number>(n).fill(0);
  tangent[0] = slope[0]!;
  tangent[n - 1] = slope[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    const a = slope[i - 1]!;
    const b = slope[i]!;
    tangent[i] = a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  }
  // Keep each segment monotone: a tangent more than three times the secant would overshoot.
  for (let i = 0; i < n - 1; i++) {
    const s = slope[i]!;
    if (s === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i]! / s;
    const b = tangent[i + 1]! / s;
    const h = Math.hypot(a, b);
    if (h > 3) {
      tangent[i] = (3 * a * s) / h;
      tangent[i + 1] = (3 * b * s) / h;
    }
  }
  return (pressure) => {
    const x = clamp01(pressure);
    if (x <= pts[0]![0]) return clamp01(pts[0]![1]);
    if (x >= pts[n - 1]![0]) return clamp01(pts[n - 1]![1]);
    let i = 0;
    while (i < n - 2 && x > pts[i + 1]![0]) i++;
    const h = dx[i]!;
    if (h <= 0) return clamp01(pts[i]![1]);
    const t = (x - pts[i]![0]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const y =
      (2 * t3 - 3 * t2 + 1) * pts[i]![1] +
      (t3 - 2 * t2 + t) * h * tangent[i]! +
      (-2 * t3 + 3 * t2) * pts[i + 1]![1] +
      (t3 - t2) * h * tangent[i + 1]!;
    return clamp01(y);
  };
}
