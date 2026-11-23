/**
 * The Preferences window: a list of sections, a search box, the options of the chosen section, and changes that apply as they
 * are made. What is offered lives in `prefs-model.ts`; this file only draws it and reports changes (`apply`).
 *
 * On a narrow screen (a phone) the list and the options are two screens: the list first, a back button from a section.
 */
import { valueField, type ValueField } from './value-field';
import {
  autosaveHint,
  buildSections,
  changedCount,
  isChanged,
  isEditable,
  isLive,
  itemsOf,
  restore,
  search,
  fold,
  type IconName,
  type PrefItem,
  type Values,
} from './prefs-model';

export interface PreferencesOptions {
  /** The preferences as they are now. */
  values: Values;
  /** What each one is at the start (a restore goes back to these). */
  defaults: Values;
  /** Facts about the memory, read when the window opens. */
  memory: [string, string][];
  /**
   * The person changed something (a slider counts when it is let go). The new values are applied and kept; what comes back is how
   * they were really kept (a number outside its range comes back inside it), and the window shows that.
   */
  apply(values: Values): Values;
  /** What the buttons of the window open. */
  actions: Record<'shortcuts' | 'updates' | 'about', () => void>;
}

const SOON = 'Todavía no disponible';
const SHOW_SOON_KEY = 'lienzo.prefsShowSoon';

const ICONS: Record<IconName, string> = {
  pen: '<path d="M4 20l4-1 10-10-3-3L5 16z"/><path d="M14 7l3 3"/>',
  canvas: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  ui: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  layers: '<path d="M12 3 3 8l9 5 9-5z"/><path d="m3 13 9 5 9-5"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  perf: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 18 4-6"/>',
  tablet: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M11 18h2"/>',
  ruler: '<path d="m4 16 12-12 4 4L8 20z"/><path d="m8 12 2 2m1-5 2 2m1-5 2 2"/>',
  keys: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 11h.01M11 11h.01M15 11h.01M8 14h8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function icon(name: IconName, size = 18): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(size));
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name];
  return s;
}

/** `text` with the part that matches `query` in a <mark> (only when both fold to the same length, so the positions agree). */
function highlighted(parent: HTMLElement, text: string, query: string): void {
  const q = fold(query.trim());
  const folded = fold(text);
  const at = q && folded.length === text.length ? folded.indexOf(q) : -1;
  if (at < 0) {
    parent.textContent = text;
    return;
  }
  const mark = el('mark', '', text.slice(at, at + q.length));
  parent.replaceChildren(document.createTextNode(text.slice(0, at)), mark, document.createTextNode(text.slice(at + q.length)));
}

function readShowSoon(): boolean {
  try {
    return localStorage.getItem(SHOW_SOON_KEY) !== '0';
  } catch {
    return true;
  }
}
function writeShowSoon(on: boolean): void {
  try {
    localStorage.setItem(SHOW_SOON_KEY, on ? '1' : '0');
  } catch {
    /* the choice lasts until the window closes */
  }
}

interface Row {
  el: HTMLElement;
  /** Bring the row in line with the current values. */
  sync(): void;
}

