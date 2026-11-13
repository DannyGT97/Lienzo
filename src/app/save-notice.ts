/**
 * What the person is told when a document or picture was written, or could not be. Pure: the save flow reports what
 * happened (`SavedResult`) and this turns it into a notice, so every kind of save says the same things the same way:
 * what was done, where the file went, how big it is, and what the format could not keep.
 *
 * Where a file went is told as far as the system lets us know it:
 *  - the desktop app has the full path;
 *  - Android only gives an opaque content address, which says nothing, so only the file name is shown;
 *  - a browser knows the name of the file it was given, or that it went to the downloads.
 */
import type { FilePlatform, FileRef } from './file-io';
import { formatBytes } from './memory-info';
import type { NoticeAction, NoticeLevel, NoticeSpec } from './notify';
import { formatInfo, type SaveFormat } from './save-formats';

export type SaveStep = 'save' | 'saveAs' | 'copy' | 'export';

export interface SavedResult {
  step: SaveStep;
  format: SaveFormat;
  /** The name asked for, used when the system gave no file back (a plain download). */
  name: string;
  ref: FileRef | null;
  size: number;
  /** What the format could not keep. */
  warnings: string[];
}

export interface SaveFailure {
  step: SaveStep;
  message: string;
  /** Repeat the step that failed. */
  retry: () => void;
  /** Offer another place when the same one just failed (not for a step that already asks where). */
  saveAs?: () => void;
}

export interface NoticeText {
  level: NoticeLevel;
  title: string;
  spec: NoticeSpec;
}

const TITLE: Record<SaveStep, string> = { save: 'Guardado', saveAs: 'Guardado', copy: 'Copia guardada', export: 'Imagen exportada' };
const FAILED: Record<SaveStep, string> = { save: 'No se pudo guardar', saveAs: 'No se pudo guardar', copy: 'No se pudo guardar la copia', export: 'No se pudo exportar la imagen' };

export const CLIP_NOTE = 'Lienzo escribe el .clip modificando el archivo original; ábrelo en Clip Studio para comprobarlo antes de dejar de usar el original.';

/** The line that says where the file is, and the words that go with it in the small grey line. */
function whereLine(r: SavedResult, platform: FilePlatform): { line: string; place?: string } {
  if (!r.ref) return { line: r.name, place: 'en las descargas del navegador' };
  if (r.ref.kind === 'tauri' && platform === 'desktop') return { line: r.ref.path };
  return { line: r.ref.name, place: platform === 'android' ? 'en la carpeta que elegiste' : 'en el lugar que elegiste' };
}

const count = (n: number): string => `${n} aviso${n > 1 ? 's' : ''}`;

/** `clipNote` adds the .clip warning (once per document); the caller decides when it is still news. */
export function savedNotice(r: SavedResult, platform: FilePlatform, opts: { clipNote?: boolean } = {}): NoticeText {
  const where = whereLine(r, platform);
  const lines = [where.line];
  if (r.step === 'copy') lines.push('El documento sigue asociado a su archivo de trabajo.');
  if (r.step === 'export') {
    if (r.format === 'jpg' || r.format === 'bmp') lines.push('La transparencia quedó sobre fondo blanco.');
    lines.push('El documento no cambia.');
  }
  const meta = [formatBytes(r.size), `.${formatInfo(r.format).ext}`, where.place].filter(Boolean).join(' · ');
  const warnings = opts.clipNote && r.format === 'clip' ? [...r.warnings, CLIP_NOTE] : r.warnings;
  if (warnings.length) {
    return { level: 'warning', title: `${TITLE[r.step]} con ${count(warnings.length)}`, spec: { detail: [...lines, ...warnings], meta } };
  }
  return { level: 'success', title: TITLE[r.step], spec: { detail: lines, meta } };
}

export function failedNotice(f: SaveFailure): NoticeText {
  const actions: NoticeAction[] = [{ label: 'Reintentar', run: f.retry }];
  if (f.saveAs) actions.push({ label: 'Guardar como…', run: f.saveAs });
  return { level: 'error', title: FAILED[f.step], spec: { detail: f.message, actions } };
}

/** The file cannot be overwritten (no write permission): nothing was written and a place is asked for next. */
export function deniedNotice(fileName: string): NoticeText {
  return { level: 'warning', title: 'No se puede sobrescribir', spec: { detail: [fileName, 'El sistema no da permiso de escritura. Elige dónde guardar.'], persist: false } };
}
