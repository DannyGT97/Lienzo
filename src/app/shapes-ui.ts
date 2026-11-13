import { Stroke, type BrushSettings, type StrokePatch } from '../engine/brush';
import { paintTarget, type Document, type Layer } from '../engine/document';
import { applyGradient, type GradientRepeat, type GradientShape } from '../engine/gradient';
import { presetStops } from '../engine/gradient-presets';
import type { ToneShape } from '../engine/tone';
import type { Pt } from '../engine/geometry';
import { combineCommands, patchCommand, type History } from '../engine/history';
import { Selection, fillSelection } from '../engine/selection';
import type { Rect } from '../engine/tiles';

export type ShapeTool = 'gradient' | 'figline' | 'figrect' | 'figellipse' | 'figpoly' | 'figpolygon';
const SHAPE_TOOLS: ReadonlySet<string> = new Set<ShapeTool>(['gradient', 'figline', 'figrect', 'figellipse', 'figpoly', 'figpolygon']);
export const isShapeTool = (t: string): t is ShapeTool => SHAPE_TOOLS.has(t);
const isPathTool = (t: string): boolean => t === 'figpoly' || t === 'figpolygon';

export interface ShapesDeps {
  doc: () => Document;
  view: { x: number; y: number; scale: number };
  history: () => History;
  activeLayer: () => Layer;
  selection: () => Selection | null;
  brush: () => BrushSettings;
  colors: () => { main: readonly [number, number, number]; sub: readonly [number, number, number] };
  /** The "transparent colour" is on: figures erase instead of painting. */
  transparent: () => boolean;
  /** Which gradient the tool lays down and with which shape ('auto': the one the gradient itself wants, a line when it wants none). */
  gradient: () => { id: string; shape: GradientShape | 'auto'; repeat: GradientRepeat; dither: boolean; halftone?: { shape: ToneShape; lpi: number; angle: number } };
  /** Rectangles, ellipses and polygons are also filled with the secondary colour. */
  fillShapes: () => boolean;
  render: (region?: Rect | null) => void;
  refreshLayer: (layer: Layer, rect: Rect) => void;
  refreshUi: () => void;
  redrawOverlay: () => void;
  say: (msg: string) => void;
  pathBar: (open: boolean) => void;
}

