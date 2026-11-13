// What a person changed in the option panel of a sub tool (selection tolerance, gradient shape, ruler counts…), kept apart
// from the panel's factory values, like the brush settings are (engine/brush-overrides.ts). Only the differences are
// stored, per sub tool. The panel controls are shared by several sub tools, so on choosing a sub tool they go back to the
// factory values first and the stored changes are applied on top. Nothing here touches storage.

/** The option controls that belong to the chosen sub tool. Controls that follow a selected object (balloons, tone layers, panels) are not in the list. */
export const OPTION_CONTROLS: readonly string[] = [
  'sel-mode', 'sel-tol', 'sel-contig', 'sel-gap', 'sel-all', 'sel-grow', 'sel-aa',
  'grad-shape', 'grad-repeat', 'grad-dither', 'grad-manga', 'grad-manga-shape', 'grad-manga-lpi', 'grad-manga-angle',
  'pick-size', 'fig-fill', 'liq-mode', 'vec-strength', 'vec-reach', 'vec-thick',
  'ruler-persp', 'ruler-fig', 'ruler-special', 'ruler-count', 'ruler-gap',
];

/** Control id -> its value: a string for ranges, numbers and selects, a boolean for checkboxes. */
export type ControlValues = Record<string, string | boolean>;

/** The stored changes of each sub tool, by sub tool id. */
export type ControlStore = Record<string, ControlValues>;

const known = new Set(OPTION_CONTROLS);

/** The settings of `now` that differ from `base` (both whole snapshots of the controls). */
export function diffControls(base: Readonly<ControlValues>, now: Readonly<ControlValues>): ControlValues {
  const out: ControlValues = {};
  for (const id of OPTION_CONTROLS) {
    const b = now[id];
    if (b !== undefined && base[id] !== b) out[id] = b;
  }
  return out;
}

/** Read what was stored, dropping any control that is not a known one or has the wrong kind of value. Never throws. */
export function parseControlStore(raw: unknown): ControlStore {
  const store: ControlStore = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return store;
  for (const [subId, entry] of Object.entries(raw)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const values: ControlValues = {};
    for (const [id, v] of Object.entries(entry)) {
      if (known.has(id) && (typeof v === 'string' || typeof v === 'boolean')) values[id] = v;
    }
    if (Object.keys(values).length > 0) store[subId] = values;
  }
  return store;
}

/** A copy of the store with this sub tool's changes replaced (or removed when there are none). */
export function withControls(store: Readonly<ControlStore>, subId: string, values: ControlValues): ControlStore {
  const next = { ...store };
  if (Object.keys(values).length === 0) delete next[subId];
  else next[subId] = values;
  return next;
}

/** A control of the page, as far as this module needs to read or set it. */
export interface ControlElement {
  type?: string;
  value: string;
  checked?: boolean;
  dispatchEvent(event: Event): boolean;
}

const isToggle = (el: ControlElement): boolean => el.type === 'checkbox';

/** Every option control of the page as it is now. */
export function readControls(find: (id: string) => ControlElement | null): ControlValues {
  const out: ControlValues = {};
  for (const id of OPTION_CONTROLS) {
    const el = find(id);
    if (el) out[id] = isToggle(el) ? !!el.checked : el.value;
  }
  return out;
}

/** Put these values in their controls and tell the page's own handlers (labels, hidden rows) through the usual events. */
export function writeControls(find: (id: string) => ControlElement | null, values: Readonly<ControlValues>): void {
  for (const [id, v] of Object.entries(values)) {
    const el = find(id);
    if (!el) continue;
    if (isToggle(el)) {
      if (typeof v !== 'boolean' || el.checked === v) continue;
      el.checked = v;
    } else {
      if (typeof v !== 'string' || el.value === v) continue;
      el.value = v;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