/** Open the window. Resolves when it is closed. */
export function openPreferencesWindow(o: PreferencesOptions): Promise<void> {
  return new Promise((resolve) => {
    const sections = buildSections(o.memory);
    const values: Values = { ...o.values };
    let current = sections[0]!.id;
    let query = '';
    let showSoon = readShowSoon();
    let narrow = false;
    let view: 'list' | 'page' = 'page';
    let rows: Row[] = [];
    let statusTimer = 0;

    const dlg = el('dialog', 'pw-dialog');
    dlg.setAttribute('aria-label', 'Preferencias');

    // ---- header ----
    const back = el('button', 'pw-back', '‹');
    back.type = 'button';
    back.setAttribute('aria-label', 'Volver a las secciones');
    const title = el('h1', 'pw-title', 'Preferencias');
    const searchBox = el('label', 'pw-search');
    const input = el('input');
    input.type = 'search';
    input.placeholder = 'Buscar una opción…';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Buscar una opción');
    const slash = el('kbd', '', '/');
    searchBox.append(searchGlyph(), input, slash);
    const closeX = el('button', 'pw-x', '×');
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Cerrar');
    const head = el('div', 'pw-head');
    head.append(back, title, searchBox, closeX);

    // ---- body ----
    const nav = el('nav', 'pw-nav');
    nav.setAttribute('aria-label', 'Secciones');
    const main = el('main', 'pw-main');
    const body = el('div', 'pw-body');
    body.append(nav, main);

    // ---- footer ----
    const status = el('span', 'pw-status', 'Los cambios se aplican al momento.');
    const soonLabel = el('label', 'pw-soon');
    const soonSwitch = switchButton('Mostrar lo que aún no funciona', showSoon);
    soonSwitch.classList.add('small');
    soonLabel.append(soonSwitch, el('span', '', 'Mostrar lo que aún no funciona'));
    const resetAll = el('button', 'pw-link', 'Restablecer todo');
    resetAll.type = 'button';
    const done = el('button', 'pw-btn primary', 'Listo');
    done.type = 'button';
    const foot = el('div', 'pw-foot');
    foot.append(status, el('span', 'pw-sp'), soonLabel, resetAll, done);

    dlg.append(head, body, foot);

    // ---- behaviour ----
    const flash = (text: string): void => {
      status.textContent = text;
      window.clearTimeout(statusTimer);
      statusTimer = window.setTimeout(() => (status.textContent = 'Los cambios se aplican al momento.'), 2400);
    };

    /** The person changed `key`: apply it, take back what was really kept, and bring everything in line. */
    function commit(key?: string, value?: unknown): void {
      if (key !== undefined) values[key] = value;
      Object.assign(values, o.apply({ ...values }));
      syncAll();
    }

    function syncAll(): void {
      for (const r of rows) r.sync();
      renderNavState();
      resetAll.disabled = !sections.some((s) => changedCount(s, values, o.defaults) > 0);
    }

    function switchButton(label: string, on: boolean): HTMLButtonElement {
      const b = el('button', 'pw-sw');
      b.type = 'button';
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-label', label);
      b.setAttribute('aria-checked', String(on));
      return b;
    }

    function buildRow(item: PrefItem): Row {
      const live = isLive(item);
      const row = el('div', 'pw-row' + (live ? '' : ' soon') + (item.control.type === 'range' ? ' wide' : ''));
      const name = el('div', 'pw-t');
      const dot = el('span', 'pw-dot');
      dot.title = 'Distinto del valor por defecto';
      const label = el('span', 'pw-label');
      highlighted(label, item.label, query);
      const reset = el('button', 'pw-rst', '↺');
      reset.type = 'button';
      reset.title = 'Volver al valor por defecto';
      reset.setAttribute('aria-label', `Restablecer «${item.label}»`);
      reset.addEventListener('click', () => {
        commit(item.key, o.defaults[item.key]);
        flash('Valor por defecto.');
      });
      name.append(dot, label, reset);
      if (!live) name.append(el('span', 'pw-badge', 'Próximamente'));
      const hint = el('div', 'pw-h');
      if (item.hint) highlighted(hint, item.hint, query);
      const control = el('div', 'pw-ctl');
      row.append(name, hint, control);

      let syncControl: (disabled: boolean) => void = () => {};
      const c = item.control;
      if (c.type === 'toggle') {
        const b = switchButton(item.label, false);
        b.disabled = !live;
        if (!live) b.title = SOON;
        const shown = (): boolean => (live ? Boolean(values[item.key]) : Boolean(item.placeholder));
        b.addEventListener('click', () => commit(item.key, !Boolean(values[item.key])));
        syncControl = (disabled) => {
          b.setAttribute('aria-checked', String(shown()));
          b.disabled = disabled;
        };
        control.append(b);
      } else if (c.type === 'segmented') {
        const seg = el('div', 'pw-seg');
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', item.label);
        const buttons = c.options.map((opt) => {
          const b = el('button', '', opt.label);
          b.type = 'button';
          b.addEventListener('click', () => commit(item.key, opt.id));
          seg.append(b);
          return { b, id: opt.id };
        });
        syncControl = (disabled) => {
          const now = live ? values[item.key] : item.placeholder;
          for (const { b, id } of buttons) {
            b.classList.toggle('on', id === now);
            b.setAttribute('aria-pressed', String(id === now));
            b.disabled = disabled;
            if (!live) b.title = SOON;
          }
        };
        control.append(seg);
      } else if (c.type === 'select') {
        const s = el('select');
        s.setAttribute('aria-label', item.label);
        for (const opt of c.options) s.append(new Option(opt, opt, false, opt === item.placeholder));
        s.disabled = true;
        s.title = SOON;
        control.append(s);
      } else if (c.type === 'number') {
        const wrap = el('label', 'pw-num');
        const n = el('input');
        n.type = 'number';
        n.value = String(item.placeholder ?? '');
        n.disabled = true;
        n.title = SOON;
        n.setAttribute('aria-label', item.label);
        wrap.append(n, el('span', 'pw-unit', c.unit ?? ''));
        control.append(wrap);
      } else if (c.type === 'range') {
        const field: ValueField = valueField({
          scale: { min: c.min, max: c.max, step: c.step, decimals: 0 },
          unit: c.unit,
          label: item.label,
          choices: c.presets,
          onChange: (v) => {
            // While the slider moves only the window follows; the change is applied when it is let go (see 'change' below).
            values[item.key] = v;
            row.dataset.moving = '1';
            for (const r of rows) r.sync();
          },
        });
        field.el.addEventListener('change', () => {
          delete row.dataset.moving;
          commit();
        });
        syncControl = (disabled) => {
          if (!row.dataset.moving) field.setValue(Number(values[item.key]));
          field.setDisabled(disabled);
        };
        control.append(field.el);
      } else if (c.type === 'info') {
        control.append(el('span', 'pw-info', c.value));
      } else {
        const b = el('button', 'pw-btn', c.label);
        b.type = 'button';
        b.addEventListener('click', () => o.actions[c.action]());
        control.append(b);
      }

      return {
        el: row,
        sync() {
          const changed = live && isEditable(item) && isChanged(item, values, o.defaults);
          row.classList.toggle('changed', changed);
          const gated = item.needs !== undefined && !values[item.needs];
          row.classList.toggle('gated', gated);
          syncControl(!live || gated);
          if (item.key === 'autosaveMinutes') hint.textContent = autosaveHint(values);
        },
      };
    }

    function card(items: PrefItem[]): HTMLElement {
      const c = el('div', 'pw-card');
      for (const item of items) {
        const r = buildRow(item);
        rows.push(r);
        c.append(r.el);
      }
      return c;
    }

    function renderMain(): void {
      rows = [];
      main.replaceChildren();
      if (query.trim()) {
        const hits = search(sections, query, showSoon);
        const n = hits.reduce((a, h) => a + h.items.length, 0);
        main.append(el('h2', '', `Resultados para «${query.trim()}»`), el('p', 'pw-lead', `${n} ${n === 1 ? 'opción' : 'opciones'}`));
        if (!n) main.append(el('div', 'pw-empty', 'No hay ninguna opción con ese nombre. Prueba con otra palabra: «presión», «copia», «memoria», «tamaño»…'));
        for (const h of hits) {
          const t = el('div', 'pw-res');
          t.append(icon(h.section.icon, 15), el('b', '', h.section.title));
          main.append(t, card(h.items));
        }
        return;
      }
      const s = sections.find((x) => x.id === current)!;
      const bar = el('div', 'pw-secbar');
      const reset = el('button', 'pw-link', 'Restablecer esta sección');
      reset.type = 'button';
      reset.addEventListener('click', () => {
        Object.assign(values, restore(sections, values, o.defaults, s.id));
        commit();
        flash('Sección restablecida.');
      });
      bar.append(el('h2', '', s.title), reset);
      main.append(bar);
      if (s.lead) main.append(el('p', 'pw-lead', s.lead));
      for (const g of s.groups) {
        const items = g.items.filter((i) => showSoon || isLive(i));
        if (!items.length) continue;
        if (g.name) main.append(el('div', 'pw-group', g.name));
        if (g.callout) {
          const call = el('div', 'pw-callout');
          const body = el('span');
          body.innerHTML = g.callout; // fixed text of the model, with <b>
          call.append(el('span', '', 'ⓘ'), body);
          main.append(call);
        }
        main.append(card(items));
      }
      reset.disabled = changedCount(s, values, o.defaults) === 0;
    }

    function renderNav(): void {
      nav.replaceChildren();
      sections.forEach((s, i) => {
        if (i === 7) nav.append(el('div', 'pw-nav-sep'));
        // With the options that do nothing yet hidden, a section made only of those has nothing to show.
        if (!showSoon && !s.groups.some((g) => g.items.some(isLive))) return;
        const b = el('button');
        b.type = 'button';
        b.dataset.id = s.id;
        b.append(icon(s.icon), el('span', '', s.title), el('span', 'pw-count'));
        b.addEventListener('click', () => {
          query = '';
          input.value = '';
          current = s.id;
          view = 'page';
          render();
          main.scrollTop = 0;
        });
        nav.append(b);
      });
      renderNavState();
    }

    function renderNavState(): void {
      for (const b of nav.querySelectorAll('button')) {
        const s = sections.find((x) => x.id === b.dataset.id)!;
        b.classList.toggle('on', !query.trim() && s.id === current);
        const count = b.querySelector('.pw-count')!;
        const n = changedCount(s, values, o.defaults);
        count.textContent = n ? String(n) : '';
        (count as HTMLElement).title = n ? `${n} distintas del valor por defecto` : '';
      }
    }

    function render(): void {
      dlg.dataset.view = query.trim() ? 'page' : view;
      const s = sections.find((x) => x.id === current)!;
      title.textContent = narrow && view === 'page' && !query.trim() ? s.title : 'Preferencias';
      renderMain();
      renderNavState();
      syncAll();
    }

    // ---- events ----
    input.addEventListener('input', () => {
      query = input.value;
      render();
    });
    back.addEventListener('click', () => {
      view = 'list';
      render();
    });
    const close = (): void => {
      if (dlg.open) dlg.close();
      dlg.remove();
      observer.disconnect();
      window.removeEventListener('keydown', onKey, true);
      resolve();
    };
    closeX.addEventListener('click', close);
    done.addEventListener('click', close);
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      if (query.trim()) {
        query = '';
        input.value = '';
        render();
      } else close();
    });
    soonSwitch.addEventListener('click', () => {
      showSoon = !showSoon;
      soonSwitch.setAttribute('aria-checked', String(showSoon));
      writeShowSoon(showSoon);
      if (!showSoon && !itemsOf(sections.find((x) => x.id === current)!).some(isLive)) current = sections.find((x) => itemsOf(x).some(isLive))!.id;
      renderNav();
      render();
    });
    resetAll.addEventListener('click', () => {
      Object.assign(values, restore(sections, values, o.defaults));
      commit();
      flash('Todo vuelve a los valores por defecto.');
    });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === '/' && document.activeElement !== input && !(document.activeElement instanceof HTMLInputElement) && dlg.open && dlg === topDialog()) {
        e.preventDefault();
        input.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    // Narrow = a phone-sized window: the list and the options are two screens.
    const observer = new ResizeObserver(() => {
      const now = dlg.clientWidth < 640;
      if (now === narrow) return;
      narrow = now;
      dlg.classList.toggle('pw-narrow', narrow);
      if (narrow) view = 'list';
      render();
    });

    document.body.append(dlg);
    dlg.showModal();
    narrow = dlg.clientWidth < 640;
    dlg.classList.toggle('pw-narrow', narrow);
    view = narrow ? 'list' : 'page';
    observer.observe(dlg);
    renderNav();
    render();
    (nav.querySelector('button.on') as HTMLElement | null)?.focus({ preventScroll: true });
  });
}

/** The magnifying glass of the search box. */
function searchGlyph(): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', '14');
  s.setAttribute('height', '14');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>';
  return s;
}

/** The dialog on top of the others (a window opened from this one, like the shortcuts list, is above it). */
function topDialog(): Element | null {
  const open = [...document.querySelectorAll('dialog[open]')];
  return open[open.length - 1] ?? null;
}

