import type { PaintTarget } from './document';
import { pressureResponse, type PressureGraph } from './pressure-graph';
import { Stabilizer } from './stabilizer';
import type { SelectionClip } from './selection';
import { TILE, TILE_BYTES, assertWorkingBlocks, type Rect, type Tile } from './tiles';

export { STAB_SPEED_HALF, stabilizationAtSpeed, stabilizationAtZoom } from './stabilizer';

export type { Rect } from './tiles';

export interface BrushSettings {
  /** Diameter in pixels at full pressure. */
  size: number;
  /** 0 = fully soft edge, 1 = hard edge (still anti-aliased). */
  hardness: number;
  /** Maximum stroke opacity 0..1 (a stroke never exceeds it, however much it overlaps itself). */
  opacity: number;
  /** Distance between stamps as a fraction of the current diameter. */
  spacing: number;
  color: readonly [number, number, number]; // 0..255
  erase: boolean;
  /** Pressure influence on diameter: 0 = none, 1 = size scales from 0 to full. */
  pressureSize: number;
  /** Pressure influence on opacity of each stamp. */
  pressureOpacity: number;
  /** 0 = follow the pen exactly, up to ~0.95 = heavy smoothing. */
  stabilization: number;
  /** Paint behind what is already there (only the gaps get colour): the "leftover" pen. */
  behind?: boolean;
  /** Pressure response: pressure is raised to this power (1 = as reported, below 1 = lighter touch counts more, above 1 = firmer). */
  pressureCurve?: number;
  /** A drawn pressure response (points of pressure → result); applied before `pressureCurve`, which then only bends it further. */
  pressureGraph?: PressureGraph;
  /** Smallest size as a fraction of `size`, however light the pressure (0 = can shrink to a point). */
  minSize?: number;
  /** The stroke starts thin and reaches full size after this many pixels of path. */
  taperIn?: number;
  /** The stroke thins out over its last this-many pixels (applied when the pen is lifted). */
  taperOut?: number;
  /** Paper grain: 0 = none, 1 = the paint only lands on the high points of the grain. */
  grain?: number;
  /** Size of one grain cell in pixels. */
  grainScale?: number;
  /** Nib shape: the width across the nib as a fraction of its length (1 = round, below 1 = a flat nib, above 1 = a tall one). */
  nibThickness?: number;
  /** Direction of the nib's length in degrees, 0 = horizontal and turning clockwise on screen. */
  nibAngle?: number;
  /** View scale (screen pixels per page pixel) when the stroke starts. Only set when the "by zoom" option is on: stabilization then eases off when zoomed in and grows when zoomed out. Unset, it lags the same distance on screen at any zoom. */
  stabilizationZoom?: number;
  /** Ease the stabilization off as the pen speeds up (see `stabilizationAtSpeed`); `stabilization` is then the most it applies. */
  stabilizationBySpeed?: boolean;
  /**
   * Samples over which the pressure fades in at the start of the stroke (0 = off): sample n of N is scaled by
   * sin(90° · (n+1) / (N+1)) (a plain n / N ramp would make a tap invisible). It scales with the smoothing level (see `entryRampSamples`), so a stabilized
   * stroke does not open with a blob while the lagging path catches up.
   */
  entryRamp?: number;
  /**
   * How much of the opacity each stamp lays down (1 or unset = the whole stroke at once, so overlap never
   * darkens it). Below 1 the brush is stamped at `spacing` and each stamp adds that share of what is still
   * missing, so slow or repeated passes build up towards `opacity`, which stays the ceiling.
   */
  flow?: number;
  /**
   * How much a light touch lowers the flow of each stamp: 0 or unset = none, 0.5 = a feather touch lays half of `flow`
   * (pencil and chalk brushes use 0.5), 1 = down to nothing. Like `flow` it needs stamping, so a
   * value above 0 stamps the brush even at full `flow`. Linear: no response curve is applied.
   */
  pressureFlow?: number;
  /** Anti-aliasing of the edge (see `Antialias`); unset = medium. */
  antialias?: Antialias;
}

/**
 * Anti-aliasing level of a tool's edge: 0 none, 1 weak, 2 medium (the default), 3 strong.
 * Own design: the levels are named by what they do, the width of the soft rim every edge gets.
 */
