import type { AdjustSettings } from './adjust';
import type { VectorStroke } from './vector';
import type { BlendMode } from './blend';
import { createDocument, newLayer, type Document, type Layer, type LayerKind, type LayerRole } from './document';
import type { Guides } from './guides';
import type { LayerComp } from './layer-comps';
import type { Ruler } from './rulers';
import { normalizeLayers } from './layer-tree';
import { TILE, TiledSurface } from './tiles';
import type { Balloon } from './balloon';
import type { Panel } from './panels';
import type { ToneSettings } from './tone';

/**
 * Lienzo's own file format (`.lienzo`). One file holds the whole document: every layer with its folder, mask, role,
 * halftone settings, panels and balloons, plus layer comps and guides.
 *
 *   bytes 0..6   "LIENZO\0"
 *   byte  7      format version (1, or 2 when a surface is not cut into 256×256 blocks)
 *   bytes 8..11  length of the metadata block (u32, little endian)
 *   metadata     JSON (UTF-8): document settings and, per layer, its properties and the list of its tiles
 *   tile data    every tile on its own, compressed with deflate (raw), one after another
 *
 * Tiles are compressed one by one, so saving never holds the whole raw document in memory and loading can read just
 * the pieces it needs. A tile reference is [tx, ty, offset, length], the offset counted from the end of the metadata.
 *
 * Block size: a tile is `blockSize`² RGBA pixels. Version 1 files have no `blocks` field and always use 256. A layer
 * whose surface/source/mask uses another size records it in `blocks` and the file is written as version 2; any other
 * file stays version 1, so older builds keep opening it. On load every surface is cut again into the engine's working
 * size (`TILE`), because the brush and the renderers assume it; the file keeps whatever size it was saved with.
 */
const MAGIC = [0x4c, 0x49, 0x45, 0x4e, 0x5a, 0x4f, 0x00]; // "LIENZO\0"
/** Newest format version this build can read. */
export const LIENZO_VERSION = 2;
const HEADER = 12;
const CORRUPT = 'El archivo está incompleto o dañado.';

type TileRef = [tx: number, ty: number, offset: number, length: number];

interface LayerRecord {
  id: number;
  name: string;
  kind: LayerKind;
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
  paperColor?: [number, number, number];
  tone?: ToneSettings;
  adjust?: AdjustSettings;
  panels?: Panel[];
  balloons?: Balloon[];
  vector?: VectorStroke[];
  /** Tiles of the layer's pixels, of the painted area (tone layers) and of its mask. */
  surface: TileRef[];
  source?: TileRef[];
  mask?: { base: 0 | 255; enabled: boolean; tiles: TileRef[] };
  /** Block size of each surface that is not 256 (absent = 256). Version 2. */
  blocks?: { surface?: number; source?: number; mask?: number };
  renderedTiles?: number[];
  /** What the layer holds beyond the page (see overflow): its own size, the page point its (0, 0) sits at, and its tiles. Older builds ignore it. */
  overflow?: { x: number; y: number; width: number; height: number; tiles: TileRef[] };
}

interface Metadata {
  version: number;
  width: number;
  height: number;
  dpi: number;
  activeId: number;
  nextId: number;
  nextCompId: number;
  comps: LayerComp[];
  guides: Guides;
  rulers?: Ruler[];
  nextRulerId?: number;
  layers: LayerRecord[];
  /** A small picture of the page (PNG, base64), so a file explorer can show the document without reading all of it. */
  preview?: string;
}

/**
 * How many tiles are being compressed or decompressed at the same time. The work runs off the main thread, but one tile at a time
 * each one waits for the previous to finish: a page of thousands of tiles took tens of seconds on a tablet. A batch keeps the
 * compressor busy, and the results are still put in order.
 */
const PARALLEL = 16;

async function pack(data: Uint8ClampedArray): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  void writer.write(data);
  void writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

async function unpack(data: ArrayBuffer): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  void writer.write(new Uint8Array(data));
  void writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** Write a document to a `.lienzo` file. */
export interface SaveOptions {
  /** Makes the small picture kept inside the file (PNG bytes), or null when there is none. Left out by autosave, which saves often. */
  preview?: () => Promise<Uint8Array | null>;
}

