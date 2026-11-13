// What a person can adjust about a brush, described as data. The detail palette is built from this list and nothing in it
// knows about the DOM or the renderer: each entry says which `BrushSettings` field it edits, in which unit it is shown,
// which kinds of tool really read it and when it has no effect yet. Add a setting by adding an entry (and the engine
// code that reads it); a setting the engine does not apply must not be listed here.

import { antialiasOf, type BrushSettings } from './brush';

/** Which engine a tool paints with. Only the settings that engine reads are offered. */
export type ToolFamily = 'stroke' | 'blend' | 'none';

export type BrushCategoryId = 'tip' | 'ink' | 'dynamics' | 'stroke' | 'texture';

export const BRUSH_CATEGORIES: readonly { id: BrushCategoryId; label: string }[] = [
  { id: 'tip', label: 'Punta' },
  { id: 'ink', label: 'Tinta' },
  { id: 'dynamics', label: 'Dinámica' },
  { id: 'stroke', label: 'Trazo' },
  { id: 'texture', label: 'Textura' },
];

interface ParamBase {
  key: string;
  category: BrushCategoryId;
  label: string;
  /** Tool families whose engine reads this setting; the others do not show it. */
  families: readonly ToolFamily[];
  /** Label used instead of `label` by some families (the blending tools use opacity as their strength). */
  labels?: Partial<Record<ToolFamily, string>>;
  /** Explains what the setting does, shown as a tooltip. */
  hint?: string;
  /** Present when the setting currently changes nothing; the text says why. Omitted when it is in effect. */
  inactive?: (s: Readonly<BrushSettings>) => string | undefined;
}

/** How a number is edited: its range, the step it snaps to, the decimals shown and how a slider maps onto it. */
export interface Scale {
  min: number;
  max: number;
  step: number;
  /** Decimals the number box shows. */
  decimals: number;
  /** The slider moves by a constant ratio (sizes); otherwise it is linear. */
  log?: boolean;
}

/** Sizes offered as quick picks (the size palette and the ▾ menu of every size field). */
export const SIZE_CHOICES: readonly number[] = [1, 2, 3, 5, 8, 10, 15, 20, 30, 40, 60, 80, 100, 150, 200, 300, 500, 800, 1200, 2000];

export interface NumberParam extends ParamBase, Scale {
  kind: 'number';
  /** Shown value in `unit`s (percent, pixels, degrees…), not the stored one. */
  get: (s: Readonly<BrushSettings>) => number;
  /** The settings to change so that `get` returns `shown`. */
  set: (shown: number) => Partial<BrushSettings>;
  unit: string;
  /** Values worth offering as quick picks next to the slider. */
  choices?: readonly number[];
  /** A length in page pixels: it scales with the page resolution (presets are written for 150 dpi). */
  length?: boolean;
}

export interface ToggleParam extends ParamBase {
  kind: 'toggle';
  get: (s: Readonly<BrushSettings>) => boolean;
  set: (on: boolean) => Partial<BrushSettings>;
}

/** One of a few named options, each stored as a number. */
export interface ChoiceParam extends ParamBase {
  kind: 'choice';
  options: readonly { value: number; label: string }[];
  get: (s: Readonly<BrushSettings>) => number;
  set: (value: number) => Partial<BrushSettings>;
}

export type BrushParam = NumberParam | ToggleParam | ChoiceParam;

const STROKE: readonly ToolFamily[] = ['stroke'];
const ALL: readonly ToolFamily[] = ['stroke', 'blend'];

const pct = (v: number): number => Math.round(v * 1000) / 10;
const orZero = (v: number | undefined): number => v ?? 0;

/** Stamps are laid down (instead of one swept shape) when the flow is below 100 % or a light touch lowers it. */
export function isStamping(s: Readonly<BrushSettings>): boolean {
  return (s.flow ?? 1) < 1 || orZero(s.pressureFlow) > 0;
}

