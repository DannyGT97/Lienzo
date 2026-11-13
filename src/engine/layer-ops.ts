import type { BlendMode } from './blend';
import { compositePixel } from './composite';
import type { Document, Layer, LayerMask, LayerRole } from './document';
import { newLayer } from './document';
import { normalizeLayers } from './layer-tree';
import { carryPixels } from './overflow';
import type { Command } from './history';
import { TILE, TILE_BYTES, TiledSurface, type Rect, type Tile } from './tiles';

/** The properties of a layer that the layer palette can change. */
export interface LayerProps {
  id: number;
  name: string;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  lockAlpha: boolean;
  locked: boolean;
  clip: boolean;
  parent: number | null;
  open: boolean;
  through: boolean;
  role: LayerRole;
  /** The mask object (null = none) and whether it is switched on; the mask's pixels are not part of this. */
  mask: LayerMask | null;
  maskEnabled: boolean;
}

/** Order, membership and properties of the layers: enough to undo any change made from the layer palette. */
export interface Structure {
  layers: Layer[];
  props: LayerProps[];
  activeId: number;
}

const propsOf = (l: Layer): LayerProps => ({
  id: l.id,
  name: l.name,
  visible: l.visible,
  opacity: l.opacity,
  blend: l.blend,
  lockAlpha: l.lockAlpha,
  locked: l.locked,
  clip: l.clip,
  parent: l.parent,
  open: l.open,
  through: l.through,
  role: l.role,
  mask: l.mask ?? null,
  maskEnabled: l.mask?.enabled ?? true,
});

/** True when two property lists describe the same layers in the same state. */
export function samePropsList(a: readonly LayerProps[], b: readonly LayerProps[]): boolean {
  return a.length === b.length && a.every((p, i) => (Object.keys(p) as (keyof LayerProps)[]).every((k) => p[k] === b[i]![k]));
}

export function captureStructure(doc: Document): Structure {
  return { layers: [...doc.layers], props: doc.layers.map(propsOf), activeId: doc.activeId };
}

function applyStructure(doc: Document, s: Structure): void {
  doc.layers = [...s.layers];
  s.layers.forEach((l, i) => {
    const { mask, maskEnabled, ...rest } = s.props[i]!;
    Object.assign(l, rest);
    if (mask) {
      mask.enabled = maskEnabled;
      l.mask = mask;
    } else delete l.mask;
  });
  doc.activeId = s.activeId;
  // A layer that was away may have lost its GPU copy: make the renderer upload it again.
  for (const l of doc.layers) {
    l.surface.markAllDirty();
    l.mask?.surface.markAllDirty();
  }
}

const sameStructure = (a: Structure, b: Structure): boolean =>
  a.activeId === b.activeId &&
  a.layers.length === b.layers.length &&
  a.layers.every((l, i) => l === b.layers[i]) &&
  samePropsList(a.props, b.props);

/** A history step for a change of the layer structure; `extra` undoes or redoes what the structure alone cannot (pixels). */
export function structureCommand(
  doc: Document,
  label: string,
  before: Structure,
  after: Structure,
  extra?: { undo(): void; redo(): void; bytes?: number },
): Command {
  return {
    label,
    region: null,
    bytes: extra?.bytes ?? 0,
    undo: () => {
      extra?.undo();
      applyStructure(doc, before);
    },
    redo: () => {
      applyStructure(doc, after);
      extra?.redo();
    },
  };
}

/** Run `change` and return the history step that undoes it (null when nothing changed). */
export function recordStructure(doc: Document, label: string, change: () => void): Command | null {
  const before = captureStructure(doc);
  change();
  const after = captureStructure(doc);
  return sameStructure(before, after) ? null : structureCommand(doc, label, before, after);
}

/** Layer kinds that keep editable objects behind their pixels, and can be turned into plain pixels. */
export const canRasterize = (l: Layer): boolean => l.kind === 'tone' || l.kind === 'panels' || l.kind === 'balloons' || l.kind === 'vector';

/**
 * Turn a tone, panel or balloon layer into an ordinary pixel layer: the pixels as they are drawn stay, the editable
 * objects (halftone settings, frames, balloons and text) are given up. Returns the history step (null if not applicable).
 * The caller makes sure the layer's pixels are up to date first.
 */
export function rasterizeLayer(layer: Layer): Command | null {
  if (!canRasterize(layer)) return null;
  const before = { kind: layer.kind, tone: layer.tone, source: layer.source, panels: layer.panels, balloons: layer.balloons, vector: layer.vector, renderedTiles: layer.renderedTiles };
  const apply = (): void => {
    layer.kind = 'raster';
    delete layer.tone;
    delete layer.source;
    delete layer.panels;
    delete layer.balloons;
    delete layer.vector;
    delete layer.renderedTiles;
  };
  apply();
  return {
    label: 'Rasterizar',
    region: null,
    undo: () => {
      layer.kind = before.kind;
      Object.assign(layer, { tone: before.tone, source: before.source, panels: before.panels, balloons: before.balloons, vector: before.vector, renderedTiles: before.renderedTiles });
    },
    redo: apply,
  };
}

