import { contains, lastCrossing, smoothClosed, type Poly, type Pt } from './geometry';

/**
 * `rough` is a rounded balloon with a hand-cut edge, `curve` a smooth closed curve through its own points (`pts`, drawn by
 * clicking points or by hand), `shout` and `cloud` are the spiky and the bumpy ones, `none` is free text.
 */
export type BalloonShape = 'ellipse' | 'rounded' | 'rough' | 'rect' | 'curve' | 'shout' | 'cloud' | 'none';

/** A speech tail is a spike; a thought tail is a chain of shrinking bubbles. */
export type TailStyle = 'speech' | 'thought';

export interface Balloon {
  id: number;
  shape: BalloonShape;
  /** The box of the balloon (for `curve`, the box of its points). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Tip of the tail, or null for none. */
  tail: Pt | null;
  /** How the tail looks (a speech spike when missing). */
  tailStyle?: TailStyle;
  /** The points a `curve` balloon passes through, in page coordinates. */
  pts?: Pt[];
  text: string;
  fontSize: number;
  fontFamily: string;
  vertical: boolean;
  border: number;
}

export const MIN_BALLOON = 24;

export function createBalloon(id: number, shape: BalloonShape, a: Pt, b: Pt): Balloon {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return withShape(
    {
      id,
      shape,
      x,
      y,
      w: Math.max(MIN_BALLOON, Math.abs(b.x - a.x)),
      h: Math.max(MIN_BALLOON, Math.abs(b.y - a.y)),
      tail: null,
      text: '',
      fontSize: 28,
      fontFamily: 'sans-serif',
      vertical: false,
      border: 4,
    },
    shape,
  );
}

const boxOf = (pts: readonly Pt[]): { x: number; y: number; w: number; h: number } => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/** A balloon through the given points (a drawn or clicked outline), or null when they enclose less than the smallest balloon. */
export function pathBalloon(id: number, pts: readonly Pt[]): Balloon | null {
  if (pts.length < 3) return null;
  const box = boxOf(pts);
  if (box.w < MIN_BALLOON || box.h < MIN_BALLOON) return null;
  return { ...createBalloon(id, 'rect', { x: box.x, y: box.y }, { x: box.x + box.w, y: box.y + box.h }), shape: 'curve', pts: pts.map((p) => ({ ...p })) };
}

/** The balloon with another shape. A curve needs its own points, so one drawn like the old outline is made; other shapes drop them. */
export function withShape(b: Balloon, shape: BalloonShape): Balloon {
  if (shape === 'curve') {
    if (b.pts && b.pts.length >= 3) return { ...b, shape };
    const rx = b.w / 2;
    const ry = b.h / 2;
    const pts = Array.from({ length: 8 }, (_, i) => {
      const t = (i / 8) * Math.PI * 2;
      return { x: b.x + rx + rx * Math.cos(t), y: b.y + ry + ry * Math.sin(t) };
    });
    return { ...b, shape, pts };
  }
  const out: Balloon = { ...b, shape };
  delete out.pts;
  return out;
}

/** The balloon moved by (dx, dy), points and tail with it. */
export function moveBalloon(b: Balloon, dx: number, dy: number): Balloon {
  const shift = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
  const out: Balloon = { ...b, x: b.x + dx, y: b.y + dy, tail: b.tail ? shift(b.tail) : null };
  if (b.pts) out.pts = b.pts.map(shift);
  return out;
}

/** The balloon with its tail tip at `tip` (null = no tail) and in that style. A tip inside the body is no tail at all. */
export function withTail(b: Balloon, tip: Pt | null, style: TailStyle): Balloon {
  const out: Balloon = { ...b, tail: tip && !contains(bodyOutline(b), tip) ? tip : null };
  if (style === 'speech') delete out.tailStyle;
  else out.tailStyle = style;
  return out;
}

/** Where a balloon's tail points when nobody chose: below its lower left, in proportion to its size. */
export function defaultTailTip(b: Balloon): Pt {
  return { x: b.x + b.w * 0.35, y: b.y + b.h * 1.35 };
}

/** Clouds think, every other shape speaks. */
export const defaultTailStyle = (shape: BalloonShape): TailStyle => (shape === 'cloud' ? 'thought' : 'speech');

/** A new balloon comes with its tail (free text has none): the tail belongs to the shape and is adjusted from its tip. */
export function withDefaultTail(b: Balloon, style: TailStyle = defaultTailStyle(b.shape)): Balloon {
  return b.shape === 'none' ? b : withTail(b, defaultTailTip(b), style);
}

const ring = (n: number, f: (theta: number, i: number) => Pt): Poly =>
  Array.from({ length: n }, (_, i) => f((i / n) * Math.PI * 2, i));