export const BRUSH_PARAMS: readonly BrushParam[] = [
  // Punta
  { key: 'size', kind: 'number', category: 'tip', label: 'Tamaño', families: ALL, get: (s) => s.size, set: (v) => ({ size: v }), min: 1, max: 2000, step: 0.1, unit: 'px', decimals: 1, log: true, length: true, choices: SIZE_CHOICES },
  { key: 'hardness', kind: 'number', category: 'tip', label: 'Dureza', families: ALL, hint: '0 % = borde difuminado, 100 % = borde nítido', get: (s) => pct(s.hardness), set: (v) => ({ hardness: v / 100 }), min: 0, max: 100, step: 1, unit: '%', decimals: 0 },
  { key: 'nibThickness', kind: 'number', category: 'tip', label: 'Grosor de la punta', families: STROKE, hint: '100 % = punta redonda; menos = punta plana', get: (s) => pct(s.nibThickness ?? 1), set: (v) => ({ nibThickness: v / 100 }), min: 10, max: 200, step: 1, unit: '%', decimals: 0 },
  {
    key: 'nibAngle', kind: 'number', category: 'tip', label: 'Ángulo de la punta', families: STROKE, get: (s) => Math.round(s.nibAngle ?? 0), set: (v) => ({ nibAngle: v }), min: 0, max: 179, step: 1, unit: '°', decimals: 0,
    inactive: (s) => ((s.nibThickness ?? 1) === 1 ? 'Con la punta redonda el ángulo no cambia nada' : undefined),
  },
  {
    key: 'spacing', kind: 'number', category: 'tip', label: 'Separación de sellos', families: STROKE, hint: 'Distancia entre sellos, como porcentaje del diámetro', get: (s) => pct(s.spacing), set: (v) => ({ spacing: v / 100 }), min: 1, max: 100, step: 1, unit: '%', decimals: 0,
    inactive: (s) => (isStamping(s) ? undefined : 'Solo actúa con flujo por sello inferior al 100 % o presión → flujo'),
  },
  {
    key: 'antialias', kind: 'choice', category: 'tip', label: 'Antialiasing', families: ALL,
    hint: 'Suavizado del borde: Ninguno deja el borde duro, Fuerte lo difumina más',
    options: [{ value: 0, label: 'Ninguno' }, { value: 1, label: 'Débil' }, { value: 2, label: 'Medio' }, { value: 3, label: 'Fuerte' }],
    get: (s) => antialiasOf(s.antialias), set: (v) => ({ antialias: antialiasOf(v) }),
  },
  // Tinta
  { key: 'opacity', kind: 'number', category: 'ink', label: 'Opacidad', families: ALL, labels: { blend: 'Intensidad' }, hint: 'Máximo que alcanza el trazo, por mucho que se solape', get: (s) => pct(s.opacity), set: (v) => ({ opacity: v / 100 }), min: 0.1, max: 100, step: 0.1, unit: '%', decimals: 1 },
  { key: 'flow', kind: 'number', category: 'ink', label: 'Flujo por sello', families: STROKE, hint: 'Menos de 100 % acumula tinta con pasadas lentas o repetidas', get: (s) => pct(s.flow ?? 1), set: (v) => ({ flow: v / 100 }), min: 5, max: 100, step: 1, unit: '%', decimals: 0 },
  { key: 'pressureFlow', kind: 'number', category: 'ink', label: 'Presión → flujo', families: STROKE, hint: 'Cuánto reduce el flujo un toque ligero', get: (s) => pct(orZero(s.pressureFlow)), set: (v) => ({ pressureFlow: v / 100 }), min: 0, max: 100, step: 1, unit: '%', decimals: 0 },
  { key: 'pressureOpacity', kind: 'number', category: 'ink', label: 'Presión → opacidad', families: STROKE, get: (s) => pct(s.pressureOpacity), set: (v) => ({ pressureOpacity: v / 100 }), min: 0, max: 100, step: 1, unit: '%', decimals: 0 },
  // Dinámica
  { key: 'pressureSize', kind: 'toggle', category: 'dynamics', label: 'Presión → tamaño', families: ALL, get: (s) => s.pressureSize > 0, set: (on) => ({ pressureSize: on ? 1 : 0 }) },
  {
    key: 'minSize', kind: 'number', category: 'dynamics', label: 'Tamaño mínimo', families: STROKE, hint: 'Tamaño más pequeño, como porcentaje del tamaño, con el toque más ligero', get: (s) => pct(orZero(s.minSize)), set: (v) => ({ minSize: v / 100 }), min: 0, max: 100, step: 1, unit: '%', decimals: 0,
    inactive: (s) => (s.pressureSize > 0 ? undefined : 'Necesita presión → tamaño'),
  },
  {
    key: 'pressureCurve', kind: 'number', category: 'dynamics', label: 'Curva de presión', families: STROKE, hint: 'Menos de 1: el toque ligero cuenta más. Más de 1: hay que apretar más', get: (s) => Math.round((s.pressureCurve ?? 1) * 100) / 100, set: (v) => ({ pressureCurve: v }), min: 0.4, max: 2.5, step: 0.05, unit: '', decimals: 2,
    inactive: (s) => (s.pressureSize > 0 || s.pressureOpacity > 0 || orZero(s.pressureFlow) > 0 ? undefined : 'Necesita presión sobre tamaño, opacidad o flujo'),
  },
  // Trazo
  { key: 'stabilization', kind: 'number', category: 'stroke', label: 'Estabilización', families: STROKE, hint: 'Suaviza el temblor de la mano', get: (s) => Math.round(s.stabilization * 100), set: (v) => ({ stabilization: v / 100 }), min: 0, max: 95, step: 1, unit: '', decimals: 0 },
  { key: 'taperIn', kind: 'number', category: 'stroke', label: 'Entrada (afinado)', families: STROKE, hint: 'Longitud en la que el trazo crece hasta su tamaño', get: (s) => Math.round(orZero(s.taperIn)), set: (v) => ({ taperIn: v }), min: 0, max: 400, step: 1, unit: 'px', decimals: 0, length: true },
  { key: 'taperOut', kind: 'number', category: 'stroke', label: 'Salida (afinado)', families: STROKE, hint: 'Longitud en la que el trazo se afina al levantar el lápiz', get: (s) => Math.round(orZero(s.taperOut)), set: (v) => ({ taperOut: v }), min: 0, max: 400, step: 1, unit: 'px', decimals: 0, length: true },
  // Textura
  { key: 'grain', kind: 'number', category: 'texture', label: 'Textura de papel', families: STROKE, hint: '0 % = sin grano; la tinta solo se asienta en las crestas del grano', get: (s) => pct(orZero(s.grain)), set: (v) => ({ grain: v / 100 }), min: 0, max: 100, step: 1, unit: '%', decimals: 0 },
  {
    key: 'grainScale', kind: 'number', category: 'texture', label: 'Tamaño del grano', families: STROKE, get: (s) => Math.round(s.grainScale ?? 6), set: (v) => ({ grainScale: v }), min: 1, max: 40, step: 1, unit: 'px', decimals: 0, length: true,
    inactive: (s) => (orZero(s.grain) > 0 ? undefined : 'Con textura de papel al 0 % no hay grano'),
  },
];

