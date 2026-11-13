import type { Document, Layer } from '../engine/document';
import { combineCommands, patchCommand, type Command, type History } from '../engine/history';
import { descendants } from '../engine/layer-tree';
import type { Selection } from '../engine/selection';
import type { Pt } from '../engine/geometry';
import type { Rect } from '../engine/tiles';
import { dropEverything, layerReach, liftEverything, overflowCommand, sticksOut, type Overflow } from '../engine/overflow';
import {
  TileRecorder,
  about,
  apply,
  compose,
  drop,
  invert,
  lift,
  mapRect,
  rotation,
  scaling,
  transformLayerPixels,
  transformSelection,
  translation,
  unionRect,
  type Affine,
  type Lifted,
} from '../engine/transform';
import type { Floating } from './gl-renderer';
import { Warp, applyH, dropWarp, meshPoints, rectQuad, warpSelection, type Quad } from '../engine/warp';

/** How the content is being transformed: scale/rotate with the box, or one of the free-form warps. */
export type TransformMode = 'free' | 'distort' | 'perspective' | 'skew' | 'mesh';
const MESH_COLS = 3;
const MESH_ROWS = 3;

export interface TransformDeps {
  doc: () => Document;
  view: { x: number; y: number; scale: number };
  history: () => History;
  /** The layers the command applies to: the ticked ones, or just the active layer when none is ticked. */
  layers: () => Layer[];
  selection: () => Selection | null;
  setSelection: (s: Selection | null, label: string) => void;
  render: (region?: Rect | null) => void;
  refreshLayer: (layer: Layer, rect: Rect) => void;
  refreshUi: () => void;
  redrawOverlay: () => void;
  /**
   * The lifted pixels are shown by the renderer, in their layers' places in the stack (clipping, blend mode, opacity and
   * mask included), not on the overlay. `setFloating(null)` ends it; `floatChanged` follows every change to the matrix or warp.
   */
  setFloating: (f: Floating | null) => void;
  floatChanged: () => void;
  say: (msg: string) => void;
  /** Tells the page a session began, ended or changed mode (to show the Apply / Cancel buttons, the mode and a line saying how it works). */
  setActive: (on: boolean, mode: TransformMode, hint?: string) => void;
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move' | 'rotate' | 'rotgrip' | 'pivot';
const HANDLE_POS: Record<Exclude<Handle, 'move' | 'rotate' | 'rotgrip' | 'pivot'>, [number, number]> = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
};

const BLUE = '#2f7bf5';
const ORANGE = '#f59a23';

/** The system resize cursor that matches a direction (radians, page plane): ←→, ↖↘, ↑↓ or ↗↙. */
export function resizeCursor(angle: number): string {
  const deg = ((((angle * 180) / Math.PI) % 180) + 180) % 180;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][Math.round(deg / 45) % 4]!;
}

