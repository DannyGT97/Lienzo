// Application preferences: the values the "Preferencias" dialog edits. Pure and storage-agnostic so they can be tested.
// Lienzo keeps its preferences as one JSON object where a missing or invalid key falls back to its default.

import { clampUiScale, UI_SCALE_DEFAULT } from '../ui/ui-scale-model';

export type PressureCurveId = 'default' | 'soft' | 'firm';
export const PRESSURE_CURVES: readonly PressureCurveId[] = ['default', 'soft', 'firm'];

/** How long a notice stays on screen before it fades. Notices that wait for something (progress) ignore it. */
export type NoticeSpeedId = 'fast' | 'normal' | 'slow' | 'slower';
export const NOTICE_SPEEDS: readonly NoticeSpeedId[] = ['fast', 'normal', 'slow', 'slower'];
const NOTICE_SECONDS: Record<NoticeSpeedId, number> = { fast: 2, normal: 3, slow: 4, slower: 7 };
/** Milliseconds a plain notice stays visible. */
export const noticeMs = (id: NoticeSpeedId): number => NOTICE_SECONDS[id] * 1000;

export interface Prefs {
  /** How long short notices stay on screen. */
  noticeSpeed: NoticeSpeedId;
  /** Read the pen's pressure. Off: every stamp is made at full pressure, as with a mouse. */
  usePressure: boolean;
  /** Bends the pen's reported pressure before any brush sees it (the brush's own curve then adds to it). */
  pressureCurve: PressureCurveId;
  /** Whether a finger draws when the app starts (the toolbar checkbox can still change it for the session). */
  fingerDraws: boolean;
  /** Ring around the brush showing its real size. */
  brushOutline: boolean;
  /** Small cross at the middle of the brush ring. */
  brushCrosshair: boolean;
  /** How many undo steps are kept. */
  historySteps: number;
  /** Memory the undo steps may use, in megabytes. */
  undoMemoryMb: number;
  /** Size of the bars and docks around the canvas, in percent (the canvas itself never scales). */
  uiScale: number;
  /** Write the recovery copy of the open documents at an interval (they are always written when the app goes to the background or a file is saved). */
  autosave: boolean;
  /** Minutes between recovery copies. */
  autosaveMinutes: number;
}

export const DEFAULT_PREFS: Readonly<Prefs> = {
  noticeSpeed: 'slow',
  usePressure: true,
  pressureCurve: 'default',
  fingerDraws: true,
  brushOutline: true,
  brushCrosshair: false,
  historySteps: 200,
  undoMemoryMb: 256,
  uiScale: UI_SCALE_DEFAULT,
  autosave: true,
  autosaveMinutes: 15,
};

export const HISTORY_STEPS_RANGE = { min: 10, max: 1000 } as const;
export const UNDO_MEMORY_RANGE = { min: 32, max: 4096 } as const;
export const AUTOSAVE_MINUTES_RANGE = { min: 1, max: 120 } as const;

const clampInt = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

/** Field by field: whatever is missing or of the wrong kind takes its default, so an old or edited file never breaks the app. */
export function sanitizePrefs(raw: unknown): Prefs {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const bool = (k: 'usePressure' | 'fingerDraws' | 'brushOutline' | 'brushCrosshair' | 'autosave'): boolean => (typeof o[k] === 'boolean' ? (o[k] as boolean) : DEFAULT_PREFS[k]);
  const curve = PRESSURE_CURVES.find((c) => c === o.pressureCurve) ?? DEFAULT_PREFS.pressureCurve;
  return {
    noticeSpeed: NOTICE_SPEEDS.find((s) => s === o.noticeSpeed) ?? DEFAULT_PREFS.noticeSpeed,
    usePressure: bool('usePressure'),
    pressureCurve: curve,
    fingerDraws: bool('fingerDraws'),
    brushOutline: bool('brushOutline'),
    brushCrosshair: bool('brushCrosshair'),
    historySteps: clampInt(o.historySteps, HISTORY_STEPS_RANGE.min, HISTORY_STEPS_RANGE.max, DEFAULT_PREFS.historySteps),
    undoMemoryMb: clampInt(o.undoMemoryMb, UNDO_MEMORY_RANGE.min, UNDO_MEMORY_RANGE.max, DEFAULT_PREFS.undoMemoryMb),
    uiScale: typeof o.uiScale === 'number' ? clampUiScale(o.uiScale) : DEFAULT_PREFS.uiScale,
    autosave: bool('autosave'),
    autosaveMinutes: clampInt(o.autosaveMinutes, AUTOSAVE_MINUTES_RANGE.min, AUTOSAVE_MINUTES_RANGE.max, DEFAULT_PREFS.autosaveMinutes),
  };
}

export const PREFS_KEY = 'lienzo.prefs';

type ReadStore = Pick<Storage, 'getItem'>;
type WriteStore = Pick<Storage, 'setItem'>;

export function loadPrefs(store: ReadStore): Prefs {
  try {
    const text = store.getItem(PREFS_KEY);
    return sanitizePrefs(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** False when the browser refuses (private mode, full disk): the preferences then last only for this session. */
export function savePrefs(store: WriteStore, prefs: Prefs): boolean {
  try {
    store.setItem(PREFS_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

/**
 * The global pressure response: pressure 0..1 in, 0..1 out. These three shapes are plain power curves.
 */
export function applyPressureCurve(p: number, id: PressureCurveId): number {
  const x = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 1;
  if (id === 'soft') return Math.pow(x, 0.7); // a light touch counts for more
  if (id === 'firm') return Math.pow(x, 1.5); // needs a firmer press for the same effect
  return x;
}
