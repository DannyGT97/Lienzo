import type { PressureGraph } from '../../engine/pressure-graph';
import { GRADIENT_CHIPS, GRADIENT_IDS } from '../../engine/gradient-presets';
import { TOOLS, type SubToolDef, type ToolDef, type ToolGroupDef } from './tools';

/** What the engine can do today. Anything else in the tool tree is shown but not selectable. */
export type InternalTool = 'brush' | 'erase' | 'tone' | 'panel' | 'split' | 'balloon' | 'text' | 'select' | 'hand' | 'zoomin' | 'zoomout' | 'pick' | 'selrect' | 'selellipse' | 'sellasso' | 'wand' | 'fill'
  | 'selpoly' | 'selmagnet' | 'selpen' | 'selerase' | 'selshrink' | 'enclose' | 'lassofill'
  | 'gradient' | 'figline' | 'figrect' | 'figellipse' | 'figpoly' | 'figpolygon' | 'blur' | 'smudge'
  | 'rulerline' | 'rulerpersp' | 'rulersym' | 'rulerguide' | 'rulercurve' | 'rulerfigure' | 'rulerpen' | 'rulerspecial' | 'liquify' | 'clone'
  | 'vcontrol' | 'vpinch' | 'vsimplify' | 'vwidth';

export interface BrushPreset {
  /** Diameter at 150 dpi; scaled to the page resolution when applied. */
  size?: number;
  hardness?: number; // 0..1
  opacity?: number; // 0..1
  stabilization?: number; // 0..0.95
  pressureSize?: boolean;
  /** How much pressure lowers the opacity: 0 = none, 0.2 = light touches keep 80 % of it (Clip Studio's Pen), 1 = down to transparent. */
  pressureOpacity?: number;
  /** Paint under what is already there (the leftover pen). */
  behind?: boolean;
  /** Pressure curve exponent, minimum size (fraction), taper lengths and paper grain, as in the brush settings (lengths at 150 dpi). */
  pressureCurve?: number;
  /** Pressure → result drawn as points, as Clip Studio's pens ship them. */
  pressureGraph?: PressureGraph;
  minSize?: number;
  taperIn?: number;
  taperOut?: number;
  grain?: number;
  grainScale?: number;
  /** Nib shape: width across the nib as a fraction of its length (1 = round) and the direction of its length in degrees. */
  nibThickness?: number;
  nibAngle?: number;
  /** Share of the opacity each stamp lays down (1 or unset = the whole stroke at once; see BrushSettings.flow). */
  flow?: number;
  /** How much a light touch lowers the flow (0.5 = half at feather touch; see BrushSettings.pressureFlow). */
  pressureFlow?: number;
  /** Anti-aliasing of the edge, 0 none … 3 strong (unset = medium; see BrushSettings.antialias). */
  antialias?: 0 | 1 | 2 | 3;
}

export interface LiveBinding {
  tool: InternalTool;
  preset?: BrushPreset;
  /** Balloon tools: the shape a new balloon gets, how it is drawn (a dragged box by default) and the tail the tail tools add. */
  balloonShape?: 'ellipse' | 'rounded' | 'rough' | 'rect' | 'curve';
  balloonDraw?: 'box' | 'points' | 'freehand' | 'tail';
  tailStyle?: 'speech' | 'thought';
  /** Eyedropper: take the colour of what is shown, or of the active layer alone. */
  pick?: 'display' | 'layer';
  /** Magic wand: look at the whole picture (true) or at the active layer only (false). */
  wandAllLayers?: boolean;
  /** Look only at the layers marked as reference. */
  wandReference?: boolean;
  /** Which gradient the gradient tool lays down (see gradient.ts presetStops). */
  gradientId?: string;
}

/** A sub tool as the list shows it; the gradient library files its presets under section headers. */
export interface SubToolEntry extends SubToolDef {
  section?: string;
}

