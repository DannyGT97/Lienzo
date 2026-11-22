/**
 * The home screen: a file explorer for the documents the editor can open. It shows the files opened lately, the favourites
 * and the app's own library of folders (create, rename, move, duplicate, delete, import, export), with a small picture of each
 * document. It is shown when the app starts with nothing open and from File ▸ Inicio, and works with the mouse and with a finger
 * (a tap opens, a long press or the ⋯ button gives the menu). Storage is `library-fs.ts`; the lists and names are `library.ts`.
 */
import { nameOfPath, type FileRef, type PickedFile } from './file-io';
import { allFolders, type LibLocation, type LibraryFs } from './library-fs';
import {
  FILTERS,
  arrange,
  placeBeside,
  relocateOrder,
  PREFS_KEY,
  baseRel,
  crumbs,
  dropFavourites,
  fileKind,
  followMove,
  formatSize,
  formatWhen,
  isInside,
  joinRel,
  kindLabel,
  nameClash,
  nameProblem,
  parentRel,
  parsePrefs,
  toggleFavourite,
  uniqueName,
  visibleEntries,
  type LibEntry,
  type LibraryPrefs,
  type SortKey,
  type TypeFilter,
} from './library';
import { pickFolder } from './library-picker';
import type { Thumbs } from './library-preview';
import type { RecentFile } from './recent-files';
import { alertDialog, choiceDialog, confirmDialog, promptDialog } from './ui-dialogs';

export interface HomeDeps {
  /** The library's storage; null when there is none (a browser without OPFS): only recent files are listed. */
  fs: LibraryFs | null;
  recent(): RecentFile[];
  thumbs: Thumbs;
  /** Open a file in the editor (the editor reports what goes wrong). */
  open(ref: FileRef): Promise<void>;
  /** Create a document; `folder` is the library folder it is made in (null when there is no library). */
  newDocument(folder: string | null): void;
  /** The system's own file chooser, for files outside the library. */
  openOutside(): void;
  /** Let the person choose one or several files outside the library; their bytes, to be copied in. Empty when cancelled. */
  pickOutside(): Promise<PickedFile[]>;
  /** Hand `blob` to the system's save dialog, to take a document out of the library. */
  exportOutside(blob: Blob, name: string): Promise<void>;
  /** Read a file that is not in the library, for its picture. */
  readRef(ref: FileRef): Promise<Blob>;
  /** When a file outside the library last changed (its picture is valid while this is the same), or null. */
  stampOf(ref: FileRef): Promise<number | null>;
  /** Whether a document that is open is tied to `rel` or to something inside it (such a file cannot be moved or deleted). */
  inUse(rel: string): boolean;
  /** A library file or folder was moved (`to` set) or deleted (`to` null): the recent list follows. */
  moved(from: string, to: string | null): Promise<void>;
  forgetRecent(ref: FileRef): Promise<void>;
  /** Whether there is a document to go back to. */
  canReturn(): boolean;
  /** The person asked to go back to the editor. */
  returned(): void;
}

export interface Home {
  readonly visible: boolean;
  show(): void;
  hide(): void;
  /** Re-read what is listed (the recent list or the library changed). */
  refresh(): void;
  /** Ask which folder of the library to use. Null when cancelled or there is no library. */
  chooseFolder(message: string): Promise<string | null>;
  /** Whether `rel` is taken in its folder. */
  exists(rel: string): Promise<boolean>;
}

interface Item {
  key: string;
  name: string;
  dir: boolean;
  size: number;
  modified: number;
  /** In the library: its path. */
  rel?: string;
  /** Outside the library: how the editor reads it. */
  ref?: FileRef;
  /** The small grey line under the name. */
  note?: string;
}

