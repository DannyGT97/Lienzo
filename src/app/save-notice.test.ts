import { describe, expect, it } from 'vitest';
import type { FileRef } from './file-io';
import { CLIP_NOTE, deniedNotice, failedNotice, savedNotice, type SavedResult } from './save-notice';

const tauri = (path: string): FileRef => ({ kind: 'tauri', path, name: path.split('/').pop()! });
const result = (over: Partial<SavedResult> = {}): SavedResult => ({ step: 'save', format: 'psd', name: 'Obra.psd', ref: tauri('C:/Work/Obra.psd'), size: 3_400_000, warnings: [], ...over });

describe('savedNotice', () => {
  it('desktop: shows the full path, the size and the format', () => {
    const n = savedNotice(result(), 'desktop');
    expect(n).toMatchObject({ level: 'success', title: 'Guardado', spec: { detail: ['C:/Work/Obra.psd'], meta: '3.2 MB · .psd' } });
  });
  it('android: only the name, never the opaque address', () => {
    const ref: FileRef = { kind: 'tauri', path: 'content://com.android.providers/1026', name: 'Obra.psd' };
    const n = savedNotice(result({ ref }), 'android');
    expect(n.spec.detail).toEqual(['Obra.psd']);
    expect(n.spec.meta).toContain('en la carpeta que elegiste');
    expect(JSON.stringify(n)).not.toContain('content://');
  });
  it('browser: a plain download says it went to the downloads', () => {
    const n = savedNotice(result({ ref: null, name: 'x.png', format: 'png' }), 'browser');
    expect(n.spec.detail).toEqual(['x.png']);
    expect(n.spec.meta).toContain('descargas del navegador');
  });
  it('titles each kind of save', () => {
    expect(savedNotice(result({ step: 'copy' }), 'desktop').title).toBe('Copia guardada');
    expect(savedNotice(result({ step: 'export', format: 'png' }), 'desktop').title).toBe('Imagen exportada');
  });
  it('an export of JPEG or BMP says the transparency went onto white; PNG does not', () => {
    expect(savedNotice(result({ step: 'export', format: 'jpg' }), 'desktop').spec.detail).toContain('La transparencia quedó sobre fondo blanco.');
    expect(savedNotice(result({ step: 'export', format: 'png' }), 'desktop').spec.detail).not.toContain('La transparencia quedó sobre fondo blanco.');
  });
  it('warnings make it a warning that counts them, with the paths first', () => {
    const n = savedNotice(result({ warnings: ['Un efecto de capa no se guardó.', 'Una máscara se aplanó.'] }), 'desktop');
    expect(n.level).toBe('warning');
    expect(n.title).toBe('Guardado con 2 avisos');
    expect(n.spec.detail).toEqual(['C:/Work/Obra.psd', 'Un efecto de capa no se guardó.', 'Una máscara se aplanó.']);
    expect(savedNotice(result({ warnings: ['x'] }), 'desktop').title).toBe('Guardado con 1 aviso');
  });
  it('the .clip note joins the warnings only when asked', () => {
    expect(savedNotice(result({ format: 'clip' }), 'desktop', { clipNote: true })).toMatchObject({ level: 'warning', title: 'Guardado con 1 aviso' });
    expect(savedNotice(result({ format: 'clip' }), 'desktop', { clipNote: true }).spec.detail).toContain(CLIP_NOTE);
    expect(savedNotice(result({ format: 'clip' }), 'desktop').level).toBe('success');
  });
});

describe('failedNotice / deniedNotice', () => {
  it('an error offers Reintentar, and Guardar como… when asked', () => {
    const calls: string[] = [];
    const n = failedNotice({ step: 'save', message: 'disco lleno', retry: () => calls.push('retry'), saveAs: () => calls.push('as') });
    expect(n).toMatchObject({ level: 'error', title: 'No se pudo guardar', spec: { detail: 'disco lleno' } });
    n.spec.actions!.forEach((a) => a.run());
    expect(n.spec.actions!.map((a) => a.label)).toEqual(['Reintentar', 'Guardar como…']);
    expect(calls).toEqual(['retry', 'as']);
    expect(failedNotice({ step: 'export', message: 'm', retry: () => {} }).spec.actions).toHaveLength(1);
  });
  it('a refused overwrite names the file and does not stay forever', () => {
    const n = deniedNotice('Obra.psd');
    expect(n).toMatchObject({ level: 'warning', spec: { persist: false } });
    expect(n.spec.detail).toContain('Obra.psd');
  });
});
