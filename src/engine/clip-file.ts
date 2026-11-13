import { createDocument, newLayer, type Document, type Layer } from './document';
import type { RawImage } from './image-decode';
import { SqliteDb, type SqlRow, type SqlValue } from './sqlite-read';
import { TILE, TILE_BYTES } from './tiles';
import { BLOCK_RAW, inflateBlock, looksLikeClip, parseAttribute, parseBlockSet, parseCsf, parseExta, type BlockRecord } from './clip-csf';

export { looksLikeClip } from './clip-csf';

/**
 * Reader for the `.clip` files of Clip Studio Paint (the "CSF" container). The
 * container and block formats are described in clip-csf.ts. Writing the changes back is
 * in clip-write.ts; both rely on `ClipOrigin`, which remembers what the file said about each layer.
 *
 * Covered: the container, the layer tree (first child is the BOTTOM layer, `LayerNextIndex` goes up),
 * 256×256 blocks with an alpha plane first, opacity 256 = 100 %, blend mode 0 = normal, and that the alpha of a layer
 * reproduces the file's own preview picture. Not yet covered: the order of the colour bytes,
 * whether they are premultiplied, and what blend modes other than 0 mean.
 */
export interface ClipCodecs {
  decodePng(bytes: Uint8Array): Promise<RawImage>;
}

export interface ClipResult {
  value: Document;
  warnings: string[];
}

const ALPHA_BLOCK = TILE * TILE;
/** Fewer or more layers than this is not a plausible document. */
const MAX_LAYERS = 20_000;
/** LayerType values. */
const TYPE_RASTER = 1;
const TYPE_PAPER = 1584;

/** What the file said about one layer when it was read, so the writer only changes what the user changed. */
export interface ClipLayerOrigin {
  mainId: number;
  name: string;
  /** LayerOpacity as stored (256 = 100 %). */
  opacity: number;
  visibility: number;
  clip: number;
  composite: number;
  kind: Layer['kind'];
  /** The external data id of the full-size pixels (pixel layers; an empty layer has an id but no stored data). */
  externalId: string | null;
  /** Whether the file holds a data chunk under `externalId` (false: the layer was empty when read). */
  stored: boolean;
  /** Block grid of those pixels. */
  columns: number;
  rows: number;
  /** Content fingerprint of every block as read ("empty" for blocks with no pixels), by block index. */
  hashes: Map<number, string>;
  /** Whether the pixels could be read and written back (false: left exactly as they are in the file). */
  editable: boolean;
}

export interface ClipOrigin {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** By Lienzo layer id. */
  layers: Map<number, ClipLayerOrigin>;
  /** Layer ids, parents and kinds as imported: when the document differs, the writer edits the file's layer tree. */
  structure: string;
}

/** The order, nesting, kinds and names of the layers, without ids: what two readings of the same file must agree on. */
export function shapeOf(doc: Document): string {
  const parent = new Map(doc.layers.map((l) => [l.id, l.parent]));
  const depth = (id: number): number => {
    let n = 0;
    for (let at = parent.get(id) ?? null; at !== null && n < doc.layers.length; at = parent.get(at) ?? null) n++;
    return n;
  };
  return doc.layers.map((l) => `${depth(l.id)}/${l.kind}/${l.name}`).join('\n');
}

const origins = new WeakMap<Document, ClipOrigin>();

/** The `.clip` file this document was read from, if it was. */
export function clipOriginOf(doc: Document): ClipOrigin | undefined {
  return origins.get(doc);
}

export const structureOf = (doc: Document): string => doc.layers.map((l) => `${l.id}:${l.parent ?? ''}:${l.kind}`).join('|');

/** Fingerprint of a block's pixels (colour only counts where there is alpha), "empty" when nothing is visible. */
export function tileHash(tile: Uint8ClampedArray | undefined): string {
  if (!tile) return 'empty';
  let a = 0x811c9dc5;
  let b = 5381;
  let any = false;
  for (let i = 0; i < tile.length; i += 4) {
    const alpha = tile[i + 3]!;
    const r = alpha ? tile[i]! : 0;
    const g = alpha ? tile[i + 1]! : 0;
    const bl = alpha ? tile[i + 2]! : 0;
    if (alpha) any = true;
    a = Math.imul(a ^ alpha, 0x01000193);
    a = Math.imul(a ^ r, 0x01000193);
    a = Math.imul(a ^ g, 0x01000193);
    a = Math.imul(a ^ bl, 0x01000193);
    b = (Math.imul(b, 33) + (alpha | (r << 8) | (g << 16) | (bl << 24))) | 0;
  }
  return any ? `${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}` : 'empty';
}

