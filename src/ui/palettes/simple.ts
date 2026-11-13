import { icon } from '../icons';
import type { PaletteInstance } from '../palette-dock';

// ---- History palette -------------------------------------------------------------------------------

export interface HistoryDeps {
  labels: () => { undo: string[]; redo: string[] };
  /** Move through history: negative = undo that many steps, positive = redo. */
  jump: (delta: number) => void;
}

export function historyPalette(d: HistoryDeps): (body: HTMLElement) => PaletteInstance {
  return (body) => {
    body.classList.add('hist-body');
    const list = document.createElement('ol');
    list.className = 'hist-list';
    body.append(list);
    const render = (): void => {
      const { undo, redo } = d.labels();
      const rows = ['Documento', ...undo, ...redo];
      const current = undo.length;
      list.replaceChildren();
      rows.forEach((label, i) => {
        const li = document.createElement('li');
        li.className = 'hist-row' + (i === current ? ' on' : '') + (i > current ? ' future' : '');
        li.textContent = label;
        li.addEventListener('click', () => d.jump(i - current));
        list.append(li);
      });
      list.lastElementChild?.scrollIntoView({ block: 'nearest' });
      (list.querySelector('.on') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
    };
    render();
    return { refresh: render };
  };
}

// ---- Information palette ---------------------------------------------------------------------------

export type InfoRows = [label: string, value: string][];

export function infoPalette(rows: () => InfoRows): (body: HTMLElement) => PaletteInstance {
  return (body) => {
    body.classList.add('info-body');
    const table = document.createElement('dl');
    table.className = 'info-list';
    body.append(table);
    const render = (): void => {
      table.replaceChildren();
      for (const [k, v] of rows()) {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        table.append(dt, dd);
      }
    };
    render();
    return { refresh: render };
  };
}

// ---- Palettes that exist in the structure but have no behaviour yet -------------------------------------

export type Item =
  | { note: string }
  | { search: string }
  | { buttons: { icon: string; tip: string }[] }
  | { list: string[]; empty?: string }
  | { slider: string }
  | { select: string; options: string[] }
  | { checks: string[] }
  | { grid: number; cols?: number }
  | { gradient: true };

/** Every control here is disabled and says so: the palette is part of the layout, the feature comes later. */
export function placeholderPalette(items: Item[]): (body: HTMLElement) => PaletteInstance {
  return (body) => {
    body.classList.add('ph-body');
    const soon = 'Todavía no disponible';
    for (const it of items) {
      const el = document.createElement('div');
      el.className = 'ph-item';
      if ('note' in it) {
        el.className = 'ph-note';
        el.textContent = it.note;
      } else if ('search' in it) {
        el.innerHTML = `<div class="ph-search">${icon('search', 14)}<input type="text" disabled placeholder="${it.search}" title="${soon}" /></div>`;
      } else if ('buttons' in it) {
        el.className = 'nav-row ph-buttons';
        for (const b of it.buttons) {
          const btn = document.createElement('button');
          btn.className = 'nav-btn';
          btn.disabled = true;
          btn.title = `${b.tip} (${soon.toLowerCase()})`;
          btn.innerHTML = icon(b.icon, 16);
          el.append(btn);
        }
      } else if ('list' in it) {
        el.className = 'ph-list';
        if (!it.list.length) el.innerHTML = `<div class="ph-empty">${it.empty ?? 'Vacío'}</div>`;
        for (const row of it.list) {
          const r = document.createElement('div');
          r.className = 'ph-row planned';
          r.textContent = row;
          r.title = soon;
          el.append(r);
        }
      } else if ('slider' in it) {
        el.className = 'nav-row';
        el.innerHTML = `<span class="nav-lbl">${it.slider}</span><input type="range" disabled title="${soon}" />`;
      } else if ('select' in it) {
        el.innerHTML = `<label>${it.select} <select disabled title="${soon}">${it.options.map((o) => `<option>${o}</option>`).join('')}</select></label>`;
      } else if ('checks' in it) {
        el.className = 'ph-checks';
        for (const c of it.checks) {
          const l = document.createElement('label');
          l.innerHTML = `<input type="checkbox" disabled title="${soon}" /> ${c}`;
          el.append(l);
        }
      } else if ('grid' in it) {
        el.className = 'ph-grid';
        el.style.gridTemplateColumns = `repeat(${it.cols ?? 4}, 1fr)`;
        for (let i = 0; i < it.grid; i++) {
          const s = document.createElement('span');
          s.className = 'ph-slot';
          el.append(s);
        }
      } else {
        el.className = 'ph-gradient';
      }
      body.append(el);
    }
    return {};
  };
}
