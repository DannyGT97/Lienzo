import { commands } from './commands';
import { MENUS, type MenuEntry } from './spec/menus';
import { snapValue } from '../engine/brush-params';
import { valueField } from './value-field';

// Dialogs of the main menus. Their layout is complete; controls that do nothing yet are disabled and say so.

// A field with a `key` is live: it starts from the value in the dialog's draft and writes its changes back there.
// Fields without a key are still placeholders and stay disabled.
type Field =
  | { kind: 'select'; label: string; options: string[]; value?: string; key?: string; ids?: string[] }
  | { kind: 'number'; label: string; value: number; unit?: string; key?: string; min?: number; max?: number }
  /** A whole number picked with a slider, − / + buttons, the number itself and optional quick values; moves on a step grid. */
  | { kind: 'range'; label: string; value: number; unit: string; key: string; min: number; max: number; step: number; presets?: readonly number[] }
  | { kind: 'check'; label: string; value?: boolean; key?: string }
  | { kind: 'text'; label: string; value?: string }
  | { kind: 'info'; label: string; value: string }
  /** A title that groups the fields below it. */
  | { kind: 'heading'; label: string };

/** What a live dialog edits: key → value, shared by all its pages. */
type Draft = Record<string, unknown>;

interface Page {
  id: string;
  title: string;
  fields: Field[];
  note?: string;
}

const SOON = 'Todavía no disponible';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function renderField(f: Field, draft?: Draft): HTMLElement {
  if (f.kind === 'heading') return el('h5', 'sd-group', esc(f.label));
  const row = el('label', 'sd-field');
  row.append(el('span', 'sd-label', esc(f.label)));
  const live = draft && f.kind !== 'text' && f.kind !== 'info' && f.key ? { draft, key: f.key } : null;
  if (f.kind === 'select') {
    const s = el('select');
    // Live selects keep stable ids apart from the labels, so a translation never changes what is stored.
    const ids = f.ids ?? f.options;
    const current = live ? String(live.draft[live.key]) : undefined;
    const at = current === undefined ? -1 : ids.indexOf(current);
    f.options.forEach((o, n) => s.append(new Option(o, ids[n]!, false, at >= 0 ? n === at : o === (f.value ?? f.options[0]))));
    if (live) s.addEventListener('change', () => (live.draft[live.key] = s.value));
    else {
      s.disabled = true;
      s.title = SOON;
    }
    row.append(s);
  } else if (f.kind === 'number') {
    const wrap = el('span', 'sd-num');
    const i = el('input');
    i.type = 'number';
    const start = live ? live.draft[live.key] : undefined;
    i.value = String(typeof start === 'number' ? start : f.value);
    if (f.min !== undefined) i.min = String(f.min);
    if (f.max !== undefined) i.max = String(f.max);
    if (live) {
      // An unfinished entry (empty, a lone minus) leaves the draft alone; the stored value is clamped when it is applied.
      i.addEventListener('input', () => {
        if (i.value.trim() !== '' && Number.isFinite(i.valueAsNumber)) live.draft[live.key] = i.valueAsNumber;
      });
    } else {
      i.disabled = true;
      i.title = SOON;
    }
    wrap.append(i);
    if (f.unit) wrap.append(el('span', 'sd-unit', esc(f.unit)));
    row.append(wrap);
  } else if (f.kind === 'range') {
    row.classList.add('sd-field-range');
    row.append(rangeControl(f, live ? live.draft : undefined));
  } else if (f.kind === 'check') {
    row.classList.add('sd-check');
    const i = el('input');
    i.type = 'checkbox';
    const start = live ? live.draft[live.key] : undefined;
    i.checked = typeof start === 'boolean' ? start : !!f.value;
    if (live) i.addEventListener('change', () => (live.draft[live.key] = i.checked));
    else {
      i.disabled = true;
      i.title = SOON;
    }
    row.prepend(i);
  } else if (f.kind === 'text') {
    const i = el('input');
    i.type = 'text';
    i.value = f.value ?? '';
    i.disabled = true;
    i.title = SOON;
    row.append(i);
  } else {
    row.append(el('span', 'sd-value', esc(f.value)));
  }
  return row;
}

/** The control of a `range` field: every way of changing the value lands on the same step grid and in the same draft. */
function rangeControl(f: Extract<Field, { kind: 'range' }>, draft?: Draft): HTMLElement {
  const scale = { min: f.min, max: f.max, step: f.step, decimals: f.step < 1 ? 1 : 0 };
  const stored = draft?.[f.key];
  const initial = snapValue(scale, typeof stored === 'number' && Number.isFinite(stored) ? stored : f.value);
  const field = valueField({
    scale,
    unit: f.unit,
    label: f.label,
    choices: f.presets,
    onChange: (v) => {
      if (draft) draft[f.key] = v;
    },
  });
  field.setValue(initial);
  if (draft) draft[f.key] = initial;
  return field.el;
}