/**
 * Colour bytes of a block: a 256×256 plane of four-byte pixels after the alpha plane. The byte order (here B, G, R,
 * unused) is the assumption this reader and the writer share until a coloured sample confirms it.
 */
export function decodeBlockPixels(px: Uint8Array): Uint8ClampedArray {
  const tile = new Uint8ClampedArray(TILE_BYTES);
  for (let i = 0; i < ALPHA_BLOCK; i++) {
    const alpha = px[i]!;
    if (!alpha) continue;
    tile[i * 4] = px[ALPHA_BLOCK + i * 4 + 2]!;
    tile[i * 4 + 1] = px[ALPHA_BLOCK + i * 4 + 1]!;
    tile[i * 4 + 2] = px[ALPHA_BLOCK + i * 4]!;
    tile[i * 4 + 3] = alpha;
  }
  return tile;
}

/** The inverse of decodeBlockPixels. */
export function encodeBlockPixels(tile: Uint8ClampedArray): Uint8Array {
  const px = new Uint8Array(BLOCK_RAW);
  for (let i = 0; i < ALPHA_BLOCK; i++) {
    const alpha = tile[i * 4 + 3]!;
    px[i] = alpha;
    if (!alpha) continue;
    px[ALPHA_BLOCK + i * 4] = tile[i * 4 + 2]!;
    px[ALPHA_BLOCK + i * 4 + 1] = tile[i * 4 + 1]!;
    px[ALPHA_BLOCK + i * 4 + 2] = tile[i * 4]!;
    px[ALPHA_BLOCK + i * 4 + 3] = 255;
  }
  return px;
}

export const sqlInt = (v: SqlValue | undefined): number | null => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : null);
export const sqlText = (v: SqlValue | undefined): string | null => (typeof v === 'string' ? v : v instanceof Uint8Array ? new TextDecoder().decode(v) : null);

const byId = (rows: SqlRow[], key = 'MainId'): Map<number, SqlRow> => {
  const m = new Map<number, SqlRow>();
  for (const r of rows) {
    const id = sqlInt(r[key]);
    if (id !== null) m.set(id, r);
  }
  return m;
};

/** A colour stored as a 32-bit fraction (0xFFFFFFFF = full) to 0..255. */
const channel = (v: SqlValue | undefined): number => {
  const n = sqlInt(v);
  return n === null ? 255 : Math.round((Math.min(Math.max(n, 0), 0xffffffff) / 0xffffffff) * 255);
};

export interface ClipImportOptions {
  /** false: read the layer tree and properties only (no pixels), to check a file's shape. */
  pixels?: boolean;
}