const RECENT = 'recent';
/** Favourites that are files outside the library are kept as "ext:" + their path. */
const EXT = 'ext:';
const FAV = 'fav';
const SORTS: { id: SortKey; label: string }[] = [
  { id: 'date', label: 'Fecha de edición' },
  { id: 'name', label: 'Nombre' },
  { id: 'size', label: 'Tamaño' },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function btn(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

const TRASH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const FOLDER_SVG = '<svg viewBox="0 0 64 48" aria-hidden="true"><path d="M4 8a4 4 0 0 1 4-4h14l6 6h28a4 4 0 0 1 4 4v26a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="currentColor"/></svg>';

const isTouch = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createHome(root: HTMLElement, deps: HomeDeps): Home {
  const { fs } = deps;
  let prefs: LibraryPrefs = (() => {
    try {
      return parsePrefs(localStorage.getItem(PREFS_KEY));
    } catch {
      return parsePrefs(null);
    }
  })();
  const savePrefs = (): void => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // storage unavailable: the choices are just not remembered
    }
  };
  let place = prefs.place;
  let type: TypeFilter = 'all';
  let query = '';
  let items: Item[] = [];
  let folders: string[] = [];
  let selected: string | null = null;
  let location: LibLocation | null = null;
  let loadSerial = 0;
  let visible = false;
  let drawer = false;

  // ---- structure ---------------------------------------------------------------------------------------
  root.classList.add('home');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Inicio: explorador de archivos');
  root.tabIndex = -1;
  const top = el('header', 'home-top');
  const body = el('div', 'home-body');
  const side = el('nav', 'home-side');
  side.setAttribute('aria-label', 'Lugares');
  const main = el('section', 'home-main');
  const bar = el('div', 'home-bar');
  const pills = el('div', 'home-pills');
  const scroller = el('div', 'home-scroll');
  const grid = el('div', 'home-grid');
  scroller.append(grid);
  // Android: the library waits in the app's private folder until the person allows access to all files.
  const access = el('div', 'home-access');
  access.hidden = true;
  main.append(access, bar, pills, scroller);
  body.append(side, main);
  const foot = el('footer', 'home-foot');
  const menu = el('div', 'home-menu');
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  root.append(top, body, foot, menu);

  // Opening a big file freezes the page for a while. Until it is open a message covers the window, so taps cannot start it again
  // (or open whatever is under the finger) while it is being read.
  const busy = el('div', 'home-busy');
  busy.hidden = true;
  busy.setAttribute('role', 'status');
  const busyText = el('div', 'home-busy-text');
  const busyBar = el('div', 'home-busy-bar');
  const busyFill = el('i');
  busyBar.append(busyFill);
  busyBar.hidden = true;
  let stopWork: (() => void) | null = null;
  const busyStop = btn('Cancelar', () => {
    stopWork?.();
    busyStop.disabled = true;
    busyStop.textContent = 'Cancelando…';
  });
  busyStop.hidden = true;
  busy.append(busyText, busyBar, busyStop);
  root.append(busy);

  /** Cover the window with a message that can show progress (`done` of `total`) and a button to stop. */
  function working(text: string, opts: { total?: number; done?: number; stop?: () => void } = {}): void {
    busyText.textContent = text;
    busyBar.hidden = opts.total === undefined;
    busyFill.style.width = opts.total ? `${Math.min(100, Math.round(((opts.done ?? 0) / opts.total) * 100))}%` : '0%';
    stopWork = opts.stop ?? null;
    busyStop.hidden = !opts.stop;
    if (opts.stop) {
      busyStop.disabled = false;
      busyStop.textContent = 'Cancelar';
    }
    busy.hidden = false;
  }
  let opening = false;
  async function whileOpening(name: string, run: () => Promise<void>): Promise<void> {
    if (opening) return;
    opening = true;
    working(`Abriendo «${name}»…`);
    // Let the message be drawn before the heavy work starts.
    await new Promise<void>((done) => window.setTimeout(done, 60)); // a timer, not a frame: a page that is not shown gets no frames
    try {
      await run();
    } finally {
      opening = false;
      busy.hidden = true;
    }
  }

  // With the side list open over the files (narrow screens), a tap anywhere else only closes it.
  main.addEventListener(
    'click',
    (e) => {
      if (!drawer) return;
      e.stopPropagation();
      e.preventDefault();
      drawer = false;
      root.classList.remove('side-open');
    },
    true,
  );

  const menuToggle = btn('☰', () => {
    drawer = !drawer;
    root.classList.toggle('side-open', drawer);
  }, 'home-burger');
  menuToggle.setAttribute('aria-label', 'Lugares');
  const title = el('h2', '', 'Inicio');
  const search = el('input', 'home-search');
  search.type = 'search';
  search.placeholder = 'Buscar por nombre';
  search.setAttribute('aria-label', 'Buscar por nombre');
  search.addEventListener('input', () => {
    query = search.value;
    renderMain();
  });
  const sortSel = el('select', 'home-sort');
  sortSel.setAttribute('aria-label', 'Ordenar por');
  for (const s of SORTS) sortSel.append(new Option(s.label, s.id));
  sortSel.value = prefs.sort;
  sortSel.addEventListener('change', () => {
    prefs.sort = sortSel.value as SortKey;
    savePrefs();
    renderMain();
  });
  const viewGrid = btn('▦', () => setView('grid'), 'home-view');
  const viewList = btn('☰', () => setView('list'), 'home-view');
  viewGrid.title = viewGrid.ariaLabel = 'Cuadrícula';
  viewList.title = viewList.ariaLabel = 'Lista';
  const back = btn('Volver al editor', () => deps.returned(), 'home-back');
  top.append(menuToggle, title, el('span', 'home-gap'), search, sortSel, viewGrid, viewList, back);

  function setView(v: 'grid' | 'list'): void {
    prefs.view = v;
    savePrefs();
    renderMain();
  }

  // ---- data --------------------------------------------------------------------------------------------
  const libRef = (it: Item): FileRef => ({ kind: 'library', rel: it.rel!, name: it.name });
  const fromEntry = (e: LibEntry, note?: string): Item => ({ key: `lib:${e.rel}`, name: e.name, dir: e.dir, size: e.size, modified: e.modified, rel: e.rel, note });

  /** The entry at `rel`, looked up in its folder's listing (`cache` keeps one listing per folder for the whole pass). */
  async function statRel(rel: string, cache: Map<string, LibEntry[]>): Promise<LibEntry | null> {
    if (!fs) return null;
    const dir = parentRel(rel);
    let list = cache.get(dir);
    if (!list) {
      list = await fs.list(dir).catch(() => []);
      cache.set(dir, list);
    }
    return list.find((e) => e.rel === rel) ?? null;
  }

  async function collect(): Promise<Item[]> {
    const cache = new Map<string, LibEntry[]>();
    if (place === RECENT) {
      const out: Item[] = [];
      for (const r of deps.recent()) {
        if (r.ref.kind === 'library') {
          const e = await statRel(r.ref.rel, cache);
          out.push(e ? fromEntry(e, parentRel(e.rel) || 'Biblioteca') : { key: `lib:${r.ref.rel}`, name: r.name, dir: false, size: 0, modified: 0, rel: r.ref.rel, note: 'No se encuentra' });
        } else out.push({ key: `ext:${r.ref.kind === 'tauri' ? r.ref.path : r.name}`, name: r.name, dir: false, size: 0, modified: 0, ref: r.ref, note: 'Fuera de la biblioteca' });
      }
      return out;
    }
    if (place === FAV) {
      const out: Item[] = [];
      for (const key of prefs.favourites) {
        if (key.startsWith(EXT)) {
          const path = key.slice(EXT.length);
          const name = nameOfPath(path);
          out.push({ key: `ext:${path}`, name, dir: false, size: 0, modified: 0, ref: { kind: 'tauri', path, name }, note: 'Fuera de la biblioteca' });
          continue;
        }
        const e = await statRel(key, cache);
        if (e) out.push(fromEntry(e, parentRel(e.rel) || 'Biblioteca'));
      }
      return out;
    }
    if (!fs) return [];
    return (await fs.list(place)).map((e) => fromEntry(e));
  }

  async function load(): Promise<void> {
    const serial = ++loadSerial;
    try {
      const [list, tree] = await Promise.all([collect(), fs ? allFolders(fs, '', 4, (parent, names) => arrange(names, prefs.order[parent])) : Promise.resolve([] as string[])]);
      if (serial !== loadSerial) return;
      items = list;
      folders = tree;
      if (fs && (!location || location.needsAccess)) location = await fs.where().catch(() => null);
    } catch (err) {
      if (serial !== loadSerial) return;
      // The folder vanished (deleted outside the app): fall back to the library itself.
      items = [];
      if (place !== RECENT && place !== FAV && place !== '') {
        place = '';
        void load();
        return;
      }
      grid.replaceChildren(el('p', 'home-empty', `No se pudo leer la biblioteca: ${message(err)}`));
    }
    renderAll();
  }

  // ---- drawing -----------------------------------------------------------------------------------------
  const placeName = (p: string): string => (p === RECENT ? 'Recientes' : p === FAV ? 'Destacados' : p === '' ? 'Biblioteca' : baseRel(p));

  function go(next: string): void {
    place = next;
    prefs.place = next;
    savePrefs();
    selected = null;
    query = '';
    search.value = '';
    type = 'all';
    drawer = false;
    root.classList.remove('side-open');
    void load();
  }

  function renderSide(): void {
    side.replaceChildren();
    const row = (p: string, label: string, depth = 0, icon = ''): HTMLElement => {
      const b = el('button', `home-place${place === p ? ' on' : ''}`);
      b.type = 'button';
      b.style.paddingLeft = `${10 + depth * 14}px`;
      b.append(el('span', 'home-place-icon', icon), el('span', 'home-place-name', label));
      b.addEventListener('click', () => go(p));
      if (p === '') b.dataset.rel = '';
      return b;
    };
    side.append(row(RECENT, 'Recientes', 0, '◷'), row(FAV, 'Destacados', 0, '★'));
    if (!fs) return;
    side.append(el('div', 'home-side-head', 'Biblioteca'));
    for (const f of folders) side.append(f ? folderRow(f) : row(f, 'Todos los archivos', 0, '▣'));
    const add = btn('＋ Nueva carpeta', () => void newFolder(''), 'home-newfolder');
    add.title = 'Crea una carpeta en la raíz de la biblioteca';
    const where = btn('Dónde se guardan…', () => void showLocation(), 'home-where');
    where.title = 'Ver en qué carpeta del dispositivo están tus archivos';
    side.append(add, where);
  }

  /** What the favourites list calls this item: its library path, or "ext:" + path for a file outside the library. */
  const favKey = (it: Item): string | undefined => (it.dir ? undefined : (it.rel ?? (it.ref?.kind === 'tauri' ? `${EXT}${it.ref.path}` : undefined)));

  const folderItem = (rel: string): Item => ({ key: `lib:${rel}`, name: baseRel(rel), dir: true, size: 0, modified: 0, rel });

  /** A folder in the side list: a bin to its left, the name, and it can be dragged (to reorder it, or to put it inside another). */
  function folderRow(f: string): HTMLElement {
    const row = el('div', `home-frow${place === f ? ' on' : ''}`);
    row.dataset.rel = f;
    row.draggable = !isTouch();
    row.style.paddingLeft = `${4 + (f.split('/').length - 1) * 14}px`;
    const del = el('button', 'home-del');
    del.type = 'button';
    del.innerHTML = TRASH_SVG;
    del.title = `Eliminar «${baseRel(f)}»`;
    del.setAttribute('aria-label', del.title);
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      void act(folderItem(f), 'delete');
    });
    const name = el('button', 'home-place-name', baseRel(f));
    name.type = 'button';
    const touch = touchDrag(row, { rel: f, dir: true, name: baseRel(f) }, (x, y) => openMenu(folderItem(f), x, y));
    name.addEventListener('click', () => {
      if (!touch.took()) go(f);
    });
    row.append(del, name);
    row.addEventListener('dragstart', (e) => startDrag(e, f, true));
    row.addEventListener('dragend', endDrag);
    return row;
  }

  const inFolder = (): boolean => place !== RECENT && place !== FAV;

  function renderBar(): void {
    bar.replaceChildren();
    const trail = el('div', 'home-crumbs');
    if (inFolder()) {
      const add = (label: string, p: string, last: boolean): void => {
        const c = el('button', `home-crumb${last ? ' last' : ''}`, label);
        c.type = 'button';
        c.addEventListener('click', () => go(p));
        if (trail.childElementCount) trail.append(el('span', 'home-sep', '›'));
        trail.append(c);
      };
      add('Biblioteca', '', place === '');
      const cs = crumbs(place);
      cs.forEach((c, n) => add(c.name, c.rel, n === cs.length - 1));
    } else trail.append(el('strong', '', placeName(place)));
    const actions = el('div', 'home-actions');
    actions.append(btn('Nuevo documento', () => deps.newDocument(fs ? (inFolder() ? place : '') : null), 'primary'), btn('Abrir archivo…', () => deps.openOutside()));
    if (fs) {
      actions.append(btn(inFolder() && place ? 'Nueva subcarpeta' : 'Nueva carpeta', () => void newFolder(inFolder() ? place : '')));
      actions.append(btn('Importar…', () => void importHere()));
    }
    bar.append(trail, actions);
    pills.replaceChildren();
    for (const f of FILTERS) {
      const p = el('button', `home-pill${type === f.id ? ' on' : ''}`, f.label);
      p.type = 'button';
      p.addEventListener('click', () => {
        type = f.id;
        renderMain();
      });
      pills.append(p);
    }
  }

  const shown = (): Item[] => {
    const asEntries = items.map((i): LibEntry => ({ name: i.name, rel: i.key, dir: i.dir, size: i.size, modified: i.modified }));
    // In "Recientes" the order is the order of use, not a sort of the person's.
    const view = visibleEntries(asEntries, { type, query, sort: prefs.sort });
    if (place === RECENT) {
      const want = new Set(view.map((e) => e.rel));
      return items.filter((i) => want.has(i.key));
    }
    const byKey = new Map(items.map((i) => [i.key, i]));
    const dirs = view.filter((e) => e.dir);
    if (inFolder()) {
      const names = arrange(dirs.map((d) => d.name), prefs.order[place]);
      dirs.sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name));
    }
    return [...dirs, ...view.filter((e) => !e.dir)].map((e) => byKey.get(e.rel)!).filter(Boolean);
  };

  let io: IntersectionObserver | null = null;
  const byKey = new Map<string, Item>();

  function loadThumb(card: HTMLElement): void {
    const it = byKey.get(card.dataset.key ?? '');
    const img = card.querySelector<HTMLImageElement>('img.home-thumb');
    if (!it || it.dir || !img || img.src) return;
    const show = (url: string | null): void => {
      if (!url || !card.isConnected) return;
      img.src = url;
      img.hidden = false;
      card.classList.add('has-thumb');
    };
    if (it.rel !== undefined && fs) {
      if (!it.modified && !it.size) return; // missing file
      const rel = it.rel;
      void deps.thumbs.get(rel, `${it.modified}|${it.size}`, () => ({ size: it.size, range: (a, b) => fs.readRange(rel, a, b), all: () => fs.read(rel) })).then(show);
    } else if (it.ref?.kind === 'tauri') {
      const ref = it.ref;
      void deps.stampOf(ref).then((stamp) => {
        if (stamp === null) return;
        return deps.thumbs.get(`ext:${ref.path}`, String(stamp), () => {
          let whole: Promise<Blob> | null = null;
          const all = (): Promise<Blob> => (whole ??= deps.readRef(ref));
          return { size: 0, range: async (a, b) => (await all()).slice(a, b), all };
        }).then(show);
      });
    }
  }

  function card(it: Item, list: boolean): HTMLElement {
    const c = el('div', `home-card${it.dir ? ' dir' : ''}${selected === it.key ? ' on' : ''}${list ? ' row' : ''}`);
    c.dataset.key = it.key;
    c.tabIndex = 0;
    c.setAttribute('role', 'button');
    const pic = el('div', 'home-pic');
    if (it.dir) pic.innerHTML = FOLDER_SVG;
    else {
      pic.append(el('span', 'home-ext', kindLabel(it.name) || '?'));
      const img = el('img', 'home-thumb');
      img.hidden = true;
      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';
      pic.append(img);
      // A picture seen before is put in when the card is made, so going out of Inicio and back does not blink.
      const known = it.rel !== undefined && (it.modified || it.size) ? deps.thumbs.peek(it.rel, `${it.modified}|${it.size}`) : undefined;
      if (known) {
        img.src = known;
        img.hidden = false;
        c.classList.add('has-thumb');
      }
    }
    const name = el('div', 'home-name', it.name);
    name.title = it.name;
    const meta = el('div', 'home-meta');
    if (!it.dir && fileKind(it.name)) meta.append(el('span', 'home-chip', kindLabel(it.name)));
    const sub = it.note ?? '';
    const when = it.dir ? '' : formatWhen(it.modified);
    meta.append(el('span', 'home-sub', [sub, when].filter(Boolean).join(' · ')));
    if (list) meta.append(el('span', 'home-size', it.dir ? '' : it.size ? formatSize(it.size) : ''));
    const fk = favKey(it);
    const fav = fk !== undefined && prefs.favourites.includes(fk);
    const star = el('button', `home-star${fav ? ' on' : ''}`, fav ? '★' : '☆');
    star.type = 'button';
    star.title = fav ? 'Quitar de destacados' : 'Destacar';
    star.setAttribute('aria-label', star.title);
    star.hidden = fk === undefined;
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      void act(it, 'fav');
    });
    const more = el('button', 'home-more', '⋯');
    more.type = 'button';
    more.title = 'Más opciones';
    more.setAttribute('aria-label', `Más opciones de ${it.name}`);
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = more.getBoundingClientRect();
      openMenu(it, r.left, r.bottom);
    });
    const text = el('div', 'home-text');
    text.append(name, meta);
    c.append(pic, text, star, more);

    // A finger taps to open and holds to lift the item and carry it to a folder (see `touchDrag`); a mouse selects, and opens with a
    // double click (or Enter, or the button at the bottom).
    const touch = touchDrag(c, { rel: it.rel, dir: it.dir, name: it.name }, (x, y) => openMenu(it, x, y));
    c.addEventListener('click', () => {
      if (touch.took()) return;
      if (isTouch()) void act(it, 'open');
      else select(it.key);
    });
    if (!isTouch()) c.addEventListener('dblclick', () => void act(it, 'open'));
    if (it.rel !== undefined) {
      c.draggable = !isTouch(); // a finger carries things its own way
      c.addEventListener('dragstart', (e) => startDrag(e, it.rel!, it.dir));
      c.addEventListener('dragend', endDrag);
    }
    if (it.dir && it.rel !== undefined) {
      c.addEventListener('dragover', (e) => overTarget(e, c, it.rel!));
      c.addEventListener('dragleave', () => c.classList.remove('drop-in'));
      c.addEventListener('drop', (e) => void dropTarget(e, c, it.rel!));
    }
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void act(it, 'open');
      else if (e.key === 'F2' && it.rel !== undefined) void act(it, 'rename');
      else if (e.key === 'Delete' && it.rel !== undefined) void act(it, 'delete');
    });
    return c;
  }

  function renderMain(): void {
    renderBar();
    viewGrid.classList.toggle('on', prefs.view === 'grid');
    viewList.classList.toggle('on', prefs.view === 'list');
    io?.disconnect();
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          io?.unobserve(e.target);
          loadThumb(e.target as HTMLElement);
        }
      },
      { root: scroller, rootMargin: '240px' },
    );
    const list = shown();
    byKey.clear();
    for (const i of items) byKey.set(i.key, i);
    grid.className = `home-grid${prefs.view === 'list' ? ' list' : ''}`;
    grid.replaceChildren();
    if (!list.length) {
      const empty = el('div', 'home-empty');
      const filtered = query.trim() || type !== 'all';
      empty.append(
        el('strong', '', filtered ? 'No hay archivos con estos filtros.' : place === RECENT ? 'Todavía no has abierto nada.' : place === FAV ? 'No hay archivos destacados.' : 'Esta carpeta está vacía.'),
        el('span', '', filtered ? 'Cambia el tipo o la búsqueda.' : place === RECENT ? 'Crea un documento nuevo, abre un archivo o importa uno a tu biblioteca.' : place === FAV ? 'Pulsa la estrella de un archivo de la biblioteca para tenerlo aquí a mano.' : 'Crea un documento o importa archivos aquí.'),
      );
      grid.append(empty);
    }
    for (const it of list) {
      const c = card(it, prefs.view === 'list');
      grid.append(c);
      io.observe(c);
    }
    renderFoot();
  }

  function renderFoot(): void {
    foot.replaceChildren();
    const it = selected ? items.find((i) => i.key === selected) : undefined;
    const info = el('div', 'home-info');
    if (it) {
      const parts = [it.name, it.dir ? 'carpeta' : null, it.size ? formatSize(it.size) : null, it.modified ? `modificado ${formatWhen(it.modified)}` : null].filter(Boolean);
      info.textContent = parts.join(' · ');
    } else if (location && fs) {
      const where = `${location.path}${inFolder() && place ? `${location.path.includes('\\') ? '\\' : '/'}${place.split('/').join(location.path.includes('\\') ? '\\' : '/')}` : ''}`;
      info.textContent = location.visible ? `Ubicación: ${where}` : `Ubicación: ${where}`;
      info.title = `${where}\nPulsa «Dónde se guardan…» para más detalles`;
    } else info.textContent = `${shown().length} elemento${shown().length === 1 ? '' : 's'}`;
    foot.append(info);
    if (it) foot.append(btn(it.dir ? 'Abrir carpeta' : 'Abrir', () => void act(it, 'open'), 'primary'));
  }

  function renderAccess(): void {
    access.replaceChildren();
    access.hidden = !location?.needsAccess;
    if (access.hidden) return;
    access.append(
      el('span', '', 'Tu biblioteca está en la carpeta privada de la app, que casi ningún explorador deja abrir. Da acceso a los archivos y se mueve entera, con sus carpetas, a Documentos/Lienzo.'),
      btn('Dar acceso…', () => void fs?.requestAccess?.().catch((err) => alertDialog(message(err), 'No se pudo abrir los ajustes')), 'primary'),
    );
  }

  function renderAll(): void {
    renderAccess();
    renderSide();
    renderMain();
    back.hidden = !deps.canReturn();
  }

  function select(key: string): void {
    selected = key;
    for (const c of grid.querySelectorAll<HTMLElement>('.home-card')) c.classList.toggle('on', c.dataset.key === key);
    renderFoot();
  }

  // ---- menu --------------------------------------------------------------------------------------------
  function closeMenu(): void {
    menu.hidden = true;
    menu.replaceChildren();
  }

  interface MenuEntry {
    label?: string;
    run?: () => void;
    danger?: boolean;
    sep?: boolean;
  }

  function showMenu(entries: MenuEntry[], x: number, y: number): void {
    menu.replaceChildren();
    for (const e of entries) {
      if (e.sep) {
        menu.append(el('div', 'home-msep'));
        continue;
      }
      const b = el('button', `home-mi${e.danger ? ' danger' : ''}`, e.label);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.addEventListener('click', () => {
        closeMenu();
        e.run?.();
      });
      menu.append(b);
    }
    menu.hidden = false;
    const box = root.getBoundingClientRect();
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    menu.style.left = `${Math.max(4, Math.min(x - box.left, box.width - w - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y - box.top, box.height - h - 4))}px`;
    menu.querySelector<HTMLElement>('button')?.focus();
  }

  /** The menu of a file or folder. */
  function openMenu(it: Item, x: number, y: number): void {
    if (byKey.has(it.key)) select(it.key);
    const a = (id: string, label: string, danger = false): MenuEntry => ({ label, danger, run: () => void act(it, id) });
    const entries: MenuEntry[] = [a('open', it.dir ? 'Abrir carpeta' : 'Abrir')];
    if (it.rel !== undefined) {
      if (!it.dir) entries.push(a('fav', prefs.favourites.includes(it.rel) ? 'Quitar de destacados' : 'Destacar'));
      entries.push(a('dup', it.dir ? 'Copiar carpeta' : 'Duplicar'), a('rename', 'Renombrar…'), a('move', 'Mover a…'));
      if (it.dir) entries.push(a('sub', 'Nueva subcarpeta'), a('up', 'Subir en la lista'), a('down', 'Bajar en la lista'));
      if (!it.dir) entries.push(a('export', 'Exportar a…'));
      if (place === RECENT || place === FAV) entries.push(a('reveal', 'Mostrar en su carpeta'));
      if (location?.reveal) entries.push(a('os', 'Mostrar en el explorador'));
      entries.push(a('info', 'Información'), { sep: true }, a('delete', 'Eliminar…', true));
    } else {
      const fk = favKey(it);
      if (fk) entries.push(a('fav', prefs.favourites.includes(fk) ? 'Quitar de destacados' : 'Destacar'));
      if (place === RECENT) entries.push(a('forget', 'Quitar de recientes'));
    }
    showMenu(entries, x, y);
  }

  /** The menu of the empty space: make something new where the person is looking. */
  function blankMenu(x: number, y: number): void {
    const into = fs ? (inFolder() ? place : '') : null;
    const entries: MenuEntry[] = [{ label: 'Nuevo documento', run: () => deps.newDocument(into) }];
    if (fs) entries.push({ label: into ? 'Nueva subcarpeta' : 'Nueva carpeta', run: () => void newFolder(into ?? '') }, { label: 'Importar…', run: () => void importHere() });
    entries.push({ sep: true }, { label: 'Actualizar', run: () => refreshSoon() });
    showMenu(entries, x, y);
  }

  // The system's own menu (back, save as, inspect…) makes no sense here: right click gives the library's menus.
  // What last touched the window: a finger that holds makes the system send a "context menu" too, which must not open ours (holding
  // is for carrying; the menu of a finger is the ⋯ button, or letting go of a hold without moving).
  let lastPointer = 'mouse';
  root.addEventListener('contextmenu', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select')) return;
    e.preventDefault();
    if (lastPointer === 'touch') return;
    if (t.closest('.home-menu')) return;
    const card = t.closest<HTMLElement>('.home-card');
    if (card) {
      const it = byKey.get(card.dataset.key ?? '');
      if (it) openMenu(it, e.clientX, e.clientY);
      return;
    }
    const row = t.closest<HTMLElement>('.home-frow');
    if (row?.dataset.rel) return openMenu(folderItem(row.dataset.rel), e.clientX, e.clientY);
    if (t.closest('.home-main, .home-side')) blankMenu(e.clientX, e.clientY);
  });

  // ---- dragging ----------------------------------------------------------------------------------------
  let drag: { rel: string; dir: boolean } | null = null;
  type Zone = 'before' | 'after' | 'in';
  /** What the drop logic needs of a pointer: a drag event, or a finger moving. */
  interface DragPoint {
    clientY: number;
    preventDefault(): void;
    dataTransfer?: DataTransfer | null;
  }

  function startDrag(e: DragEvent, rel: string, dir: boolean): void {
    drag = { rel, dir };
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', rel);
    }
  }
  function clearDrop(): void {
    for (const n of root.querySelectorAll('.drop-before, .drop-after, .drop-in')) n.classList.remove('drop-before', 'drop-after', 'drop-in');
  }
  function endDrag(): void {
    drag = null;
    clearDrop();
  }
  /** Above, below or onto a folder: the top and bottom quarters of a row of the side list sort, the middle puts inside. */
  function zoneOf(e: DragPoint, row: HTMLElement, target: string): Zone {
    if (!drag?.dir || target === '' || !row.classList.contains('home-frow')) return 'in';
    const r = row.getBoundingClientRect();
    const y = (e.clientY - r.top) / Math.max(1, r.height);
    return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'in';
  }
  function dropAllowed(target: string, zone: Zone): boolean {
    if (!drag || isInside(target, drag.rel)) return false;
    return zone === 'in' ? parentRel(drag.rel) !== target : true;
  }
  function overTarget(e: DragPoint, row: HTMLElement, target: string): void {
    const zone = zoneOf(e, row, target);
    clearDrop();
    if (!dropAllowed(target, zone)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    row.classList.add(`drop-${zone}`);
  }
  async function dropTarget(e: DragPoint, row: HTMLElement, target: string): Promise<void> {
    const zone = zoneOf(e, row, target);
    const d = drag;
    const allowed = dropAllowed(target, zone);
    endDrag();
    if (!d || !fs || !allowed) return;
    e.preventDefault();
    const name = baseRel(d.rel);
    const parent = zone === 'in' ? target : parentRel(target);
    try {
      if (parent !== parentRel(d.rel)) {
        if (deps.inUse(d.rel)) return void alertDialog(`«${name}» está abierto en el editor. Ciérralo antes de moverlo.`, 'Está en uso');
        const to = joinRel(parent, name);
        if (await exists(to)) return void alertDialog(`Ya hay algo llamado «${name}» en esa carpeta.`, 'No se pudo mover');
        await fs.move(d.rel, to);
        await after(d.rel, to);
      }
      if (zone !== 'in') {
        const names = await folderNames(parent);
        prefs.order[parent] = placeBeside(names, name, baseRel(target), zone);
        savePrefs();
      }
      refreshSoon();
    } catch (err) {
      void alertDialog(message(err), 'No se pudo mover');
      refreshSoon();
    }
  }
  // A finger cannot use the browser's own drag and drop, so holding is the gesture: after a moment the item lifts (it follows the
  // finger and the folder under it lights up); letting go over a folder moves it there, letting go without having moved opens its menu.
  let touching = false;
  document.addEventListener(
    'touchmove',
    (e) => {
      if (touching && e.cancelable) e.preventDefault(); // the page must not scroll while something is being carried
    },
    { passive: false },
  );

  function touchDrag(target: HTMLElement, who: { rel?: string; dir: boolean; name: string }, menuAt: (x: number, y: number) => void): { took(): boolean } {
    let timer = 0;
    let scrollTimer = 0;
    let active = false;
    let took = false;
    let moved = false;
    let start = { x: 0, y: 0 };
    let last = { x: 0, y: 0 };
    let ghost: HTMLElement | null = null;
    let hover: { row: HTMLElement; rel: string } | null = null;

    /** The folder under the finger, if one can take what is carried. */
    function track(): void {
      const under = document.elementFromPoint(last.x, last.y) as HTMLElement | null;
      clearDrop();
      hover = null;
      if (!under || !drag) return;
      const card = under.closest<HTMLElement>('.home-card.dir');
      const row = card ?? under.closest<HTMLElement>('.home-side [data-rel]');
      const rel = card ? byKey.get(card.dataset.key ?? '')?.rel : row?.dataset.rel;
      if (!row || rel === undefined) return;
      overTarget({ clientY: last.y, preventDefault() {} }, row, rel);
      if (/\bdrop-(before|after|in)\b/.test(row.className)) hover = { row, rel };
    }
    /** Near the top or bottom of a list the list scrolls by itself, so far-away folders can be reached. */
    function autoScroll(): void {
      const area = (document.elementFromPoint(last.x, last.y) as HTMLElement | null)?.closest<HTMLElement>('.home-scroll, .home-side');
      if (!area) return;
      const r = area.getBoundingClientRect();
      if (last.y < r.top + 56) area.scrollTop -= 16;
      else if (last.y > r.bottom - 56) area.scrollTop += 16;
      else return;
      track();
    }
    function clean(): void {
      window.clearTimeout(timer);
      window.clearInterval(scrollTimer);
      ghost?.remove();
      ghost = null;
      target.classList.remove('lifted');
      if (active) {
        touching = false;
        endDrag();
      }
      active = false;
      hover = null;
    }

    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      took = false;
      moved = false;
      start = last = { x: e.clientX, y: e.clientY };
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        active = true;
        touching = true;
        took = true;
        navigator.vibrate?.(18);
        if (who.rel !== undefined) drag = { rel: who.rel, dir: who.dir };
        try {
          target.setPointerCapture(e.pointerId);
        } catch {
          // the finger already left
        }
        target.classList.add('lifted');
        ghost = el('div', 'home-ghost', who.name);
        ghost.style.left = `${last.x}px`;
        ghost.style.top = `${last.y}px`;
        root.append(ghost);
        scrollTimer = window.setInterval(autoScroll, 40);
      }, 380);
    });
    target.addEventListener('pointermove', (e) => {
      last = { x: e.clientX, y: e.clientY };
      if (!active) {
        if (Math.hypot(last.x - start.x, last.y - start.y) > 10) window.clearTimeout(timer); // it is a scroll, not a hold
        return;
      }
      if (Math.hypot(last.x - start.x, last.y - start.y) > 12) moved = true;
      if (ghost) {
        ghost.style.left = `${last.x}px`;
        ghost.style.top = `${last.y}px`;
      }
      track();
    });
    // The drop needs what is carried, so it is started before the state is cleaned.
    const finish = (e: PointerEvent, cancelled: boolean): void => {
      window.clearTimeout(timer);
      if (!active) return;
      const aim = hover;
      const point: DragPoint = { clientY: e.clientY, preventDefault() {} };
      if (!cancelled && aim && drag && moved) void dropTarget(point, aim.row, aim.rel);
      else if (!cancelled && !moved) menuAt(last.x, last.y);
      clean();
    };
    target.addEventListener('pointerup', (e) => finish(e, false));
    target.addEventListener('pointercancel', (e) => finish(e, true));
    return {
      took() {
        const v = took;
        took = false;
        return v;
      },
    };
  }

  side.addEventListener('dragover', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-rel]');
    if (row && row.dataset.rel !== undefined) overTarget(e, row, row.dataset.rel);
  });
  side.addEventListener('dragleave', (e) => {
    if (!side.contains(e.relatedTarget as Node | null)) clearDrop();
  });
  side.addEventListener('drop', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-rel]');
    if (row && row.dataset.rel !== undefined) void dropTarget(e, row, row.dataset.rel);
  });

  root.addEventListener('pointerdown', (e) => {
    lastPointer = e.pointerType;
    if (!menu.hidden && !menu.contains(e.target as Node)) closeMenu();
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!menu.hidden) closeMenu();
    else if (deps.canReturn()) deps.returned();
    e.stopPropagation();
  });

  // ---- actions -----------------------------------------------------------------------------------------
  /** Tell the person where the library is, and open it in the system's explorer when that can be done. */
  async function showLocation(): Promise<void> {
    if (!fs) return;
    location ??= await fs.where().catch(() => null);
    if (!location) return;
    const sep = location.path.includes('\\') ? '\\' : '/';
    const here = inFolder() && place ? `${location.path}${sep}${place.split('/').join(sep)}` : location.path;
    const android = /Android/i.test(navigator.userAgent);
    const privateFolder = location.path.includes('Android/data');
    const text = !fs || fs.backend === 'opfs'
      ? `Estás en el navegador: las carpetas se guardan en el almacenamiento privado de la página, solo para pruebas.\n\n${here}`
      : android && !privateFolder
        ? `Tus carpetas y documentos están en la memoria del dispositivo, en:\n\n${here}\n\nEs una carpeta normal de Documentos: la ves desde cualquier explorador de archivos (junto a la de Clip Studio), puedes copiar documentos dentro o llevártelos, y se conserva si desinstalas Lienzo.`
        : android
          ? `Tus carpetas y documentos están en la memoria del dispositivo, en la carpeta de la app:\n\n${here}\n\nEs una carpeta de Lienzo: si desinstalas la app, Android la borra. Según tu versión de Android, el explorador de archivos puede no dejarte entrar en «Android/data»; con un cable USB al ordenador sí suele verse. Para sacar un documento a otro sitio usa «Exportar a…» en su menú (⋯).`
        : `Tus carpetas y documentos son archivos normales de tu equipo, en:\n\n${here}\n\nPuedes abrir esa carpeta con el explorador de archivos, copiar documentos dentro o llevártelos a otro sitio.`;
    const options: { label: string; value: 'open' | 'copy' | null; primary?: boolean }[] = [];
    if (location.reveal && fs.reveal) options.push({ label: 'Abrir en el explorador', value: 'open', primary: true });
    options.push({ label: 'Copiar la ruta', value: 'copy', primary: !options.length }, { label: 'Cerrar', value: null });
    const choice = await choiceDialog<'open' | 'copy' | null>(text, options, null);
    try {
      if (choice === 'open') await fs.reveal?.(inFolder() ? place : '');
      else if (choice === 'copy') await navigator.clipboard.writeText(here);
    } catch (err) {
      void alertDialog(message(err), 'No se pudo completar');
    }
  }

  const refreshSoon = (): void => void load();

  /** The names of the folders inside `parent`, in the order the person gave. */
  const folderNames = async (parent: string): Promise<string[]> => (fs ? arrange((await fs.list(parent)).filter((e) => e.dir && !e.name.startsWith('.')).map((e) => e.name), prefs.order[parent]) : []);

  const siblings = async (dir: string): Promise<string[]> => (fs ? (await fs.list(dir)).map((e) => e.name) : []);

  async function exists(rel: string): Promise<boolean> {
    return (await siblings(parentRel(rel))).some((n) => n.toLowerCase() === baseRel(rel).toLowerCase());
  }

  /** Ask for a name and make the folder inside `inside`; its path, or null when nothing was made (the person was told why). */
  async function makeFolder(inside: string): Promise<string | null> {
    if (!fs) return null;
    const asked = await promptDialog(`Nombre de la carpeta nueva (${inside ? `dentro de «${baseRel(inside)}»` : 'en la raíz de la biblioteca'}):`, 'Nueva carpeta');
    if (asked === null) return null;
    const name = asked.trim();
    const bad = nameProblem(name);
    if (bad) {
      void alertDialog(bad, 'No se pudo crear la carpeta');
      return null;
    }
    try {
      const rel = joinRel(inside, name);
      if (await exists(rel)) {
        void alertDialog(`Ya hay algo llamado «${name}» ahí.`, 'No se pudo crear la carpeta');
        return null;
      }
      await fs.mkdir(rel);
      return rel;
    } catch (err) {
      void alertDialog(message(err), 'No se pudo crear la carpeta');
      return null;
    }
  }

  async function newFolder(inside: string): Promise<void> {
    const rel = await makeFolder(inside);
    if (rel === null) return;
    if (place !== inside) {
      place = inside;
      prefs.place = inside;
      savePrefs();
    }
    selected = `lib:${rel}`;
    await load();
  }

  async function importHere(): Promise<void> {
    if (!fs) return;
    const into = inFolder() ? place : '';
    try {
      const picked = await deps.pickOutside();
      if (!picked.length) return;
      const taken = await siblings(into);
      let done = 0;
      let stopped = false;
      const problems: string[] = [];
      for (let i = 0; i < picked.length; i++) {
        if (stopped) break;
        // Each file is read, written and counted in turn; the message says which one and how far along (a long list otherwise
        // looks as if nothing is happening), and "Cancelar" stops after the current file.
        working(`Importando ${i + 1} de ${picked.length}…`, { total: picked.length, done: i, stop: () => (stopped = true) });
        await new Promise<void>((next) => window.setTimeout(next, 0)); // let the bar be drawn between files
        let label = '';
        try {
          const file = await picked[i]!();
          label = file.name;
          working(`Importando ${i + 1} de ${picked.length}: ${file.name}`, { total: picked.length, done: i, stop: () => (stopped = true) });
          if (!fileKind(file.name)) {
            problems.push(`«${file.name}»: no es un formato que Lienzo pueda abrir.`);
            continue;
          }
          const name = uniqueName(file.name, taken);
          await fs.write(joinRel(into, name), file.blob);
          taken.push(name);
          done++;
        } catch (err) {
          problems.push(`«${label || `archivo ${i + 1}`}»: ${message(err)}`);
        }
      }
      busy.hidden = true;
      if (place === RECENT || place === FAV) go(into);
      else await load();
      if (problems.length || stopped) {
        const head = stopped ? `Importación cancelada: se importaron ${done} de ${picked.length}.` : done ? `Se importaron ${done} de ${picked.length}.` : '';
        void alertDialog(`${[head, problems.length ? `No se pudo importar:\n${problems.join('\n')}` : ''].filter(Boolean).join('\n')}`, 'Importar');
      }
    } catch (err) {
      busy.hidden = true;
      void alertDialog(message(err), 'No se pudo importar');
    }
  }

  /**
   * Ask for a folder in the window of `library-picker.ts`. `inside` (a folder being moved) and what is in it cannot be chosen,
   * nor `here` (where the thing already is); a window without those just lists every folder.
   */
  function chooseFolder(o: { title: string; message?: string; confirm: string; inside?: string; here?: string }): Promise<string | null> {
    if (!fs) return Promise.resolve(null);
    return pickFolder({
      title: o.title,
      message: o.message,
      confirmLabel: o.confirm,
      load: () => allFolders(fs, '', 8, (parent, names) => arrange(names, prefs.order[parent])),
      blocked: (f) => (o.inside !== undefined && isInside(f, o.inside) ? (f === o.inside ? 'Es la carpeta que mueves' : 'Está dentro de lo que se mueve') : f === o.here ? 'Ya está aquí' : null),
      create: (parent) => makeFolder(parent),
    });
  }

  async function act(it: Item, action: string): Promise<void> {
    const rel = it.rel;
    try {
      if (action === 'open') {
        if (it.dir && rel !== undefined) return go(rel);
        if (it.rel !== undefined) {
          if (!it.modified && !it.size && !(await exists(it.rel))) {
            if (await confirmDialog(`«${it.name}» ya no está en la biblioteca. ¿Quitarlo de la lista?`, 'Quitar')) await deps.forgetRecent(libRef(it));
            return refreshSoon();
          }
          return void (await whileOpening(it.name, () => deps.open(libRef(it))));
        }
        if (it.ref) return void (await whileOpening(it.name, () => deps.open(it.ref!)));
        return;
      }
      if (action === 'fav') {
        const key = favKey(it);
        if (!key) return;
        prefs.favourites = toggleFavourite(prefs.favourites, key);
        savePrefs();
        return place === FAV ? refreshSoon() : renderMain();
      }
      if (action === 'forget' && it.ref) {
        await deps.forgetRecent(it.ref);
        return refreshSoon();
      }
      if (rel === undefined || !fs) return;
      if (action === 'reveal') return go(parentRel(rel));
      if (action === 'os') return void (await fs.reveal?.(it.dir ? rel : parentRel(rel)));
      if (action === 'sub') return void (await newFolder(rel));
      if (action === 'up' || action === 'down') {
        const parent = parentRel(rel);
        const names = await folderNames(parent);
        const i = names.indexOf(it.name);
        const j = i + (action === 'up' ? -1 : 1);
        if (i < 0 || j < 0 || j >= names.length) return;
        [names[i], names[j]] = [names[j]!, names[i]!];
        prefs.order[parent] = names;
        savePrefs();
        return refreshSoon();
      }
      if (action === 'info') {
        const lines = [`Nombre: ${it.name}`, `Dónde: ${parentRel(rel) || 'Biblioteca'}`];
        if (!it.dir) lines.push(`Tipo: ${kindLabel(it.name) || 'desconocido'}`, `Tamaño: ${formatSize(it.size)}`);
        if (it.modified) lines.push(`Modificado: ${new Date(it.modified).toLocaleString('es')}`);
        if (location) lines.push(`Carpeta de la biblioteca: ${location.path}`);
        return void alertDialog(lines.join('\n'), 'Información');
      }
      if (action === 'export') {
        const blob = await fs.read(rel);
        return void (await deps.exportOutside(blob, it.name));
      }
      if (action === 'dup') {
        const dir = parentRel(rel);
        const name = uniqueName(it.name, await siblings(dir), !it.dir);
        await fs.copy(rel, joinRel(dir, name));
        return refreshSoon();
      }
      if (action === 'rename' || action === 'move' || action === 'delete') {
        if (deps.inUse(rel)) return void alertDialog(`«${it.name}» está abierto en el editor. Ciérralo antes de ${action === 'rename' ? 'renombrarlo' : action === 'move' ? 'moverlo' : 'eliminarlo'}.`, 'Está en uso');
      }
      if (action === 'rename') {
        const asked = await promptDialog('Nuevo nombre:', it.name);
        if (asked === null) return;
        let name = asked.trim();
        // A file keeps its extension when the new name has none, so it does not stop being a document.
        const ext = /\.[a-z0-9]{1,8}$/i.exec(it.name)?.[0] ?? '';
        if (!it.dir && ext && !/\.[a-z0-9]{1,8}$/i.test(name)) name += ext;
        if (name === it.name) return;
        const bad = nameProblem(name);
        if (bad) return void alertDialog(bad, 'No se pudo renombrar');
        const to = joinRel(parentRel(rel), name);
        if (nameClash(name, await siblings(parentRel(rel)), it.name)) return void alertDialog(`Ya hay algo llamado «${name}» ahí.`, 'No se pudo renombrar');
        await fs.move(rel, to);
        return after(rel, to);
      }
      if (action === 'move') {
        const dest = await chooseFolder({ title: `Mover «${it.name}»`, message: 'Elige la carpeta de destino.', confirm: 'Mover aquí', inside: it.dir ? rel : undefined, here: parentRel(rel) });
        if (dest === null || dest === parentRel(rel)) return;
        const to = joinRel(dest, it.name);
        if (await exists(to)) return void alertDialog(`Ya hay algo llamado «${it.name}» en esa carpeta.`, 'No se pudo mover');
        await fs.move(rel, to);
        return after(rel, to);
      }
      if (action === 'delete') {
        const what = it.dir ? `la carpeta «${it.name}» con todo lo que contiene` : `«${it.name}»`;
        if (!(await confirmDialog(`¿Eliminar ${what}? No se puede deshacer.`, 'Eliminar'))) return;
        await fs.remove(rel);
        prefs.favourites = dropFavourites(prefs.favourites, rel);
        prefs.order = relocateOrder(prefs.order, rel, null);
        savePrefs();
        deps.thumbs.forget(rel);
        await deps.moved(rel, null);
        if (selected === it.key) selected = null;
        if (it.dir && isInside(place, rel)) go(parentRel(rel));
        else refreshSoon();
      }
    } catch (err) {
      void alertDialog(message(err), 'No se pudo completar');
      refreshSoon();
    }
  }

  async function after(from: string, to: string): Promise<void> {
    prefs.favourites = followMove(prefs.favourites, from, to);
    prefs.order = relocateOrder(prefs.order, from, to);
    if (isInside(place, from)) {
      place = to + place.slice(from.length);
      prefs.place = place;
    }
    savePrefs();
    deps.thumbs.forget(from);
    await deps.moved(from, to);
    selected = `lib:${to}`;
    refreshSoon();
  }

  // Back from the system's page where access to all files is allowed: the library is looked for again (and moved, the first time).
  document.addEventListener('visibilitychange', () => {
    if (!visible || document.visibilityState !== 'visible' || !location?.needsAccess) return;
    location = null;
    void load();
  });

  return {
    get visible() {
      return visible;
    },
    show() {
      visible = true;
      root.hidden = false;
      back.hidden = !deps.canReturn();
      if (!fs && place !== RECENT && place !== FAV) place = RECENT;
      if (items.length) renderAll(); // what was shown before comes back at once; the fresh list replaces it a moment later
      void load();
      queueMicrotask(() => root.focus({ preventScroll: true }));
    },
    hide() {
      visible = false;
      root.hidden = true;
      closeMenu();
      io?.disconnect();
    },
    refresh() {
      if (visible) refreshSoon();
    },
    chooseFolder: (q) => chooseFolder({ title: 'Guardar en la biblioteca', message: q, confirm: 'Guardar aquí' }),
    exists,
  };
}
