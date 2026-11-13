import type { GradientShape, GradientStop } from '../engine/gradient';
import { presetStops } from '../engine/gradient-presets';
import type { ToneShape } from '../engine/tone';
import { icon } from './icons';

/**
 * The picture each sub tool shows: a drawing for every tool with several sub tools (not the brush-like ones) in the compact list row (and on the
 * tool button, so the button always tells which sub tool is chosen); gradients and brushes are the exception, they show a real sample of
 * themselves in a card (a colour swatch / a sample stroke).
 * Original artwork (see icons.ts). Brush-like tools have their sample stroke instead (stroke-preview.ts).
 */
const DRAWINGS: Record<string, string> = {
  'selection-area.selection-area.rectangle': 'select',
  'selection-area.selection-area.ellipse': 'sel-ellipse',
  'selection-area.selection-area.lasso': 'select-lasso',
  'selection-area.selection-area.polyline': 'sel-polyline',
  'selection-area.selection-area.selection-pen': 'sel-pen',
  'selection-area.selection-area.erase-selection': 'deselect',
  'selection-area.selection-area.shrink-selection': 'sel-shrink',
  'selection-area.selection-area.magnetic-lasso': 'sel-magnet',
  'fill.fill.refer-other-layers': 'fill-layers',
  'fill.fill.refer-only-to-editing-layer': 'fill-own',
  'fill.fill.enclose-and-fill': 'fill-enclose',
  'fill.fill.lasso-fill': 'fill-lasso',
  'fill.fill.leftover-pen': 'fill-leftover',
  'figure.direct-draw.straight-line': 'fig-line',
  'figure.direct-draw.curve': 'fig-curve',
  'figure.direct-draw.polyline': 'fig-polyline',
  'figure.direct-draw.continuous-curve': 'fig-wave',
  'figure.direct-draw.bezier-curve': 'fig-bezier',
  'figure.direct-draw.rectangle': 'fig-rect',
  'figure.direct-draw.ellipse': 'fig-ellipse',
  'figure.direct-draw.polygon': 'fig-polygon',
  'ruler.create-ruler.linear-ruler': 'ruler-line',
  'ruler.create-ruler.curve-ruler': 'ruler-curve',
  'ruler.create-ruler.figure-ruler': 'ruler-figure',
  'ruler.create-ruler.ruler-pen': 'ruler-pen',
  'ruler.create-ruler.special-ruler': 'ruler-special',
  'ruler.create-ruler.guide': 'ruler-guide',
  'ruler.create-ruler.perspective-ruler': 'ruler-persp',
  'ruler.create-ruler.symmetrical-ruler': 'ruler-sym',
  'move.move.hand': 'hand',
  'move.move.rotate': 'rotate',
  'move.move.zoom-in': 'zoom-in',
  'move.move.zoom-out': 'zoom-out',
  'operation.operation.object': 'cursor',
  'operation.operation.select-layer': 'op-layer',
  'operation.operation.move-layer': 'op-move',
  'operation.operation.move-tone-pattern': 'op-tone',
  'operation.operation.move-grid': 'snap-grid',
  'operation.operation.light-table': 'op-light',
  'operation.operation.edit-timeline': 'timeline',
  'eyedropper.eyedropper.pick-displayed-color': 'eyedropper',
  'eyedropper.eyedropper.pick-color-from-layer': 'pick-layer',
  'auto-select.auto-select.refer-to-all-layers': 'wand',
  'auto-select.auto-select.refer-to-editing-layer-only': 'wand-own',
  'auto-select.auto-select.selection-for-referred-layers': 'wand-ref',
  'text.text.text': 'text',
  'text.text.circular-text': 'text-circle',
  'comic.balloon.rounded-balloon': 'balloon',
  'comic.balloon.rough-rounded-balloon': 'balloon-rough',
  'comic.balloon.ellipse-balloon': 'balloon-ellipse',
  'comic.balloon.curve-balloon': 'balloon-curve',
  'comic.balloon.rectangle-balloon': 'balloon-rect',
  'comic.balloon.balloon-pen': 'balloon-pen',
  'comic.balloon.balloon-tail': 'balloon-tail',
  'comic.balloon.thought-balloon-tail': 'balloon-thought',
  'comic.frame-border.rectangle-frame': 'frame-rect',
  'comic.frame-border.rough-rectangle': 'frame-rough',
  'comic.frame-border.polyline-frame': 'frame-poly',
  'comic.frame-border.frame-border-pen': 'frame-pen',
  'comic.frame-border.divide-frame-border': 'frame-split',
  'comic.frame-border.divide-frame-folder': 'frame-folder',
  'comic.flash.flash-pattern': 'flash-pattern',
  'comic.flash.flash': 'flash',
  'comic.flash.dense-flash': 'flash-dense',
  'comic.flash.sea-urchin-flash': 'flash-urchin',
  'comic.flash.firework': 'flash-firework',
  'comic.focus-lines.scattered-focus-lines': 'focus-scattered',
  'comic.focus-lines.dark-focus-lines-curved': 'focus-dark',
  'comic.focus-lines.dense-focus-lines': 'focus-dense',
  'comic.focus-lines.brightness': 'focus-bright',
  'comic.focus-lines.burst': 'focus-burst',
  'comic.speed-lines.scattered-speed-lines': 'speed-scattered',
  'comic.speed-lines.dark-speed-lines': 'speed-dark',
  'comic.speed-lines.gloom': 'speed-gloom',
  'comic.speed-lines.rain': 'speed-rain',
  'gradient.freeform-gradient.normal-paint': 'grad-free',
  'gradient.freeform-gradient.the-lightest-shadow': 'grad-free-light',
  'gradient.freeform-gradient.the-deepest-shadow': 'grad-free-dark',
};

