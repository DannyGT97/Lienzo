import { icon } from './icons';
import { readUiScale } from './ui-scale';

export interface TabInfo {
  id: number;
  title: string;
  dirty: boolean;
  active: boolean;
}

export interface StatusBarDeps {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  newDocument: () => void;
  /** Make the document of tab `id` the open one. */
  selectTab: (id: number) => void;
  /** Close the document of tab `id` (asking first when it has unsaved changes). */
  closeTab: (id: number) => void;
  /** The bell: show or hide the list of notices. */
  toggleNotices: () => void;
}

export interface StatusInfo {
  zoom: number;
  width: number;
  height: number;
  dpi: number;
  memory: string;
  /** Name of the open document, and whether it has changes that were not saved (shown as a dot before the name). */
  title: string;
  dirty: boolean;
  /** The open documents, in tab order. */
  tabs: TabInfo[];
  /** No document is open: the document fields above mean nothing and are not shown. */
  empty?: boolean;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Document tabs above the canvas and the status bar below it. */
export function mountStatusBar(tabsHost: HTMLElement, barHost: HTMLElement, d: StatusBarDeps): {
  update: (info: StatusInfo) => void;
  setPointer: (x: number, y: number) => void;
  /** Unread notices (a number on the bell) and the worst one still on screen (tints it). */
  setNotices: (unread: number, worst: 'error' | 'warning' | null) => void;
} {
  tabsHost.innerHTML = `
    <span class="dt-tabs"></span>
    <button class="dt-new" title="Nuevo documento">${icon('plus', 14)}</button>
    <span class="dt-fill"></span>
    <button class="dt-list" title="Lista de documentos abiertos">${icon('chevron-down', 14)}</button>`;
  const strip = tabsHost.querySelector<HTMLElement>('.dt-tabs')!;
  tabsHost.querySelector('.dt-new')!.addEventListener('click', d.newDocument);
  const idOf = (el: Element | null): number | null => {
    const tab = el?.closest<HTMLElement>('.dt-tab');
    return tab ? Number(tab.dataset.tab) : null;
  };
  strip.addEventListener('click', (e) => {
    const target = e.target as Element;
    const id = idOf(target);
    if (id === null) return;
    if (target.closest('.dt-close')) d.closeTab(id);
    else d.selectTab(id);
  });
  // The middle button closes a tab, as in a browser.
  strip.addEventListener('auxclick', (e) => {
    const id = e.button === 1 ? idOf(e.target as Element) : null;
    if (id === null) return;
    e.preventDefault();
    d.closeTab(id);
  });

  // The list of open documents, for when there are more tabs than the strip shows.
  let menu: HTMLElement | null = null;
  const closeMenu = (): void => {
    menu?.remove();
    menu = null;
  };
  let lastTabs: TabInfo[] = [];
  tabsHost.querySelector('.dt-list')!.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu) return closeMenu();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu = document.createElement('div');
    menu.className = 'dt-menu';
    // The menu is zoomed by the interface scale, which multiplies top/right too: give them in its own pixels.
    const k = readUiScale();
    menu.style.top = `${(r.bottom + 2) / k}px`;
    menu.style.right = `${Math.max(4, window.innerWidth - r.right) / k}px`;
    for (const t of lastTabs) {
      const item = document.createElement('button');
      item.className = `dt-menu-item${t.active ? ' on' : ''}`;
      item.textContent = `${t.dirty ? '● ' : ''}${t.title}`;
      item.addEventListener('click', () => {
        closeMenu();
        d.selectTab(t.id);
      });
      menu.append(item);
    }
    document.body.append(menu);
  });
  document.addEventListener('pointerdown', (e) => {
    if (menu && !menu.contains(e.target as Node)) closeMenu();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  barHost.innerHTML = `
    <span class="sb-item sb-pos" title="Posición del cursor en el lienzo">–</span>
    <span class="sb-sep"></span>
    <span class="sb-zoom">
      <button class="sb-btn" data-act="out" title="Alejar">${icon('zoom-out', 14)}</button>
      <span class="sb-pct" title="Zoom">100%</span>
      <button class="sb-btn" data-act="in" title="Acercar">${icon('zoom-in', 14)}</button>
      <button class="sb-btn wide" data-act="fit" title="Ajustar a la ventana">Ajustar</button>
    </span>
    <span class="sb-sep"></span>
    <span class="sb-item planned sb-rot" title="Rotación del lienzo (todavía no disponible)">${icon('rotate', 14)} 0°</span>
    <span class="sb-fill"></span>
    <span class="sb-item sb-doc" title="Tamaño y resolución del documento"></span>
    <span class="sb-sep"></span>
    <span class="sb-item sb-mem" title="Memoria del historial"></span>
    <button class="sb-bell" title="Avisos" aria-label="Avisos">${icon('bell', 15)}<span class="sb-badge" hidden></span></button>`;
  const q = (s: string): HTMLElement => barHost.querySelector(s)!;
  const bell = q('.sb-bell');
  const badge = q('.sb-badge');
  bell.addEventListener('click', d.toggleNotices);
  barHost.querySelector('[data-act="in"]')!.addEventListener('click', d.zoomIn);
  barHost.querySelector('[data-act="out"]')!.addEventListener('click', d.zoomOut);
  barHost.querySelector('[data-act="fit"]')!.addEventListener('click', d.fit);
  const pos = q('.sb-pos');
  const pct = q('.sb-pct');
  const doc = q('.sb-doc');
  const mem = q('.sb-mem');

  /** The tab strip is rebuilt only when a tab was added, closed, renamed, or changed its dirty/open state. */
  let signature = '';
  function drawTabs(tabs: TabInfo[]): void {
    lastTabs = tabs;
    const next = tabs.map((t) => `${t.id}|${t.title}|${t.dirty ? 1 : 0}|${t.active ? 1 : 0}`).join('\n');
    if (next === signature) return;
    signature = next;
    strip.innerHTML = tabs
      .map(
        (t) =>
          `<div class="dt-tab${t.active ? ' on' : ''}" data-tab="${t.id}" title="${esc(t.title)}"><span class="dt-name">${t.dirty ? '● ' : ''}${esc(t.title)}</span><button class="dt-close" title="Cerrar documento">${icon('close', 12)}</button></div>`,
      )
      .join('');
    strip.querySelector('.dt-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  return {
    update: (i) => {
      pct.textContent = i.empty ? '' : `${Math.round(i.zoom * 100)}%`;
      doc.textContent = i.empty ? '' : `${i.width} × ${i.height} px · ${i.dpi} ppp`;
      mem.textContent = i.empty ? '' : `Historial ${i.memory}`;
      drawTabs(i.tabs);
      const name = strip.querySelector('.dt-tab.on .dt-name');
      if (name) name.textContent = `${i.dirty ? '● ' : ''}${i.title} (${i.width} × ${i.height} px ${i.dpi} ppp ${(i.zoom * 100).toFixed(1)}%)`;
    },
    setPointer: (x, y) => {
      pos.textContent = `${Math.round(x)}, ${Math.round(y)} px`;
    },
    setNotices: (unread, worst) => {
      badge.hidden = unread === 0;
      badge.textContent = unread > 9 ? '9+' : String(unread);
      if (worst) bell.dataset.level = worst;
      else delete bell.dataset.level;
      bell.title = unread ? `Avisos (${unread} sin leer)` : 'Avisos';
    },
  };
}
