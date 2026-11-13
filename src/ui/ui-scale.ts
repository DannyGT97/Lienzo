// Interface scale. The person chooses a percentage in Preferencias; it is never derived from the screen's pixel density.
// The bars and docks around the canvas grow or shrink with CSS `zoom` (see studio.css); the stage and the canvas never
// do, so pointer maths on the drawing keeps working in plain CSS pixels. This module applies the scale model (ui-scale-model.ts) to the page:
// the factor really applied in this window and the layout (docks beside the canvas or side drawers) it leaves room for.

import { clampUiScale, effectiveUiScale, UI_SCALE_DEFAULT, wantsDrawers } from './ui-scale-model';

// Pure helpers elsewhere import this module (and their tests run without a page), so nothing touches `document` at load.
const root = (): HTMLElement => document.documentElement;
let percent = UI_SCALE_DEFAULT;
let drawers = false;
let applied = 0;
const layoutListeners = new Set<() => void>();

/** The current scale as a factor (1 = 100 %). Code that sizes things in the zoomed chrome converts with it. */
export function readUiScale(): number {
  const value = Number.parseFloat(getComputedStyle(root()).getPropertyValue('--ui-scale'));
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/** True while the docks are side drawers (a narrow window for the current scale); CSS keys off `html.layout-drawers`. */
export function isDrawerLayout(): boolean {
  return drawers;
}

/** Called after the docks changed between "beside the canvas" and "side drawers". */
export function onLayoutModeChange(listener: () => void): void {
  layoutListeners.add(listener);
}

/** Recompute the applied factor and the layout for the current window; announces what changed. */
function sync(announce: boolean): void {
  const scale = effectiveUiScale(percent, window.innerWidth);
  const nextDrawers = wantsDrawers(window.innerWidth, scale);
  const scaleChanged = scale !== applied;
  const modeChanged = nextDrawers !== drawers;
  applied = scale;
  drawers = nextDrawers;
  if (scaleChanged) root().style.setProperty('--ui-scale', String(scale));
  root().classList.toggle('layout-drawers', drawers);
  if (modeChanged) layoutListeners.forEach((listener) => listener());
  // Layout code that measures the chrome (docks, tool strip, app bar) re-measures on `resize`.
  if (announce && (scaleChanged || modeChanged)) window.dispatchEvent(new Event('resize'));
}

/** Applies the person's percentage (any number is clamped to the range). */
export function applyUiScale(next: number): void {
  percent = clampUiScale(next);
  sync(true);
}

// The window changing size can change both the allowed factor and the layout.
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => sync(true));
  sync(false);
}
