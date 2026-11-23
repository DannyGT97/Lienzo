import { adjustLut, applyAdjustLut, type AdjustLut } from './adjust';
import { ALPHA_ADD_MODES, blendColor, type RGB } from './blend';
import type { Document, Layer } from './document';
import { layerTree, type TreeNode } from './layer-tree';
import type { Tick } from './cooperate';
import { TILE, tileRange, type Rect } from './tiles';

const T2 = TILE * TILE;
/** Whether a 32-bit view of RGBA pixels has the alpha in its top byte (little-endian machines: every browser we run on). */
const LITTLE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/**
 * Composite `src` over `dst` for one pixel (straight alpha, 0..1 floats). Writes [r,g,b,a] into `out`.
 *
 * Normal follows W3C compositing. Every other mode weights the blended colour the way the reference
 * editor does: first the backdrop and B(Cb,Cs) are mixed by as/ar, then that result and the source are
 * mixed by ab/ar. This equals W3C wherever the backdrop is opaque and differs only over a partly
 * transparent backdrop. A few modes (see ALPHA_ADD_MODES) add the alphas instead of taking their union.
 */
export function compositePixel(
  layer: Pick<Layer, 'blend'>,
  dst: RGB,
  ab: number,
  src: RGB,
  as: number,
  out: number[],
): void {
  const ar = as + ab * (1 - as);
  if (ar <= 0) {
    out[0] = out[1] = out[2] = out[3] = 0;
    return;
  }
  const mode = layer.blend;
  if (ab < 0.001) {
    out[0] = src[0];
    out[1] = src[1];
    out[2] = src[2];
    out[3] = as;
    return;
  }
  if (mode === 'normal') {
    for (let k = 0; k < 3; k++) out[k] = ((1 - as) * ab * dst[k]! + as * src[k]!) / ar;
    out[3] = ar;
    return;
  }
  const wb = ab / ar;
  if (mode === 'glowDodge') {
    const b = blendColor(mode, dst, src, as);
    for (let k = 0; k < 3; k++) out[k] = src[k]! * (1 - wb) + b[k]! * wb;
    out[3] = Math.min(as + ab, 1);
    return;
  }
  const b = blendColor(mode, dst, src, as, false);
  const wf = as / ar;
  for (let k = 0; k < 3; k++) {
    let t = dst[k]! * (1 - wf) + b[k]! * wf;
    if (t > 1) t = 1;
    else if (t < 0) t = 0;
    out[k] = src[k]! * (1 - wb) + t * wb;
  }
  out[3] = ALPHA_ADD_MODES.has(mode) ? Math.min(as + ab, 1) : ar;
}

/**
 * One layer prepared for the pixel currently being evaluated: how to read its colour and mask there, and (for a
 * folder) its members. The readers look at a cursor the caller moves from pixel to pixel.
 */
interface PNode {
  layer: Layer;
  children: PNode[];
  /** Fills [r,g,b,a] (straight, 0..1). Not used by folders. */
  read(o: number[]): void;
  /** Mask value 0..1; absent when the layer has no active mask. */
  maskAt?: () => number;
  /** Adjustment layers: the correction applied to what is composited below instead of a colour of their own. */
  adjust?: AdjustLut;
}

interface Scratch {
  px: number[];
  tmp: number[];
  out: number[];
  dst: [number, number, number];
  src: [number, number, number];
}

const scratchAt = (st: Scratch[], depth: number): Scratch =>
  (st[depth] ??= { px: [0, 0, 0, 0], tmp: [0, 0, 0, 0], out: [0, 0, 0, 0], dst: [0, 0, 0], src: [0, 0, 0] });

/**
 * Composite the nodes (bottom to top) onto `acc` ([r,g,b,a], straight 0..1), in place. Folders are composited as
 * a separate image first unless they are "pass through".
 *
 * Clipping: a clipped layer is limited by the alpha the nearest unclipped layer below it in the same folder shows
 * (its pixels × its mask). Consecutive clipped layers therefore all share that one base, whatever clipped layers lie
 * between them; to limit a layer to the shape of another clipped layer, put both in a clipped folder. A hidden base
 * shows nothing, so its clipped layers disappear with it. Adjustment layers have no pixels and never become a base.
 */
