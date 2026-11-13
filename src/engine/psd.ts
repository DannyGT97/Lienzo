import { initializeCanvas, readPsd, writePsd, type BlendMode as PsdBlend, type Layer as PsdLayer, type Psd } from 'ag-psd';
import type { BlendMode } from './blend';
import { flattenRegion } from './composite';
import { createDocument, newLayer, type Document, type Layer, type LayerMask } from './document';
import { layerTree, type TreeNode } from './layer-tree';
import { TILE, TILE_BYTES, TiledSurface, type Rect } from './tiles';

// ag-psd allocates pixel buffers through a canvas factory. Browsers get one
// automatically; outside a DOM (tests, Node tooling) plain typed arrays are enough
// because we only use the `imageData` paths, never canvases.
if (typeof document === 'undefined') {
  const plain = (width: number, height: number) =>
    ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as unknown as ImageData;
  initializeCanvas(plain as unknown as Parameters<typeof initializeCanvas>[0], plain);
}

/** Our mode -> PSD mode. `approx` marks modes PSD has no exact equivalent for. */
const TO_PSD: Record<BlendMode, { mode: PsdBlend; approx?: boolean }> = {
  normal: { mode: 'normal' },
  darken: { mode: 'darken' },
  multiply: { mode: 'multiply' },
  colorBurn: { mode: 'color burn' },
  linearBurn: { mode: 'linear burn' },
  subtract: { mode: 'subtract' },
  darkerColor: { mode: 'darker color' },
  lighten: { mode: 'lighten' },
  screen: { mode: 'screen' },
  colorDodge: { mode: 'color dodge' },
  glowDodge: { mode: 'color dodge', approx: true },
  add: { mode: 'linear dodge' },
  addGlow: { mode: 'linear dodge', approx: true },
  lighterColor: { mode: 'lighter color' },
  overlay: { mode: 'overlay' },
  softLight: { mode: 'soft light' },
  hardLight: { mode: 'hard light' },
  vividLight: { mode: 'vivid light' },
  linearLight: { mode: 'linear light' },
  pinLight: { mode: 'pin light' },
  hardMix: { mode: 'hard mix' },
  difference: { mode: 'difference' },
  exclusion: { mode: 'exclusion' },
  hue: { mode: 'hue' },
  saturation: { mode: 'saturation' },
  color: { mode: 'color' },
  luminosity: { mode: 'luminosity' },
  divide: { mode: 'divide' },
};

const FROM_PSD: Partial<Record<PsdBlend, BlendMode>> = {
  normal: 'normal',
  darken: 'darken',
  multiply: 'multiply',
  'color burn': 'colorBurn',
  'linear burn': 'linearBurn',
  subtract: 'subtract',
  subtraction: 'subtract',
  'darker color': 'darkerColor',
  lighten: 'lighten',
  screen: 'screen',
  'color dodge': 'colorDodge',
  'linear dodge': 'add',
  'lighter color': 'lighterColor',
  overlay: 'overlay',
  'soft light': 'softLight',
  'hard light': 'hardLight',
  'vivid light': 'vividLight',
  'linear light': 'linearLight',
  'pin light': 'pinLight',
  'hard mix': 'hardMix',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  divide: 'divide',
};

export interface PsdResult<T> {
  value: T;
  /** Things that could not be represented faithfully. */
  warnings: string[];
}

/** Above this many pixels the flattened preview is left out of the file (it would need one huge buffer). */
const COMPOSITE_LIMIT = 40_000_000;

/** Smallest rectangle (whole tiles, clipped to the page) that holds every tile a mask stores. */
function maskBounds(doc: Document, m: LayerMask): Rect | null {
  let tx0 = Infinity;
  let ty0 = Infinity;
  let tx1 = -Infinity;
  let ty1 = -Infinity;
  for (const [tx, ty] of m.surface.entries()) {
    tx0 = Math.min(tx0, tx);
    ty0 = Math.min(ty0, ty);
    tx1 = Math.max(tx1, tx);
    ty1 = Math.max(ty1, ty);
  }
  if (tx1 < tx0) return null;
  const x = tx0 * TILE;
  const y = ty0 * TILE;
  return { x, y, w: Math.min(doc.width, (tx1 + 1) * TILE) - x, h: Math.min(doc.height, (ty1 + 1) * TILE) - y };
}

