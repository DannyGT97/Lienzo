import { describe, expect, it } from 'vitest';
import { SAVE_FORMATS, chosenFormat, formatInfo, formatOfName, formatsFor, isLayered, nameFor, saveFilters } from './save-formats';

describe('save formats', () => {
  it('offers every format of the Clip Studio list plus Lienzo and OpenRaster', () => {
    const exts = SAVE_FORMATS.map((f) => f.ext).sort();
    expect(exts).toEqual(['bmp', 'clip', 'jpg', 'lienzo', 'ora', 'png', 'psb', 'psd', 'tga', 'tif', 'webp']);
  });

  it('tells the format from the extension of a name, case-insensitively and with aliases', () => {
    expect(formatOfName('Dibujo.CLIP')).toBe('clip');
    expect(formatOfName('a.b.psb')).toBe('psb');
    expect(formatOfName('foto.jpeg')).toBe('jpg');
    expect(formatOfName('scan.TIFF')).toBe('tif');
    expect(formatOfName('notas.txt')).toBeNull();
    expect(formatOfName('sin extension')).toBeNull();
  });

  it('keeps the layers only in the layered formats', () => {
    for (const id of ['lienzo', 'clip', 'psd', 'psb', 'ora'] as const) expect(isLayered(id)).toBe(true);
    for (const id of ['png', 'jpg', 'webp', 'bmp', 'tif', 'tga'] as const) expect(isLayered(id)).toBe(false);
  });

  it('keeps documents (with layers) and pictures (merged) apart; only PSD is in both, as a different file', () => {
    expect(formatsFor('document').map((f) => f.id)).toEqual(['lienzo', 'clip', 'psd', 'psb', 'ora']);
    expect(formatsFor('image').map((f) => f.id)).toEqual(['psd', 'bmp', 'jpg', 'png', 'tif', 'tga', 'webp']);
    expect(formatInfo('psd').imageLabel).toMatch(/una sola capa/);
  });

  it('puts the document own format first in the type list, so the dialog starts on it', () => {
    const filters = saveFilters('clip');
    expect(filters[0]!.extensions).toEqual(['clip']);
    expect(filters.map((f) => f.extensions[0])).toEqual(['clip', 'lienzo', 'psd', 'psb', 'ora']);
    expect(new Set(filters.map((f) => f.name)).size).toBe(filters.length);
    expect(saveFilters('png', undefined, 'image')[0]!.extensions).toEqual(['png']);
  });

  it('lists no flat picture for a document save and no layered format for a picture export', () => {
    const doc = saveFilters('psd').flatMap((f) => f.extensions);
    for (const flat of ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'tga']) expect(doc).not.toContain(flat);
    const img = saveFilters('png', undefined, 'image').flatMap((f) => f.extensions);
    for (const layered of ['lienzo', 'clip', 'psb', 'ora']) expect(img).not.toContain(layered);
    // the PSD there is announced as one layer, not as the document
    expect(saveFilters('png', undefined, 'image').find((f) => f.extensions[0] === 'psd')!.name).toMatch(/una sola capa/);
    expect(saveFilters('psd').find((f) => f.extensions[0] === 'psd')!.name).not.toMatch(/una sola capa/);
  });

  it('leaves out the formats the document cannot be saved in, but never its own', () => {
    const noClip = saveFilters('lienzo', (id) => id !== 'clip');
    expect(noClip.some((f) => f.extensions.includes('clip'))).toBe(false);
    expect(saveFilters('clip', () => false)).toHaveLength(1);
  });

  it('names the file with the extension of the chosen format', () => {
    expect(nameFor('Página 1', 'clip')).toBe('Página 1.clip');
    expect(nameFor('Página 1.lienzo', 'psd')).toBe('Página 1.psd');
    expect(nameFor('v1.2 final', 'png')).toBe('v1.2 final.png');
    expect(nameFor('', 'bmp')).toBe('Sin título.bmp');
    expect(formatInfo('psb').label).toBe('Documento grande de Photoshop');
  });

  it('takes the format from the name the person chose, else from where the dialog started', () => {
    expect(chosenFormat('x.psd', 'clip')).toBe('psd');
    expect(chosenFormat('x', 'clip')).toBe('clip');
    expect(chosenFormat('x.unknown', 'ora')).toBe('ora');
  });
});