function evalNodes(nodes: readonly PNode[], acc: number[], st: Scratch[], depth: number): void {
  const s = scratchAt(st, depth);
  let baseAlpha = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    const layer = n.layer;
    const nextClips = !!nodes[i + 1]?.layer.clip;
    const src = s.src;
    if (n.adjust) {
      // Changes the colour of what is below by opacity × mask (× the base layer's alpha when clipped); alpha stays as it is.
      // It has no pixels, so it does not become the base layer of the clipped layers above it.
      const k = layer.visible ? layer.opacity * (layer.clip ? baseAlpha : 1) * (n.maskAt ? n.maskAt() : 1) : 0;
      if (k > 0 && acc[3]! > 0) {
        const t = s.tmp;
        t[0] = acc[0]!;
        t[1] = acc[1]!;
        t[2] = acc[2]!;
        applyAdjustLut(n.adjust, t);
        for (let c = 0; c < 3; c++) acc[c] = acc[c]! + (t[c]! - acc[c]!) * k;
      }
      continue;
    }
    // Nothing under a clipped layer shows it: its base has no paint here, is hidden, or was left out of this render.
    if (layer.clip && baseAlpha <= 0) continue;
    let la: number;
    if (layer.kind === 'folder') {
      // A pass-through folder with nothing special about it hands its members the backdrop directly; one with a
      // mask, partial opacity or a clipping role is composited as a separate image like any other folder.
      if (layer.through && !layer.clip && !nextClips && !n.maskAt && layer.opacity >= 1) {
        if (layer.visible) evalNodes(n.children, acc, st, depth + 1);
        baseAlpha = 0;
        continue;
      }
      if (!layer.visible) {
        if (!layer.clip) baseAlpha = 0; // a hidden base takes its clipped layers with it
        continue;
      }
      const t = s.tmp;
      t[0] = t[1] = t[2] = t[3] = 0;
      evalNodes(n.children, t, st, depth + 1);
      src[0] = t[0]!;
      src[1] = t[1]!;
      src[2] = t[2]!;
      la = t[3]!;
    } else {
      const px = s.px;
      n.read(px);
      src[0] = px[0]!;
      src[1] = px[1]!;
      src[2] = px[2]!;
      la = px[3]!;
    }
    const own = layer.visible ? la : 0;
    const clipMask = layer.clip ? baseAlpha : 1;
    const maskv = n.maskAt ? n.maskAt() : 1;
    // The alpha clipped layers are limited to is what the base layer actually shows (nothing at all when it is hidden).
    if (!layer.clip) baseAlpha = layer.visible ? la * maskv : 0;
    const as = own * layer.opacity * clipMask * maskv;
    if (as <= 0) continue;
    s.dst[0] = acc[0]!;
    s.dst[1] = acc[1]!;
    s.dst[2] = acc[2]!;
    compositePixel(layer, s.dst, acc[3]!, src, as, s.out);
    acc[0] = s.out[0]!;
    acc[1] = s.out[1]!;
    acc[2] = s.out[2]!;
    acc[3] = s.out[3]!;
  }
}

/** Layers left out when producing output: drafts and references are only for working. */
const shownInOutput = (l: Layer): boolean => l.role === 'normal';

export interface CompositeOptions {
  /** Producing output (export, flatten for printing): leave out draft and reference layers. */
  output?: boolean;
  /** Look only at the reference layers (what the fill and auto-select tools use when there are any). */
  only?: 'reference';
  /** For a small picture of the page: look at one pixel in every `sample` in each direction (a quarter of the work at 2, a ninth at 3). */
  sample?: number;
}

const noRead = (o: number[]): void => {
  o[3] = 0;
};