/** A circular arrow, white with a dark edge so it reads on any drawing; its hotspot is the middle. */
const ROTATE_CURSOR = (() => {
  const arc = 'M6 13a6.5 6.5 0 1 0 6.5-6.5';
  const head = '12,2.5 18,6.5 12,10.5';
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke-linecap='round' stroke-linejoin='round'>` +
    `<path d='${arc}' stroke='#fff' stroke-width='4.5'/><polyline points='${head}' stroke='#fff' stroke-width='4.5'/>` +
    `<path d='${arc}' stroke='#111' stroke-width='2'/><polyline points='${head}' stroke='#111' stroke-width='2'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, alias`;
})();

/** Content that can be transformed: the selection (or the whole layer) of a pixel layer. */
export function createTransformUi(d: TransformDeps): {
  readonly active: boolean;
  readonly mode: TransformMode;
  /** Begin a session on the target layers, or only on `only` (a layer that was just created for it). */
  start(mode?: TransformMode, only?: Layer): boolean;
  /** Change how the content is transformed (starts a session when there is none). */
  setMode(mode: TransformMode): void;
  fix(): void;
  cancel(): void;
  down(p: Pt, shift?: boolean): boolean;
  move(p: Pt, shift?: boolean): void;
  up(): void;
  drawOverlay(ctx: CanvasRenderingContext2D): void;
  /** The mouse cursor for the pointer at `p` (what dragging there would do), or null outside a session. Tracks the hovered handle for drawing. */
  cursorAt(p: Pt): string | null;
  /** Flip or rotate by a quarter turn in one step (outside a session). */
  quick(kind: 'flipx' | 'flipy' | 'rot90' | 'rot-90'): boolean;
  canTransform(): boolean;
  /** Whether corner handles keep the proportion by default (Shift inverts it while held). */
  proportionLocked: boolean;
} {
  /** One layer taking part in the session: its own lifted pixels and the recorder that undoes them. */
  interface Part {
    layer: Layer;
    rec: TileRecorder;
    lifted: Lifted;
    /** The lifted pixels as an image, drawn through the current matrix or warp. */
    piece: HTMLCanvasElement;
    /** Without a selection the part holds everything the layer has, including what is beyond the page (see overflow). */
    whole: boolean;
    /** What the layer held beyond the page when the session began (taken out of the layer meanwhile). */
    ovBefore: Overflow | undefined;
  }
  interface Session {
    parts: Part[];
    /** The box all parts are transformed about: the selection's, or the union of what the layers hold. */
    box: Rect;
    sel: Selection | null;
    /** Centre, rotation and scale of the content, relative to its original box. */
    cx: number;
    cy: number;
    angle: number;
    sx: number;
    sy: number;
    mode: TransformMode;
    /** Where the corners of the content are now (the warp modes). */
    quad: Quad;
    /** The control points of the grid (mesh mode), row by row. */
    mesh: Pt[];
    /** The point the box rotates about (page plane); null is the middle of the content. */
    pivot: Pt | null;
  }
  let s: Session | null = null;
  let wg: { id: string; start: Pt; quad: Quad; mesh: Pt[] } | null = null;
  let gesture: { handle: Handle; start: Pt; orig: { cx: number; cy: number; angle: number; sx: number; sy: number; pivot: Pt | null }; shift: boolean } | null = null;
  /** The handle under the pointer (drawn larger), by the id `hit` / `warpHit` gives it. */
  let hover: string | null = null;
  /** The "Proporción" lock: on, corner handles keep the proportion and Shift frees it; off, it is the other way round. */
  let lockProportion = true;
  const keepsProportion = (shift: boolean): boolean => lockProportion !== shift;

  /**
   * What the command can act on. Only visible, unlocked pixel layers take part; a folder stands for the pixel layers
   * inside it. Whatever else is ticked keeps its own limits and is left as it is (counted in `skipped`).
   */
  function plan(only?: Layer): { layers: Layer[]; skipped: number } {
    const doc = d.doc();
    const ok = (l: Layer): boolean => l.kind === 'raster' && l.visible && !l.locked;
    const layers: Layer[] = [];
    let skipped = 0;
    const add = (l: Layer, nested: boolean): void => {
      if (l.kind === 'folder') {
        for (const m of descendants(doc, l.id)) if (m.kind !== 'folder') add(m, true);
        return;
      }
      if (layers.includes(l)) return;
      if (ok(l)) layers.push(l);
      else if (!nested || l.kind === 'raster') skipped++;
    };
    for (const l of only ? [only] : d.layers()) add(l, false);
    // Lowest layer first, as in the document.
    layers.sort((x, y) => doc.layers.indexOf(x) - doc.layers.indexOf(y));
    return { layers, skipped };
  }

  const canTransform = (): boolean => plan().layers.length > 0;

  const matrix = (t: { cx: number; cy: number; angle: number; sx: number; sy: number }, r: Rect): Affine =>
    compose(compose(compose(translation(-(r.x + r.w / 2), -(r.y + r.h / 2)), scaling(t.sx, t.sy)), rotation(t.angle)), translation(t.cx, t.cy));

  const pageRect = (): Rect => ({ x: 0, y: 0, w: d.doc().width, h: d.doc().height });

  /** The part of a rectangle that is on the page (null when none is). */
  function onPage(r: Rect): Rect | null {
    const p = pageRect();
    const x0 = Math.max(p.x, Math.floor(r.x));
    const y0 = Math.max(p.y, Math.floor(r.y));
    const x1 = Math.min(p.x + p.w, Math.ceil(r.x + r.w));
    const y1 = Math.min(p.y + p.h, Math.ceil(r.y + r.h));
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  /** What a layer contributes: the selection's box (on the page), or everything the layer holds, even beyond the page. */
  function partRect(layer: Layer, sel: Selection | null): Rect | null {
    if (!sel) return layerReach(layer);
    const r = sel.bounds();
    if (!r) return null;
    const doc = d.doc();
    const x = Math.max(0, r.x);
    const y = Math.max(0, r.y);
    const out = { x, y, w: Math.min(doc.width, r.x + r.w) - x, h: Math.min(doc.height, r.y + r.h) - y };
    return out.w < 1 || out.h < 1 ? null : out;
  }

  function start(mode: TransformMode = 'free', only?: Layer): boolean {
    if (s) {
      if (mode !== s.mode) setMode(mode);
      return true;
    }
    const { layers, skipped } = plan(only);
    if (!layers.length) {
      d.say('Elige una capa de píxeles visible y sin bloquear para transformar.');
      return false;
    }
    const sel = d.selection();
    const parts: Part[] = [];
    for (const layer of layers) {
      const r = partRect(layer, sel);
      if (!r) continue;
      const rec = new TileRecorder(layer.surface, layer.id);
      let lifted: Lifted | null;
      if (sel) {
        rec.watch(r);
        lifted = lift(layer.surface, r, sel);
      } else lifted = liftEverything(layer, rec);
      if (!lifted) {
        rec.restore();
        continue;
      }
      const piece = document.createElement('canvas');
      piece.width = lifted.rect.w;
      piece.height = lifted.rect.h;
      piece.getContext('2d')!.putImageData(new ImageData(lifted.pixels.slice(), lifted.rect.w, lifted.rect.h), 0, 0);
      // Without a selection what the layer holds beyond the page travels with the lifted pixels until the session ends.
      const ovBefore = sel ? undefined : layer.overflow;
      if (!sel) delete layer.overflow;
      parts.push({ layer, rec, lifted, piece, whole: !sel, ovBefore });
    }
    if (!parts.length) {
      d.say(layers.length > 1 ? 'No hay nada que transformar en las capas elegidas.' : 'No hay nada que transformar en esta capa.');
      return false;
    }
    // The selection's own box is the frame of the transformation; without one, the union of what the layers hold.
    const box = (sel ? partRect(parts[0]!.layer, sel) : null) ?? parts.reduce<Rect>((u, p) => unionRect(u, p.lifted.rect), parts[0]!.lifted.rect);
    s = { parts, box, sel, cx: box.x + box.w / 2, cy: box.y + box.h / 2, angle: 0, sx: 1, sy: 1, mode: 'free', quad: rectQuad(box), mesh: meshPoints(box, MESH_COLS, MESH_ROWS), pivot: null };
    hover = null;
    d.setFloating({ layers: parts.map((p) => p.layer.id), paint });
    refreshParts(parts, box);
    d.redrawOverlay();
    d.refreshUi();
    d.setActive(true, 'free', hintFor('free'));
    // What the tool does is written in its bar; only what was left out of the transformation is worth a notice.
    const left = skipped + (layers.length - parts.length);
    if (left) d.say(left === 1 ? 'Una capa elegida no se puede transformar y se queda como está.' : `${left} capas elegidas no se pueden transformar y se quedan como están.`);
    if (mode !== 'free') setMode(mode);
    return true;
  }

  /** Redraw the layers of a session over `area`: only the part on the page is drawn by the renderer. */
  function refreshParts(parts: Part[], area: Rect): void {
    for (const p of parts) {
      const r = onPage(p.lifted.rect);
      if (r) d.refreshLayer(p.layer, r);
    }
    d.render(onPage(area));
  }

  /** The lifted pixels of a part through the current matrix or warp, in the page plane the context is set to. */
  function drawPiece(ctx: CanvasRenderingContext2D, part: Part, scale: number): void {
    if (!s) return;
    ctx.imageSmoothingEnabled = true;
    const warp = warpOf();
    const r = part.lifted.rect;
    if (warp) {
      drawWarped(ctx, part.piece, r, warp, scale);
      return;
    }
    const t = matrix(s, s.box);
    ctx.transform(t.a, t.b, t.c, t.d, t.e, t.f);
    ctx.drawImage(part.piece, r.x, r.y);
  }

  /** The lifted pixels of one layer through the current matrix or warp, on the renderer's plane (`m`: page pixels to plane pixels). */
  function paint(layerId: number, ctx: CanvasRenderingContext2D, m: { ox: number; oy: number; s: number }): void {
    const part = s?.parts.find((p) => p.layer.id === layerId);
    if (!s || !part) return;
    ctx.setTransform(m.s, 0, 0, m.s, m.ox, m.oy);
    drawPiece(ctx, part, m.s);
  }

  /** What the content shows beyond the page's edge, faded: the renderer only draws the page. */
  function drawOutside(ctx: CanvasRenderingContext2D): void {
    if (!s) return;
    const warp = warpOf();
    const shape = warp ? warp.bounds() : mapRect(s.box, matrix(s, s.box));
    const page = pageRect();
    if (!sticksOut(shape, page.w, page.h)) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(-1e6, -1e6, 2e6, 2e6);
    ctx.rect(page.x, page.y, page.w, page.h);
    ctx.clip('evenodd');
    ctx.globalAlpha = 0.55;
    for (const part of s.parts) {
      ctx.save();
      drawPiece(ctx, part, d.view.scale);
      ctx.restore();
    }
    ctx.restore();
  }

  /** The matrix or warp changed: the renderer paints the pixels again and the overlay its handles. */
  function changed(): void {
    d.floatChanged();
    d.redrawOverlay();
  }

  /** What each mode does, shown in the transform bar (not as a notice: it would cover the bar). */
  const HINTS: Record<TransformMode, string> = {
    free: 'Arrastra las esquinas para escalar (Mayús: libre). El círculo de arriba rota; el naranja mueve el centro de giro. Intro aplica, Esc cancela.',
    distort: 'Arrastra cada esquina o lado. Dentro mueve todo; el círculo de arriba rota.',
    perspective: 'Arrastra una esquina: la vecina se mueve a la inversa.',
    skew: 'Arrastra el asa de un lado para inclinarlo a lo largo de su borde.',
    mesh: 'Arrastra los puntos de la malla para curvar la imagen; el círculo de arriba rota.',
  };
  const hintFor = (mode: TransformMode): string => HINTS[mode] + (s?.parts.some((p) => p.ovBefore) ? ' Lo de fuera del lienzo se ve atenuado.' : '');

  /** Bilinear position inside the quad (u, v from 0 to 1), used to start the grid from the current corners. */
  const lerpQuad = (q: Quad, u: number, v: number): Pt => {
    const top = { x: q[0].x + (q[1].x - q[0].x) * u, y: q[0].y + (q[1].y - q[0].y) * u };
    const bottom = { x: q[3].x + (q[2].x - q[3].x) * u, y: q[3].y + (q[2].y - q[3].y) * u };
    return { x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v };
  };

  function setMode(mode: TransformMode): void {
    if (!s) {
      void start(mode);
      return;
    }
    if (mode === s.mode) return;
    const r = s.box;
    if (s.mode === 'free') {
      const c = corners();
      s.quad = [c.nw, c.ne, c.se, c.sw];
    } else if (s.mode === 'mesh') {
      const last = (MESH_COLS + 1) * (MESH_ROWS + 1) - 1;
      s.quad = [s.mesh[0]!, s.mesh[MESH_COLS]!, s.mesh[last]!, s.mesh[MESH_ROWS * (MESH_COLS + 1)]!];
    }
    if (mode === 'free') {
      // The box transform cannot hold a free-form shape: go back to the original placement.
      s.cx = r.x + r.w / 2;
      s.cy = r.y + r.h / 2;
      s.angle = 0;
      s.sx = 1;
      s.sy = 1;
      s.pivot = null;
    } else if (mode === 'mesh') {
      s.mesh = [];
      for (let cy = 0; cy <= MESH_ROWS; cy++) for (let cx = 0; cx <= MESH_COLS; cx++) s.mesh.push(lerpQuad(s.quad, cx / MESH_COLS, cy / MESH_ROWS));
    }
    s.mode = mode;
    wg = null;
    gesture = null;
    hover = null;
    d.setActive(true, mode, hintFor(mode));
    changed();
  }

  /** The warp the session describes (null for the box transform, or when the shape collapsed). */
  function warpOf(): Warp | null {
    if (!s || s.mode === 'free') return null;
    const r = s.box;
    return s.mode === 'mesh' ? Warp.mesh(r, MESH_COLS, MESH_ROWS, s.mesh) : Warp.quad(r, s.quad);
  }

  function cancel(): void {
    if (!s) return;
    const { parts, box } = s;
    for (const p of parts) {
      p.rec.restore();
      if (p.ovBefore) p.layer.overflow = p.ovBefore;
    }
    const mode = s.mode;
    s = null;
    d.setFloating(null);
    gesture = null;
    wg = null;
    d.setActive(false, mode);
    refreshParts(parts, box);
    d.redrawOverlay();
    d.refreshUi();
  }

  function fix(): void {
    if (!s) return;
    const { parts, sel, box } = s;
    const doc = d.doc();
    const warp = warpOf();
    if (s.mode !== 'free' && !warp) {
      d.say('La forma se ha colapsado: separa las esquinas antes de aplicar.');
      return;
    }
    const m = matrix(s, box);
    const shape = warp ? warp.bounds() : mapRect(box, m);
    const reach = onPage(shape);
    const out = sticksOut(shape, doc.width, doc.height);
    // Every layer receives the very same transformation; they stay in step and undo as one.
    const steps: Command[] = [];
    const areas: { layer: Layer; area: Rect }[] = [];
    for (const p of parts) {
      // Where the layer's pixels were on the page.
      const from = onPage(p.lifted.rect);
      let written: Rect | null;
      if (p.whole && (p.ovBefore || out)) {
        // What lands beyond the page stays in the layer.
        written = dropEverything(p.layer, p.rec, p.lifted, warp ? { warp } : { m }).area;
      } else {
        if (reach) p.rec.watch(reach); // remember the tiles before the drop changes them
        written = warp ? dropWarp(p.layer.surface, p.lifted, warp) : drop(p.layer.surface, p.lifted, m);
      }
      const area = from ? (written ? unionRect(from, written) : from) : written;
      const patch = area ? p.rec.patch(area) : null;
      if (patch) steps.push(patchCommand(doc, patch, 'Transformar'));
      const ov = overflowCommand(p.layer, p.ovBefore, p.layer.overflow, 'Transformar');
      if (ov) steps.push(ov);
      if (area) areas.push({ layer: p.layer, area });
    }
    const newSel = sel ? (warp ? warpSelection(sel, box, warp) : transformSelection(sel, box, m)) : null;
    const mode = s.mode;
    s = null;
    d.setFloating(null);
    gesture = null;
    wg = null;
    d.setActive(false, mode);
    const step = combineCommands('Transformar', steps);
    if (step) d.history().push(step);
    if (newSel) d.setSelection(newSel, 'Transformar selección');
    for (const a of areas) d.refreshLayer(a.layer, a.area);
    d.render(areas.length ? areas.reduce<Rect>((u, a) => unionRect(u, a.area), areas[0]!.area) : onPage(box));
    d.redrawOverlay();
    d.refreshUi();
  }

  // ---- handles ---------------------------------------------------------------------------------
  function corners(): Record<Exclude<Handle, 'move' | 'rotate'>, Pt> {
    const r = s!.box;
    const m = matrix(s!, r);
    const out = {} as Record<Exclude<Handle, 'move' | 'rotate'>, Pt>;
    for (const [k, [hx, hy]] of Object.entries(HANDLE_POS) as [keyof typeof HANDLE_POS, [number, number]][]) out[k] = apply(m, r.x + (r.w * (hx + 1)) / 2, r.y + (r.h * (hy + 1)) / 2);
    return out;
  }

  /** Where the box rotates about, and the handle that moves that point. */
  const pivotOf = (): Pt => s!.pivot ?? { x: s!.cx, y: s!.cy };

  /** The round grip above the top edge: `from` is the edge's middle, `grip` the handle, a fixed screen distance out. */
  function gripOf(from: Pt, centre: Pt): { from: Pt; grip: Pt } {
    let nx = from.x - centre.x;
    let ny = from.y - centre.y;
    const len = Math.hypot(nx, ny);
    if (len < 1e-6) {
      nx = 0;
      ny = -1;
    } else {
      nx /= len;
      ny /= len;
    }
    const out = 26 / d.view.scale;
    return { from, grip: { x: from.x + nx * out, y: from.y + ny * out } };
  }

  function hit(p: Pt): Handle | null {
    if (!s) return null;
    const tol = 14 / d.view.scale;
    const c = corners();
    for (const k of Object.keys(c) as (keyof typeof c)[]) if (Math.hypot(p.x - c[k].x, p.y - c[k].y) <= tol) return k;
    const pv = pivotOf();
    if (Math.hypot(p.x - pv.x, p.y - pv.y) <= tol) return 'pivot';
    const g = gripOf(c.n, { x: s.cx, y: s.cy }).grip;
    if (Math.hypot(p.x - g.x, p.y - g.y) <= tol) return 'rotgrip';
    const inv = invert(matrix(s, s.box));
    if (inv) {
      const q = apply(inv, p.x, p.y);
      const r = s.box;
      if (q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h) return 'move';
    }
    return Math.hypot(p.x - s.cx, p.y - s.cy) <= (Math.max(s.box.w * s.sx, s.box.h * s.sy) / 2) * 1.6 + 30 / d.view.scale ? 'rotate' : null;
  }

  function dragTo(p: Pt): void {
    if (!s || !gesture) return;
    const g = gesture;
    const r = s.box;
    if (g.handle === 'move') {
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      s.cx = g.orig.cx + dx;
      s.cy = g.orig.cy + dy;
      if (g.orig.pivot) s.pivot = { x: g.orig.pivot.x + dx, y: g.orig.pivot.y + dy };
    } else if (g.handle === 'pivot') {
      s.pivot = { x: p.x, y: p.y };
    } else if (g.handle === 'rotate' || g.handle === 'rotgrip') {
      const o = g.orig.pivot ?? { x: g.orig.cx, y: g.orig.cy };
      const a0 = Math.atan2(g.start.y - o.y, g.start.x - o.x);
      const a1 = Math.atan2(p.y - o.y, p.x - o.x);
      let ang = g.orig.angle + (a1 - a0);
      if (g.shift) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12); // 15° steps
      const turn = ang - g.orig.angle;
      s.angle = ang;
      // The content turns about the pivot, so its middle goes round it (the pivot at the middle leaves it where it is).
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      const rx = g.orig.cx - o.x;
      const ry = g.orig.cy - o.y;
      s.cx = o.x + rx * cos - ry * sin;
      s.cy = o.y + rx * sin + ry * cos;
    } else {
      const [hx, hy] = HANDLE_POS[g.handle];
      // Work in the frame of the content: the opposite handle (the anchor) stays where it is on the page.
      const cos = Math.cos(g.orig.angle);
      const sin = Math.sin(g.orig.angle);
      const pl = { x: (p.x - g.orig.cx) * cos + (p.y - g.orig.cy) * sin, y: -(p.x - g.orig.cx) * sin + (p.y - g.orig.cy) * cos };
      const anchor = { x: hx ? (-hx * r.w * g.orig.sx) / 2 : 0, y: hy ? (-hy * r.h * g.orig.sy) / 2 : 0 };
      let sx = g.orig.sx;
      let sy = g.orig.sy;
      if (hx) sx = (pl.x - anchor.x) / (hx * r.w);
      if (hy) sy = (pl.y - anchor.y) / (hy * r.h);
      // A corner keeps the proportion the content had when the drag began; Shift (or the unlocked "Proporción" button)
      // frees it. Side handles scale one axis only, as before.
      if (hx && hy && keepsProportion(g.shift)) {
        const k = Math.max(Math.abs(sx / g.orig.sx), Math.abs(sy / g.orig.sy));
        sx = Math.sign(sx || 1) * Math.abs(g.orig.sx) * k;
        sy = Math.sign(sy || 1) * Math.abs(g.orig.sy) * k;
      }
      if (Math.abs(sx) < 0.02) sx = 0.02 * (sx < 0 ? -1 : 1);
      if (Math.abs(sy) < 0.02) sy = 0.02 * (sy < 0 ? -1 : 1);
      const anchorPage = { x: g.orig.cx + anchor.x * cos - anchor.y * sin, y: g.orig.cy + anchor.x * sin + anchor.y * cos };
      const next = { x: hx ? (-hx * r.w * sx) / 2 : 0, y: hy ? (-hy * r.h * sy) / 2 : 0 };
      s.sx = sx;
      s.sy = sy;
      s.cx = anchorPage.x - (next.x * cos - next.y * sin);
      s.cy = anchorPage.y - (next.x * sin + next.y * cos);
    }
    changed();
  }

  // ---- warp modes: handles, dragging and drawing --------------------------------------------------
  /** Edges of the quad as pairs of corner indexes: top, right, bottom, left. */
  const EDGES: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0]];

  /** The handles of the current warp mode: id, position and kind. Corners and edge middles are round, mesh nodes square, `r` is the rotation grip. */
  interface WarpHandle {
    id: string;
    p: Pt;
    kind: 'corner' | 'edge' | 'node' | 'grip';
  }
  function warpHandles(): WarpHandle[] {
    if (!s) return [];
    const q = outline();
    const mid = (i: number): Pt => ({ x: (q[EDGES[i]![0]]!.x + q[EDGES[i]![1]]!.x) / 2, y: (q[EDGES[i]![0]]!.y + q[EDGES[i]![1]]!.y) / 2 });
    const out: WarpHandle[] = [];
    if (s.mode === 'mesh') s.mesh.forEach((p, i) => out.push({ id: `m${i}`, p, kind: 'node' }));
    else {
      if (s.mode !== 'skew') s.quad.forEach((p, i) => out.push({ id: `c${i}`, p, kind: 'corner' }));
      // Perspective moves corners in pairs; distort and skew also have a handle in the middle of each edge.
      if (s.mode !== 'perspective') EDGES.forEach((_, i) => out.push({ id: `e${i}`, p: mid(i), kind: 'edge' }));
    }
    out.push({ id: 'r', p: warpGrip().grip, kind: 'grip' });
    return out;
  }

  const centroid = (q: Pt[]): Pt => ({ x: q.reduce((a, c) => a + c.x, 0) / q.length, y: q.reduce((a, c) => a + c.y, 0) / q.length });

  /** The rotation grip of a warp: out from the middle of the top edge. */
  function warpGrip(): { from: Pt; grip: Pt } {
    const q = outline();
    return gripOf({ x: (q[0]!.x + q[1]!.x) / 2, y: (q[0]!.y + q[1]!.y) / 2 }, centroid(q));
  }

  /** The outline of the whole shape (for "drag inside to move"). */
  function outline(): Pt[] {
    if (!s) return [];
    if (s.mode === 'mesh') {
      const last = (MESH_COLS + 1) * (MESH_ROWS + 1) - 1;
      return [s.mesh[0]!, s.mesh[MESH_COLS]!, s.mesh[last]!, s.mesh[MESH_ROWS * (MESH_COLS + 1)]!];
    }
    return s.quad;
  }

  function insideShape(p: Pt): boolean {
    const o = outline();
    let inside = false;
    for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
      const a = o[j]!;
      const b = o[i]!;
      if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x)) inside = !inside;
    }
    return inside;
  }

  function warpHit(p: Pt): string | null {
    const tol = 14 / d.view.scale;
    let best: string | null = null;
    let bestD = tol;
    for (const h of warpHandles()) {
      const dist = Math.hypot(p.x - h.p.x, p.y - h.p.y);
      if (dist <= bestD) {
        best = h.id;
        bestD = dist;
      }
    }
    return best ?? (insideShape(p) ? 'move' : null);
  }

  function warpDrag(p: Pt): void {
    if (!s || !wg) return;
    const dx = p.x - wg.start.x;
    const dy = p.y - wg.start.y;
    const q = wg.quad;
    if (wg.id === 'move') {
      s.quad = q.map((c) => ({ x: c.x + dx, y: c.y + dy })) as Quad;
      s.mesh = wg.mesh.map((c) => ({ x: c.x + dx, y: c.y + dy }));
    } else if (wg.id === 'r') {
      // Rotation grip: everything turns about the middle of the shape.
      const o = centroid(s.mode === 'mesh' ? [wg.mesh[0]!, wg.mesh[MESH_COLS]!, wg.mesh[(MESH_COLS + 1) * (MESH_ROWS + 1) - 1]!, wg.mesh[MESH_ROWS * (MESH_COLS + 1)]!] : q);
      const turn = Math.atan2(p.y - o.y, p.x - o.x) - Math.atan2(wg.start.y - o.y, wg.start.x - o.x);
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      const rot = (c: Pt): Pt => ({ x: o.x + (c.x - o.x) * cos - (c.y - o.y) * sin, y: o.y + (c.x - o.x) * sin + (c.y - o.y) * cos });
      s.quad = q.map(rot) as Quad;
      s.mesh = wg.mesh.map(rot);
    } else if (wg.id.startsWith('m')) {
      const i = Number(wg.id.slice(1));
      s.mesh = wg.mesh.map((c, k) => (k === i ? { x: c.x + dx, y: c.y + dy } : c));
    } else if (wg.id.startsWith('e')) {
      const [a, b] = EDGES[Number(wg.id.slice(1))]!;
      const next = q.map((c) => ({ ...c })) as Quad;
      if (s.mode === 'skew') {
        // Skew: the two corners of the edge slide together along the edge.
        const ux = q[b]!.x - q[a]!.x;
        const uy = q[b]!.y - q[a]!.y;
        const len = Math.hypot(ux, uy) || 1;
        const t = (dx * ux + dy * uy) / len;
        for (const i of [a, b]) next[i] = { x: q[i]!.x + (ux / len) * t, y: q[i]!.y + (uy / len) * t };
      } else {
        // Distort: the whole edge goes where the pointer goes.
        for (const i of [a, b]) next[i] = { x: q[i]!.x + dx, y: q[i]!.y + dy };
      }
      s.quad = next;
    } else {
      const i = Number(wg.id.slice(1));
      const next = q.map((c) => ({ ...c })) as Quad;
      next[i] = { x: q[i]!.x + dx, y: q[i]!.y + dy };
      if (s.mode === 'perspective') {
        // The corner along the same horizontal edge mirrors the horizontal move, the one on the same vertical edge the vertical move.
        const h = [1, 0, 3, 2][i]!;
        const v = [3, 2, 1, 0][i]!;
        next[h] = { x: q[h]!.x - dx, y: q[h]!.y };
        next[v] = { x: next[v]!.x, y: q[v]!.y - dy };
      }
      s.quad = next;
    }
    changed();
  }

  /** Draw an image through a warp onto the overlay by cutting each cell into small triangles. */
  function drawWarped(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, r: Rect, warp: Warp, sc: number): void {
    const n = warp.cells.length === 1 ? 10 : 4;
    const grow = 0.6 / sc; // overlap the triangles a little so no seams show between them
    const tri = (a: Pt, b: Pt, c: Pt, a2: Pt, b2: Pt, c2: Pt): void => {
      const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
      if (Math.abs(det) < 1e-9) return;
      const m = {
        a: ((b2.x - a2.x) * (c.y - a.y) - (c2.x - a2.x) * (b.y - a.y)) / det,
        b: ((b2.y - a2.y) * (c.y - a.y) - (c2.y - a2.y) * (b.y - a.y)) / det,
        c: ((c2.x - a2.x) * (b.x - a.x) - (b2.x - a2.x) * (c.x - a.x)) / det,
        d: ((c2.y - a2.y) * (b.x - a.x) - (b2.y - a2.y) * (c.x - a.x)) / det,
        e: 0,
        f: 0,
      };
      m.e = a2.x - m.a * a.x - m.c * a.y;
      m.f = a2.y - m.b * a.x - m.d * a.y;
      const cx = (a2.x + b2.x + c2.x) / 3;
      const cy = (a2.y + b2.y + c2.y) / 3;
      const push = (q: Pt): Pt => {
        const len = Math.hypot(q.x - cx, q.y - cy) || 1;
        return { x: q.x + ((q.x - cx) / len) * grow, y: q.y + ((q.y - cy) / len) * grow };
      };
      const p0 = push(a2);
      const p1 = push(b2);
      const p2 = push(c2);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.closePath();
      ctx.clip();
      ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
      ctx.drawImage(img, 0, 0); // the source triangle is given in the image's own pixels
      ctx.restore();
    };
    for (const cell of warp.cells) {
      for (let iy = 0; iy < n; iy++) {
        for (let ix = 0; ix < n; ix++) {
          const at = (i: number, j: number): [Pt, Pt] => {
            const src = { x: cell.src.x + (cell.src.w * i) / n, y: cell.src.y + (cell.src.h * j) / n };
            return [{ x: src.x - r.x, y: src.y - r.y }, applyH(cell.fwd, src.x, src.y)];
          };
          const [s00, d00] = at(ix, iy);
          const [s10, d10] = at(ix + 1, iy);
          const [s01, d01] = at(ix, iy + 1);
          const [s11, d11] = at(ix + 1, iy + 1);
          // Cells of the grid that fall outside this image (another layer's pixels) have nothing to draw.
          if (Math.max(s00.x, s10.x, s01.x, s11.x) < 0 || Math.min(s00.x, s10.x, s01.x, s11.x) > img.width) continue;
          if (Math.max(s00.y, s10.y, s01.y, s11.y) < 0 || Math.min(s00.y, s10.y, s01.y, s11.y) > img.height) continue;
          tri(s00, s10, s01, d00, d10, d01);
          tri(s11, s01, s10, d11, d01, d10);
        }
      }
    }
  }

  function drawWarpOverlay(ctx: CanvasRenderingContext2D): void {
    if (!s) return;
    const sc = d.view.scale;
    ctx.save();
    ctx.beginPath();
    if (s.mode === 'mesh') {
      const cols = MESH_COLS + 1;
      for (let cy = 0; cy <= MESH_ROWS; cy++) for (let cx = 0; cx <= MESH_COLS; cx++) {
        const p = s.mesh[cy * cols + cx]!;
        if (cx) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      }
      for (let cx = 0; cx <= MESH_COLS; cx++) for (let cy = 0; cy <= MESH_ROWS; cy++) {
        const p = s.mesh[cy * cols + cx]!;
        if (cy) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      }
    } else {
      s.quad.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
    }
    strokeBlue(ctx, sc);
    const grip = warpGrip();
    ctx.beginPath();
    ctx.moveTo(grip.from.x, grip.from.y);
    ctx.lineTo(grip.grip.x, grip.grip.y);
    strokeBlue(ctx, sc);
    for (const h of warpHandles()) {
      const on = h.id === hover || h.id === wg?.id;
      if (h.kind === 'grip') ringHandle(ctx, h.p, sc, BLUE, on);
      else if (h.kind === 'node') squareHandle(ctx, h.p, sc, on);
      else dotHandle(ctx, h.p, sc, on);
    }
    ctx.restore();
  }

  /** The thin blue line CSP draws between handles, with a pale halo so it reads on dark and light drawings. */
  function strokeBlue(ctx: CanvasRenderingContext2D, sc: number): void {
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3 / sc;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.stroke();
    ctx.lineWidth = 1.25 / sc;
    ctx.strokeStyle = BLUE;
    ctx.stroke();
  }

  /** Filled round handle (corners and edge middles). */
  function dotHandle(ctx: CanvasRenderingContext2D, p: Pt, sc: number, on: boolean): void {
    ctx.beginPath();
    ctx.arc(p.x, p.y, (on ? 6.5 : 5) / sc, 0, Math.PI * 2);
    ctx.fillStyle = BLUE;
    ctx.fill();
    ctx.lineWidth = 1.5 / sc;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }

  /** Hollow round handle (the rotation grip, or the pivot in orange). */
  function ringHandle(ctx: CanvasRenderingContext2D, p: Pt, sc: number, color: string, on: boolean): void {
    ctx.beginPath();
    ctx.arc(p.x, p.y, (on ? 7.5 : 6) / sc, 0, Math.PI * 2);
    ctx.fillStyle = on ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.55)';
    ctx.fill();
    ctx.lineWidth = 2 / sc;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  /** Hollow square node of the mesh; filled while hovered or dragged. */
  function squareHandle(ctx: CanvasRenderingContext2D, p: Pt, sc: number, on: boolean): void {
    const hs = 4.5 / sc;
    ctx.beginPath();
    ctx.rect(p.x - hs, p.y - hs, hs * 2, hs * 2);
    ctx.fillStyle = on ? BLUE : '#fff';
    ctx.fill();
    ctx.lineWidth = 1.5 / sc;
    ctx.strokeStyle = BLUE;
    ctx.stroke();
  }

  /** The system cursor that matches what `id` (a handle of the current session) does when dragged. */
  function cursorOfHandle(id: string | null): string | null {
    if (!s || !id) return null;
    if (id === 'move') return 'move';
    if (id === 'rotate' || id === 'rotgrip' || id === 'r') return ROTATE_CURSOR;
    if (s.mode === 'free') {
      if (id === 'pivot') return 'crosshair';
      const c = corners();
      const k = id as keyof typeof c;
      return c[k] ? resizeCursor(Math.atan2(c[k].y - s.cy, c[k].x - s.cx)) : null;
    }
    if (id.startsWith('e')) {
      if (s.mode !== 'skew') return 'move';
      const [a, b] = EDGES[Number(id.slice(1))]!;
      return resizeCursor(Math.atan2(s.quad[b]!.y - s.quad[a]!.y, s.quad[b]!.x - s.quad[a]!.x));
    }
    return 'crosshair'; // corners and mesh nodes go anywhere
  }

  return {
    get active() {
      return s !== null;
    },
    get mode(): TransformMode {
      return s?.mode ?? 'free';
    },
    get proportionLocked(): boolean {
      return lockProportion;
    },
    set proportionLocked(on: boolean) {
      lockProportion = on;
    },
    start,
    setMode,
    fix,
    cancel,
    canTransform,
    down(p: Pt, shift = false): boolean {
      if (!s) return false;
      if (s.mode !== 'free') {
        const id = warpHit(p);
        if (!id) {
          fix(); // a click outside applies the transformation
          return false;
        }
        wg = { id, start: p, quad: s.quad.map((c) => ({ ...c })) as Quad, mesh: s.mesh.map((c) => ({ ...c })) };
        return true;
      }
      const handle = hit(p);
      if (!handle) {
        fix(); // a click outside applies the transformation, as in most painting programs
        return false;
      }
      gesture = { handle, start: p, orig: { cx: s.cx, cy: s.cy, angle: s.angle, sx: s.sx, sy: s.sy, pivot: s.pivot ? { ...s.pivot } : null }, shift };
      hover = handle;
      return true;
    },
    cursorAt(p: Pt): string | null {
      if (!s) return null;
      const id = gesture ? gesture.handle : wg ? wg.id : s.mode === 'free' ? hit(p) : warpHit(p);
      if (id !== hover) {
        hover = id;
        d.redrawOverlay();
      }
      return cursorOfHandle(id);
    },
    move(p: Pt, shift = false): void {
      if (wg) {
        warpDrag(p);
        return;
      }
      if (!gesture) return;
      gesture.shift = shift;
      dragTo(p);
    },
    up(): void {
      gesture = null;
      wg = null;
    },
    drawOverlay(ctx: CanvasRenderingContext2D): void {
      if (!s) return;
      drawOutside(ctx);
      if (s.mode !== 'free') {
        drawWarpOverlay(ctx);
        return;
      }
      const c = corners();
      const sc = d.view.scale;
      const on = (id: string): boolean => id === hover || id === gesture?.handle;
      ctx.save();
      ctx.beginPath();
      for (const k of ['nw', 'ne', 'se', 'sw'] as const) (k === 'nw' ? ctx.moveTo : ctx.lineTo).call(ctx, c[k].x, c[k].y);
      ctx.closePath();
      strokeBlue(ctx, sc);
      const grip = gripOf(c.n, { x: s.cx, y: s.cy });
      ctx.beginPath();
      ctx.moveTo(grip.from.x, grip.from.y);
      ctx.lineTo(grip.grip.x, grip.grip.y);
      strokeBlue(ctx, sc);
      for (const k of Object.keys(c) as (keyof typeof c)[]) dotHandle(ctx, c[k], sc, on(k));
      ringHandle(ctx, grip.grip, sc, BLUE, on('rotgrip'));
      // The rotation centre: a cross in an orange ring, which can be dragged elsewhere.
      const pv = pivotOf();
      const arm = 9 / sc;
      ctx.beginPath();
      ctx.moveTo(pv.x - arm, pv.y);
      ctx.lineTo(pv.x + arm, pv.y);
      ctx.moveTo(pv.x, pv.y - arm);
      ctx.lineTo(pv.x, pv.y + arm);
      ctx.lineWidth = 1.25 / sc;
      ctx.strokeStyle = ORANGE;
      ctx.stroke();
      ringHandle(ctx, pv, sc, ORANGE, on('pivot'));
      ctx.restore();
    },
    quick(kind): boolean {
      if (s) return false;
      const { layers, skipped } = plan();
      if (!layers.length) {
        d.say('Elige una capa de píxeles visible y sin bloquear para transformar.');
        return false;
      }
      const sel = d.selection();
      const rects = layers.map((layer) => ({ layer, rect: partRect(layer, sel) })).filter((x): x is { layer: Layer; rect: Rect } => !!x.rect);
      if (!rects.length) return false;
      // One centre for all layers, so they keep their places relative to each other.
      const frame = rects.reduce<Rect>((u, x) => unionRect(u, x.rect), rects[0]!.rect);
      const cx = frame.x + frame.w / 2;
      const cy = frame.y + frame.h / 2;
      const m =
        kind === 'flipx'
          ? about({ a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 }, cx, cy)
          : kind === 'flipy'
            ? about({ a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 }, cx, cy)
            : about(rotation(kind === 'rot90' ? Math.PI / 2 : -Math.PI / 2), cx, cy);
      const label = kind === 'flipx' ? 'Voltear horizontalmente' : kind === 'flipy' ? 'Voltear verticalmente' : 'Girar 90°';
      const steps: Command[] = [];
      const areas: { layer: Layer; area: Rect }[] = [];
      const page = pageRect();
      for (const { layer, rect } of rects) {
        // A layer that holds something beyond the page, or whose result would stick out of it, keeps that part.
        if (!sel && (layer.overflow || sticksOut(mapRect(rect, m), page.w, page.h))) {
          const rec = new TileRecorder(layer.surface, layer.id);
          const lifted = liftEverything(layer, rec);
          if (!lifted) {
            rec.restore();
            continue;
          }
          const before = layer.overflow;
          const { area: written } = dropEverything(layer, rec, lifted, { m });
          const from = onPage(lifted.rect);
          const area = from ? (written ? unionRect(from, written) : from) : written;
          const patch = area ? rec.patch(area) : null;
          if (patch) steps.push(patchCommand(d.doc(), patch, label));
          const ov = overflowCommand(layer, before, layer.overflow, label);
          if (ov) steps.push(ov);
          if (area) areas.push({ layer, area });
          continue;
        }
        const { patch, rect: area } = transformLayerPixels(layer.surface, layer.id, rect, sel, m);
        if (!patch || !area) continue;
        steps.push(patchCommand(d.doc(), patch, label));
        areas.push({ layer, area });
      }
      const step = combineCommands(label, steps);
      if (!step) return false;
      d.history().push(step);
      if (sel) d.setSelection(transformSelection(sel, frame, m), label);
      for (const a of areas) d.refreshLayer(a.layer, a.area);
      d.render(areas.length ? areas.reduce<Rect>((u, a) => unionRect(u, a.area), areas[0]!.area) : null);
      d.refreshUi();
      if (skipped) d.say(skipped === 1 ? 'Una capa elegida no se puede transformar y se queda como está.' : `${skipped} capas elegidas no se pueden transformar y se quedan como están.`);
      return true;
    },
  };
}

