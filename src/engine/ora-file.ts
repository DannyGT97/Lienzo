import type { BlendMode } from './blend';
import { flattenRegionAsync, paperPixels } from './composite';
import { noTick, type Tick } from './cooperate';
import { createDocument, newLayer, type Document } from './document';
import type { RawImage } from './image-decode';
import { layerTree, type TreeNode } from './layer-tree';
import type { Rect } from './tiles';
import { readZip, writeZipAsync, type ZipEntry } from './zip';

/**
 * OpenRaster (`.ora`): the open layered-image format Krita, GIMP, MyPaint and others share. A ZIP holding `mimetype`,
 * `stack.xml` (the layer tree), one PNG per layer and a flattened `mergedimage.png`. Reading and writing follow the
 * public specification (openraster.org). PNG coding is injected so the format logic works without a canvas.
 */
export interface OraCodecs {
  /** Turns given to the window while a big file is made (see cooperate.ts). */
  tick?: Tick;
  encodePng(width: number, height: number, rgba: Uint8ClampedArray): Promise<Uint8Array>;
  decodePng(bytes: Uint8Array): Promise<RawImage>;
}

export interface OraResult<T> {
  value: T;
  warnings: string[];
}

/** composite-op values of the specification (plus the ones Krita and GIMP add), both directions. */
const OPS: ReadonlyArray<readonly [BlendMode, string]> = [
  ['normal', 'svg:src-over'],
  ['multiply', 'svg:multiply'],
  ['screen', 'svg:screen'],
  ['overlay', 'svg:overlay'],
  ['darken', 'svg:darken'],
  ['lighten', 'svg:lighten'],
  ['colorDodge', 'svg:color-dodge'],
  ['colorBurn', 'svg:color-burn'],
  ['hardLight', 'svg:hard-light'],
  ['softLight', 'svg:soft-light'],
  ['difference', 'svg:difference'],
  ['exclusion', 'svg:exclusion'],
  ['hue', 'svg:hue'],
  ['saturation', 'svg:saturation'],
  ['color', 'svg:color'],
  ['luminosity', 'svg:luminosity'],
  ['add', 'svg:plus'],
  ['linearBurn', 'svg:linear-burn'],
  ['divide', 'svg:divide'],
  ['subtract', 'svg:subtract'],
];
const TO_OP = new Map(OPS);
const FROM_OP = new Map(OPS.map(([b, o]) => [o, b] as const));
FROM_OP.set('svg:plus', 'add');
FROM_OP.set('svg:lighter', 'add');

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s: string): string =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const utf8 = new TextEncoder();
const num = (n: number): string => String(Math.round(n * 1000) / 1000);