/** The value of a layer's mask at a page pixel (1 when it has none or it is disabled). */
export function layerMaskAt(layer: Layer, x: number, y: number): number {
  const m = layer.mask;
  if (!m || !m.enabled) return 1;
  const t = m.surface.get(Math.floor(x / TILE), Math.floor(y / TILE));
  return t ? t[((y % TILE) * TILE + (x % TILE)) * 4 + 3]! / 255 : m.base / 255;
}

/** The look-up tables of an adjustment layer; one that cannot be evaluated changes nothing. */
const identityLut: AdjustLut = { mode: 'channel', table: Uint8Array.from({ length: 768 }, (_, i) => i % 256) };
const adjustOf = (layer: Layer): AdjustLut => (layer.adjust && adjustLut(layer.adjust)) || identityLut;

const paperReader = (layer: Layer): ((o: number[]) => void) => {
  const c = layer.paperColor ?? [255, 255, 255];
  return (o) => {
    o[0] = c[0] / 255;
    o[1] = c[1] / 255;
    o[2] = c[2] / 255;
    o[3] = 1;
  };
};

/**
 * Plan for one tile of the page: every layer reads its own tile. `any` says whether anything can show there; `varies`
 * whether the result can differ from one pixel of the tile to another (only a layer or mask tile with pixels makes it
 * so: paper, adjustments and layers or masks without a tile here give the same value everywhere). The tiles that
 * make it vary are added to `srcs`: the result at a pixel is a function of just those pixels.
 */
function planTile(nodes: readonly TreeNode[], tx: number, ty: number, cur: { li: number }, opts: CompositeOptions, srcs: Uint8ClampedArray[], inRef = false): { plan: PNode[]; any: boolean; varies: boolean } {
  const plan: PNode[] = [];
  let any = false;
  let varies = false;
  // The base of the clipped layers being walked was left out of this render, so they have nothing to be limited by.
  let baseLeftOut = false;
  for (const tn of nodes) {
    const layer = tn.layer;
    const refHere = inRef || layer.role === 'reference';
    if ((opts.output && !shownInOutput(layer)) || (opts.only === 'reference' && !refHere && layer.kind !== 'folder')) {
      if (!layer.clip && layer.kind !== 'adjust') baseLeftOut = true;
      continue;
    }
    if (layer.clip && baseLeftOut) continue;
    if (!layer.clip && layer.kind !== 'adjust') baseLeftOut = false;
    const m = layer.mask && layer.mask.enabled ? layer.mask : undefined;
    const mtile = m ? m.surface.get(tx, ty) : undefined;
    if (mtile) {
      varies = true;
      srcs.push(mtile);
    }
    const maskAt = m ? () => (mtile ? mtile[cur.li + 3]! / 255 : m.base / 255) : undefined;
    if (layer.kind === 'folder') {
      const sub = planTile(tn.children, tx, ty, cur, opts, srcs, refHere);
      if (opts.only === 'reference' && !refHere && sub.plan.length === 0) {
        if (!layer.clip) baseLeftOut = true;
        continue;
      }
      if (sub.any) any = true;
      if (sub.varies) varies = true;
      plan.push({ layer, children: sub.plan, read: noRead, maskAt });
    } else if (layer.kind === 'paper') {
      any = true;
      plan.push({ layer, children: [], read: paperReader(layer), maskAt });
    } else if (layer.kind === 'adjust') {
      plan.push({ layer, children: [], read: noRead, maskAt, adjust: adjustOf(layer) });
    } else {
      const tile = layer.surface.get(tx, ty);
      if (tile) {
        any = varies = true;
        srcs.push(tile);
      } else if (!layer.clip && !nodes[nodes.indexOf(tn) + 1]?.layer.clip) {
        // A layer with nothing on this tile and no layer clipped to it adds nothing at any pixel here: it is left out of the plan.
        continue;
      }
      plan.push({
        layer,
        children: [],
        read: tile
          ? (o) => {
              const li = cur.li;
              o[0] = tile[li]! / 255;
              o[1] = tile[li + 1]! / 255;
              o[2] = tile[li + 2]! / 255;
              o[3] = tile[li + 3]! / 255;
            }
          : noRead,
        maskAt,
      });
    }
  }
  return { plan, any, varies };
}

