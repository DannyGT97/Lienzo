import type { AdjustSettings } from './adjust';
import type { Balloon } from './balloon';
import type { BlendMode } from './blend';
import type { Guides } from './guides';
import type { Ruler } from './rulers';
import type { VectorStroke } from './vector';
import { emptyGuides } from './guides';
import type { LayerComp } from './layer-comps';
import type { Overflow } from './overflow';
import type { Panel } from './panels';
import { TiledSurface } from './tiles';
import type { ToneSettings } from './tone';
import { defaultTone } from './tone';

/**
 * raster   – plain pixels.
 * tone     – a halftone screen; `source` holds the painted area, `surface` the rendered screen.
 * panels   – vector panel borders, rasterised into `surface`.
 * balloons – speech balloons and text, rasterised into `surface`.
 * paper    – a solid colour with no pixels of its own (a blank page costs no memory).
 * adjust   – no pixels: a colour correction applied to what is below it (see adjust)
 * vector   – pen lines kept as points and redrawn into `surface` (see vector)
 * folder   – holds other layers (those whose `parent` is its id); has no pixels of its own.
 * Every kind keeps its rendered pixels in `surface` (paper aside), so compositing and PSD need no special cases.
 */
export type LayerKind = 'raster' | 'tone' | 'panels' | 'balloons' | 'paper' | 'folder' | 'adjust' | 'vector';

/**
 * A layer mask: the alpha of each pixel says how much of the layer shows there (255 = all). Tiles the mask
 * does not hold are `base` (255 for "show all", 0 for "hide all"), so an untouched mask costs no memory.
 */
export interface LayerMask {
  surface: TiledSurface;
  base: 0 | 255;
  /** A disabled mask is kept but ignored. */
  enabled: boolean;
}

/**
 * What a layer is for besides drawing: `draft` layers are shown while working but left out of the output,
 * `reference` layers are what the fill and selection tools look at (and are also left out of the output).
 */
export type LayerRole = 'normal' | 'draft' | 'reference';

export interface Layer {
  id: number;
  name: string;
  kind: LayerKind;
  visible: boolean;
  opacity: number; // 0..1
  blend: BlendMode;
  /** Lock transparent pixels: painting may not change alpha. */
  lockAlpha: boolean;
  /** Locked layer: its content cannot be changed (painting, filling, erasing, transforming) until it is unlocked. */
  locked: boolean;
  /** Clip to the layer below: only visible where the layer below has alpha. */
  clip: boolean;
  /** Sparse straight (non-premultiplied) RGBA pixels, 8 bits per channel. */
  surface: TiledSurface;
  /** Pixel layers: what the layer holds beyond the page's edge (see overflow). Never changed in place, only replaced. */
  overflow?: Overflow;
  /** The folder this layer sits in (null = top level). A folder's members are listed right below it, see layer-tree. */
  parent: number | null;
  /** Folders: the member layers are shown in the layer palette. */
  open: boolean;
  /** Folders: members are composited straight onto what is below instead of as a separate image first. */
  through: boolean;
  role: LayerRole;
  mask?: LayerMask;
  /** Colour of a `paper` layer. */
  paperColor?: [number, number, number];
  tone?: ToneSettings;
  /** Adjustment layers: the correction. */
  adjust?: AdjustSettings;
  /** Tone layers: the painted area (alpha is the mask the screen is clipped to). */
  source?: TiledSurface;
  panels?: Panel[];
  balloons?: Balloon[];
  /** Vector layers: the lines, bottom first. */
  vector?: VectorStroke[];
  /** Object layers: tiles that currently hold rendered objects, so stale ones can be cleared. */
  renderedTiles?: Set<number>;
}

export interface Document {
  width: number;
  height: number;
  /** Pixels per inch; sets the physical size of a halftone screen. */
  dpi: number;
  layers: Layer[]; // bottom -> top
  activeId: number;
  nextId: number;
  /** Saved combinations of layer settings (see layer-comps). */
  comps: LayerComp[];
  nextCompId: number;
  /** Ruler guides (see guides). */
  guides: Guides;
  /** Drawing rulers (see rulers). */
  rulers: Ruler[];
  nextRulerId: number;
}

export const DEFAULT_DPI = 350;