/** `onOk` makes Aceptar live: it runs before the dialog closes. Without it the dialog has nothing to apply and Aceptar stays disabled. */
function openDialog(title: string, build: (body: HTMLElement) => void, buttons: 'close' | 'okcancel' = 'close', wide = false, onOk?: () => void): Promise<void> {
  return new Promise((resolve) => {
    const dlg = el('dialog', 'app-dialog spec-dialog' + (wide ? ' wide' : ''));
    const done = (): void => {
      if (dlg.open) dlg.close();
      dlg.remove();
      resolve();
    };
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      done();
    });
    const body = el('div', 'sd-body');
    build(body);
    const row = el('div', 'row');
    if (buttons === 'okcancel') {
      const ok = el('button', 'primary', 'Aceptar');
      if (onOk) {
        ok.addEventListener('click', () => {
          onOk();
          done();
        });
      } else {
        ok.disabled = true;
        ok.title = SOON;
      }
      const cancel = el('button', '', 'Cancelar');
      cancel.addEventListener('click', done);
      row.append(ok, cancel);
    } else {
      const close = el('button', 'primary', 'Cerrar');
      close.addEventListener('click', done);
      row.append(close);
    }
    dlg.append(el('h3', '', esc(title)), body, row);
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** Dialog with a list of categories on the left and the settings of the chosen one on the right. */
function paged(title: string, pages: Page[], buttons: 'close' | 'okcancel', draft?: Draft, onOk?: () => void): Promise<void> {
  return openDialog(
    title,
    (body) => {
      body.classList.add('sd-paged');
      const nav = el('ul', 'sd-nav');
      const pane = el('div', 'sd-pane');
      const show = (p: Page): void => {
        nav.querySelectorAll('li').forEach((li) => li.classList.toggle('on', li.dataset.id === p.id));
        pane.replaceChildren(el('h4', '', esc(p.title)));
        if (p.note) pane.append(el('p', 'sd-note', esc(p.note)));
        for (const f of p.fields) pane.append(renderField(f, draft));
      };
      for (const p of pages) {
        const li = el('li', '', esc(p.title));
        li.dataset.id = p.id;
        li.addEventListener('click', () => show(p));
        nav.append(li);
      }
      body.append(nav, pane);
      show(pages[0]!);
    },
    buttons,
    true,
    onOk,
  );
}

// ---- Canvas properties, resolution, layer properties ---------------------------------------------------------

export interface LayerInfo {
  name: string;
  kind: string;
  blend: string;
  opacity: number;
  clip: boolean;
  lockAlpha: boolean;
}

export function openLayerSettings(l: LayerInfo): Promise<void> {
  return paged(
    'Propiedades de la capa',
    [
      {
        id: 'general',
        title: 'General',
        note: 'Para cambiar el nombre, haz doble clic en la capa o usa el botón de renombrar.',
        fields: [
          { kind: 'info', label: 'Nombre', value: l.name },
          { kind: 'info', label: 'Tipo', value: l.kind },
          { kind: 'info', label: 'Modo de mezcla', value: l.blend },
          { kind: 'info', label: 'Opacidad', value: `${Math.round(l.opacity * 100)} %` },
          { kind: 'check', label: 'Ajustar a capa inferior', value: l.clip },
          { kind: 'check', label: 'Bloquear transparencia', value: l.lockAlpha },
        ],
      },
      {
        id: 'color',
        title: 'Color y efectos',
        fields: [
          { kind: 'select', label: 'Expresión de color', options: ['Color', 'Gris', 'Monocromo'] },
          { kind: 'check', label: 'Usar color de capa' },
          { kind: 'check', label: 'Efecto de borde' },
          { kind: 'check', label: 'Capa de borrador' },
          { kind: 'check', label: 'Capa de referencia' },
        ],
      },
    ],
    'okcancel',
  );
}

// ---- Shortcut settings ----------------------------------------------------------------------------------------

interface ShortcutRow {
  menu: string;
  label: string;
  shortcut: string;
  id: string;
}

function collectShortcuts(): ShortcutRow[] {
  const rows: ShortcutRow[] = [];
  const walk = (menu: string, items: MenuEntry[]): void => {
    for (const e of items) {
      if ('sep' in e) continue;
      if ('items' in e) walk(menu, e.items);
      else rows.push({ menu, label: e.label, shortcut: e.shortcut ?? '', id: e.id });
    }
  };
  for (const m of MENUS) walk(m.label, m.items);
  return rows;
}

export function openShortcutSettings(): Promise<void> {
  const rows = collectShortcuts();
  return openDialog(
    'Ajustes de atajos',
    (body) => {
      body.classList.add('sd-shortcuts');
      const search = el('input');
      search.type = 'search';
      search.placeholder = 'Buscar comando…';
      const note = el('p', 'sd-note', 'Por ahora solo se muestran los atajos; cambiarlos llegará más adelante.');
      const table = el('table', 'sd-table');
      const render = (q: string): void => {
        const n = q.trim().toLowerCase();
        table.replaceChildren(el('thead', '', '<tr><th>Menú</th><th>Comando</th><th>Atajo</th></tr>'));
        const tb = el('tbody');
        for (const r of rows) {
          if (n && !`${r.menu} ${r.label} ${r.shortcut}`.toLowerCase().includes(n)) continue;
          const tr = el('tr', commands.has(r.id) ? '' : 'planned', `<td>${esc(r.menu)}</td><td>${esc(r.label.replace(/…$/, ''))}</td><td>${esc(r.shortcut)}</td>`);
          tb.append(tr);
        }
        table.append(tb);
      };
      search.addEventListener('input', () => render(search.value));
      render('');
      const scroller = el('div', 'sd-scroll');
      scroller.append(table);
      body.append(search, note, scroller);
    },
    'close',
    true,
  );
}