const toBase64 = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
};
const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export async function saveLienzo(doc: Document, opts: SaveOptions = {}): Promise<Blob> {
  const parts: Uint8Array[] = [];
  let offset = 0;
  const refs = async (s: TiledSurface | undefined): Promise<TileRef[]> => {
    const out: TileRef[] = [];
    if (!s) return out;
    const all = [...s.entries()];
    for (let i = 0; i < all.length; i += PARALLEL) {
      const batch = all.slice(i, i + PARALLEL);
      const packed = await Promise.all(batch.map(([, , tile]) => pack(tile)));
      batch.forEach(([tx, ty], j) => {
        const z = packed[j]!;
        parts.push(z);
        out.push([tx, ty, offset, z.length]);
        offset += z.length;
      });
    }
    return out;
  };
  const layers: LayerRecord[] = [];
  let version = 1;
  for (const l of doc.layers) {
    const rec: LayerRecord = {
      id: l.id,
      name: l.name,
      kind: l.kind,
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
      surface: await refs(l.surface),
    };
    if (l.paperColor) rec.paperColor = [...l.paperColor];
    if (l.tone) rec.tone = { ...l.tone };
    if (l.adjust) rec.adjust = { ...l.adjust, values: { ...l.adjust.values }, main: [...l.adjust.main], sub: [...l.adjust.sub] };
    if (l.panels) rec.panels = l.panels;
    if (l.balloons) rec.balloons = l.balloons;
    if (l.vector) rec.vector = l.vector;
    if (l.source) rec.source = await refs(l.source);
    if (l.mask) rec.mask = { base: l.mask.base, enabled: l.mask.enabled, tiles: await refs(l.mask.surface) };
    if (l.renderedTiles) rec.renderedTiles = [...l.renderedTiles];
    if (l.overflow && !l.overflow.surface.isEmpty) {
      const o = l.overflow;
      rec.overflow = { x: o.x, y: o.y, width: o.surface.width, height: o.surface.height, tiles: await refs(o.surface) };
    }
    const blocks: NonNullable<LayerRecord['blocks']> = {};
    if (l.surface.blockSize !== TILE) blocks.surface = l.surface.blockSize;
    if (l.source && l.source.blockSize !== TILE) blocks.source = l.source.blockSize;
    if (l.mask && l.mask.surface.blockSize !== TILE) blocks.mask = l.mask.surface.blockSize;
    if (Object.keys(blocks).length) {
      rec.blocks = blocks;
      version = 2;
    }
    layers.push(rec);
  }
  const meta: Metadata = {
    version,
    width: doc.width,
    height: doc.height,
    dpi: doc.dpi,
    activeId: doc.activeId,
    nextId: doc.nextId,
    nextCompId: doc.nextCompId,
    comps: doc.comps,
    guides: doc.guides,
    rulers: doc.rulers,
    nextRulerId: doc.nextRulerId,
    layers,
  };
  const picture = opts.preview ? await opts.preview().catch(() => null) : null;
  if (picture) meta.preview = toBase64(picture);
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const head = new Uint8Array(HEADER);
  head.set(MAGIC);
  head[7] = version;
  new DataView(head.buffer).setUint32(8, json.length, true);
  return new Blob([head, json, ...parts], { type: 'application/x-lienzo' });
}

/** True when the first bytes say the data is a `.lienzo` file. */
export async function isLienzo(src: Blob): Promise<boolean> {
  if (src.size < HEADER) return false;
  const head = new Uint8Array(await src.slice(0, MAGIC.length).arrayBuffer());
  return MAGIC.every((b, i) => head[i] === b);
}