/** `large` writes a PSB (version 2 of the format: 32-bit sizes become 64-bit, so pages beyond 30 000 px fit). */
export function exportPsd(doc: Document, options: { large?: boolean } = {}): PsdResult<ArrayBuffer> {
  const warnings: string[] = [];
  const full: Rect = { x: 0, y: 0, w: doc.width, h: doc.height };
  // PSD adjustment layers are a different thing from Lienzo's: they are left out (the flattened preview does include them).
  const exportable = (nodes: readonly TreeNode[]): TreeNode[] =>
    nodes.filter((n) => {
      if (n.layer.kind !== 'adjust') return true;
      warnings.push(`"${n.layer.name}": la capa de ajuste no se exportó a PSD (solo se ve reflejada en la imagen compuesta).`);
      return false;
    });
  const convert = (node: TreeNode): PsdLayer => {
    const l = node.layer;
    if (l.kind !== 'raster' && l.kind !== 'paper' && l.kind !== 'folder') {
      warnings.push(`"${l.name}": la capa de ${l.kind} se exportó rasterizada (ya no se podrá editar como objeto).`);
    }
    if (l.role !== 'normal') warnings.push(`"${l.name}": la capa de ${l.role === 'draft' ? 'borrador' : 'referencia'} se exportó como capa normal.`);
    const m = TO_PSD[l.blend];
    if (m.approx) warnings.push(`"${l.name}": el modo ${l.blend} se exportó como "${m.mode}" (aproximado).`);
    const layer: PsdLayer = {
      name: l.name,
      opacity: l.opacity,
      hidden: !l.visible,
      clipping: l.clip,
      transparencyProtected: l.lockAlpha,
      blendMode: m.mode,
      top: 0,
      left: 0,
    };
    if (l.mask) {
      const b = maskBounds(doc, l.mask);
      layer.mask = { top: b?.y ?? 0, left: b?.x ?? 0, bottom: b ? b.y + b.h : 0, right: b ? b.x + b.w : 0, defaultColor: l.mask.base, disabled: !l.mask.enabled };
      if (b) {
        // PSD keeps the mask in the red channel.
        const gray = new Uint8ClampedArray(b.w * b.h * 4);
        for (let y = 0; y < b.h; y++) {
          for (let x = 0; x < b.w; x++) {
            const tile = l.mask.surface.get(Math.floor((b.x + x) / TILE), Math.floor((b.y + y) / TILE));
            const i = (y * b.w + x) * 4;
            gray[i] = tile ? tile[(((b.y + y) % TILE) * TILE + ((b.x + x) % TILE)) * 4 + 3]! : l.mask.base;
            gray[i + 3] = 255;
          }
        }
        layer.mask.imageData = { width: b.w, height: b.h, data: gray };
      }
    }
    if (l.kind === 'folder') {
      layer.children = exportable(node.children).map(convert);
      layer.opened = l.open;
      layer.blendMode = l.through ? 'pass through' : m.mode;
      return layer;
    }
    // Only the part of the layer that has pixels is written; a blank layer stays empty.
    let bounds: Rect | null;
    let data: Uint8ClampedArray | null = null;
    if (l.kind === 'paper') {
      bounds = full;
      const c = l.paperColor ?? [255, 255, 255];
      data = new Uint8ClampedArray(full.w * full.h * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = c[0];
        data[i + 1] = c[1];
        data[i + 2] = c[2];
        data[i + 3] = 255;
      }
    } else {
      bounds = l.surface.contentBounds();
      if (bounds) data = l.surface.readRect(bounds);
    }
    if (bounds && data) {
      layer.left = bounds.x;
      layer.top = bounds.y;
      layer.imageData = { width: bounds.w, height: bounds.h, data };
    }
    return layer;
  };
  const children: PsdLayer[] = exportable(layerTree(doc.layers)).map(convert);

  const psd: Psd = { width: doc.width, height: doc.height, children };
  if (doc.width * doc.height <= COMPOSITE_LIMIT) {
    // The flattened preview is what other programs show, so it leaves out drafts and references like any output.
    psd.imageData = { width: doc.width, height: doc.height, data: flattenRegion(doc, full, { output: true }) };
  } else {
    warnings.push('El documento es muy grande: el PSD no incluye la imagen compuesta (sí las capas).');
  }
  const out = writePsd(psd, { trimImageData: false, generateThumbnail: false, psb: options.large === true });
  // writePsd returns an ArrayBuffer; copy so the result never aliases an internal buffer.
  return { value: out.slice(0), warnings };
}

