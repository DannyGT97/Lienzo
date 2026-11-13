/**
 * The formats Lienzo writes, in two separate families that the menu keeps apart:
 *  - documents (Lienzo, Clip Studio, Photoshop PSD/PSB, OpenRaster): every exporter keeps the layers, so they are what
 *    "Guardar", "Guardar como…" and "Guardar copia…" offer;
 *  - pictures (PNG, JPEG, WebP, BMP, TIFF, Targa and a one-layer PSD): the finished page merged into one image, what
 *    "Exportar imagen…" offers. They never become the file a document is tied to.
 */
import type { FileFilter } from './file-io';

export type SaveFormat = 'lienzo' | 'clip' | 'psd' | 'psb' | 'ora' | 'png' | 'jpg' | 'webp' | 'bmp' | 'tif' | 'tga';

export interface SaveFormatInfo {
  id: SaveFormat;
  /** Name shown in the type list of the save dialog. */
  label: string;
  /** Extension without the dot, as written to the file. */
  ext: string;
  /** Other extensions that mean the same format when reading a file name. */
  aliases?: string[];
  /** Keeps the layers: it is a document format, offered by "Guardar como…" and "Guardar copia…". */
  layered: boolean;
  /** Can be written as a merged picture: offered by "Exportar imagen…". */
  image: boolean;
  /** Name in the type list of "Exportar imagen…" when it differs (a PSD there has a single layer). */
  imageLabel?: string;
}

/** In the order the type list shows them (the document's own format goes first, see `saveFilters`). */
export const SAVE_FORMATS: readonly SaveFormatInfo[] = [
  { id: 'lienzo', label: 'Documento de Lienzo', ext: 'lienzo', layered: true, image: false },
  { id: 'clip', label: 'Formato de Clip Studio', ext: 'clip', layered: true, image: false },
  { id: 'psd', label: 'Documento de Photoshop', ext: 'psd', layered: true, image: true, imageLabel: 'Photoshop de una sola capa' },
  { id: 'psb', label: 'Documento grande de Photoshop', ext: 'psb', layered: true, image: false },
  { id: 'ora', label: 'OpenRaster', ext: 'ora', layered: true, image: false },
  { id: 'bmp', label: 'BMP', ext: 'bmp', layered: false, image: true },
  { id: 'jpg', label: 'JPEG', ext: 'jpg', aliases: ['jpeg'], layered: false, image: true },
  { id: 'png', label: 'PNG', ext: 'png', layered: false, image: true },
  { id: 'tif', label: 'TIFF', ext: 'tif', aliases: ['tiff'], layered: false, image: true },
  { id: 'tga', label: 'Targa', ext: 'tga', layered: false, image: true },
  { id: 'webp', label: 'WebP', ext: 'webp', layered: false, image: true },
];

const BY_ID = new Map<SaveFormat, SaveFormatInfo>(SAVE_FORMATS.map((f) => [f.id, f]));
const BY_EXT = new Map<string, SaveFormat>(SAVE_FORMATS.flatMap((f) => [f.ext, ...(f.aliases ?? [])].map((e) => [e, f.id] as const)));

export const formatInfo = (id: SaveFormat): SaveFormatInfo => BY_ID.get(id)!;
export const isLayered = (id: SaveFormat): boolean => formatInfo(id).layered;

/** What a save dialog is for: a document with its layers, or a merged picture. */
export type SaveKind = 'document' | 'image';

/** The formats that kind of save offers, in list order. */
export const formatsFor = (kind: SaveKind): SaveFormatInfo[] => SAVE_FORMATS.filter((f) => (kind === 'document' ? f.layered : f.image));

const nameInList = (f: SaveFormatInfo, kind: SaveKind): string => (kind === 'image' ? f.imageLabel ?? f.label : f.label);

/** The format a file name's extension says it is, or null when it is none of ours. */
export function formatOfName(name: string): SaveFormat | null {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return (m && BY_EXT.get(m[1]!.toLowerCase())) || null;
}

/** The name with the extension of `format` (replacing any extension of ours it already had). */
export function nameFor(name: string, format: SaveFormat): string {
  const stem = formatOfName(name) ? name.replace(/\.[a-z0-9]+$/i, '') : name;
  return `${stem || 'Sin título'}.${formatInfo(format).ext}`;
}

/**
 * The type list of a save dialog of `kind`. `preferred` goes first, which is the type a dialog starts on (it must be one
 * of that kind's formats); `allowed` leaves out formats the document cannot be saved in (Clip Studio only for a
 * document that was opened from one).
 */
export function saveFilters(preferred: SaveFormat, allowed: (id: SaveFormat) => boolean = () => true, kind: SaveKind = 'document'): FileFilter[] {
  const pool = formatsFor(kind);
  const first = pool.find((f) => f.id === preferred) ?? pool[0]!;
  const ordered = [first, ...pool.filter((f) => f !== first)].filter((f) => f === first || allowed(f.id));
  return ordered.map((f) => ({ name: `${nameInList(f, kind)} (*.${f.ext})`, extensions: [f.ext, ...(f.aliases ?? [])] }));
}

/** The format a save dialog ended up with: the one the chosen name says, else the one the dialog started on. */
export function chosenFormat(chosenName: string, fallback: SaveFormat): SaveFormat {
  return formatOfName(chosenName) ?? fallback;
}