export type Antialias = 0 | 1 | 2 | 3;
export const DEFAULT_ANTIALIAS: Antialias = 2;
/** Width in pixels of the rim a hard edge fades over, per level. Level 2 is what the brush always had. */
const AA_RIM: readonly number[] = [0, 0.5, 1, 2];

/** `value` as a level; anything else (absent, out of range, not a whole number) is the default. */
export function antialiasOf(value: number | undefined): Antialias {
  return value === 0 || value === 1 || value === 2 || value === 3 ? value : DEFAULT_ANTIALIAS;
}

/**
 * Radius up to which a round tool of radius `r` is at full strength: the hardness decides it, but the edge always
 * keeps the rim of its anti-aliasing level. With level 0 and full hardness this is `r` itself, a hard edge
 * (a pixel is in or out by its centre).
 */
export function innerRadius(r: number, hardness: number, antialias: number | undefined): number {
  return Math.max(0, Math.min(r * hardness, r - AA_RIM[antialiasOf(antialias)]!));
}

export const defaultBrush: BrushSettings = {
  size: 12,
  hardness: 0.8,
  opacity: 1,
  spacing: 0.1,
  color: [0, 0, 0],
  erase: false,
  pressureSize: 1,
  pressureOpacity: 0,
  stabilization: 0.3,
};

/** What the app needs from anything that is dragged over a layer like a pen: the pen itself and the blending tools. */
export interface PenStroke {
  /** Add a pen sample; returns the dirty rectangle, or null if nothing changed. */
  addPoint(x: number, y: number, pressure?: number, t?: number): Rect | null;
  /** Note a sample without painting it (the brush is too heavy to keep up). */
  skipPoint(x: number, y: number, pressure?: number): void;
  /** The patch that undoes the stroke (null when it changed nothing). */
  finish(): StrokePatch | null;
  /** Abort and put the layer back; returns the area to repaint. */
  cancel(): Rect | null;
}

/** One tile as it was before and after a stroke (null = the tile did not exist / was removed). */
export interface TilePatch {
  tx: number;
  ty: number;
  before: Tile | null;
  after: Tile | null;
}

export interface StrokePatch {
  layerId: number;
  /** The tiles belong to the layer's mask, not to its pixels. */
  onMask?: boolean;
  /** Area covered by the stroke, for repainting. */
  rect: Rect;
  tiles: TilePatch[];
  /** Memory held by the snapshots, for the history budget. */
  bytes: number;
}

// Uint8ClampedArray rounds to nearest on assignment, so values are stored as plain floats here.
const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * Samples a stroke's pressure fades in over: between 3 and 5, scaled with the stabilization setting.
 */
export function entryRampSamples(stabilization: number): number {
  return Math.min(5, 3 + Math.round(2 * Math.min(1, Math.max(0, stabilization))));
}

/** At the end of a stroke the smoothing runs on the last sample for at most this many steps, and stops within this distance (px) of it. */
const TAIL_STEPS = 16;
const TAIL_DONE_PX = 0.75;

/** Fraction of the size a tapered stroke starts or ends with. */
const TAPER_MIN = 0.1;

