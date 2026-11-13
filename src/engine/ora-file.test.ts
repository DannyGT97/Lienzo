import { describe, expect, it } from 'vitest';
import { exportOra, importOra, looksLikeOra, type OraCodecs } from './ora-file';
import { addLayer, createDocument, newLayer } from './document';
import { bufPixel, fillLayer, setPixel } from './test-utils';
import { crc32, readZip, writeZip } from './zip';

// A stand-in for PNG: the format logic is what is under test here, not the codec.
const codecs: OraCodecs = {
  async encodePng(w, h, rgba) {
    const out = new Uint8Array(8 + rgba.length);
    new DataView(out.buffer).setUint32(0, w);
    new DataView(out.buffer).setUint32(4, h);
    out.set(rgba, 8);
    return out;
  },
  async decodePng(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint32(0), height: dv.getUint32(4), data: new Uint8ClampedArray(bytes.slice(8)) };
  },
};

function sample() {
  const doc = createDocument(8, 6, 300);
  doc.layers[0]!.name = 'Fondo & <papel>';
  fillLayer(doc.layers[0]!, [255, 255, 255, 255]);
  const folder = newLayer(doc, 'Grupo', 'folder');
  const inner = newLayer(doc, 'Sombra');
  inner.parent = folder.id;
  inner.blend = 'multiply';
  inner.opacity = 0.4;
  inner.visible = false;
  setPixel(inner, 3, 2, [10, 20, 30, 200]);
  folder.opacity = 0.75;
  folder.through = false;
  doc.layers.push(inner, folder);
  const top = addLayer(doc, 'Tinta');
  setPixel(top, 6, 5, [255, 0, 0, 255]);
  return doc;
}

describe('OpenRaster', () => {
  it('writes a ZIP whose first entry is the uncompressed mimetype', async () => {
    const { value } = await exportOra(sample(), codecs);
    expect(looksLikeOra(value)).toBe(true);
    const names = (await readZip(value)).map((e) => e.name);
    expect(names[0]).toBe('mimetype');
    expect(names).toContain('stack.xml');
    expect(names).toContain('mergedimage.png');
  });

  it('round-trips layers, folders, order, modes, opacity, visibility and pixels', async () => {
    const src = sample();
    const { value: file, warnings } = await exportOra(src, codecs);
    expect(warnings).toEqual([]);
    const { value: back, warnings: w2 } = await importOra(file, codecs);
    expect(w2).toEqual([]);
    expect([back.width, back.height, back.dpi]).toEqual([8, 6, 300]);
    expect(back.layers.map((l) => l.name)).toEqual(['Fondo & <papel>', 'Sombra', 'Grupo', 'Tinta']);
    const [bg, shade, group, ink] = back.layers;
    expect(group!.kind).toBe('folder');
    expect(group!.opacity).toBe(0.75);
    expect(group!.through).toBe(false);
    expect(shade!.parent).toBe(group!.id);
    expect(shade!.blend).toBe('multiply');
    expect(shade!.opacity).toBe(0.4);
    expect(shade!.visible).toBe(false);
    const px = (l: typeof bg, x: number, y: number) => bufPixel(l!.surface.readRect({ x, y, w: 1, h: 1 }), 1, 0, 0);
    expect(px(shade, 3, 2)).toEqual([10, 20, 30, 200]);
    expect(px(ink, 6, 5)).toEqual([255, 0, 0, 255]);
    expect(px(bg, 0, 0)).toEqual([255, 255, 255, 255]);
  });

  it('says what OpenRaster cannot hold', async () => {
    const doc = sample();
    doc.layers[3]!.blend = 'hardMix';
    doc.layers[3]!.clip = true;
    const { warnings } = await exportOra(doc, codecs);
    expect(warnings.some((w) => /hardMix/.test(w))).toBe(true);
    expect(warnings.some((w) => /ajuste a la capa inferior/.test(w))).toBe(true);
  });

  it('refuses archives that are not OpenRaster and survives a missing layer image', async () => {
    await expect(importOra(writeZip([{ name: 'a.txt', data: new Uint8Array(3) }]), codecs)).rejects.toThrow(/stack\.xml/);
    const xml = '<image w="4" h="4"><stack><layer name="A" src="data/x.png" x="0" y="0"/></stack></image>';
    const { value, warnings } = await importOra(writeZip([{ name: 'stack.xml', data: new TextEncoder().encode(xml) }]), codecs);
    expect(value.layers.length).toBe(1);
    expect(warnings.some((w) => /falta/.test(w))).toBe(true);
    const huge = '<image w="99999" h="99999"><stack/></image>';
    await expect(importOra(writeZip([{ name: 'stack.xml', data: new TextEncoder().encode(huge) }]), codecs)).rejects.toThrow(/tamaño/);
  });
});

describe('zip', () => {
  it('round-trips entries and detects damage', async () => {
    const data = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
    const zip = writeZip([{ name: 'ñ/uno.bin', data }, { name: 'dos', data: new Uint8Array(0) }]);
    const back = await readZip(zip);
    expect(back.map((e) => e.name)).toEqual(['ñ/uno.bin', 'dos']);
    expect(Array.from(back[0]!.data)).toEqual(Array.from(data));
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const broken = zip.slice();
    broken[40]! ^= 1;
    await expect(readZip(broken)).rejects.toThrow();
    await expect(readZip(zip.subarray(0, 20))).rejects.toThrow(/ZIP/);
  });
});