/** The engine each tool paints with (see the stroke created for it in main.ts). */
export function toolFamily(tool: string): ToolFamily {
  if (tool === 'brush' || tool === 'erase' || tool === 'tone') return 'stroke';
  if (tool === 'blur' || tool === 'smudge' || tool === 'liquify' || tool === 'clone') return 'blend';
  return 'none';
}

export function paramsFor(family: ToolFamily): BrushParam[] {
  return BRUSH_PARAMS.filter((p) => p.families.includes(family));
}

export function paramByKey(key: string): BrushParam | undefined {
  return BRUSH_PARAMS.find((p) => p.key === key);
}

/** The label of a setting for this family of tools. */
export function paramLabel(p: BrushParam, family: ToolFamily): string {
  return p.labels?.[family] ?? p.label;
}

/** Why the setting changes nothing with these settings, or undefined when it is in effect. */
export function whyInactive(p: BrushParam, s: Readonly<BrushSettings>): string | undefined {
  return p.inactive?.(s);
}

/** Clamp a typed value to the setting's range and round it to its step (so a typed 33.37 does not land between steps). */
export function snapValue(p: Scale, value: number): number {
  const v = Math.min(p.max, Math.max(p.min, Number.isFinite(value) ? value : p.min));
  const snapped = Math.round((v - p.min) / p.step) * p.step + p.min;
  const factor = 10 ** Math.max(p.decimals, 3);
  return Math.min(p.max, Math.max(p.min, Math.round(snapped * factor) / factor));
}

/** Slider resolution; logarithmic settings map their range onto it by ratio. */
export const SLIDER_RESOLUTION = 1000;

export function valueToPosition(p: Scale, value: number): number {
  const v = Math.min(p.max, Math.max(p.min, value));
  const t = p.log ? Math.log(v / p.min) / Math.log(p.max / p.min) : (v - p.min) / (p.max - p.min);
  return Math.round(t * SLIDER_RESOLUTION);
}

export function positionToValue(p: Scale, position: number): number {
  const t = Math.min(1, Math.max(0, position / SLIDER_RESOLUTION));
  return snapValue(p, p.log ? p.min * Math.pow(p.max / p.min, t) : p.min + t * (p.max - p.min));
}

export function formatParam(p: Scale, value: number): string {
  return value.toFixed(p.decimals);
}
