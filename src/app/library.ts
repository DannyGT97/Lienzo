/**
 * The file library behind the home screen: the pure part. Names, kinds of file, sorting and filtering, and the small
 * list of favourites. Where the files live (a folder of the app, or the browser's private storage) is `library-fs.ts`;
 * the window itself is `library-ui.ts`. Paths here are always relative to the library folder and use "/" ("Manga/cap1.lienzo").
 */

export type FileKind = 'lienzo' | 'psd' | 'ora' | 'clip' | 'image';

/** The type filter of the home screen. */
export type TypeFilter = 'all' | FileKind;

export const FILTERS: { id: TypeFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'lienzo', label: '.lienzo' },
  { id: 'psd', label: 'PSD' },
  { id: 'clip', label: '.clip' },
  { id: 'ora', label: 'ORA' },
  { id: 'image', label: 'Imágenes' },
];

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'jfif', 'webp', 'avif', 'jxl', 'gif', 'bmp', 'ico', 'svg', 'tga', 'tif', 'tiff', 'pnm', 'pbm', 'pgm', 'ppm', 'pam', 'qoi', 'pcx'];

/** Every extension the library lists (the ones the editor can open). */
export const OPEN_EXTENSIONS = ['lienzo', 'psd', 'psb', 'ora', 'clip', ...IMAGE_EXT];

export const extensionOf = (name: string): string => {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name);
  return m ? m[1]!.toLowerCase() : '';
};

/** What kind of document `name` is, or null when the editor cannot open it. */
export function fileKind(name: string): FileKind | null {
  const e = extensionOf(name);
  if (e === 'lienzo') return 'lienzo';
  if (e === 'psd' || e === 'psb') return 'psd';
  if (e === 'ora') return 'ora';
  if (e === 'clip') return 'clip';
  return IMAGE_EXT.includes(e) ? 'image' : null;
}

/** The short label of the type chip on a card. */
export function kindLabel(name: string): string {
  const e = extensionOf(name);
  return e ? (e === 'lienzo' ? 'LIENZO' : e.toUpperCase()) : '';
}

export interface LibEntry {
  name: string;
  /** Path from the library folder, "/"-separated. */
  rel: string;
  dir: boolean;
  size: number;
  /** Milliseconds since 1970; 0 when unknown. */
  modified: number;
}

// ---- paths ------------------------------------------------------------------------------------------------

export const joinRel = (folder: string, name: string): string => (folder ? `${folder}/${name}` : name);

export const parentRel = (rel: string): string => {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
};

export const baseRel = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1);

/** The folders on the way to `rel`, the library itself first: [{name: 'Manga', rel: 'Manga'}, …]. */
export function crumbs(rel: string): { name: string; rel: string }[] {
  const parts = rel.split('/').filter(Boolean);
  return parts.map((name, n) => ({ name, rel: parts.slice(0, n + 1).join('/') }));
}

/** Whether `rel` is `folder` or is inside it. */
export const isInside = (rel: string, folder: string): boolean => rel === folder || rel.startsWith(`${folder}/`);

/**
 * Why `name` cannot be the name of a file or folder, or null when it can. The rules are the strictest of the platforms
 * (Windows), so a library moved from one device to another keeps working.
 */
export function nameProblem(name: string): string | null {
  const t = name.trim();
  if (!t) return 'Escribe un nombre.';
  if (t.length > 120) return 'El nombre es demasiado largo.';
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(t)) return 'El nombre no puede llevar \\ / : * ? " < > |';
  if (/[. ]$/.test(name) && t === name) return 'El nombre no puede terminar en punto.';
  if (t.startsWith('.')) return 'El nombre no puede empezar por punto.';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(t)) return 'Ese nombre está reservado por el sistema.';
  return null;
}

/** `name` made not to collide with `taken` (compared without case): "dibujo.lienzo" → "dibujo copia.lienzo" → "dibujo copia 2.lienzo". */
export function uniqueName(name: string, taken: Iterable<string>, withExtension = true): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const hasExt = withExtension && dot > 0 && name.length - dot <= 9;
  const stem = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : '';
  for (let n = 1; ; n++) {
    const candidate = `${stem} copia${n > 1 ? ` ${n}` : ''}${ext}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

// ---- listing ----------------------------------------------------------------------------------------------

export type SortKey = 'date' | 'name' | 'size';

export interface ViewOptions {
  type: TypeFilter;
  query: string;
  sort: SortKey;
}

const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

/**
 * What the grid shows: folders first, then the files the editor can open that match the filter and the search.
 * Hidden entries (a leading dot) never show. While searching, folders are filtered by name too.
 */
export function visibleEntries(entries: readonly LibEntry[], opts: ViewOptions): LibEntry[] {
  const q = opts.query.trim().toLowerCase();
  const keep = entries.filter((e) => {
    if (e.name.startsWith('.')) return false;
    if (q && !e.name.toLowerCase().includes(q)) return false;
    if (e.dir) return opts.type === 'all';
    const k = fileKind(e.name);
    return k !== null && (opts.type === 'all' || opts.type === k);
  });
  const cmp = (a: LibEntry, b: LibEntry): number =>
    opts.sort === 'name' ? collator.compare(a.name, b.name) : opts.sort === 'size' ? b.size - a.size || collator.compare(a.name, b.name) : b.modified - a.modified || collator.compare(a.name, b.name);
  return [...keep.filter((e) => e.dir).sort((a, b) => collator.compare(a.name, b.name)), ...keep.filter((e) => !e.dir).sort(cmp)];
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 || v % 1 === 0 ? Math.round(v) : v.toFixed(1).replace('.', ',')} ${units[u]}`;
}

