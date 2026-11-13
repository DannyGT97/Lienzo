import type { BrushSettings } from '../../engine/brush';
import {
  BRUSH_CATEGORIES,
  BRUSH_PARAMS,
  paramLabel,
  paramsFor,
  toolFamily,
  whyInactive,
  type BrushParam,
  type ChoiceParam,
  type NumberParam,
  type ToggleParam,
  type ToolFamily,
} from '../../engine/brush-params';
import type { PaletteBuilder } from '../palette-dock';
import { valueField } from '../value-field';

export interface BrushDetailDeps {
  /** The tool that is selected now. */
  tool: () => string;
  /** The brush as it stands (read on every refresh, never kept). */
  settings: () => Readonly<BrushSettings>;
  /** Change one setting; `shown` is in the unit the setting is displayed in (see `BrushParam`). */
  set: (key: string, shown: number | boolean) => void;
  /** The sub tool these settings belong to and which of them the person changed from its preset; null when they belong to none. */
  subTool: () => { name: string; modified: ReadonlySet<string> } | null;
  /** Put one changed setting, or all of them (no key), back to what the preset gives. */
  restore: (key?: string) => void;
}

const OPEN_KEY = 'lienzo.brushDetailOpen';
const DEFAULT_OPEN = ['tip', 'ink'];

function loadOpen(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? 'null');
    if (Array.isArray(raw)) return new Set(raw.filter((v): v is string => typeof v === 'string'));
  } catch {
    // Storage can be unavailable; the default categories open.
  }
  return new Set(DEFAULT_OPEN);
}

function saveOpen(open: ReadonlySet<string>): void {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
  } catch {
    // Not remembering which categories are open costs nothing.
  }
}

interface Row {
  param: BrushParam;
  el: HTMLElement;
  label: HTMLElement;
  note: HTMLElement;
  /** Puts this one setting back to the preset; shown only while it differs. */
  reset: HTMLButtonElement;
  /** Disables the controls while the setting has no effect. */
  setDisabled(disabled: boolean): void;
  update(settings: Readonly<BrushSettings>, family: ToolFamily): void;
}