/**
 * Flatten the part of the document inside `region` (clamped to the canvas) to
 * dense straight-alpha RGBA of exactly that size. Tiles no layer has pixels on
 * are skipped, so a mostly blank huge page flattens quickly.
 */
export function flattenRegion(doc: Document, region: Rect, opts: CompositeOptions = {}): Uint8ClampedArray {
  const x0 = Math.max(0, region.x);
  const y0 = Math.max(0, region.y);
  const x1 = Math.min(doc.width, region.x + region.w);
  const y1 = Math.min(doc.height, region.y + region.h);
  const out = new Uint8ClampedArray(Math.max(0, x1 - x0) * Math.max(0, y1 - y0) * 4);
  if (x1 <= x0 || y1 <= y0) return out;
  const rw = x1 - x0;

  const tree = layerTree(doc.layers);
  const cur = { li: 0 };
  const acc = [0, 0, 0, 0];
  const st: Scratch[] = [];
  const grid = { tilesX: Math.ceil(doc.width / TILE), tilesY: Math.ceil(doc.height / TILE) };
  const { tx0, ty0, tx1, ty1 } = tileRange(grid, { x: x0, y: y0, w: rw, h: y1 - y0 });
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const srcs: Uint8ClampedArray[] = [];
      const { plan, any, varies } = planTile(tree, tx, ty, cur, opts, srcs);
      if (!any) continue;
      const ya = Math.max(y0, ty * TILE);
      const yb = Math.min(y1, (ty + 1) * TILE);
      const xa = Math.max(x0, tx * TILE);
      const xb = Math.min(x1, (tx + 1) * TILE);
      if (!varies) {
        // Every pixel of this tile composes to the same value (a blank page under the paper, say): work it out once.
        cur.li = 0;
        acc[0] = acc[1] = acc[2] = acc[3] = 0;
        evalNodes(plan, acc, st, 0);
        const v0 = acc[0]! * 255;
        const v1 = acc[1]! * 255;
        const v2 = acc[2]! * 255;
        const v3 = acc[3]! * 255;
        for (let y = ya; y < yb; y++) {
          for (let o = ((y - y0) * rw + (xa - x0)) * 4, end = o + (xb - xa) * 4; o < end; o += 4) {
            out[o] = v0;
            out[o + 1] = v1;
            out[o + 2] = v2;
            out[o + 3] = v3;
          }
        }
        continue;
      }
      // The result at a pixel depends only on the pixels the planned tiles hold there, so a run of equal pixels
      // (flat colour, which is most of a drawing) is composed once. Tiles that are not 4-byte aligned skip this.
      const views = srcs.map((s) => ((s.byteOffset & 3) === 0 ? new Uint32Array(s.buffer, s.byteOffset, T2) : null));
      const memo = LITTLE && views.every((v) => v !== null);
      const key = new Uint32Array(views.length);
      // Per row, the views that have any alpha in it: a view with none there contributes nothing whatever its colour, so a row where
      // no view has any is one value and the others are compared on the views that matter only.
      const live = new Int32Array(views.length);
      let have = false;
      let r0 = 0;
      let r1 = 0;
      let r2 = 0;
      let r3 = 0;
      const evalHere = (at: number): void => {
        cur.li = at * 4;
        acc[0] = acc[1] = acc[2] = acc[3] = 0;
        evalNodes(plan, acc, st, 0);
        r0 = acc[0]! * 255;
        r1 = acc[1]! * 255;
        r2 = acc[2]! * 255;
        r3 = acc[3]! * 255;
      };
      for (let y = ya; y < yb; y++) {
        const rowAt = (y - ty * TILE) * TILE;
        let n = 0;
        if (memo) {
          const x0 = xa - tx * TILE;
          const x1 = xb - tx * TILE;
          for (let k = 0; k < views.length; k++) {
            const v = views[k]!;
            let any = false;
            for (let i = rowAt + x0; i < rowAt + x1; i++) {
              if (v[i]! >>> 24 !== 0) {
                any = true;
                break;
              }
            }
            if (any) live[n++] = k;
          }
        }
        if (memo && n === 0) {
          // Nothing from any layer on this row: it composes to the same value everywhere (worked out at its first pixel).
          evalHere(rowAt + (xa - tx * TILE));
          for (let o = ((y - y0) * rw + (xa - x0)) * 4, end = o + (xb - xa) * 4; o < end; o += 4) {
            out[o] = r0;
            out[o + 1] = r1;
            out[o + 2] = r2;
            out[o + 3] = r3;
          }
          have = false;
          continue;
        }
        for (let x = xa; x < xb; x++) {
          const at = rowAt + (x - tx * TILE);
          if (memo) {
            let same = have;
            for (let j = 0; j < n; j++) {
              const k = live[j]!;
              const v = views[k]![at]!;
              if (v !== key[k]) {
                key[k] = v;
                same = false;
              }
            }
            if (!same) {
              evalHere(at);
              have = true;
            }
          } else {
            evalHere(at);
          }
          const o = ((y - y0) * rw + (x - x0)) * 4;
          out[o] = r0;
          out[o + 1] = r1;
          out[o + 2] = r2;
          out[o + 3] = r3;
        }
        have = false; // the live views change from row to row: the keys are not comparable across rows
      }
    }
  }
  return out;
}