/** Rounded rectangle outline, clockwise from the top right corner, with no edge longer than `step`. */
function roundedOutline(b: Balloon, r: number, step: number): Poly {
  const corners: [number, number, number][] = [
    [b.x + b.w - r, b.y + r, -Math.PI / 2],
    [b.x + b.w - r, b.y + b.h - r, 0],
    [b.x + r, b.y + b.h - r, Math.PI / 2],
    [b.x + r, b.y + r, Math.PI],
  ];
  const pts: Poly = [];
  for (const [ox, oy, a0] of corners) {
    for (let i = 0; i <= 8; i++) {
      const a = a0 + (i / 8) * (Math.PI / 2);
      pts.push({ x: ox + r * Math.cos(a), y: oy + r * Math.sin(a) });
    }
  }
  if (step <= 0) return pts;
  const dense: Poly = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / step));
    for (let k = 0; k < n; k++) dense.push({ x: p.x + ((q.x - p.x) * k) / n, y: p.y + ((q.y - p.y) * k) / n });
  }
  return dense;
}

/** A rounded balloon whose edge is a little off everywhere, like cut by hand. The wobble is fixed by the vertex number, so it never changes between draws. */
function roughOutline(b: Balloon): Poly {
  const base = roundedOutline(b, Math.min(b.w, b.h) * 0.28, 14);
  const amp = Math.min(b.w, b.h) * 0.02 + 1.5;
  const n = base.length;
  return base.map((p, i) => {
    const a = base[(i + n - 1) % n]!;
    const c = base[(i + 1) % n]!;
    const tx = c.x - a.x;
    const ty = c.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    const wobble = 0.55 * Math.sin(i * 0.7 + 0.5) + 0.2 * Math.sin(i * 1.9 + 2.1) + 0.25 * Math.sin(i * 12.9898 + 78.233);
    const d = wobble * amp * 2;
    return { x: p.x + (ty / len) * d, y: p.y - (tx / len) * d };
  });
}

export function bodyOutline(b: Balloon): Poly {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const rx = b.w / 2;
  const ry = b.h / 2;
  switch (b.shape) {
    case 'ellipse':
      return ring(96, (t) => ({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) }));
    case 'rect':
      return [
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y },
        { x: b.x + b.w, y: b.y + b.h },
        { x: b.x, y: b.y + b.h },
      ];
    case 'rounded':
      return roundedOutline(b, Math.min(b.w, b.h) * 0.28, 0);
    case 'rough':
      return roughOutline(b);
    case 'curve':
      return b.pts && b.pts.length >= 3 ? smoothClosed(b.pts, 12) : bodyOutline({ ...b, shape: 'ellipse' });
    case 'shout': {
      // Alternating outer/inner points; the jitter is deterministic so a balloon never "wobbles".
      const spikes = Math.max(10, Math.round((b.w + b.h) / 28));
      return ring(spikes * 2, (t, i) => {
        const outer = i % 2 === 0;
        const k = outer ? 1 : 0.74 + 0.05 * Math.sin(i * 12.9898);
        return { x: cx + rx * k * Math.cos(t), y: cy + ry * k * Math.sin(t) };
      });
    }
    case 'cloud': {
      const bumps = Math.max(6, Math.round((b.w + b.h) / 46));
      return ring(bumps * 14, (t) => {
        const k = 0.9 + 0.1 * Math.abs(Math.sin((bumps * t) / 2));
        return { x: cx + rx * k * Math.cos(t), y: cy + ry * k * Math.sin(t) };
      });
    }
    case 'none':
      return [];
  }
}

/** The middle of the body: the box centre, except for a drawn curve whose box centre may lie outside of it. */
function bodyCentre(b: Balloon, body: Poly): Pt {
  if (b.shape !== 'curve') return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const s = body.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / body.length, y: s.y / body.length };
}

/** A speech tail: a spike whose base is buried inside the body so the union has no seam. */
function speechTail(b: Balloon, base: Pt, centre: Pt): Poly {
  const tip = b.tail!;
  const len = Math.hypot(tip.x - centre.x, tip.y - centre.y);
  const dir = { x: (tip.x - centre.x) / len, y: (tip.y - centre.y) / len };
  const perp = { x: -dir.y, y: dir.x };
  const hw = Math.min(b.w, b.h) * 0.12 + 4;
  const inset = hw * 1.5;
  const at = (s: number, p: number): Pt => ({
    x: base.x + dir.x * s + perp.x * p,
    y: base.y + dir.y * s + perp.y * p,
  });
  return [at(-inset, hw), at(0, hw), tip, at(0, -hw), at(-inset, -hw)];
}