const pen = (p: BrushPreset): LiveBinding => ({ tool: 'brush', preset: p });
const eraser = (p: BrushPreset): LiveBinding => ({ tool: 'erase', preset: p });
const blend = (tool: 'blur' | 'smudge' | 'clone', p: BrushPreset): LiveBinding => ({ tool, preset: p });

/** Real G-pen: it takes a firm press to reach full width. */
const REAL_G_PEN_PRESSURE: PressureGraph = [[0, 0], [0.75, 0.25], [1, 1]];

/** Sub tool id -> engine binding. Presets are first approximations built on the one round brush we have. */
export const LIVE: Record<string, LiveBinding> = {
  // Pressure floors and curves below were tuned by hand; the pens do not taper by themselves and stabilize lightly (5-6 of 100).
  'pen.pen.g-pen': pen({ size: 8, hardness: 1, opacity: 0.9, pressureOpacity: 0.2, stabilization: 0.1, pressureSize: true, minSize: 0.1 }),
  'pen.pen.real-g-pen': pen({ size: 9, hardness: 1, opacity: 1, stabilization: 0.12, pressureSize: true, pressureGraph: REAL_G_PEN_PRESSURE, nibThickness: 0.85 }),
  'pen.pen.milli-pen': pen({ size: 3, hardness: 1, opacity: 1, stabilization: 0.3, pressureSize: false }),
  'pen.pen.felt-pen': pen({ size: 14, hardness: 0.7, opacity: 1, stabilization: 0.2, pressureSize: false }),
  'pen.pen.dot-pen': pen({ size: 2, hardness: 1, opacity: 1, stabilization: 0.5, pressureSize: false }),
  'sketch.sketch.pencil': pen({ size: 5, hardness: 1, opacity: 0.9, pressureOpacity: 0.2, stabilization: 0.15, pressureSize: true, minSize: 0.1, grain: 0.55, grainScale: 2, flow: 0.85, pressureFlow: 0.5 }),
  'sketch.sketch.mechanical-pencil': pen({ size: 2, hardness: 0.8, opacity: 0.9, stabilization: 0.15, pressureSize: false }),
  'airbrush.airbrush.soft': pen({ size: 40, hardness: 0, opacity: 0.9, stabilization: 0.1, pressureSize: false, flow: 0.5 }),
  // More pens and brushes, as first approximations built on the one round brush with grain, taper and curve.
  'pen.pen.mapping-pen': pen({ size: 2, hardness: 1, opacity: 1, stabilization: 0.4, pressureSize: false }),
  'pen.pen.turnip-pen': pen({ size: 7, hardness: 0.9, opacity: 1, stabilization: 0.3, pressureSize: true, taperIn: 10, taperOut: 40 }),
  'pen.pen.textured-pen': pen({ size: 9, hardness: 0.6, opacity: 1, stabilization: 0.1, pressureSize: true, nibThickness: 0.6, grain: 0.5, grainScale: 2 }),
  'pen.pen.rough-pen': pen({ size: 9, hardness: 1, opacity: 1, stabilization: 0.12, pressureSize: true, nibThickness: 1.5, grain: 0.7, grainScale: 1.5 }),
  'pen.pen.calligraphy': pen({ size: 10, hardness: 1, opacity: 1, stabilization: 0.35, pressureSize: true, minSize: 0.15, pressureCurve: 1.3 }),
  'pen.pen.flat-marker': pen({ size: 22, hardness: 0.7, opacity: 1, stabilization: 0.25, pressureSize: true, minSize: 0.6, pressureGraph: [[0, 0], [0.56, 0.06], [0.93, 0.6], [1, 1]], nibThickness: 0.3, nibAngle: 90 }),
  'sketch.sketch.charcoal': pen({ size: 16, hardness: 0.35, opacity: 0.9, stabilization: 0.1, pressureSize: true, grain: 0.75, grainScale: 3 }),
  'sketch.sketch.crayon': pen({ size: 10, hardness: 0.6, opacity: 0.9, stabilization: 0.1, pressureSize: true, grain: 0.6, grainScale: 2 }),
  'sketch.sketch.pastel': pen({ size: 18, hardness: 0.4, opacity: 0.85, stabilization: 0.1, pressureSize: true, grain: 0.8, grainScale: 3 }),
  'sketch.sketch.chalk': pen({ size: 14, hardness: 0.81, opacity: 1, stabilization: 0.1, pressureSize: true, minSize: 0.5, pressureGraph: [[0, 0], [0.14, 0.69], [0.75, 1], [1, 1]], nibThickness: 0.5, grain: 0.85, grainScale: 2, pressureFlow: 0.5 }),
  'airbrush.airbrush.spray': pen({ size: 50, hardness: 0, opacity: 0.4, stabilization: 0.05, pressureSize: false, grain: 0.7, grainScale: 1.5 }),
  'airbrush.airbrush.droplet': pen({ size: 30, hardness: 0.6, opacity: 0.9, stabilization: 0.05, pressureSize: false, grain: 0.92, grainScale: 1.5 }),
  'airbrush.airbrush.noise': pen({ size: 40, hardness: 0.1, opacity: 0.6, stabilization: 0.05, pressureSize: false, grain: 0.75, grainScale: 1 }),
  'brush.watercolor.round-watercolor-brush': pen({ size: 30, hardness: 1, opacity: 0.9, stabilization: 0.2, pressureSize: true, pressureOpacity: 0.2, flow: 0.5 }),
  'brush.watercolor.brush-pen': pen({ size: 14, hardness: 0.9, opacity: 1, stabilization: 0.3, pressureSize: true, taperIn: 8, taperOut: 30 }),
  'brush.watercolor.dry-ink': pen({ size: 12, hardness: 1, opacity: 1, stabilization: 0.25, pressureSize: true, minSize: 0.05, pressureGraph: [[0, 0], [0.74, 0.25], [1, 1]], grain: 0.55, grainScale: 2 }),
  'brush.thick-paint.gouache': pen({ size: 26, hardness: 1, opacity: 1, stabilization: 0.2, pressureSize: true, minSize: 0.1, pressureGraph: [[0, 0], [0.31, 0.21], [0.58, 0.82], [1, 1]], flow: 0.75, pressureFlow: 0.8 }),
  'brush.thick-paint.oil-paint': pen({ size: 28, hardness: 0.7, opacity: 0.95, stabilization: 0.2, pressureSize: true, grain: 0.15, grainScale: 3 }),
  'eraser.eraser.kneaded-eraser': eraser({ size: 24, hardness: 0.2, opacity: 0.5, stabilization: 0.1, pressureSize: false }),
  'eraser.eraser.rough': eraser({ size: 16, hardness: 0.8, opacity: 1, stabilization: 0.1, pressureSize: false, grain: 0.6, grainScale: 2 }),
  'blend.blend.blend': blend('smudge', { size: 30, hardness: 0.5, opacity: 0.6, stabilization: 0.1, pressureSize: false }),
  'blend.blend.finger-tip': blend('smudge', { size: 24, hardness: 0.7, opacity: 0.8, stabilization: 0.1, pressureSize: true }),
  'blend.blend.painterly-blender': blend('smudge', { size: 36, hardness: 0.4, opacity: 0.5, stabilization: 0.15, pressureSize: false }),
  'blend.blend.wet-bleed-blender': blend('smudge', { size: 40, hardness: 0.2, opacity: 0.45, stabilization: 0.15, pressureSize: false }),
  'blend.blend.textured-blender': blend('smudge', { size: 36, hardness: 0.5, opacity: 0.6, stabilization: 0.1, pressureSize: false, grain: 0.5, grainScale: 2 }),
  'blend.blend.copy-stamp': blend('clone', { size: 40, hardness: 0.8, opacity: 1, stabilization: 0.1, pressureSize: false }),
  'blend.blend.blur': blend('blur', { size: 36, hardness: 0.5, opacity: 0.7, stabilization: 0.1, pressureSize: false }),
  'eraser.eraser.hard': eraser({ size: 12, hardness: 1, opacity: 1, stabilization: 0.1, pressureSize: false }),
  'eraser.eraser.soft': eraser({ size: 24, hardness: 0.25, opacity: 1, stabilization: 0.1, pressureSize: false }),
  'move.move.hand': { tool: 'hand' },
  'move.move.zoom-in': { tool: 'zoomin' },
  'move.move.zoom-out': { tool: 'zoomout' },
  'operation.operation.object': { tool: 'select' },
  'selection-area.selection-area.rectangle': { tool: 'selrect' },
  'selection-area.selection-area.ellipse': { tool: 'selellipse' },
  'selection-area.selection-area.lasso': { tool: 'sellasso' },
  'selection-area.selection-area.polyline': { tool: 'selpoly' },
  'selection-area.selection-area.selection-pen': { tool: 'selpen' },
  'selection-area.selection-area.erase-selection': { tool: 'selerase' },
  'selection-area.selection-area.shrink-selection': { tool: 'selshrink' },
  'selection-area.selection-area.magnetic-lasso': { tool: 'selmagnet', wandAllLayers: true },
  'fill.fill.refer-other-layers': { tool: 'fill', wandAllLayers: true },
  'fill.fill.refer-only-to-editing-layer': { tool: 'fill', wandAllLayers: false },
  'auto-select.auto-select.refer-to-all-layers': { tool: 'wand', wandAllLayers: true },
  'auto-select.auto-select.refer-to-editing-layer-only': { tool: 'wand', wandAllLayers: false },
  'auto-select.auto-select.selection-for-referred-layers': { tool: 'wand', wandAllLayers: true, wandReference: true },
  'fill.fill.enclose-and-fill': { tool: 'enclose', wandAllLayers: true },
  'fill.fill.lasso-fill': { tool: 'lassofill' },
  'fill.fill.leftover-pen': pen({ size: 16, hardness: 1, opacity: 1, stabilization: 0.2, pressureSize: false, behind: true }),
  'eyedropper.eyedropper.pick-displayed-color': { tool: 'pick', pick: 'display' },
  'eyedropper.eyedropper.pick-color-from-layer': { tool: 'pick', pick: 'layer' },
  'liquify.liquify.liquify': { tool: 'liquify' },
  'correct-line.correct-line.control-point': { tool: 'vcontrol' },
  'correct-line.correct-line.pinch-vector-line': { tool: 'vpinch' },
  'correct-line.correct-line.simplify-vector-line': { tool: 'vsimplify' },
  'correct-line.correct-line.adjust-line-width': { tool: 'vwidth' },
  'ruler.create-ruler.linear-ruler': { tool: 'rulerline' },
  'ruler.create-ruler.curve-ruler': { tool: 'rulercurve' },
  'ruler.create-ruler.figure-ruler': { tool: 'rulerfigure' },
  'ruler.create-ruler.ruler-pen': { tool: 'rulerpen' },
  'ruler.create-ruler.special-ruler': { tool: 'rulerspecial' },
  'ruler.create-ruler.perspective-ruler': { tool: 'rulerpersp' },
  'ruler.create-ruler.symmetrical-ruler': { tool: 'rulersym' },
  'ruler.create-ruler.guide': { tool: 'rulerguide' },
  'figure.direct-draw.straight-line': { tool: 'figline' },
  'figure.direct-draw.rectangle': { tool: 'figrect' },
  'figure.direct-draw.ellipse': { tool: 'figellipse' },
  'figure.direct-draw.polyline': { tool: 'figpoly' },
  'figure.direct-draw.polygon': { tool: 'figpolygon' },
  'comic.balloon.rounded-balloon': { tool: 'balloon', balloonShape: 'rounded' },
  'comic.balloon.rough-rounded-balloon': { tool: 'balloon', balloonShape: 'rough' },
  'comic.balloon.ellipse-balloon': { tool: 'balloon', balloonShape: 'ellipse' },
  'comic.balloon.curve-balloon': { tool: 'balloon', balloonShape: 'curve', balloonDraw: 'points' },
  'comic.balloon.rectangle-balloon': { tool: 'balloon', balloonShape: 'rect' },
  'comic.balloon.balloon-pen': { tool: 'balloon', balloonShape: 'curve', balloonDraw: 'freehand' },
  'comic.balloon.balloon-tail': { tool: 'balloon', balloonDraw: 'tail', tailStyle: 'speech' },
  'comic.balloon.thought-balloon-tail': { tool: 'balloon', balloonDraw: 'tail', tailStyle: 'thought' },
  'comic.frame-border.rectangle-frame': { tool: 'panel' },
  'comic.frame-border.divide-frame-border': { tool: 'split' },
  'text.text.text': { tool: 'text' },
  'lienzo-tone.paint.paint': { tool: 'tone' },
  // Freeform gradient, first approximation: a wide soft brush that blends into what is there. The two shadow modes are not built yet.
  'gradient.freeform-gradient.normal-paint': pen({ size: 90, hardness: 0, opacity: 0.6, stabilization: 0.2, pressureSize: false, flow: 0.4 }),
};
for (const id of GRADIENT_IDS) LIVE[`gradient.gradient.${id}`] = { tool: 'gradient', gradientId: id };