/** Opaque pixels of one colour (a paper layer's content), filled by the engine instead of a loop of a few million steps. */
export function paperPixels(width: number, height: number, c: readonly number[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  if (LITTLE) new Uint32Array(out.buffer).fill(((255 << 24) | (c[2]! << 16) | (c[1]! << 8) | c[0]!) >>> 0);
  else
    for (let i = 0; i < out.length; i += 4) {
      out[i] = c[0]!;
      out[i + 1] = c[1]!;
      out[i + 2] = c[2]!;
      out[i + 3] = 255;
    }
  return out;
}

/** Rows merged between two turns: a whole tile of a page of many layers took 150 ms on a tablet, which a window feels as a stutter. */
const PIECE_ROWS = 48;

/**
 * `flattenRegion` in pieces (a strip of one tile), with a turn given to the window between them (see cooperate.ts): the same pixels,
 * for the places where merging a whole page in one go made it stand still (saving as an image, a PSD or an OpenRaster file).
 */
export async function flattenRegionAsync(doc: Document, region: Rect, opts: CompositeOptions, tick: Tick): Promise<Uint8ClampedArray> {
  const x0 = Math.max(0, region.x);
  const y0 = Math.max(0, region.y);
  const x1 = Math.min(doc.width, region.x + region.w);
  const y1 = Math.min(doc.height, region.y + region.h);
  const rw = Math.max(0, x1 - x0);
  const out = new Uint8ClampedArray(rw * Math.max(0, y1 - y0) * 4);
  if (x1 <= x0 || y1 <= y0) return out;
  for (let y = y0; y < y1; ) {
    const h = Math.min(y1, (Math.floor(y / TILE) + 1) * TILE, y + PIECE_ROWS) - y;
    for (let x = x0; x < x1; x = (Math.floor(x / TILE) + 1) * TILE) {
      const w = Math.min(x1, (Math.floor(x / TILE) + 1) * TILE) - x;
      const piece = flattenRegion(doc, { x, y, w, h }, opts);
      for (let r = 0; r < h; r++) out.set(piece.subarray(r * w * 4, (r + 1) * w * 4), ((y - y0 + r) * rw + (x - x0)) * 4);
      await tick();
    }
    y += h;
  }
  return out;
}

/** Flatten the whole document. Only sensible for documents that fit in memory as one buffer. */
export function flatten(doc: Document, opts: CompositeOptions = {}): Uint8ClampedArray {
  return flattenRegion(doc, { x: 0, y: 0, w: doc.width, h: doc.height }, opts);
}

/** Colour of one page pixel after compositing every layer: [r, g, b, a] in 0..255. */
export function sampleDocument(doc: Document, x: number, y: number, opts: CompositeOptions = {}): [number, number, number, number] {
  const build = (nodes: readonly TreeNode[]): PNode[] => {
    const plan: PNode[] = [];
    for (const tn of nodes) {
      const layer = tn.layer;
      if (opts.output && !shownInOutput(layer)) continue;
      const maskAt = layer.mask && layer.mask.enabled ? () => layerMaskAt(layer, x, y) : undefined;
      if (layer.kind === 'folder') plan.push({ layer, children: build(tn.children), read: noRead, maskAt });
      else if (layer.kind === 'paper') plan.push({ layer, children: [], read: paperReader(layer), maskAt });
      else if (layer.kind === 'adjust') plan.push({ layer, children: [], read: noRead, maskAt, adjust: adjustOf(layer) });
      else {
        plan.push({
          layer,
          children: [],
          read: (o) => {
            const p = layer.surface.pixel(x, y);
            o[0] = p[0] / 255;
            o[1] = p[1] / 255;
            o[2] = p[2] / 255;
            o[3] = p[3] / 255;
          },
          maskAt,
        });
      }
    }
    return plan;
  };
  const acc = [0, 0, 0, 0];
  evalNodes(build(layerTree(doc.layers)), acc, [], 0);
  return [acc[0]! * 255, acc[1]! * 255, acc[2]! * 255, acc[3]! * 255];
}

type Reduced = { r: Float32Array; g: Float32Array; b: Float32Array; a: Float32Array };

/** The reduced pictures made so far, per surface and size, with the revision of the surface they were made from. */
const reducedCache = new WeakMap<object, { revision: number; docW: number; docH: number; bySize: Map<string, Reduced> }>();

/**
 * Average colour and coverage of a layer over each cell of a w×h grid (every painted pixel counts). The result is kept while the
 * layer's pixels do not change: the layer thumbnails and the navigator ask for it after every edit, for every layer.
 */
function downsampleLayer(layer: Layer, docW: number, docH: number, w: number, h: number, step = 1): Reduced {
  const surface = layer.surface;
  let entry = reducedCache.get(surface);
  if (!entry || entry.revision !== surface.revision || entry.docW !== docW || entry.docH !== docH) {
    entry = { revision: surface.revision, docW, docH, bySize: new Map() };
    reducedCache.set(surface, entry);
  }
  const key = `${w}x${h}x${step}`;
  let r = entry.bySize.get(key);
  if (!r) {
    r = computeReduced(layer, docW, docH, w, h, step);
    entry.bySize.set(key, r);
  }
  return r;
}

function computeReduced(layer: Layer, docW: number, docH: number, w: number, h: number, step = 1): Reduced {
  const n = w * h;
  const sum = { r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), a: new Float32Array(n) };
  const kx = w / docW;
  const ky = h / docH;
  const cols = new Int32Array(TILE);
  for (const [tx, ty, tile] of layer.surface.entries()) {
    // Which cell each column of the tile falls in: the same for every row.
    const xEnd = Math.min(TILE, docW - tx * TILE);
    for (let x = 0; x < xEnd; x++) cols[x] = Math.min(w - 1, Math.floor((tx * TILE + x) * kx));
    for (let y = 0; y < TILE; y += step) {
      const py = ty * TILE + y;
      if (py >= docH) break;
      const cy = Math.min(h - 1, Math.floor(py * ky)) * w;
      for (let x = 0, o = y * TILE * 4; x < xEnd; x += step, o += 4 * step) {
        const al = tile[o + 3]!;
        if (al === 0) continue;
        const i = cy + cols[x]!;
        const f = al / 255;
        sum.r[i]! += tile[o]! * f;
        sum.g[i]! += tile[o + 1]! * f;
        sum.b[i]! += tile[o + 2]! * f;
        sum.a[i]! += f;
      }
    }
  }
  const area = ((docW / w) * (docH / h)) / (step * step); // fewer pixels were looked at, so a full cell holds fewer
  for (let i = 0; i < n; i++) {
    const a = sum.a[i]!;
    if (a > 0) {
      sum.r[i] = sum.r[i]! / a;
      sum.g[i] = sum.g[i]! / a;
      sum.b[i] = sum.b[i]! / a;
    }
    sum.a[i] = Math.min(1, a / area);
  }
  return sum;
}