/** "Detalle de subherramienta": the settings of the selected brush, grouped in collapsible categories. */
export function brushDetailPalette(d: BrushDetailDeps): PaletteBuilder {
  return (body) => {
    body.classList.add('bd-body');
    const head = document.createElement('div');
    head.className = 'bd-head';
    const title = document.createElement('span');
    title.className = 'bd-title';
    const restoreAll = document.createElement('button');
    restoreAll.type = 'button';
    restoreAll.className = 'bd-restore';
    restoreAll.textContent = 'Restaurar preset';
    restoreAll.title = 'Devuelve todos los ajustes de esta subherramienta a como vienen de serie';
    restoreAll.addEventListener('click', () => d.restore());
    head.append(title, restoreAll);
    const intro = document.createElement('p');
    intro.className = 'ph-note bd-intro';
    body.append(head, intro);

    const resetButton = (p: BrushParam): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bd-reset';
      b.textContent = '↺';
      b.title = 'Volver al valor del preset';
      b.setAttribute('aria-label', `Restaurar ${p.label} al valor del preset`);
      b.addEventListener('click', () => d.restore(p.key));
      return b;
    };
    const titled = (label: HTMLElement, reset: HTMLButtonElement): HTMLElement => {
      const line = document.createElement('div');
      line.className = 'bd-title-line';
      line.append(label, reset);
      return line;
    };

    const open = loadOpen();
    const rows: Row[] = [];
    const sections = new Map<string, { details: HTMLDetailsElement; rows: Row[] }>();

    const numberRow = (p: NumberParam): Row => {
      const el = document.createElement('div');
      el.className = 'bd-row';
      const label = document.createElement('label');
      label.className = 'bd-label';
      const field = valueField({
        scale: p,
        unit: p.unit,
        label: p.label,
        choices: p.choices,
        onChange: (v) => {
          d.set(p.key, v);
          field.setValue(p.get(d.settings())); // what the brush kept (it may have clamped)
        },
      });
      const note = document.createElement('div');
      note.className = 'bd-note';
      const line = document.createElement('div');
      line.className = 'bd-line';
      line.append(field.el);
      const reset = resetButton(p);
      el.append(titled(label, reset), line, note);
      if (p.hint) el.title = p.hint;

      return {
        param: p,
        el,
        label,
        note,
        reset,
        setDisabled: field.setDisabled,
        update(settings, family) {
          label.textContent = paramLabel(p, family);
          field.setValue(p.get(settings)); // leaves alone the control the person is holding
        },
      };
    };

    const toggleRow = (p: ToggleParam): Row => {
      const el = document.createElement('div');
      el.className = 'bd-row bd-toggle';
      const label = document.createElement('label');
      label.className = 'bd-check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      const text = document.createElement('span');
      label.append(box, text);
      const note = document.createElement('div');
      note.className = 'bd-note';
      const reset = resetButton(p);
      el.append(titled(label, reset), note);
      if (p.hint) el.title = p.hint;
      box.addEventListener('change', () => d.set(p.key, box.checked));
      return {
        param: p,
        el,
        label: text,
        note,
        reset,
        setDisabled: (disabled) => (box.disabled = disabled),
        update(settings, family) {
          text.textContent = paramLabel(p, family);
          box.checked = p.get(settings);
        },
      };
    };

    const choiceRow = (p: ChoiceParam): Row => {
      const el = document.createElement('div');
      el.className = 'bd-row';
      const label = document.createElement('label');
      label.className = 'bd-label';
      const select = document.createElement('select');
      select.className = 'bd-choice';
      select.setAttribute('aria-label', p.label);
      for (const o of p.options) select.append(new Option(o.label, String(o.value)));
      const note = document.createElement('div');
      note.className = 'bd-note';
      const reset = resetButton(p);
      el.append(titled(label, reset), select, note);
      if (p.hint) el.title = p.hint;
      select.addEventListener('change', () => {
        d.set(p.key, Number(select.value));
        select.value = String(p.get(d.settings()));
      });
      return {
        param: p,
        el,
        label,
        note,
        reset,
        setDisabled: (disabled) => (select.disabled = disabled),
        update(settings, family) {
          label.textContent = paramLabel(p, family);
          select.value = String(p.get(settings));
        },
      };
    };

    for (const category of BRUSH_CATEGORIES) {
      const details = document.createElement('details');
      details.className = 'bd-cat';
      details.open = open.has(category.id);
      const summary = document.createElement('summary');
      summary.textContent = category.label;
      const content = document.createElement('div');
      content.className = 'bd-content';
      details.append(summary, content);
      details.addEventListener('toggle', () => {
        if (details.open) open.add(category.id);
        else open.delete(category.id);
        saveOpen(open);
      });
      const own: Row[] = [];
      for (const p of BRUSH_PARAMS) {
        if (p.category !== category.id) continue;
        const row = p.kind === 'number' ? numberRow(p) : p.kind === 'choice' ? choiceRow(p) : toggleRow(p);
        own.push(row);
        rows.push(row);
        content.append(row.el);
      }
      sections.set(category.id, { details, rows: own });
      body.append(details);
    }

    const empty = document.createElement('p');
    empty.className = 'ph-note bd-empty';
    empty.textContent = 'Esta herramienta no tiene ajustes de pincel.';
    body.append(empty);

    const refresh = (): void => {
      const family = toolFamily(d.tool());
      const settings = d.settings();
      const offered = new Set<BrushParam>(paramsFor(family));
      empty.hidden = family !== 'none';
      intro.hidden = family !== 'blend';
      intro.textContent = 'Esta herramienta solo usa tamaño, dureza, antialiasing, intensidad y presión → tamaño.';
      const sub = d.subTool();
      head.hidden = family === 'none';
      title.textContent = sub ? sub.name : 'Ajustes actuales';
      title.title = sub ? 'Los cambios se guardan en esta subherramienta' : 'Esta herramienta no guarda sus ajustes aparte';
      restoreAll.hidden = !sub || sub.modified.size === 0;
      for (const row of rows) {
        const shown = offered.has(row.param);
        row.el.hidden = !shown;
        if (!shown) continue;
        const changed = sub?.modified.has(row.param.key) ?? false;
        row.el.classList.toggle('modified', changed);
        row.reset.hidden = !changed;
        row.update(settings, family);
        const why = whyInactive(row.param, settings);
        row.el.classList.toggle('inactive', why !== undefined);
        row.setDisabled(why !== undefined);
        row.note.textContent = why ?? '';
        row.note.hidden = why === undefined;
      }
      for (const { details, rows: own } of sections.values()) details.hidden = !own.some((r) => offered.has(r.param));
    };
    refresh();
    return { refresh };
  };
}