/**
 * The finished page as a PSD (or PSB) with a single layer: the merged picture, with drafts and reference layers left out
 * like in any output. Unlike `exportPsd` nothing of the layer structure goes in, and the file's own preview is that same
 * picture. Throws when the page is too big to be merged in one block of memory.
 */
export function exportFlatPsd(doc: Document, options: { large?: boolean } = {}): PsdResult<ArrayBuffer> {
  if (doc.width * doc.height > COMPOSITE_LIMIT) {
    throw new Error(`El documento es demasiado grande para exportarlo como PSD de una capa (más de ${COMPOSITE_LIMIT / 1_000_000} megapíxeles).`);
  }
  const data = flattenRegion(doc, { x: 0, y: 0, w: doc.width, h: doc.height }, { output: true });
  const merged: PsdLayer = { name: 'Imagen combinada', left: 0, top: 0, imageData: { width: doc.width, height: doc.height, data } };
  const psd: Psd = { width: doc.width, height: doc.height, children: [merged], imageData: { width: doc.width, height: doc.height, data } };
  const out = writePsd(psd, { trimImageData: false, generateThumbnail: false, psb: options.large === true });
  return { value: out.slice(0), warnings: [] };
}

export function importPsd(buffer: ArrayBuffer): PsdResult<Document> {
  const warnings: string[] = [];
  const psd = readPsd(buffer, { useImageData: true, skipThumbnail: true });
  if (psd.bitsPerChannel !== undefined && psd.bitsPerChannel !== 8) {
    throw new Error(`Solo se admiten PSD de 8 bits por canal (este tiene ${psd.bitsPerChannel}).`);
  }
  const doc = createDocument(psd.width, psd.height);
  doc.layers = [];

  // Members are pushed before their folder, which is the order the layer list keeps.
  const walk = (layers: PsdLayer[], parent: number | null): void => {
    for (const src of layers) {
      if (src.children) {
        const mode = src.blendMode ?? 'pass through';
        const folder = newLayer(doc, src.name ?? 'Carpeta', 'folder');
        folder.parent = parent;
        folder.visible = !src.hidden;
        folder.opacity = src.opacity ?? 1;
        folder.open = src.opened ?? true;
        folder.through = mode === 'pass through';
        if (!folder.through) {
          const blend = FROM_PSD[mode];
          if (blend) folder.blend = blend;
          else warnings.push(`Carpeta "${folder.name}": modo ${mode} no soportado; se usó Normal.`);
        }
        folder.clip = !!src.clipping;
        walk(src.children, folder.id);
        const mask = toMask(doc, src, warnings);
        if (mask) folder.mask = mask;
        doc.layers.push(folder);
        continue;
      }
      const layer = toLayer(doc, src, warnings);
      if (layer) {
        layer.parent = parent;
        doc.layers.push(layer);
      }
    }
  };
  walk(psd.children ?? [], null);

  const hasPixels = (d: ArrayLike<number>): boolean => {
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
    return false;
  };
  if (psd.imageData && doc.layers.every((l) => l.kind !== 'paper' && l.surface.isEmpty) && hasPixels(psd.imageData.data)) {
    // No layer carries pixels but the file has a flattened image: use it as the only layer.
    doc.layers = [];
    const layer = newLayer(doc, 'Fondo');
    layer.surface.writeRect({ x: 0, y: 0, w: doc.width, h: doc.height }, psd.imageData.data);
    doc.layers.push(layer);
  }
  if (doc.layers.length === 0) doc.layers.push(newLayer(doc, 'Capa 1'));
  doc.activeId = doc.layers[doc.layers.length - 1]!.id;
  return { value: doc, warnings };
}