/** Small preview of one layer alone (straight RGBA, w×h); a paper layer is its flat colour. */
export function layerThumbnail(layer: Layer, docW: number, docH: number, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  if (layer.kind === 'paper') {
    const c = layer.paperColor ?? [255, 255, 255];
    for (let i = 0; i < w * h; i++) out.set([c[0], c[1], c[2], 255], i * 4);
    return out;
  }
  const d = downsampleLayer(layer, docW, docH, w, h);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = d.r[i]!;
    out[i * 4 + 1] = d.g[i]!;
    out[i * 4 + 2] = d.b[i]!;
    out[i * 4 + 3] = d.a[i]! * 255;
  }
  return out;
}

/**
 * Small preview of the whole page (straight RGBA, w×h). Every layer is first reduced to the preview size by
 * averaging all of its painted pixels, then the reduced layers are blended. Cost grows with the painted
 * area and the number of layers, not with the page size, and thin lines never vanish.
 */
export function thumbnail(doc: Document, w: number, h: number, opts: CompositeOptions = {}): Uint8ClampedArray {
  const steps = thumbnailSteps(doc, w, h, opts);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/** `thumbnail` that gives the window turns between layers and every few rows of the picture (see cooperate.ts). */
export async function thumbnailAsync(doc: Document, w: number, h: number, opts: CompositeOptions, tick: Tick): Promise<Uint8ClampedArray> {
  const steps = thumbnailSteps(doc, w, h, opts);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    await tick();
  }
}

