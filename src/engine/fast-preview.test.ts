import { describe, expect, it } from 'vitest';
import { addLayer, createDocument } from './document';
import { exportOra, readOraPreview, type OraCodecs } from './ora-file';
import { encodePng } from './png-encode';
import { exportPsd, readPsdPreview } from './psd';
import { fillLayer } from './test-utils';

// The pictures that formats keep of their page, read without touching a single layer.
describe('quick previews', () => {
  it('a PSD gives its merged picture, and nothing when the page is blank', async () => {
    const doc = createDocument(40, 30, 300);
    const l = addLayer(doc, 'Dibujo');
    fillLayer(l, [200, 30, 20, 255]);
    const merged = readPsdPreview((await exportPsd(doc)).value);
    expect(merged).not.toBeNull();
    expect([merged!.width, merged!.height]).toEqual([40, 30]);
    expect(Array.from(merged!.data.subarray(0, 4))).toEqual([200, 30, 20, 255]);

    const blank = createDocument(8, 8, 300);
    blank.layers.forEach((x) => (x.visible = false));
    expect(readPsdPreview((await exportPsd(blank)).value)).toBeNull();
    expect(readPsdPreview(new Uint8Array(20).buffer)).toBeNull(); // not a PSD at all
  });

  it('an OpenRaster file gives its merged image without reading the layers', async () => {
    const doc = createDocument(32, 24, 300);
    fillLayer(addLayer(doc, 'Dibujo'), [10, 120, 240, 255]);
    const codecs: OraCodecs = {
      encodePng: (w, h, rgba) => encodePng(w, h, rgba),
      decodePng: async () => {
        throw new Error('the layers must not be decoded');
      },
    };
    const ora = (await exportOra(doc, codecs)).value;
    const png = await readOraPreview(ora as Uint8Array);
    expect(png).not.toBeNull();
    expect(Array.from(png!.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(await readOraPreview(new Uint8Array(30))).toBeNull();
  });
});