/** A tool of our own: halftone painting. */
const EXTRA: ToolDef = {
  id: 'lienzo-tone',
  es: 'Tono',
  icon: 'tone',
  shortcut: null,
  groups: [
    {
      id: 'lienzo-tone.paint',
      es: 'Tono (trama)',
          subtools: [{ id: 'lienzo-tone.paint.paint', es: 'Pintar trama' }],
    },
  ],
};

/** Tool palette order (top to bottom). */
const ORDER = [
  'move', 'operation', 'eyedropper', 'selection-area', 'auto-select', 'pen', 'sketch', 'brush', 'airbrush', 'eraser',
  'blend', 'fill', 'gradient', 'figure', 'ruler', 'text', 'comic', 'correct-line', 'liquify', 'decoration', 'lienzo-tone',
];

/** The gradient tool: our own library of presets in chips and sections, then the freeform group. */
const GRADIENT_TOOL: ToolDef = (() => {
  const base = TOOLS.find((t) => t.id === 'gradient')!;
  const chips: ToolGroupDef[] = GRADIENT_CHIPS.map((chip) => ({
    id: `gradient.${chip.id}`,
    es: chip.es,
    subtools: chip.sections.flatMap((sec) => sec.presets.map((pr): SubToolEntry => ({ id: `gradient.gradient.${pr.id}`, es: pr.es, section: sec.es }))),
  }));
  return { ...base, groups: [...chips, ...base.groups.filter((g) => g.id === 'gradient.freeform-gradient')] };
})();

export const PALETTE_TOOLS: ToolDef[] = ORDER.map((id) => [...TOOLS.map((t) => (t.id === 'gradient' ? GRADIENT_TOOL : t)), EXTRA].find((t) => t.id === id)).filter((t): t is ToolDef => !!t);

export const isLive = (subId: string): boolean => subId in LIVE;

/** The sub tool a tool starts on the first time (without it, the first one in the list that works). */
export const DEFAULT_SUBTOOL: Readonly<Record<string, string>> = {
  'selection-area': 'selection-area.selection-area.rectangle',
};

export const toolHasLive = (t: ToolDef): boolean => t.groups.some((g) => g.subtools.some((s) => isLive(s.id)));

/** Tool shortcut letters for the engine tools we can actually switch to. */
export function toolsForLetter(letter: string): ToolDef[] {
  return PALETTE_TOOLS.filter((t) => t.shortcut === letter && toolHasLive(t));
}