/** "hoy", "ayer", "hace 3 días", or the date for anything older than a month. */
export function formatWhen(ms: number, now = Date.now()): string {
  if (!ms) return '';
  const start = (t: number): number => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((start(now) - start(ms)) / 86_400_000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  return new Date(ms).toLocaleDateString('es', { day: 'numeric', month: 'short', year: new Date(ms).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

// ---- favourites and remembered place -----------------------------------------------------------------------

/** The order the person gave the folders: for each folder (by path; "" is the library), the names of its folders, first to last. */
export type OrderMap = Record<string, string[]>;

export interface LibraryPrefs {
  favourites: string[];
  order: OrderMap;
  /** The last section shown: "recent", "fav" or a folder path. */
  place: string;
  view: 'grid' | 'list';
  sort: SortKey;
}

export const DEFAULT_PREFS: LibraryPrefs = { favourites: [], order: {}, place: 'recent', view: 'grid', sort: 'date' };
export const PREFS_KEY = 'lienzo.library.v1';

export function parsePrefs(text: string | null): LibraryPrefs {
  if (!text) return { ...DEFAULT_PREFS, favourites: [], order: {} };
  try {
    const v = JSON.parse(text) as Partial<LibraryPrefs> | null;
    return {
      favourites: Array.isArray(v?.favourites) ? [...new Set(v.favourites.filter((x): x is string => typeof x === 'string' && x.length > 0))] : [],
      order: parseOrder(v?.order),
      place: typeof v?.place === 'string' ? v.place : DEFAULT_PREFS.place,
      view: v?.view === 'list' ? 'list' : 'grid',
      sort: v?.sort === 'name' || v?.sort === 'size' ? v.sort : 'date',
    };
  } catch {
    return { ...DEFAULT_PREFS, favourites: [], order: {} };
  }
}

function parseOrder(raw: unknown): OrderMap {
  const out: OrderMap = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, list] of Object.entries(raw)) if (Array.isArray(list)) out[key] = [...new Set(list.filter((x): x is string => typeof x === 'string' && x.length > 0))];
  return out;
}

export const toggleFavourite = (list: readonly string[], rel: string): string[] => (list.includes(rel) ? list.filter((r) => r !== rel) : [...list, rel]);

/** A file or folder moved or renamed from `from` to `to`: favourites inside it follow. */
export const followMove = (list: readonly string[], from: string, to: string): string[] => list.map((r) => (r === from ? to : r.startsWith(`${from}/`) ? to + r.slice(from.length) : r));

/** A file or folder deleted: favourites inside it go. */
export const dropFavourites = (list: readonly string[], gone: string): string[] => list.filter((r) => !isInside(r, gone));

// ---- the order of folders ---------------------------------------------------------------------------------

/** `names` in the order the person gave (`saved`); the ones not mentioned come after, alphabetically. */
export function arrange(names: readonly string[], saved: readonly string[] | undefined): string[] {
  const rest = [...names].sort((a, b) => collator.compare(a, b));
  if (!saved?.length) return rest;
  const have = new Set(names);
  const first = saved.filter((n, i) => have.has(n) && saved.indexOf(n) === i);
  return [...first, ...rest.filter((n) => !first.includes(n))];
}

/** `current` with `name` taken out and put right before or after `target`. */
export function placeBeside(current: readonly string[], name: string, target: string, where: 'before' | 'after'): string[] {
  const list = current.filter((n) => n !== name);
  const at = list.indexOf(target);
  if (at < 0) return [...list, name];
  list.splice(where === 'before' ? at : at + 1, 0, name);
  return list;
}

/**
 * A folder moved or renamed from `from` to `to` (or deleted, `to` null): its place in the order of its parent and the order of
 * the folders inside it follow. A folder that changes parent is not listed in the new one: it goes after the others there.
 */
export function relocateOrder(order: OrderMap, from: string, to: string | null): OrderMap {
  const out: OrderMap = {};
  const parent = parentRel(from);
  const name = baseRel(from);
  for (const [key, list] of Object.entries(order)) {
    let names = list;
    if (key === parent) names = to !== null && parentRel(to) === parent ? list.map((n) => (n === name ? baseRel(to) : n)) : list.filter((n) => n !== name);
    if (isInside(key, from)) {
      if (to === null) continue;
      out[to + key.slice(from.length)] = names;
    } else out[key] = names;
  }
  return out;
}