/** The same pixels as a surface that fits `doc`: a plain copy when the page is the same size, otherwise re-cut (what falls off the page is dropped). */
function carry(s: TiledSurface, doc: Pick<Document, 'width' | 'height'>): TiledSurface {
  if (s.width === doc.width && s.height === doc.height && s.blockSize === TILE) return s.clone();
  const out = new TiledSurface(doc.width, doc.height);
  for (const [tx, ty] of s.entries()) {
    const r = s.blockRect(tx, ty);
    if (r) out.writeRect(r, s.readRect(r));
  }
  out.markAllDirty();
  return out;
}

/** A copy of `src` made for `doc` (new id, pixels carried over); a folder's members are not included. */
function copyOf(doc: Pick<Document, 'width' | 'height' | 'nextId'>, src: Layer, parent: number | null, name: string): Layer {
  const copy = newLayer(doc as Document, name, src.kind);
  copy.visible = src.visible;
  copy.opacity = src.opacity;
  copy.blend = src.blend;
  copy.lockAlpha = src.lockAlpha;
  copy.locked = src.locked;
  copy.clip = src.clip;
  copy.parent = parent;
  copy.open = src.open;
  copy.through = src.through;
  copy.role = src.role;
  if (src.kind === 'raster') {
    // A pixel layer keeps what lies beyond the page's edge (or what the target page cannot hold), to be moved or scaled into view later.
    const px = carryPixels(src, doc.width, doc.height);
    copy.surface = px.surface;
    if (px.overflow) copy.overflow = px.overflow;
  } else copy.surface = carry(src.surface, doc);
  if (src.mask) copy.mask = { surface: carry(src.mask.surface, doc), base: src.mask.base, enabled: src.mask.enabled };
  if (src.source) copy.source = carry(src.source, doc);
  if (src.tone) copy.tone = { ...src.tone };
  if (src.adjust) copy.adjust = { ...src.adjust, values: { ...src.adjust.values }, main: [...src.adjust.main], sub: [...src.adjust.sub] };
  if (src.paperColor) copy.paperColor = [...src.paperColor];
  if (src.panels) copy.panels = structuredClone(src.panels);
  if (src.balloons) copy.balloons = structuredClone(src.balloons);
  if (src.vector) copy.vector = structuredClone(src.vector);
  if (src.renderedTiles) copy.renderedTiles = new Set(src.renderedTiles);
  return copy;
}

/** A copy of the layer (pixels, mask, tone screen, panels and balloons included; a folder with its members) placed right above it and made active. */
export function duplicateLayer(doc: Document, id: number): Layer | null {
  const i = doc.layers.findIndex((l) => l.id === id);
  if (i < 0) return null;
  const src = doc.layers[i]!;
  const copy = copyOf(doc, src, src.parent, `${src.name} copia`);
  const added: Layer[] = [];
  const walk = (from: Layer, to: Layer): void => {
    for (const m of doc.layers.filter((l) => l.parent === from.id)) {
      const c = copyOf(doc, m, to.id, m.name);
      added.push(c);
      if (m.kind === 'folder') walk(m, c);
    }
  };
  if (src.kind === 'folder') walk(src, copy);
  for (const c of [copy, ...added]) if (c.role === 'reference') c.role = 'normal'; // the original keeps the one reference role
  doc.layers.splice(i + 1, 0, ...added, copy);
  normalizeLayers(doc);
  doc.activeId = copy.id;
  return copy;
}

/** Layers taken out of a document, kept apart from it so they can be put into any document (also another one). */
export interface LayerClip {
  /** Bottom first, a folder after its members; `parent` points inside the clip, null for the top ones. */
  layers: Layer[];
}

/** Snapshot of the given layers (a folder with everything inside it); the page's paper is not copied. Null when there is nothing to copy. */
export function copyLayers(doc: Document, ids: readonly number[]): LayerClip | null {
  const wanted = new Set<number>();
  const take = (id: number): void => {
    wanted.add(id);
    for (const l of doc.layers) if (l.parent === id) take(l.id);
  };
  for (const id of ids) if (doc.layers.some((l) => l.id === id)) take(id);
  const scratch = { width: doc.width, height: doc.height, nextId: 1 };
  // Every page has its own paper at the very bottom, which stays where it is; any other paper layer that was chosen is a layer like the rest.
  const pagePaper = doc.layers[0]?.kind === 'paper' ? doc.layers[0] : undefined;
  const layers = doc.layers
    .filter((l) => wanted.has(l.id) && l !== pagePaper)
    .map((l) => {
      const c = copyOf(scratch, l, l.parent !== null && wanted.has(l.parent) ? l.parent : null, l.name);
      c.id = l.id; // the clip's own ids; parents refer to them
      return c;
    });
  return layers.length ? { layers } : null;
}

/**
 * Put a clip into a document above the active layer (inside it when it is an open folder), keeping names, order and
 * folders; returns every layer created. The last top-level one becomes the active layer.
 */