export async function importClip(bytes: Uint8Array, codecs?: ClipCodecs, options: ClipImportOptions = {}): Promise<ClipResult> {
  const warnings: string[] = [];
  const chunks = parseCsf(bytes);
  const sqliteChunk = chunks.find((c) => c.tag === 'CHNKSQLi');
  if (!sqliteChunk) throw new Error('El archivo .clip no contiene la base de datos de capas.');
  const external = new Map<string, Uint8Array>();
  for (const c of chunks) {
    if (c.tag !== 'CHNKExta') continue;
    const e = parseExta(c.payload);
    external.set(e.id, e.data);
  }
  const db = new SqliteDb(sqliteChunk.payload);
  const need = (t: string): SqlRow[] => {
    if (!db.has(t)) throw new Error(`El archivo .clip no tiene la tabla ${t}; puede ser de una versión que no se reconoce.`);
    return db.rows(t);
  };
  const canvas = need('Canvas')[0];
  const width = Math.round(Number(canvas?.CanvasWidth));
  const height = Math.round(Number(canvas?.CanvasHeight));
  if (!(width > 0 && height > 0) || width * height > 100_000_000) throw new Error('El archivo .clip declara un tamaño de lienzo no válido.');
  const dpi = Number(canvas?.CanvasResolution);
  const doc = createDocument(width, height, dpi >= 1 && dpi < 10_000 ? Math.round(dpi) : undefined);
  doc.layers = [];
  const origin: ClipOrigin = { bytes, width, height, layers: new Map(), structure: '' };

  const layerRows = need('Layer');
  if (layerRows.length > MAX_LAYERS) throw new Error('El archivo .clip declara demasiadas capas.');
  const layers = byId(layerRows);
  const mipmaps = db.has('Mipmap') ? byId(db.rows('Mipmap')) : new Map<number, SqlRow>();
  const infos = db.has('MipmapInfo') ? byId(db.rows('MipmapInfo')) : new Map<number, SqlRow>();
  const offscreens = db.has('Offscreen') ? byId(db.rows('Offscreen')) : new Map<number, SqlRow>();
  const columns = Math.ceil(width / TILE);
  const rows = Math.ceil(height / TILE);

  /** The full-size image of a mipmap chain: its external data id, block grid and whether the file stores it, or null. */
  const fullSize = (mipId: number | null): { id: string; columns: number; rows: number; stored: boolean } | null => {
    if (mipId === null) return null;
    let info = infos.get(sqlInt(mipmaps.get(mipId)?.BaseMipmapInfo) ?? -1);
    for (let guard = 0, cur = info; cur && guard < 32; guard++) {
      if (sqlInt(cur.ThisScale) === 100) {
        info = cur;
        break;
      }
      cur = infos.get(sqlInt(cur.NextIndex) ?? -1);
    }
    const off = offscreens.get(sqlInt(info?.Offscreen) ?? -1);
    const id = sqlText(off?.BlockData);
    if (!id) return null;
    const attr = off?.Attribute instanceof Uint8Array ? parseAttribute(off.Attribute) : null;
    return { id, columns: attr?.columns ?? columns, rows: attr?.rows ?? rows, stored: external.has(id) };
  };

  const blockCache = new Map<string, BlockRecord[]>();
  const paint = async (layer: Layer, o: ClipLayerOrigin): Promise<void> => {
    let blocks = blockCache.get(o.externalId!);
    if (!blocks) {
      blocks = parseBlockSet(external.get(o.externalId!)!);
      blockCache.set(o.externalId!, blocks);
    }
    let damaged = 0;
    for (const b of blocks) {
      if (!b.zlib) {
        o.hashes.set(b.index, 'empty');
        continue;
      }
      const tx = b.index % o.columns;
      const ty = Math.floor(b.index / o.columns);
      if (ty >= o.rows || ty * TILE >= height) continue;
      try {
        layer.surface.writeRect({ x: tx * TILE, y: ty * TILE, w: TILE, h: TILE }, decodeBlockPixels(await inflateBlock(b.zlib)));
        // Fingerprint what the surface kept (pixels past the canvas edge are not): "unchanged" means unchanged there.
        o.hashes.set(b.index, tileHash(layer.surface.get(tx, ty)));
      } catch {
        damaged++;
      }
    }
    if (damaged) {
      o.editable = false;
      warnings.push(`"${layer.name}": ${damaged} bloque(s) de píxeles no se pudieron descomprimir y quedaron vacíos; la capa no se reescribirá al guardar.`);
    }
  };

  const seen = new Set<number>();
  const unknownModes = new Set<number>();
  const build = async (first: number, parent: number | null): Promise<void> => {
    // `first` is the BOTTOM child; LayerNextIndex goes up to the next sibling.
    for (let cur: number | null = first; cur !== null && cur > 0 && seen.size <= MAX_LAYERS; ) {
      const row = layers.get(cur);
      if (!row || seen.has(cur)) break;
      seen.add(cur);
      const type = sqlInt(row.LayerType) ?? 0;
      const name = sqlText(row.LayerName) ?? 'Capa';
      const folder = (sqlInt(row.LayerFolder) ?? 0) !== 0;
      const isPaper = !folder && type === TYPE_PAPER;
      const l = newLayer(doc, name, folder ? 'folder' : isPaper ? 'paper' : 'raster');
      l.parent = parent;
      const opacity = sqlInt(row.LayerOpacity) ?? 256;
      l.opacity = Math.min(1, Math.max(0, opacity / 256));
      const visibility = sqlInt(row.LayerVisibility) ?? 1;
      l.visible = (visibility & 1) === 1;
      const clip = sqlInt(row.LayerClip) ?? 0;
      l.clip = clip !== 0;
      const composite = sqlInt(row.LayerComposite) ?? 0;
      if (composite !== 0 && !(folder && composite === 30)) unknownModes.add(composite);
      const o: ClipLayerOrigin = { mainId: cur, name, kind: l.kind, opacity, visibility, clip, composite, externalId: null, stored: false, columns, rows, hashes: new Map(), editable: false };
      if (sqlInt(row.LayerLayerMaskMipmap)) warnings.push(`"${name}": la máscara de la capa no se importó (se conserva en el archivo).`);
      if (folder) {
        l.through = sqlInt(row.LayerFolderThrough) !== 0;
        const child = sqlInt(row.LayerFirstChildIndex);
        // A folder's members are listed right below it in the document, so they go in first.
        if (child) await build(child, l.id);
        doc.layers.push(l);
        origin.layers.set(l.id, o);
        cur = sqlInt(row.LayerNextIndex);
        continue;
      }
      if (isPaper) {
        if (sqlInt(row.DrawColorEnable) !== 0) l.paperColor = [channel(row.DrawColorMainRed), channel(row.DrawColorMainGreen), channel(row.DrawColorMainBlue)];
      } else {
        const full = fullSize(sqlInt(row.LayerRenderMipmap));
        if (full && type === TYPE_RASTER) {
          o.externalId = full.id;
          o.stored = full.stored;
          o.columns = full.columns;
          o.rows = full.rows;
          o.editable = full.columns === columns && full.rows === rows;
          if (!o.editable) warnings.push(`"${name}": su cuadrícula de bloques no coincide con la del lienzo; se lee pero no se reescribirá al guardar.`);
          if (full.stored && options.pixels !== false) await paint(l, o);
        } else {
          warnings.push(`"${name}": no se encontraron sus píxeles (puede ser una capa vectorial, de texto u otro tipo no admitido); queda vacía aquí y se conserva tal cual en el archivo.`);
        }
      }
      doc.layers.push(l);
      origin.layers.set(l.id, o);
      cur = sqlInt(row.LayerNextIndex);
    }
  };

  const rootRow = layers.get(sqlInt(canvas?.CanvasRootFolder) ?? -1);
  const first = sqlInt(rootRow?.LayerFirstChildIndex);
  if (first) await build(first, null);
  else warnings.push('No se pudo recorrer el árbol de capas.');
  if (unknownModes.size) {
    warnings.push(`Modos de mezcla sin verificar (${[...unknownModes].join(', ')}): se muestran como Normal aquí, pero el archivo conserva el original.`);
  }

  const hasPixels = doc.layers.some((l) => !l.surface.isEmpty || l.kind === 'paper');
  if (!hasPixels && codecs && db.has('CanvasPreview')) {
    // No layer could be read: fall back to the preview picture the file carries.
    for (const row of db.rows('CanvasPreview')) {
      const png = Object.values(row).find((v): v is Uint8Array => v instanceof Uint8Array && v[0] === 0x89 && v[1] === 0x50);
      if (!png) continue;
      try {
        const img = await codecs.decodePng(png);
        const l = newLayer(doc, 'Vista previa');
        l.surface.writeRect({ x: 0, y: 0, w: img.width, h: img.height }, img.data);
        doc.layers = [l];
        origin.layers.clear();
        warnings.push('No se pudieron leer las capas: se importó solo la vista previa del archivo.');
        break;
      } catch {
        // try the next picture
      }
    }
  }
  if (doc.layers.length === 0) doc.layers.push(newLayer(doc, 'Capa 1'));
  doc.activeId = doc.layers[doc.layers.length - 1]!.id;
  origin.structure = structureOf(doc);
  if (origin.layers.size) origins.set(doc, origin);
  return { value: doc, warnings };
}
