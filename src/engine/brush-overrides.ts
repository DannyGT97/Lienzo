// What a person changed on a sub tool, kept apart from the preset it started as. Only the differences are stored, so a
// preset that later improves still reaches every setting the person never touched. Lengths are stored per 150 dpi (the
// unit presets are written in) and scaled to the page resolution when applied. Nothing here touches the DOM or storage.

import type { BrushSettings } from './brush';
import { BRUSH_PARAMS, paramByKey, snapValue, type BrushParam } from './brush-params';

/** Values by setting key, in the unit the setting is shown in (booleans for toggles). */
export type ParamValues = Record<string, number | boolean>;

/** The stored changes of each sub tool, by sub tool id. */
export type OverrideStore = Record<string, ParamValues>;

const scaled = (p: BrushParam, unit: number): number => (p.kind === 'number' && p.length ? unit : 1);
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Every editable setting of the brush, lengths divided by `unit` (page pixels per 150-dpi pixel). */
export function snapshotParams(s: Readonly<BrushSettings>, unit: number): ParamValues {
  const out: ParamValues = {};
  for (const p of BRUSH_PARAMS) {
    const v = p.get(s);
    out[p.key] = typeof v === 'number' ? round3(v / scaled(p, unit)) : v;
  }
  return out;
}

/** The settings of `now` that differ from `base` (both from `snapshotParams`); `unit` is the current page unit. */
export function diffParams(base: ParamValues, now: ParamValues, unit: number): ParamValues {
  const out: ParamValues = {};
  for (const p of BRUSH_PARAMS) {
    const a = base[p.key];
    const b = now[p.key];
    if (b === undefined || a === b) continue;
    // Closer than half a step is the same value (a preset's fractions are rounded to the step when applied).
    if (p.kind === 'number' && typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= p.step / 2 / scaled(p, unit)) continue;
    out[p.key] = b;
  }
  return out;
}

/** Stored (normalised) values as they are shown at this page unit, snapped to each setting's range and step. */
export function shownParams(values: ParamValues, unit: number): ParamValues {
  const out: ParamValues = {};
  for (const [key, v] of Object.entries(values)) {
    const p = paramByKey(key);
    if (!p) continue;
    if (p.kind === 'toggle' && typeof v === 'boolean') out[key] = v;
    else if (p.kind === 'number' && typeof v === 'number') out[key] = snapValue(p, v * scaled(p, unit));
    else if (p.kind === 'choice' && typeof v === 'number' && p.options.some((o) => o.value === v)) out[key] = v;
  }
  return out;
}

/** Read what was stored, dropping anything that is not a known setting of the right kind. Never throws. */
export function parseStore(raw: unknown): OverrideStore {
  const store: OverrideStore = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return store;
  for (const [subId, entry] of Object.entries(raw)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const values: ParamValues = {};
    for (const [key, v] of Object.entries(entry)) {
      const p = paramByKey(key);
      if (p?.kind === 'number' && typeof v === 'number' && Number.isFinite(v)) values[key] = v;
      else if (p?.kind === 'toggle' && typeof v === 'boolean') values[key] = v;
      else if (p?.kind === 'choice' && typeof v === 'number' && p.options.some((o) => o.value === v)) values[key] = v;
    }
    if (Object.keys(values).length > 0) store[subId] = values;
  }
  return store;
}

/** A copy of the store with this sub tool's changes replaced (or removed when there are none). */
export function withOverrides(store: Readonly<OverrideStore>, subId: string, values: ParamValues): OverrideStore {
  const next = { ...store };
  if (Object.keys(values).length === 0) delete next[subId];
  else next[subId] = values;
  return next;
}