/** Bubbles from the body to the tip, each smaller than the one before, with a visible gap between them (the first one too). */
function thoughtBubbles(b: Balloon, base: Pt): Poly[] {
  const tip = b.tail!;
  const length = Math.hypot(tip.x - base.x, tip.y - base.y);
  if (length < 1) return [];
  const dir = { x: (tip.x - base.x) / length, y: (tip.y - base.y) / length };
  const ratios = [1, 0.7, 0.45];
  const gap = b.border * 2 + 4;
  const sum = ratios.reduce((a, r) => a + 2 * r, 0); // the chain is this many radii long
  const cap = Math.min(b.w, b.h) * 0.14;
  const r = Math.min(cap, Math.max(3, (length - ratios.length * gap) / sum));
  const spare = Math.max(1, (length - sum * r) / ratios.length); // what is left of the length is spread as gaps
  const out: Poly[] = [];
  let at = spare;
  for (const k of ratios) {
    const rad = r * k;
    const c = { x: base.x + dir.x * (at + rad), y: base.y + dir.y * (at + rad) };
    out.push(ring(28, (t) => ({ x: c.x + rad * Math.cos(t), y: c.y + rad * Math.sin(t) })));
    at += 2 * rad + spare;
  }
  return out;
}

/** The shapes of the tail (none when there is no tail or its tip is inside the body). */
export function tailShapes(b: Balloon): Poly[] {
  if (!b.tail || b.shape === 'none') return [];
  const body = bodyOutline(b);
  if (contains(body, b.tail)) return [];
  const centre = bodyCentre(b, body);
  const base = lastCrossing(body, centre, b.tail);
  if (!base) return [];
  return b.tailStyle === 'thought' ? thoughtBubbles(b, base) : [speechTail(b, base, centre)];
}

/** Rectangle available for text inside the body, in document coordinates. */
export function textArea(b: Balloon): { x: number; y: number; w: number; h: number } {
  const k = b.shape === 'rect' ? 0.92 : b.shape === 'rounded' ? 0.86 : b.shape === 'rough' ? 0.84 : b.shape === 'none' ? 1 : 0.68;
  const w = b.w * k;
  const h = b.h * k;
  return { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h };
}

export type Handle = 'nw' | 'ne' | 'se' | 'sw' | 'tail';

export function handlePoints(b: Balloon): Partial<Record<Handle, Pt>> {
  const h: Partial<Record<Handle, Pt>> = {
    nw: { x: b.x, y: b.y },
    ne: { x: b.x + b.w, y: b.y },
    se: { x: b.x + b.w, y: b.y + b.h },
    sw: { x: b.x, y: b.y + b.h },
  };
  if (b.tail) h.tail = b.tail;
  return h;
}

export function hitHandle(b: Balloon, p: Pt, radius: number): Handle | null {
  for (const [name, pt] of Object.entries(handlePoints(b)) as [Handle, Pt][]) {
    if (Math.hypot(p.x - pt.x, p.y - pt.y) <= radius) return name;
  }
  return null;
}

export function hitBalloon(list: Balloon[], p: Pt): Balloon | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i]!;
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return b;
    if (tailShapes(b).some((s) => contains(s, p))) return b;
  }
  return null;
}

export function resizeBalloon(b: Balloon, handle: Handle, p: Pt): Balloon {
  if (handle === 'tail') return { ...b, tail: p };
  let x0 = b.x;
  let y0 = b.y;
  let x1 = b.x + b.w;
  let y1 = b.y + b.h;
  if (handle === 'nw' || handle === 'sw') x0 = Math.min(p.x, x1 - MIN_BALLOON);
  if (handle === 'ne' || handle === 'se') x1 = Math.max(p.x, x0 + MIN_BALLOON);
  if (handle === 'nw' || handle === 'ne') y0 = Math.min(p.y, y1 - MIN_BALLOON);
  if (handle === 'sw' || handle === 'se') y1 = Math.max(p.y, y0 + MIN_BALLOON);
  const out: Balloon = { ...b, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  // The tail keeps its place relative to the box, so it grows and shrinks with its balloon.
  if (b.tail) out.tail = { x: x0 + ((b.tail.x - b.x) / b.w) * (x1 - x0), y: y0 + ((b.tail.y - b.y) / b.h) * (y1 - y0) };
  // The points of a curve keep their place inside the box.
  if (b.pts) out.pts = b.pts.map((q) => ({ x: x0 + ((q.x - b.x) / b.w) * (x1 - x0), y: y0 + ((q.y - b.y) / b.h) * (y1 - y0) }));
  return out;
}