function hash2(ix: number, iy: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Smooth value noise in 0..1, stretched so it uses the whole range: the paper grain a textured brush leaves. */
export function grainAt(x: number, y: number, cell: number): number {
  const gx = x / cell;
  const gy = y / cell;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = smooth(gx - ix);
  const fy = smooth(gy - iy);
  const top = hash2(ix, iy) * (1 - fx) + hash2(ix + 1, iy) * fx;
  const bottom = hash2(ix, iy + 1) * (1 - fx) + hash2(ix + 1, iy + 1) * fx;
  const v = top * (1 - fy) + bottom * fy;
  return Math.min(1, Math.max(0, (v - 0.5) * 1.8 + 0.5));
}

const ZERO_TILE: Tile = new Uint8ClampedArray(TILE_BYTES);
const FULL_TILE: Tile = new Uint8ClampedArray(TILE_BYTES).fill(255);

// Coverage masks are 256 KB each and a stroke needs one per tile it enters; reusing them
// avoids allocating (and later garbage-collecting) megabytes in the middle of a stroke.
const maskPool: Float32Array[] = [];
function acquireMask(): Float32Array {
  const m = maskPool.pop();
  if (!m) return new Float32Array(TILE * TILE);
  m.fill(0);
  return m;
}
function releaseMasks(states: Iterable<{ mask: Float32Array }>): void {
  for (const st of states) if (maskPool.length < 96) maskPool.push(st.mask);
}

interface TileState {
  /** Copy of the tile before the stroke, or null if it did not exist. */
  base: Tile | null;
  /** Coverage accumulated by the stroke on this tile (max-combined stamps). */
  mask: Float32Array;
}

/**
 * One pen stroke on one target. Stamps accumulate into a per-tile coverage mask
 * (max-combined) and every touched pixel is recomputed from the untouched
 * snapshot of its tile, so overlapping stamps never darken past `opacity`.
 * Only tiles the stroke crosses are copied, so strokes on huge canvases stay cheap.
 */
export class Stroke implements PenStroke {
  private readonly states = new Map<number, TileState>();
  private readonly stabilizer: Stabilizer;
  private last: { x: number; y: number; p: number; k?: number } | null = null;
  /** Path length so far, and (only when the end tapers) every point laid down, to repaint the stroke when it ends. */
  private travel = 0;
  private trail: { x: number; y: number; p: number; s: number }[] = [];
  private lastInput: { x: number; y: number; p: number } | null = null;
  /** Samples seen so far (for the entry ramp). */
  private count = 0;
  /** Previous sample: the control point of the next curve segment. */
  private ctrl: { x: number; y: number; p: number } | null = null;
  private bounds: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private readonly response: ((pressure: number) => number) | null;
  /** Flow mode: path length still to travel before the next stamp. */
  private gap = 0;

  constructor(
    private readonly target: PaintTarget,
    readonly settings: BrushSettings,
    /** When given, paint only inside the selection (partly selected pixels get partial paint). */
    private readonly clip?: SelectionClip,
  ) {
    // The per-tile snapshots and coverage masks below are TILE-sized; a surface cut differently would be corrupted.
    assertWorkingBlocks(target.surface);
    this.response = settings.pressureGraph?.length ? pressureResponse(settings.pressureGraph) : null;
    this.stabilizer = new Stabilizer({ stabilization: settings.stabilization, zoom: settings.stabilizationZoom, bySpeed: settings.stabilizationBySpeed });
  }

  /** Add a pen sample (`t`: its time in ms, when known, so the smoothing is by time and not by sample); returns the dirty rectangle, or null if nothing changed. */
  addPoint(x: number, y: number, rawPressure = 1, t?: number): Rect | null {
    const shaped = this.shape(rawPressure);
    const pressure = shaped * this.entryFactor();
    this.lastInput = { x, y, p: shaped };
    return this.curveTo(this.stabilizer.next(x, y, pressure, t));
  }

  /**
   * Note a pen sample without painting it (used when the brush is too heavy to keep up).
   * The stroke still ends exactly at the last sample given.
   */
  skipPoint(x: number, y: number, pressure = 1): void {
    this.lastInput = { x, y, p: this.shape(pressure) };
  }

  /** Factor the entry ramp applies to the next sample's pressure (1 once past the ramp or when off). */
  private entryFactor(): number {
    const n = this.count++;
    const len = this.settings.entryRamp ?? 0;
    return len > 0 && n < len ? Math.sin((Math.PI / 2) * ((n + 1) / (len + 1))) : 1;
  }

  /** The pressure after the brush's response curve. */
  private shape(pressure: number): number {
    const g = this.settings.pressureCurve ?? 1;
    const p = Math.min(1, Math.max(0, pressure));
    const drawn = this.response ? this.response(p) : p;
    return g === 1 ? drawn : Math.pow(drawn, g);
  }

  /**
   * Pens report ~60 samples a second on many tablets, so joining them with straight
   * lines shows corners. Instead the path runs along quadratic curves from the midpoint
   * of one sample pair to the next, with the shared sample as control point.
   */
  private curveTo(p: { x: number; y: number; p: number }): Rect | null {
    const c = this.ctrl;
    const from = this.last;
    this.ctrl = { ...p };
    if (!c || !from) return this.moveTo(p);
    const mid = { x: (c.x + p.x) / 2, y: (c.y + p.y) / 2, p: (c.p + p.p) / 2 };
    const chord = Math.hypot(mid.x - from.x, mid.y - from.y);
    // Pieces of the curve are filled as capsules, so a big brush needs far fewer of them.
    const step = Math.min(40, Math.max(2.5, (this.diameter(Math.max(from.p, c.p, p.p)) / 2) * 0.35));
    const n = Math.min(24, Math.max(1, Math.ceil(chord / step)));
    let dirty: Rect | null = null;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const d = t * t;
      dirty = union(
        dirty,
        this.moveTo({
          x: a * from.x + b * c.x + d * mid.x,
          y: a * from.y + b * c.y + d * mid.y,
          p: a * from.p + b * c.p + d * mid.p,
        }),
      );
    }
    return dirty;
  }

  /** Abort the stroke and put back the untouched tiles; returns the area to repaint. */
  cancel(): Rect | null {
    const b = this.bounds;
    this.bounds = null;
    const surface = this.target.surface;
    for (const [key, st] of this.states) surface.put(surface.tx(key), surface.ty(key), st.base ?? undefined);
    releaseMasks(this.states.values());
    this.states.clear();
    return b ? { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 } : null;
  }

  /** Finish the path and hand back what is needed to undo/redo it. */
  finish(): StrokePatch | null {
    // The curve stops at the midpoint of the last pair: finish the path at the last
    // smoothed sample, then catch up to the last raw one (stabilization lags behind it).
    if (this.ctrl) this.moveTo(this.ctrl);
    const raw = this.lastInput;
    if (raw && this.stabilizer.current) {
      // Let the smoothing run its course on the last sample: the stroke closes in on the pen along its own curve, and what is
      // left is a short step, instead of one straight line from where the smoothing had got to (up to tens of pixels long).
      for (let i = 0; i < TAIL_STEPS; i++) {
        const at = this.stabilizer.current;
        if (Math.hypot(at.x - raw.x, at.y - raw.y) < TAIL_DONE_PX) break;
        this.curveTo(this.stabilizer.next(raw.x, raw.y, raw.p));
      }
      this.moveTo(raw);
    }
    if ((this.settings.taperOut ?? 0) > 0 && this.trail.length > 1) this.retrace();
    const b = this.bounds;
    if (!b) return null;
    const surface = this.target.surface;
    const tiles: TilePatch[] = [];
    let bytes = 0;
    for (const [key, st] of this.states) {
      const tx = surface.tx(key);
      const ty = surface.ty(key);
      // Erasing may have emptied the tile; a mask tile that went back to its default goes too.
      if (this.target.mask === undefined) surface.dropIfEmpty(tx, ty);
      else surface.dropIfUniform(tx, ty, this.target.mask);
      const now = surface.get(tx, ty);
      if (!st.base && !now) continue; // touched by a stamp's margin but never painted
      tiles.push({ tx, ty, before: st.base, after: now ? now.slice() : null });
      bytes += (st.base ? TILE_BYTES : 0) + (now ? TILE_BYTES : 0);
    }
    releaseMasks(this.states.values());
    this.states.clear();
    return {
      layerId: this.target.id,
      ...(this.target.mask !== undefined ? { onMask: true } : {}),
      rect: { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 },
      tiles,
      bytes,
    };
  }

  private moveTo(to: { x: number; y: number; p: number }): Rect | null {
    const from = this.last;
    if (from) this.travel += Math.hypot(to.x - from.x, to.y - from.y);
    const point = { ...to, k: this.taper(this.travel) };
    this.last = point;
    if ((this.settings.taperOut ?? 0) > 0) this.trail.push({ x: to.x, y: to.y, p: to.p, s: this.travel });
    return this.lay(from ?? point, point);
  }

  /**
   * Put the brush along a to b: one swept capsule, or (flow below 1) stamps at the brush spacing, carrying the
   * distance to the next stamp across segments so the pitch stays even however the pen samples arrive.
   */
  private lay(a: { x: number; y: number; p: number; k?: number }, b: { x: number; y: number; p: number; k?: number }): Rect | null {
    if (!this.stamps()) return this.capsule(a, b);
    let dirty: Rect | null = null;
    const pitch = (p: number, k: number): number => Math.max(1, this.diameter(p, k) * Math.max(0.01, this.settings.spacing));
    if (a === b) {
      this.gap = pitch(b.p, b.k ?? 1);
      return this.capsule(b, b);
    }
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    let pos = this.gap;
    while (pos <= d) {
      const t = d > 0 ? pos / d : 1;
      const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t, k: (a.k ?? 1) + ((b.k ?? 1) - (a.k ?? 1)) * t };
      dirty = union(dirty, this.capsule(at, at));
      pos += pitch(at.p, at.k);
    }
    this.gap = pos - d;
    return dirty;
  }

  /** Whether the brush is stamped (flow below 1, or flow that follows the pressure) rather than swept in one capsule. */
  private stamps(): boolean {
    return (this.settings.flow ?? 1) < 1 || (this.settings.pressureFlow ?? 0) > 0;
  }

  /** Share of the opacity a stamp lays down at this pressure. */
  private flowAt(pressure: number): number {
    const lift = Math.min(1, Math.max(0, this.settings.pressureFlow ?? 0));
    return Math.max(0, this.settings.flow ?? 1) * (1 - lift * (1 - pressure));
  }

  /** Size factor at a distance along the path: thin at the start, and (once the length is known) at the end. */
  private taper(s: number, total = Infinity): number {
    const { taperIn = 0, taperOut = 0 } = this.settings;
    let k = 1;
    if (taperIn > 0) k = Math.min(k, TAPER_MIN + (1 - TAPER_MIN) * Math.min(1, s / taperIn));
    if (taperOut > 0 && total < Infinity) k = Math.min(k, TAPER_MIN + (1 - TAPER_MIN) * Math.min(1, Math.max(0, total - s) / taperOut));
    return k;
  }

  /** The pen is up and the length is known: paint the stroke again, this time thinning out towards its end. */
  private retrace(): void {
    const surface = this.target.surface;
    const earlier = this.bounds;
    for (const [key, st] of this.states) surface.put(surface.tx(key), surface.ty(key), st.base ?? undefined);
    releaseMasks(this.states.values());
    this.states.clear();
    this.bounds = null;
    let prev: { x: number; y: number; p: number; k: number } | null = null;
    for (const pt of this.trail) {
      const cur = { x: pt.x, y: pt.y, p: pt.p, k: this.taper(pt.s, this.travel) };
      this.lay(prev ?? cur, cur);
      prev = cur;
    }
    if (earlier && this.bounds) {
      const b = this.bounds as { x0: number; y0: number; x1: number; y1: number };
      this.bounds = { x0: Math.min(b.x0, earlier.x0), y0: Math.min(b.y0, earlier.y0), x1: Math.max(b.x1, earlier.x1), y1: Math.max(b.y1, earlier.y1) };
    }
    this.trail = [];
  }

  private diameter(pressure: number, k = 1): number {
    const f = 1 - this.settings.pressureSize * (1 - pressure);
    const m = this.settings.minSize ?? 0;
    return Math.max(1, this.settings.size * (m + (1 - m) * f) * k);
  }

  /** Snapshot state for a tile, created on first touch. */
  private state(tx: number, ty: number): TileState {
    const surface = this.target.surface;
    const key = surface.key(tx, ty);
    let st = this.states.get(key);
    if (!st) {
      const existing = surface.get(tx, ty);
      st = { base: existing ? existing.slice() : null, mask: acquireMask() };
      this.states.set(key, st);
    }
    return st;
  }

  /**
   * Paint the shape swept by the brush disc moving from `a` to `b` (a capsule, tapered if the
   * pressure differs). Coverage at a pixel is the brush falloff at its distance to the segment,
   * combined with what the stroke already laid down by taking the maximum, exactly what an
   * infinite number of overlapping stamps would give, without scalloped edges and at a fraction
   * of the cost. Pixels the stroke has already saturated are skipped before any maths.
   */
  private capsule(a: { x: number; y: number; p: number; k?: number }, b: { x: number; y: number; p: number; k?: number }): Rect | null {
    const { hardness, opacity, color, erase, pressureOpacity, behind, antialias } = this.settings;
    const accumulate = this.stamps();
    const flow = accumulate ? this.flowAt(a.p) : 1;
    // A flat or tall nib: measure everything in a space where it is a plain disc (turn by the nib angle, stretch across it).
    const th = Math.max(0.05, this.settings.nibThickness ?? 1);
    const oval = th !== 1;
    const ang = ((this.settings.nibAngle ?? 0) * Math.PI) / 180;
    const cs = Math.cos(ang);
    const sn = Math.sin(ang);
    const grainAmount = this.settings.grain ?? 0;
    const grainCell = Math.max(1, this.settings.grainScale ?? 6);
    const surface = this.target.surface;
    const lockAlpha = this.target.lockAlpha;
    const maskBase = this.target.mask;
    // On a mask the colour's lightness says how much of the layer shows (white = all); the eraser shows it again.
    const maskValue = erase ? 255 : 0.3 * color[0] + 0.59 * color[1] + 0.11 * color[2];
    const r0 = this.diameter(a.p, a.k) / 2;
    const r1 = this.diameter(b.p, b.k) / 2;
    const a0 = 1 - pressureOpacity * (1 - a.p);
    const a1 = 1 - pressureOpacity * (1 - b.p);
    const aMax = Math.max(a0, a1);
    const rMax = Math.max(r0, r1) * (oval ? Math.max(1, th) : 1);
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - rMax - 1));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - rMax - 1));
    const x1 = Math.min(surface.width, Math.ceil(Math.max(a.x, b.x) + rMax + 1));
    const y1 = Math.min(surface.height, Math.ceil(Math.max(a.y, b.y) + rMax + 1));
    if (x1 <= x0 || y1 <= y0) return null;

    const wx = b.x - a.x;
    const wy = b.y - a.y;
    const dx = oval ? wx * cs + wy * sn : wx;
    const dy = oval ? (wy * cs - wx * sn) / th : wy;
    const len2 = dx * dx + dy * dy;
    const inv = len2 > 0 ? 1 / len2 : 0;
    const len = Math.sqrt(len2);

    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y1 - 1) / TILE); ty++) {
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x1 - 1) / TILE); tx++) {
        // Erasing or alpha-locked painting never changes a tile that has no pixels. A mask's missing tiles
        // are uniform, so only painting towards the value they already have is skipped.
        if (!surface.get(tx, ty) && (maskBase === undefined ? erase || lockAlpha : erase && maskBase === 255)) continue;
        const sc = this.clip ? this.clip.tile(tx, ty) : 255;
        if (sc === 0) continue; // nothing of this tile is selected
        const st = this.state(tx, ty);
        let tile = surface.get(tx, ty);
        if (!tile) {
          tile = surface.ensure(tx, ty);
          if (maskBase === 255) tile.fill(255);
        }
        const mask = st.mask;
        const base = st.base ?? (maskBase === 255 ? FULL_TILE : ZERO_TILE);
        const ox = tx * TILE;
        const oy = ty * TILE;
        const ya = Math.max(y0, oy);
        const yb = Math.min(y1, oy + TILE);
        const xa = Math.max(x0, ox);
        const xb = Math.min(x1, ox + TILE);
        for (let y = ya; y < yb; y++) {
          const rowMask = (y - oy) * TILE - ox;
          const yc = y + 0.5;
          const wpy = yc - a.y;
          const py = oval ? wpy / th : wpy;
          // The capsule's extent on this row: the two end discs plus the body between them, a
          // rectangle of half-width rMax along the segment. Pixels outside have no coverage.
          let lo = Infinity;
          let hi = -Infinity;
          const ra2 = r0 * r0 - py * py;
          if (oval) {
            lo = xa;
            hi = xb;
          } else if (ra2 > 0) {
            const w = Math.sqrt(ra2);
            lo = a.x - w;
            hi = a.x + w;
          }
          const pyb = yc - b.y;
          const rb2 = r1 * r1 - pyb * pyb;
          if (!oval && rb2 > 0) {
            const w = Math.sqrt(rb2);
            lo = Math.min(lo, b.x - w);
            hi = Math.max(hi, b.x + w);
          }
          if (len > 0 && !oval) {
            // With u = x - a.x on this row: along-segment position (u·dx + py·dy) must lie in
            // [0, len²] and the sideways offset (py·dx - u·dy) within ±rMax·len.
            let u0 = -Infinity;
            let u1 = Infinity;
            const clip = (k: number, c0: number, c1: number): void => {
              // constraint c0 <= k·u <= c1
              if (k > 0) {
                u0 = Math.max(u0, c0 / k);
                u1 = Math.min(u1, c1 / k);
              } else if (k < 0) {
                u0 = Math.max(u0, c1 / k);
                u1 = Math.min(u1, c0 / k);
              } else if (c0 > 0 || c1 < 0) {
                u1 = -Infinity; // 0 is outside [c0, c1]: no body on this row
              }
            };
            clip(dx, -py * dy, len2 - py * dy);
            clip(-dy, -rMax * len - py * dx, rMax * len - py * dx);
            if (u1 >= u0) {
              lo = Math.min(lo, a.x + u0);
              hi = Math.max(hi, a.x + u1);
            }
          }
          if (hi < lo) continue;
          const xs = Math.max(xa, Math.floor(lo));
          const xe = Math.min(xb, Math.ceil(hi) + 1);
          for (let x = xs; x < xe; x++) {
            const li = rowMask + x;
            const m = mask[li]!;
            if (m >= (accumulate ? 0.999 : aMax)) continue; // already fully laid down by this stroke
            const wpx = x + 0.5 - a.x;
            const px = oval ? wpx * cs + wpy * sn : wpx;
            const qy = oval ? (wpy * cs - wpx * sn) / th : py;
            let t = (px * dx + qy * dy) * inv;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = px - t * dx;
            const ey = qy - t * dy;
            const d2 = ex * ex + ey * ey;
            const r = r0 + (r1 - r0) * t;
            if (d2 >= r * r) continue;
            // The soft edge keeps at least the rim of the anti-aliasing level, so hard brushes are smooth too.
            const ri = innerRadius(r, hardness, antialias);
            let cov = (d2 <= ri * ri ? 1 : smooth((r - Math.sqrt(d2)) / (r - ri))) * (a0 + (a1 - a0) * t);
            if (sc !== 255) cov *= sc[li]! / 255;
            if (grainAmount > 0) cov *= 1 - grainAmount * (1 - grainAt(x, y, grainCell));
            let laid = cov;
            if (accumulate) laid = m + (1 - m) * cov * Math.max(0, flow);
            if (laid <= m) continue;
            mask[li] = laid;

            const q = li * 4;
            const ta = laid * opacity;
            if (maskBase !== undefined) {
              const was = base[q + 3]!;
              tile[q] = tile[q + 1] = tile[q + 2] = 255;
              tile[q + 3] = was + (maskValue - was) * ta;
            } else if (erase) {
              const ba = base[q + 3]! / 255;
              tile[q] = base[q]!;
              tile[q + 1] = base[q + 1]!;
              tile[q + 2] = base[q + 2]!;
              tile[q + 3] = ba * (1 - ta) * 255;
            } else if (lockAlpha) {
              if (base[q + 3]! > 0) {
                tile[q] = base[q]! + (color[0] - base[q]!) * ta;
                tile[q + 1] = base[q + 1]! + (color[1] - base[q + 1]!) * ta;
                tile[q + 2] = base[q + 2]! + (color[2] - base[q + 2]!) * ta;
                tile[q + 3] = base[q + 3]!;
              }
            } else if (behind) {
              // The new colour goes underneath: existing pixels keep priority, gaps and soft edges get filled.
              const ba = base[q + 3]! / 255;
              const na = ta * (1 - ba);
              const ra = ba + na;
              if (ra > 0) {
                tile[q] = (ba * base[q]! + na * color[0]) / ra;
                tile[q + 1] = (ba * base[q + 1]! + na * color[1]) / ra;
                tile[q + 2] = (ba * base[q + 2]! + na * color[2]) / ra;
                tile[q + 3] = ra * 255;
              }
            } else if (ta >= 1) {
              tile[q] = color[0];
              tile[q + 1] = color[1];
              tile[q + 2] = color[2];
              tile[q + 3] = 255;
            } else {
              const ba = base[q + 3]! / 255;
              const ra = ta + ba * (1 - ta);
              const w = (1 - ta) * ba;
              tile[q] = (ta * color[0] + w * base[q]!) / ra;
              tile[q + 1] = (ta * color[1] + w * base[q + 1]!) / ra;
              tile[q + 2] = (ta * color[2] + w * base[q + 2]!) / ra;
              tile[q + 3] = ra * 255;
            }
          }
        }
        surface.touch(tx, ty);
      }
    }
    const bb = this.bounds;
    this.bounds = bb
      ? { x0: Math.min(bb.x0, x0), y0: Math.min(bb.y0, y0), x1: Math.max(bb.x1, x1), y1: Math.max(bb.y1, y1) }
      : { x0, y0, x1, y1 };
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
}

function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