/** The gradient tool and the figure tools (straight line, rectangle, ellipse, polyline, polygon). */
export function createShapesUi(d: ShapesDeps): {
  readonly dragging: boolean;
  readonly pathOpen: boolean;
  down(tool: ShapeTool, e: PointerEvent, p: Pt): void;
  move(p: Pt): void;
  up(): void;
  closePath(): void;
  cancelPath(): void;
  drawOverlay(ctx: CanvasRenderingContext2D): void;
} {
  let drag: { tool: ShapeTool; start: Pt; now: Pt; pts: Pt[]; lastClick?: { x: number; y: number; t: number } } | null = null;

  const editable = (): boolean => {
    const l = d.activeLayer();
    if (l.kind !== 'raster') {
      d.say('Elige una capa de píxeles para dibujar figuras y degradados.');
      return false;
    }
    if (l.locked) {
      d.say('La capa está bloqueada: desbloquéala para dibujar en ella.');
      return false;
    }
    return true;
  };

  /** Points every few pixels along a polyline, so the stroke's own smoothing cannot cut corners. */
  function dense(pts: Pt[], closed: boolean): Pt[] {
    const out: Pt[] = [];
    const list = closed ? [...pts, pts[0]!] : pts;
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i]!;
      const b = list[i + 1]!;
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3));
      for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
    out.push(list[list.length - 1]!);
    return out;
  }

  function outline(dr: NonNullable<typeof drag>): { pts: Pt[]; closed: boolean } {
    const a = dr.start;
    const b = dr.now;
    if (dr.tool === 'figline') return { pts: [a, b], closed: false };
    if (dr.tool === 'figrect') return { pts: [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], closed: true };
    if (dr.tool === 'figellipse') {
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const rx = Math.abs(b.x - a.x) / 2;
      const ry = Math.abs(b.y - a.y) / 2;
      const n = Math.min(720, Math.max(24, Math.ceil(Math.PI * (rx + ry) / 3)));
      return { pts: Array.from({ length: n }, (_, i) => ({ x: cx + rx * Math.cos((i / n) * Math.PI * 2), y: cy + ry * Math.sin((i / n) * Math.PI * 2) })), closed: true };
    }
    return { pts: dr.pts, closed: dr.tool === 'figpolygon' };
  }

  /** Draw the figure on the layer: its interior first when asked, then its outline with the brush. */
  function commitFigure(dr: NonNullable<typeof drag>): void {
    const { pts, closed } = outline(dr);
    if (pts.length < 2 || !editable()) return;
    const layer = d.activeLayer();
    const doc = d.doc();
    const target = paintTarget(layer);
    const steps = [];
    const b = d.brush();
    const sel = d.selection() ?? undefined;
    if (closed && pts.length >= 3 && d.fillShapes() && !d.transparent()) {
      const inside = Selection.polygon(doc.width, doc.height, pts);
      if (sel) inside.combine(sel as Selection, 'intersect');
      const fill = fillSelection(target.surface, layer.id, inside, d.colors().sub);
      if (fill) steps.push(patchCommand(doc, fill as StrokePatch, 'Relleno de figura'));
    }
    const stroke = new Stroke(target, { ...b, stabilization: 0, erase: b.erase || d.transparent(), pressureSize: 0, pressureOpacity: 0, taperIn: 0, taperOut: 0 }, sel);
    for (const p of dense(pts, closed)) stroke.addPoint(p.x, p.y, 1);
    const patch = stroke.finish();
    if (patch) steps.push(patchCommand(doc, patch, 'Figura'));
    const cmd = combineCommands('Figura', steps);
    if (!cmd) return;
    d.history().push(cmd);
    const r = cmd.region ?? { x: 0, y: 0, w: doc.width, h: doc.height };
    d.refreshLayer(layer, r);
    d.render(r);
    d.refreshUi();
  }

  function commitGradient(dr: NonNullable<typeof drag>): void {
    if (!editable() || Math.hypot(dr.now.x - dr.start.x, dr.now.y - dr.start.y) < 2) return;
    const layer = d.activeLayer();
    const { id, shape: chosen, repeat, dither, halftone } = d.gradient();
    const { main, sub } = d.colors();
    const { stops, mode, shape: wanted } = presetStops(id, main, sub);
    const shape = chosen === 'auto' ? wanted ?? 'linear' : chosen;
    const patch = applyGradient(paintTarget(layer).surface, layer.id, d.selection(), { shape, from: dr.start, to: dr.now, stops, mode, repeat, dither, halftone: halftone ? { ...halftone, dpi: d.doc().dpi, ink: main } : undefined });
    if (!patch) return;
    d.history().push(patchCommand(d.doc(), patch, mode === 'erase' ? 'Borrar degradado' : 'Degradado'));
    d.refreshLayer(layer, patch.rect);
    d.render(patch.rect);
    d.refreshUi();
  }

  function finishPath(): void {
    const dr = drag;
    if (!dr || !isPathTool(dr.tool)) return;
    drag = null;
    d.pathBar(false);
    if (dr.pts.length >= (dr.tool === 'figpolygon' ? 3 : 2)) commitFigure(dr);
    d.redrawOverlay();
  }

  const api = {
    get dragging() {
      return drag !== null;
    },
    get pathOpen() {
      return drag !== null && isPathTool(drag.tool);
    },
    down(tool: ShapeTool, _e: PointerEvent, p: Pt): void {
      if (isPathTool(tool)) {
        const now = performance.now();
        if (!drag || drag.tool !== tool) {
          drag = { tool, start: p, now: p, pts: [p], lastClick: { x: p.x, y: p.y, t: now } };
          d.pathBar(true);
          d.redrawOverlay();
          return;
        }
        const lc = drag.lastClick;
        const first = drag.pts[0]!;
        const twice = !!lc && now - lc.t < 350 && Math.hypot(p.x - lc.x, p.y - lc.y) * d.view.scale < 8;
        const onFirst = tool === 'figpolygon' && drag.pts.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) * d.view.scale <= 10;
        if (twice || onFirst) {
          finishPath();
          return;
        }
        drag.pts.push(p);
        drag.lastClick = { x: p.x, y: p.y, t: now };
        d.redrawOverlay();
        return;
      }
      drag = { tool, start: p, now: p, pts: [p] };
    },
    move(p: Pt): void {
      if (!drag) return;
      drag.now = p;
      d.redrawOverlay();
    },
    up(): void {
      if (!drag || isPathTool(drag.tool)) return;
      const dr = drag;
      drag = null;
      if (dr.tool === 'gradient') commitGradient(dr);
      else commitFigure(dr);
      d.redrawOverlay();
    },
    closePath: finishPath,
    cancelPath(): void {
      if (!drag || !isPathTool(drag.tool)) return;
      drag = null;
      d.pathBar(false);
      d.redrawOverlay();
    },
    drawOverlay(ctx: CanvasRenderingContext2D): void {
      if (!drag) return;
      const s = d.view.scale;
      ctx.save();
      ctx.lineWidth = 1.5 / s;
      ctx.setLineDash([6 / s, 4 / s]);
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      if (drag.tool === 'gradient') {
        ctx.moveTo(drag.start.x, drag.start.y);
        ctx.lineTo(drag.now.x, drag.now.y);
      } else {
        const { pts, closed } = outline(drag);
        pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        if (isPathTool(drag.tool)) ctx.lineTo(drag.now.x, drag.now.y);
        if (closed) ctx.closePath();
      }
      ctx.stroke();
      ctx.strokeStyle = '#000';
      ctx.lineDashOffset = 5 / s;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fff';
      for (const q of drag.tool === 'gradient' ? [drag.start, drag.now] : isPathTool(drag.tool) ? drag.pts : []) {
        ctx.beginPath();
        ctx.arc(q.x, q.y, 4 / s, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    },
  };
  return api;
}