export async function exportOra(doc: Document, codecs: OraCodecs): Promise<OraResult<Uint8Array>> {
  const tick = codecs.tick ?? noTick;
  const warnings: string[] = [];
  const files: ZipEntry[] = [{ name: 'mimetype', data: utf8.encode('image/openraster') }];
  let counter = 0;

  const node = async (n: TreeNode, indent: string): Promise<string> => {
    const l = n.layer;
    const common = `name="${esc(l.name)}" opacity="${num(l.opacity)}" visibility="${l.visible ? 'visible' : 'hidden'}"`;
    const op = TO_OP.get(l.blend);
    if (!op) warnings.push(`"${l.name}": el modo ${l.blend} no existe en OpenRaster; se guardó como Normal.`);
    const comp = `composite-op="${op ?? 'svg:src-over'}"`;
    if (l.kind === 'adjust') warnings.push(`"${l.name}": la capa de ajuste no se guardó en OpenRaster.`);
    if (l.mask) warnings.push(`"${l.name}": OpenRaster no tiene máscaras de capa; la máscara no se guardó.`);
    if (l.clip) warnings.push(`"${l.name}": OpenRaster no tiene ajuste a la capa inferior; se guardó sin él.`);
    if (l.kind === 'folder') {
      const inner = await group(n.children, indent + '  ');
      return `${indent}<stack ${common} ${comp} isolation="${l.through ? 'auto' : 'isolate'}">\n${inner}${indent}</stack>\n`;
    }
    if (l.kind === 'adjust') return '';
    if (l.kind !== 'raster' && l.kind !== 'paper') warnings.push(`"${l.name}": la capa de ${l.kind} se guardó rasterizada.`);
    let bounds: Rect | null;
    let data: Uint8ClampedArray | null = null;
    if (l.kind === 'paper') {
      bounds = { x: 0, y: 0, w: doc.width, h: doc.height };
      const c = l.paperColor ?? [255, 255, 255];
      data = paperPixels(doc.width, doc.height, c);
    } else {
      bounds = l.surface.contentBounds();
      if (bounds) data = await l.surface.readRectAsync(bounds, tick);
    }
    await tick();
    // A layer without pixels still needs a PNG: a 1×1 transparent one.
    const w = bounds?.w ?? 1;
    const h = bounds?.h ?? 1;
    const src = `data/layer${counter++}.png`;
    files.push({ name: src, data: await codecs.encodePng(w, h, data ?? new Uint8ClampedArray(4)) });
    return `${indent}<layer ${common} ${comp} src="${src}" x="${bounds?.x ?? 0}" y="${bounds?.y ?? 0}" />\n`;
  };
  // The specification lists the topmost layer first.
  const group = async (nodes: readonly TreeNode[], indent: string): Promise<string> => {
    let xml = '';
    for (let i = nodes.length - 1; i >= 0; i--) xml += await node(nodes[i]!, indent);
    return xml;
  };

  const body = await group(layerTree(doc.layers), '    ');
  const dpi = Math.round(doc.dpi);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<image version="0.0.3" w="${doc.width}" h="${doc.height}" xres="${dpi}" yres="${dpi}">\n  <stack>\n${body}  </stack>\n</image>\n`;
  files.push({ name: 'stack.xml', data: utf8.encode(xml) });

  const full: Rect = { x: 0, y: 0, w: doc.width, h: doc.height };
  if (doc.width * doc.height <= 40_000_000) {
    files.push({ name: 'mergedimage.png', data: await codecs.encodePng(doc.width, doc.height, await flattenRegionAsync(doc, full, { output: true }, tick)) });
  } else {
    warnings.push('El documento es muy grande: el archivo no incluye la imagen compuesta (sí las capas).');
  }
  return { value: await writeZipAsync(files, tick), warnings };
}

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

/** The tiny part of XML a stack.xml needs: nested elements with attributes, no text content. */
function parseStack(xml: string): XmlNode {
  const root: XmlNode = { tag: '#root', attrs: {}, children: [] };
  const open: XmlNode[] = [root];
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const attr = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const cleaned = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
  for (let m = tag.exec(cleaned); m; m = tag.exec(cleaned)) {
    if (m[1]) {
      if (open.length > 1) open.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (let a = attr.exec(m[3]!); a; a = attr.exec(m[3]!)) attrs[a[1]!] = unesc(a[2] ?? a[3] ?? '');
    const el: XmlNode = { tag: m[2]!, attrs, children: [] };
    open[open.length - 1]!.children.push(el);
    if (!m[4]) open.push(el);
    if (open.length > 64) throw new Error('El archivo OpenRaster tiene capas anidadas en exceso.');
  }
  return root;
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);

export async function importOra(bytes: Uint8Array, codecs: OraCodecs): Promise<OraResult<Document>> {
  const warnings: string[] = [];
  const entries = await readZip(bytes);
  const byName = new Map(entries.map((e) => [e.name.replace(/^\.?\//, ''), e.data] as const));
  const stack = byName.get('stack.xml');
  if (!stack) throw new Error('El archivo OpenRaster no tiene stack.xml.');
  const image = parseStack(new TextDecoder('utf-8').decode(stack)).children.find((c) => c.tag === 'image');
  if (!image) throw new Error('El archivo OpenRaster no tiene un elemento <image>.');
  const width = Math.floor(Number(image.attrs.w));
  const height = Math.floor(Number(image.attrs.h));
  if (!(width > 0 && height > 0) || width * height > 100_000_000) throw new Error('El archivo OpenRaster declara un tamaño de imagen no válido.');
  const dpi = Number(image.attrs.xres);
  const doc = createDocument(width, height, dpi > 0 && dpi < 10_000 ? Math.round(dpi) : undefined);
  doc.layers = [];

  const walk = async (stackEl: XmlNode, parent: number | null): Promise<void> => {
    // Listed top first; the document keeps bottom first.
    for (const el of [...stackEl.children].reverse()) {
      const name = el.attrs.name || (el.tag === 'stack' ? 'Carpeta' : 'Capa');
      const op = el.attrs['composite-op'] ?? 'svg:src-over';
      let blend = FROM_OP.get(op);
      if (!blend) {
        if (el.tag !== 'stack' || op !== 'svg:src-over') warnings.push(`"${name}": modo ${op} no soportado; se usó Normal.`);
        blend = 'normal';
      }
      if (el.tag === 'stack') {
        const folder = newLayer(doc, name, 'folder');
        folder.parent = parent;
        folder.opacity = clamp01(Number(el.attrs.opacity ?? 1));
        folder.visible = el.attrs.visibility !== 'hidden';
        folder.through = el.attrs.isolation !== 'isolate';
        if (!folder.through) folder.blend = blend;
        await walk(el, folder.id);
        doc.layers.push(folder);
      } else if (el.tag === 'layer') {
        const layer = newLayer(doc, name);
        layer.parent = parent;
        layer.opacity = clamp01(Number(el.attrs.opacity ?? 1));
        layer.visible = el.attrs.visibility !== 'hidden';
        layer.blend = blend;
        const src = (el.attrs.src ?? '').replace(/^\.?\//, '');
        const png = byName.get(src);
        if (!png) warnings.push(`"${name}": falta la imagen ${src || '(sin nombre)'} dentro del archivo.`);
        else {
          try {
            const img = await codecs.decodePng(png);
            layer.surface.writeRect({ x: Math.round(Number(el.attrs.x) || 0), y: Math.round(Number(el.attrs.y) || 0), w: img.width, h: img.height }, img.data);
          } catch (err) {
            warnings.push(`"${name}": no se pudo leer su imagen (${err instanceof Error ? err.message : String(err)}).`);
          }
        }
        doc.layers.push(layer);
      }
    }
  };
  const top = image.children.find((c) => c.tag === 'stack');
  if (top) await walk(top, null);
  if (doc.layers.length === 0) doc.layers.push(newLayer(doc, 'Capa 1'));
  doc.activeId = doc.layers[doc.layers.length - 1]!.id;
  return { value: doc, warnings };
}

/** True when the bytes are an OpenRaster ZIP: it starts with a local header and the `mimetype` entry comes first. */
export function looksLikeOra(head: Uint8Array): boolean {
  if (head.length < 38 || head[0] !== 0x50 || head[1] !== 0x4b || head[2] !== 3 || head[3] !== 4) return false;
  const nameLen = head[26]! | (head[27]! << 8);
  const name = new TextDecoder().decode(head.subarray(30, 30 + nameLen));
  if (name !== 'mimetype') return false;
  const extra = head[28]! | (head[29]! << 8);
  const dataAt = 30 + nameLen + extra;
  return new TextDecoder().decode(head.subarray(dataAt, dataAt + 16)) === 'image/openraster';
}

/**
 * The picture an OpenRaster file carries of itself (its thumbnail, or the merged image), as PNG bytes, without reading a single
 * layer. Null when there is none or the file cannot be read.
 */
export async function readOraPreview(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const clean = (n: string): string => n.replace(/^\.?\//, '');
    const entries = await readZip(bytes, (n) => clean(n) === 'Thumbnails/thumbnail.png' || clean(n) === 'mergedimage.png');
    const by = new Map(entries.map((e) => [clean(e.name), e.data] as const));
    return by.get('Thumbnails/thumbnail.png') ?? by.get('mergedimage.png') ?? null;
  } catch {
    return null;
  }
}