/** The work of `thumbnail`, which pauses (yields) where it can be interrupted. */
function* thumbnailSteps(doc: Document, w: number, h: number, opts: CompositeOptions): Generator<void, Uint8ClampedArray> {
  const out = new Uint8ClampedArray(w * h * 4);
  const cur = { i: 0 };
  const cellX = (): number => Math.min(doc.width - 1, Math.floor(((cur.i % w) + 0.5) * (doc.width / w)));
  const cellY = (): number => Math.min(doc.height - 1, Math.floor((Math.floor(cur.i / w) + 0.5) * (doc.height / h)));
  const build = function* (nodes: readonly TreeNode[]): Generator<void, PNode[]> {
    const plan: PNode[] = [];
    for (const tn of nodes) {
      const l = tn.layer;
      if (opts.output && !shownInOutput(l)) continue;
      const maskAt = l.mask && l.mask.enabled ? () => layerMaskAt(l, cellX(), cellY()) : undefined;
      if (l.kind === 'folder') plan.push({ layer: l, children: yield* build(tn.children), read: noRead, maskAt });
      else if (l.kind === 'paper') plan.push({ layer: l, children: [], read: paperReader(l), maskAt });
      else if (l.kind === 'adjust') plan.push({ layer: l, children: [], read: noRead, maskAt, adjust: adjustOf(l) });
      else {
        const d = downsampleLayer(l, doc.width, doc.height, w, h, Math.max(1, Math.floor(opts.sample ?? 1)));
        yield;
        plan.push({
          layer: l,
          children: [],
          read: (o) => {
            const i = cur.i;
            o[0] = d.r[i]! / 255;
            o[1] = d.g[i]! / 255;
            o[2] = d.b[i]! / 255;
            o[3] = d.a[i]!;
          },
          maskAt,
        });
      }
    }
    return plan;
  };
  const plan = yield* build(layerTree(doc.layers));
  const acc = [0, 0, 0, 0];
  const st: Scratch[] = [];
  for (let i = 0; i < w * h; i++) {
    if ((i & 511) === 511) yield;
    cur.i = i;
    acc[0] = acc[1] = acc[2] = acc[3] = 0;
    evalNodes(plan, acc, st, 0);
    const o = i * 4;
    out[o] = acc[0]! * 255;
    out[o + 1] = acc[1]! * 255;
    out[o + 2] = acc[2]! * 255;
    out[o + 3] = acc[3]! * 255;
  }
  return out;
}
