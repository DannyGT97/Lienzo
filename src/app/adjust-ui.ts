import { isAdjustable, type AdjustSettings } from '../engine/adjust';
import type { Document, Layer } from '../engine/document';
import { FILTERS } from '../engine/filters';
import type { Command, History } from '../engine/history';

export interface AdjustDeps {
  doc: () => Document;
  history: () => History;
  /** Redraw the whole view (the correction changes every pixel below the layer). */
  render: () => void;
  refreshUi: () => void;
  /** The element the floating panel is placed in. */
  host: HTMLElement;
}

/**
 * The parameter panel of an adjustment layer. Moving a slider changes the layer's settings and redraws at once;
 * closing the panel keeps the result as one undoable step ("Cerrar"), and "Cancelar" puts the old values back.
 * Own design: Clip Studio's panel for these layers has not been analysed.
 */
export function createAdjustUi(d: AdjustDeps): {
  readonly active: boolean;
  open(layer: Layer): boolean;
  close(keep: boolean): void;
} {
  interface Session {
    layer: Layer;
    before: AdjustSettings;
    panel: HTMLElement;
  }
  let s: Session | null = null;

  const clone = (a: AdjustSettings): AdjustSettings => ({ ...a, values: { ...a.values }, main: [...a.main], sub: [...a.sub] });

  function setting(layer: Layer, to: AdjustSettings, redraw: boolean): void {
    layer.adjust = clone(to);
    if (redraw) d.render();
  }

  function buildPanel(layer: Layer): HTMLElement {
    const a = layer.adjust!;
    const def = FILTERS[a.filter]!;
    const panel = document.createElement('div');
    panel.id = 'filter-panel';
    const title = document.createElement('strong');
    title.textContent = `${layer.name} · ${def.title}`;
    panel.append(title);
    if (def.params.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Esta corrección no tiene parámetros: actúa sobre todo lo que hay debajo.';
      panel.append(hint);
    }
    for (const param of def.params) {
      const label = document.createElement('label');
      const text = document.createElement('span');
      const readout = document.createElement('output');
      const unit = param.unit ?? '';
      const current = a.values[param.id] ?? param.value;
      text.textContent = param.label;
      readout.textContent = `${current}${unit}`;
      const range = document.createElement('input');
      range.type = 'range';
      range.min = String(param.min);
      range.max = String(param.max);
      range.step = String(param.step);
      range.value = String(current);
      range.addEventListener('input', () => {
        if (!s) return;
        const value = Number(range.value);
        readout.textContent = `${value}${unit}`;
        const now = s.layer.adjust!;
        setting(s.layer, { ...now, values: { ...now.values, [param.id]: value } }, true);
      });
      label.append(text, readout, range);
      panel.append(label);
    }
    const row = document.createElement('div');
    row.className = 'row';
    const ok = document.createElement('button');
    ok.className = 'primary';
    ok.textContent = 'Cerrar';
    ok.addEventListener('click', () => api.close(true));
    const no = document.createElement('button');
    no.textContent = 'Cancelar';
    no.addEventListener('click', () => api.close(false));
    row.append(ok, no);
    panel.append(row);
    return panel;
  }

  const api = {
    get active() {
      return s !== null;
    },
    open(layer: Layer): boolean {
      if (!layer.adjust || !isAdjustable(layer.adjust.filter) || !FILTERS[layer.adjust.filter]) return false;
      if (s) api.close(true);
      const panel = buildPanel(layer);
      d.host.append(panel);
      s = { layer, before: clone(layer.adjust), panel };
      return true;
    },
    close(keep: boolean): void {
      if (!s) return;
      const { layer, before, panel } = s;
      s = null;
      panel.remove();
      const after = layer.adjust ? clone(layer.adjust) : before;
      if (!keep) {
        setting(layer, before, true);
      } else if (JSON.stringify(before) !== JSON.stringify(after)) {
        const cmd: Command = {
          region: null,
          label: 'Cambiar corrección',
          undo: () => setting(layer, before, true),
          redo: () => setting(layer, after, true),
        };
        d.history().push(cmd);
      }
      d.refreshUi();
    },
  };
  return api;
}