/** The layer mask of a PSD layer (its red channel), or null when it has none. */
function toMask(doc: Document, src: PsdLayer, warnings: string[]): LayerMask | null {
  const m = src.mask;
  if (!m) return null;
  const base: 0 | 255 = (m.defaultColor ?? 0) >= 128 ? 255 : 0;
  const surface = new TiledSurface(doc.width, doc.height);
  const data = m.imageData;
  if (data && data.width && data.height) {
    const ox = (m.left ?? 0) + (m.positionRelativeToLayer ? (src.left ?? 0) : 0);
    const oy = (m.top ?? 0) + (m.positionRelativeToLayer ? (src.top ?? 0) : 0);
    const x0 = Math.max(0, ox);
    const y0 = Math.max(0, oy);
    const x1 = Math.min(doc.width, ox + data.width);
    const y1 = Math.min(doc.height, oy + data.height);
    for (let ty = Math.floor(y0 / TILE); y1 > y0 && ty <= Math.floor((y1 - 1) / TILE); ty++) {
      for (let tx = Math.floor(x0 / TILE); x1 > x0 && tx <= Math.floor((x1 - 1) / TILE); tx++) {
        const tile = new Uint8ClampedArray(TILE_BYTES).fill(255);
        for (let i = 3; i < tile.length; i += 4) tile[i] = base;
        for (let y = Math.max(y0, ty * TILE); y < Math.min(y1, (ty + 1) * TILE); y++) {
          for (let x = Math.max(x0, tx * TILE); x < Math.min(x1, (tx + 1) * TILE); x++) {
            tile[((y - ty * TILE) * TILE + (x - tx * TILE)) * 4 + 3] = data.data[((y - oy) * data.width + (x - ox)) * 4]!;
          }
        }
        surface.put(tx, ty, tile);
        surface.dropIfUniform(tx, ty, base);
      }
    }
  }
  if (m.userMaskDensity !== undefined && m.userMaskDensity < 1) warnings.push(`"${src.name}": se ignoró la densidad de la máscara.`);
  return { surface, base, enabled: !m.disabled };
}

function toLayer(doc: Document, src: PsdLayer, warnings: string[]): Layer | null {
  const opacity = src.opacity ?? 1;
  const hidden = !!src.hidden;
  const name = src.name ?? 'Capa';
  const mode = src.blendMode ?? 'normal';
  let blend = FROM_PSD[mode];
  if (!blend) {
    warnings.push(`"${name}": modo ${mode} no soportado; se usó Normal.`);
    blend = 'normal';
  }
  // A layer with no pixels is either genuinely empty (keep it) or non-raster content we cannot show.
  if (!src.imageData && (src.text || src.adjustment || src.vectorMask)) {
    warnings.push(`"${name}": capa de texto, ajuste o forma sin píxeles; se omitió.`);
    return null;
  }

  const layer = newLayer(doc, name);
  layer.visible = !hidden;
  layer.opacity = opacity;
  layer.blend = blend;
  layer.clip = !!src.clipping;
  layer.lockAlpha = !!src.transparencyProtected;
  const mask = toMask(doc, src, warnings);
  if (mask) layer.mask = mask;

  if (!src.imageData) return layer;
  const { width: sw, height: sh, data } = src.imageData;
  // A layer that is one opaque colour over the whole page is a paper: keep it as a colour, not as pixels.
  const colour = (src.left ?? 0) <= 0 && (src.top ?? 0) <= 0 && sw >= doc.width && sh >= doc.height ? uniformOpaque(data) : null;
  if (colour) {
    layer.kind = 'paper';
    layer.paperColor = colour;
    layer.clip = false;
    return layer;
  }
  // writeRect clips to the canvas, so layers hanging off the page are fine.
  layer.surface.writeRect({ x: src.left ?? 0, y: src.top ?? 0, w: sw, h: sh }, data);
  return layer;
}

/** The colour of a buffer whose pixels are all the same fully opaque colour, or null. */
function uniformOpaque(data: ArrayLike<number>): [number, number, number] | null {
  if (data.length < 4 || data[3] !== 255) return null;
  const r = data[0]!;
  const g = data[1]!;
  const b = data[2]!;
  for (let i = 4; i < data.length; i += 4) {
    if (data[i] !== r || data[i + 1] !== g || data[i + 2] !== b || data[i + 3] !== 255) return null;
  }
  return [r, g, b];
}