export function pasteLayers(doc: Document, clip: LayerClip): Layer[] {
  const made = new Map<number, Layer>();
  for (const s of clip.layers) made.set(s.id, copyOf(doc, s, null, s.name));
  const cur = doc.layers.find((l) => l.id === doc.activeId) ?? doc.layers[doc.layers.length - 1];
  const inside = cur !== undefined && cur.kind === 'folder' && cur.open;
  const rootParent = cur ? (inside ? cur.id : cur.parent) : null;
  const tops: Layer[] = [];
  for (const s of clip.layers) {
    const c = made.get(s.id)!;
    const parent = s.parent === null ? undefined : made.get(s.parent);
    c.parent = parent ? parent.id : rootParent;
    if (!parent) tops.push(c);
  }
  // There is at most one reference layer: the document's own keeps the role.
  if (doc.layers.some((l) => l.role === 'reference')) for (const c of made.values()) if (c.role === 'reference') c.role = 'normal';
  const index = cur ? doc.layers.indexOf(cur) + (inside ? 0 : 1) : doc.layers.length;
  doc.layers.splice(index, 0, ...clip.layers.map((s) => made.get(s.id)!));
  normalizeLayers(doc);
  if (tops.length) doc.activeId = tops[tops.length - 1]!.id;
  return clip.layers.map((s) => made.get(s.id)!);
}

/** A layer can be merged into the one below when that one is a plain pixel layer and it has pixels of its own. */
export function canMergeDown(doc: Document, id: number): boolean {
  const i = doc.layers.findIndex((l) => l.id === id);
  if (i < 1) return false;
  const upper = doc.layers[i]!;
  const lower = doc.layers[i - 1]!;
  // A clipped lower layer is not the base of the one above it (nor can it keep that layer's pixels unclipped), so the merge
  // would limit the pixels by the wrong shape.
  return upper.kind !== 'paper' && upper.kind !== 'folder' && upper.kind !== 'adjust' && lower.kind === 'raster' && lower.parent === upper.parent && !lower.mask && !lower.clip;
}

interface TilePatch {
  tx: number;
  ty: number;
  before?: Tile;
  after: Tile;
}

/**
 * Paint a layer onto the one below it (with its opacity, blend mode and clipping) and remove it.
 * Returns the history step, or null when the layers cannot be merged.
 */
export function mergeLayerDown(doc: Document, id: number): Command | null {
  if (!canMergeDown(doc, id)) return null;
  const i = doc.layers.findIndex((l) => l.id === id);
  const upper = doc.layers[i]!;
  const lower = doc.layers[i - 1]!;
  const before = captureStructure(doc);

  const patches: TilePatch[] = [];
  const dst: [number, number, number] = [0, 0, 0];
  const src: [number, number, number] = [0, 0, 0];
  const px = [0, 0, 0, 0];
  const mask = upper.mask && upper.mask.enabled ? upper.mask : null;
  for (const [tx, ty, ut] of upper.surface.entries()) {
    const mt = mask ? mask.surface.get(tx, ty) : undefined;
    const old = lower.surface.get(tx, ty);
    const next: Tile = old ? old.slice() : new Uint8ClampedArray(TILE_BYTES);
    let touched = false;
    for (let o = 0; o < TILE * TILE * 4; o += 4) {
      const ua = ut[o + 3]!;
      if (ua === 0) continue;
      const la = next[o + 3]! / 255;
      const m = mask ? (mt ? mt[o + 3]! / 255 : mask.base / 255) : 1;
      const as = (upper.visible ? ua / 255 : 0) * upper.opacity * (upper.clip ? la : 1) * m;
      if (as <= 0) continue;
      dst[0] = next[o]! / 255;
      dst[1] = next[o + 1]! / 255;
      dst[2] = next[o + 2]! / 255;
      src[0] = ut[o]! / 255;
      src[1] = ut[o + 1]! / 255;
      src[2] = ut[o + 2]! / 255;
      compositePixel(upper, dst, la, src, as, px);
      next[o] = px[0]! * 255;
      next[o + 1] = px[1]! * 255;
      next[o + 2] = px[2]! * 255;
      next[o + 3] = px[3]! * 255;
      touched = true;
    }
    if (touched) patches.push({ tx, ty, before: old?.slice(), after: next.slice() });
    if (touched) lower.surface.put(tx, ty, next);
  }

  doc.layers.splice(i, 1);
  doc.activeId = lower.id;
  const after = captureStructure(doc);
  const bytes = patches.reduce((n, p) => n + (p.before ? TILE_BYTES : 0) + TILE_BYTES, 0);
  const apply = (which: 'before' | 'after'): void => {
    for (const p of patches) {
      const t = p[which];
      lower.surface.put(p.tx, p.ty, t ? t.slice() : undefined);
    }
  };
  return structureCommand(doc, 'Combinar con la capa inferior', before, after, {
    undo: () => apply('before'),
    redo: () => apply('after'),
    bytes,
  });
}