/** Read a `.lienzo` file. Throws an Error with a message fit to show the user when the file is not valid. */
export async function loadLienzo(src: Blob): Promise<Document> {
  if (!(await isLienzo(src))) throw new Error('El archivo no es un documento de Lienzo.');
  const head = new Uint8Array(await src.slice(0, HEADER).arrayBuffer());
  const version = head[7]!;
  if (version > LIENZO_VERSION) throw new Error('El archivo es de una versión más nueva de Lienzo: actualiza la aplicación para abrirlo.');
  const metaLength = new DataView(head.buffer).getUint32(8, true);
  if (HEADER + metaLength > src.size) throw new Error('El archivo está incompleto o dañado.');
  let meta: Metadata;
  try {
    meta = JSON.parse(new TextDecoder().decode(await src.slice(HEADER, HEADER + metaLength).arrayBuffer())) as Metadata;
  } catch {
    throw new Error('El archivo está incompleto o dañado.');
  }
  if (!Number.isInteger(meta.width) || !Number.isInteger(meta.height) || meta.width < 1 || meta.height < 1 || !Array.isArray(meta.layers)) {
    throw new Error('El archivo está incompleto o dañado.');
  }
  const dataStart = HEADER + metaLength;
  /** Read a surface saved with `blockSize`-sized blocks and return it cut into the working size. */
  const readSurface = async (tiles: TileRef[], blockSize: number | undefined, width = meta.width, height = meta.height): Promise<TiledSurface> => {
    // Only version 2 files carry a block size; a version 1 file is always 256.
    const size = version >= 2 && blockSize !== undefined ? blockSize : TILE;
    let stored: TiledSurface;
    try {
      stored = new TiledSurface(width, height, size);
    } catch {
      throw new Error(CORRUPT);
    }
    for (let i = 0; i < tiles.length; i += PARALLEL) {
      const batch = tiles.slice(i, i + PARALLEL);
      for (const [tx, ty, offset, length] of batch) {
        if (!stored.inGrid(tx, ty) || !Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || dataStart + offset + length > src.size) throw new Error(CORRUPT);
      }
      const raws = await Promise.all(
        batch.map(async ([, , offset, length]) =>
          unpack(await src.slice(dataStart + offset, dataStart + offset + length).arrayBuffer()).catch(() => {
            throw new Error(CORRUPT);
          }),
        ),
      );
      batch.forEach(([tx, ty], j) => {
        const raw = raws[j]!;
        if (raw.length !== stored.blockBytes) throw new Error(CORRUPT);
        stored.put(tx, ty, new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.length));
      });
    }
    return size === TILE ? stored : stored.reblock(TILE);
  };

  const doc = createDocument(meta.width, meta.height, meta.dpi);
  doc.layers = [];
  for (const rec of meta.layers) {
    const layer: Layer = newLayer(doc, rec.name, rec.kind);
    layer.id = rec.id;
    layer.visible = rec.visible;
    layer.opacity = rec.opacity;
    layer.blend = rec.blend;
    layer.lockAlpha = rec.lockAlpha;
    layer.locked = rec.locked ?? false;
    layer.clip = rec.clip;
    layer.parent = rec.parent;
    layer.open = rec.open;
    layer.through = rec.through;
    layer.role = rec.role;
    if (rec.paperColor) layer.paperColor = rec.paperColor;
    if (rec.tone) layer.tone = rec.tone;
    if (rec.adjust) layer.adjust = rec.adjust;
    if (rec.panels) layer.panels = rec.panels;
    if (rec.balloons) layer.balloons = rec.balloons;
    if (rec.vector) layer.vector = rec.vector;
    if (rec.renderedTiles) layer.renderedTiles = new Set(rec.renderedTiles);
    layer.surface = await readSurface(rec.surface, rec.blocks?.surface);
    if (rec.source) layer.source = await readSurface(rec.source, rec.blocks?.source);
    if (rec.mask) layer.mask = { surface: await readSurface(rec.mask.tiles, rec.blocks?.mask), base: rec.mask.base, enabled: rec.mask.enabled };
    const o = rec.overflow;
    if (o) {
      if (!Number.isInteger(o.x) || !Number.isInteger(o.y) || !Number.isInteger(o.width) || !Number.isInteger(o.height) || o.width < 1 || o.height < 1) throw new Error(CORRUPT);
      layer.overflow = { x: o.x, y: o.y, surface: await readSurface(o.tiles, undefined, o.width, o.height) };
    }
    doc.layers.push(layer);
  }
  normalizeLayers(doc);
  doc.nextId = Math.max(meta.nextId, ...doc.layers.map((l) => l.id + 1));
  doc.activeId = doc.layers.some((l) => l.id === meta.activeId) ? meta.activeId : doc.layers[doc.layers.length - 1]?.id ?? 0;
  doc.comps = meta.comps ?? [];
  doc.nextCompId = meta.nextCompId ?? doc.comps.reduce((m, c) => Math.max(m, c.id + 1), 1);
  doc.guides = meta.guides ?? { v: [], h: [] };
  doc.rulers = meta.rulers ?? [];
  doc.nextRulerId = meta.nextRulerId ?? doc.rulers.reduce((m, r) => Math.max(m, r.id + 1), 1);
  if (!doc.layers.length) throw new Error('El archivo no contiene capas.');
  return doc;
}

/**
 * The picture a `.lienzo` file keeps of its page (PNG bytes), read from the first bytes of the file only: `range` gives bytes
 * `start` to `end` of it, so a big document is never read whole. Null when the file has no picture (it was saved before there
 * was one) or is not a valid file.
 */
export async function readLienzoPreview(range: (start: number, end: number) => Promise<Blob>): Promise<Uint8Array | null> {
  try {
    const head = new Uint8Array(await (await range(0, HEADER)).arrayBuffer());
    if (head.length < HEADER || !MAGIC.every((b, i) => head[i] === b)) return null;
    const metaLength = new DataView(head.buffer).getUint32(8, true);
    if (metaLength <= 0 || metaLength > 64 * 1024 * 1024) return null;
    const meta = JSON.parse(new TextDecoder().decode(await (await range(HEADER, HEADER + metaLength)).arrayBuffer())) as Metadata;
    return typeof meta.preview === 'string' && meta.preview ? fromBase64(meta.preview) : null;
  } catch {
    return null;
  }
}