export function createDocument(width: number, height: number, dpi = DEFAULT_DPI): Document {
  const doc: Document = { width, height, dpi, layers: [], activeId: 0, nextId: 1, comps: [], nextCompId: 1, guides: emptyGuides(), rulers: [], nextRulerId: 1 };
  addLayer(doc, 'Layer 1');
  return doc;
}

/**
 * Pixel data the document holds in memory: the blocks that exist in every layer, mask and tone area. Vector and
 * object data, selections, undo steps and the GPU's copies are not counted here.
 */
export function documentPixels(doc: Document): { tiles: number; bytes: number } {
  let tiles = 0;
  let bytes = 0;
  for (const l of doc.layers) {
    for (const s of [l.surface, l.mask?.surface, l.source]) {
      if (!s) continue;
      tiles += s.tileCount;
      bytes += s.pixelBytes;
    }
  }
  return { tiles, bytes };
}

/** Allocate a layer (consumes an id) without inserting it. */
export function newLayer(doc: Document, name?: string, kind: LayerKind = 'raster'): Layer {
  const id = doc.nextId++;
  const layer: Layer = {
    id,
    name: name ?? `Layer ${id}`,
    kind,
    visible: true,
    opacity: 1,
    blend: 'normal',
    lockAlpha: false,
    locked: false,
    clip: false,
    surface: new TiledSurface(doc.width, doc.height),
    parent: null,
    open: true,
    through: kind === 'folder',
    role: 'normal',
  };
  if (kind === 'tone') {
    layer.tone = { ...defaultTone };
    layer.source = new TiledSurface(doc.width, doc.height);
  } else if (kind === 'adjust') {
    layer.adjust = { filter: 'brightness', values: {}, main: [0, 0, 0], sub: [255, 255, 255] };
  } else if (kind === 'vector') {
    layer.vector = [];
  } else if (kind === 'paper') {
    layer.paperColor = [255, 255, 255];
  } else if (kind === 'panels') {
    layer.panels = [];
  } else if (kind === 'balloons') {
    layer.balloons = [];
  }
  return layer;
}

export function addLayer(doc: Document, name?: string, index = doc.layers.length, kind: LayerKind = 'raster'): Layer {
  const layer = newLayer(doc, name, kind);
  doc.layers.splice(index, 0, layer);
  doc.activeId = layer.id;
  return layer;
}

export function removeLayer(doc: Document, id: number): void {
  if (doc.layers.length <= 1) return;
  const i = doc.layers.findIndex((l) => l.id === id);
  if (i < 0) return;
  const gone = doc.layers[i]!;
  // A folder takes its members with it.
  const doomed = new Set<number>([id]);
  for (const l of doc.layers) if (l.parent !== null && doomed.has(l.parent)) doomed.add(l.id);
  if (doomed.size >= doc.layers.length) return;
  doc.layers = doc.layers.filter((l) => !doomed.has(l.id));
  if (doomed.has(doc.activeId)) {
    const near = Math.max(0, Math.min(i - doomed.size, doc.layers.length - 1));
    doc.activeId = (doc.layers.find((l) => l.id === gone.parent) ?? doc.layers[near]!).id;
  }
}

export function activeLayer(doc: Document): Layer {
  return doc.layers.find((l) => l.id === doc.activeId) ?? doc.layers[0]!;
}

/** What a brush paints into: the tone mask for tone layers, the layer's pixels otherwise. */
export interface PaintTarget {
  id: number;
  surface: TiledSurface;
  lockAlpha: boolean;
  /** Set when painting a layer mask: the alpha tiles the mask does not hold stand for (0 hides, 255 shows). */
  mask?: 0 | 255;
}

export function paintTarget(layer: Layer, editMask = false): PaintTarget {
  if (editMask && layer.mask) return { id: layer.id, surface: layer.mask.surface, lockAlpha: false, mask: layer.mask.base };
  return layer.source
    ? { id: layer.id, surface: layer.source, lockAlpha: false }
    : { id: layer.id, surface: layer.surface, lockAlpha: layer.lockAlpha };
}

/** First layer of a kind, searching from the top. */
export function findLayer(doc: Document, kind: LayerKind): Layer | undefined {
  for (let i = doc.layers.length - 1; i >= 0; i--) if (doc.layers[i]!.kind === kind) return doc.layers[i];
  return undefined;
}