/** Tools whose button takes the drawing of the chosen sub tool. */
const BUTTON_FOLLOWS_SUBTOOL = new Set(['selection-area', 'auto-select', 'fill', 'figure', 'ruler', 'move', 'operation', 'eyedropper', 'text', 'comic']);

/** The icon name of a sub tool's drawing, if it has one. */
export const drawingOf = (subId: string): string | undefined => DRAWINGS[subId];

/** The icon the tool button shows for the chosen sub tool: its own drawing, else the tool's. */
export function buttonIconName(toolId: string, toolIcon: string, subId: string | undefined): string {
  return (BUTTON_FOLLOWS_SUBTOOL.has(toolId) && subId ? DRAWINGS[subId] : undefined) ?? toolIcon;
}

// ---- gradient swatches -----------------------------------------------------------------------------
/** Sample drawing colours for the swatches of gradients that start from the colours in use. */
const SAMPLE_MAIN: readonly [number, number, number] = [30, 30, 40];
const SAMPLE_SUB: readonly [number, number, number] = [245, 245, 245];
const CHECKER = 'repeating-conic-gradient(#b9bac2 0 25%, #eceef3 0 50%) 0 0 / 8px 8px';
/** The screens a manga gradient is drawn with, on the paper it would print on. */
const SCREENS: Record<ToneShape, string> = {
  dot: 'radial-gradient(circle at 50% 50%, #151519 38%, transparent 42%) 0 0 / 5px 5px',
  line: 'repeating-linear-gradient(45deg, #151519 0 1.5px, transparent 1.5px 4px)',
  cross: 'repeating-linear-gradient(0deg, #151519 0 1px, transparent 1px 4px), repeating-linear-gradient(90deg, #151519 0 1px, transparent 1px 4px)',
};

const css = (s: GradientStop): string => `rgba(${s.color[0]},${s.color[1]},${s.color[2]},${s.alpha})`;
const at = (s: GradientStop, t = s.t): string => `${css(s)} ${Math.round(t * 1000) / 10}%`;

/** The CSS gradient that looks like the preset's colours laid in its own shape. */
function colourGradient(shape: GradientShape, stops: readonly GradientStop[]): string {
  const list = (f: (s: GradientStop) => string): string => stops.map(f).join(',');
  switch (shape) {
    case 'radial':
      return `radial-gradient(circle closest-side at 50% 50%,${list((s) => at(s))})`;
    case 'conic':
      return `conic-gradient(from 90deg at 50% 50%,${stops.map((s) => `${css(s)} ${Math.round(s.t * 360)}deg`).join(',')})`;
    case 'mirrored': {
      const out = [...stops].reverse().map((s) => at(s, (1 - s.t) / 2)).concat(stops.map((s) => at(s, 0.5 + s.t / 2)));
      return `linear-gradient(90deg,${out.join(',')})`;
    }
    default:
      return `linear-gradient(90deg,${list((s) => at(s))})`;
  }
}

/** The CSS background of a gradient sub tool's swatch, or undefined when the sub tool is not a named gradient. */
export function gradientSwatch(subId: string): string | undefined {
  const m = /^gradient\.gradient\.(.+)$/.exec(subId);
  if (!m) return undefined;
  const { stops, mode, shape, halftone } = presetStops(m[1]!, SAMPLE_MAIN, SAMPLE_SUB);
  if (mode === 'erase') return `linear-gradient(90deg, rgba(43,43,46,.95), rgba(43,43,46,0)), ${CHECKER}`;
  if (halftone) return `${SCREENS[halftone.shape]}, linear-gradient(90deg, #ffffff, #9a9aa3)`;
  // Light and soft gradients (a glow, a vignette) are drawn over the dark and the checker they would sit on.
  const translucent = stops.some((x) => x.alpha < 1);
  return `${colourGradient(shape ?? 'linear', stops)}${translucent ? `, ${CHECKER}` : ''}`;
}

/** The inner HTML of a gradient's card preview (a real sample of it), or '' for everything else: those use the compact icon row. */
export function cardPreview(subId: string): string {
  const swatch = gradientSwatch(subId);
  if (!swatch) return '';
  const erase = subId === 'gradient.gradient.gradient-erase';
  return `<span class="st-preview st-swatch${erase ? ' erase' : ''}" style="background:${swatch}">${erase ? icon('eraser', 16) : ''}</span>`;
}

/** The icon of a sub tool's compact row: its own drawing, else the tool's. */
export const rowIconName = (toolIcon: string, subId: string): string => DRAWINGS[subId] ?? toolIcon;
