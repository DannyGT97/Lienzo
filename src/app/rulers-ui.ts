import type { Document } from '../engine/document';
import type { Pt } from '../engine/geometry';
import type { History } from '../engine/history';
import {
  DEFAULT_SPECIAL_COUNT,
  DEFAULT_SPECIAL_GAP,
  distanceToRuler,
  followGuides,
  followPerspective,
  mirrors,
  recordRulers,
  rulerPath,
  simplifyPath,
  specialGuides,
  type FigureShape,
  type Ruler,
  type SpecialShape,
} from '../engine/rulers';

export type RulerTool = 'rulerline' | 'rulerpersp' | 'rulersym' | 'rulercurve' | 'rulerfigure' | 'rulerpen' | 'rulerspecial';
const RULER_TOOLS: ReadonlySet<string> = new Set<RulerTool>(['rulerline', 'rulerpersp', 'rulersym', 'rulercurve', 'rulerfigure', 'rulerpen', 'rulerspecial']);
export const isRulerTool = (t: string): t is RulerTool => RULER_TOOLS.has(t);

/** What the tool options bar says about the ruler about to be made. */
export interface RulerOptions {
  /** Vanishing points the perspective ruler has: 1, 2 or 3. */
  perspPoints: 1 | 2 | 3;
  figure: FigureShape;
  special: SpecialShape;
  /** Special: guides (each side of the base, rings, or rays). */
  count: number;
  /** Special: distance between parallel lines or rings, in pixels. */
  gap: number;
}

export interface RulersDeps {
  doc: () => Document;
  view: { x: number; y: number; scale: number };
  history: () => History;
  redraw: () => void;
  say: (msg: string) => void;
  /** Strokes follow the rulers (the "snap to rulers" switch). */
  snapOn: () => boolean;
  options: () => RulerOptions;
}

/** What a pen stroke has to do to follow the rulers: where it paints, and the mirror images it also paints. */
export interface StrokeRulers {
  follow: (p: Pt) => Pt;
  mirrors: ((p: Pt) => Pt)[];
}

const LABEL: Record<Ruler['kind'], string> = {
  line: 'Nueva regla lineal',
  perspective: 'Nuevo punto de fuga',
  persp2: 'Nueva perspectiva de 2 puntos',
  persp3: 'Nueva perspectiva de 3 puntos',
  symmetry: 'Nueva regla de simetría',
  curve: 'Nueva regla curva',
  pen: 'Nueva pluma de regla',
  figure: 'Nueva regla de figura',
  special: 'Nueva regla especial',
};

/** Rulers made by clicking points one after another; they close when enough points are in (or with Enter / a double click for the pen). */
type PendingKind = 'pen' | 'persp2' | 'persp3';
const NEEDS: Record<PendingKind, number> = { pen: Infinity, persp2: 2, persp3: 3 };

const far = 1e6;
const extend = (a: Pt, b: Pt): [Pt, Pt] => {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  return [{ x: a.x - ux * far, y: a.y - uy * far }, { x: a.x + ux * far, y: a.y + uy * far }];
};

/** Drawing rulers: make them with the ruler tools, and ask them how a stroke should follow them. */
export function createRulersUi(d: RulersDeps): {
  down(tool: RulerTool, e: PointerEvent, p: Pt): void;
  move(p: Pt): void;
  up(): void;
  readonly dragging: boolean;
  forStroke(start: Pt): StrokeRulers | null;
  drawOverlay(ctx: CanvasRenderingContext2D): void;
  clear(): void;
  readonly any: boolean;
  /** Points are being clicked for a pen or perspective ruler. */
  readonly pending: boolean;
  finishPending(): void;
  cancelPending(): void;
} {
  let drag: { tool: RulerTool; start: Pt; now: Pt; path: Pt[] } | null = null;
  let pend: { kind: PendingKind; pts: Pt[] } | null = null;

  const rulers = (): Ruler[] => d.doc().rulers;
  const round1 = (q: Pt): Pt => ({ x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 });

  function add(r: Omit<Ruler, 'id'>): void {
    const doc = d.doc();
    const cmd = recordRulers(doc, LABEL[r.kind], () => doc.rulers.push({ ...r, id: doc.nextRulerId++, pts: r.pts.map(round1) }));
    if (cmd) d.history().push(cmd);
  }

  /** Alt + click deletes the ruler nearest to the click. */
  function removeNear(p: Pt): boolean {
    const tol = 12 / d.view.scale;
    let hit: Ruler | null = null;
    let best = tol;
    for (const r of rulers()) {
      const dist = distanceToRuler(r, p);
      if (dist <= best) {
        hit = r;
        best = dist;
      }
    }
    if (!hit) return false;
    const gone = hit;
    const doc = d.doc();
    const cmd = recordRulers(doc, 'Borrar regla', () => (doc.rulers = doc.rulers.filter((r) => r.id !== gone.id)));
    if (cmd) d.history().push(cmd);
    return true;
  }

  /** The ruler the current drag would make (also what the preview shows), or null while it is too small to count. */
  function draft(dr: NonNullable<typeof drag>): Omit<Ruler, 'id'> | null {
    const o = d.options();
    const moved = Math.hypot(dr.now.x - dr.start.x, dr.now.y - dr.start.y) * d.view.scale;
    switch (dr.tool) {
      case 'rulerline':
        return moved >= 5 ? { kind: 'line', pts: [dr.start, dr.now] } : null;
      case 'rulersym':
        // A click makes a vertical axis through it.
        return moved < 5 ? { kind: 'symmetry', pts: [dr.start, { x: dr.start.x, y: dr.start.y + 100 }] } : { kind: 'symmetry', pts: [dr.start, dr.now] };
      case 'rulerfigure':
        return moved >= 5 ? { kind: 'figure', shape: o.figure, pts: [dr.start, dr.now] } : null;
      case 'rulerspecial': {
        if (moved < 5) return null;
        const shape = o.special;
        return { kind: 'special', shape, count: o.count > 0 ? o.count : DEFAULT_SPECIAL_COUNT[shape], gap: o.gap > 0 ? o.gap : DEFAULT_SPECIAL_GAP, pts: [dr.start, dr.now] };
      }
      case 'rulercurve': {
        if (moved < 5 && dr.path.length < 3) return null;
        const pts = simplifyPath(dr.path, 6 / d.view.scale, 2.5 / d.view.scale);
        return pts.length >= 2 ? { kind: 'curve', pts } : null;
      }
      default:
        return null;
    }
  }

  function commitPending(): void {
    if (!pend) return;
    const done = pend;
    pend = null;
    if (done.pts.length >= (done.kind === 'pen' ? 2 : NEEDS[done.kind])) add({ kind: done.kind, pts: done.pts });
    d.redraw();
  }

  /** One ruler on the overlay. `preview` draws it white and dashed, the way a ruler being made looks. */
  function drawRuler(ctx: CanvasRenderingContext2D, r: Ruler, s: number, preview: boolean): void {
    const line = (color: string, dash: number[], segs: [Pt, Pt][]): void => {
      ctx.strokeStyle = preview ? 'rgba(255, 255, 255, 0.9)' : color;
      ctx.setLineDash((preview ? [6, 4] : dash).map((n) => n / s));
      ctx.beginPath();
      for (const [a, b] of segs) {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    };
    const pink = 'rgba(255, 70, 210, 0.9)';
    switch (r.kind) {
      case 'line':
        if (r.pts.length >= 2) line(pink, [], [extend(r.pts[0]!, r.pts[1]!)]);
        break;
      case 'symmetry':
        if (r.pts.length >= 2) line('rgba(60, 220, 120, 0.95)', [10, 6], [extend(r.pts[0]!, r.pts[1]!)]);
        break;
      case 'curve':
      case 'pen':
      case 'figure': {
        const path = rulerPath(r);
        if (!path) break;
        ctx.strokeStyle = preview ? 'rgba(255, 255, 255, 0.9)' : pink;
        ctx.setLineDash((preview ? [6, 4] : []).map((n) => n / s));
        ctx.beginPath();
        path.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        if (path.closed) ctx.closePath();
        ctx.stroke();
        break;
      }
      case 'special': {
        const cyan = 'rgba(70, 200, 255, 0.9)';
        const guides = specialGuides(r);
        const lines: [Pt, Pt][] = [];
        ctx.strokeStyle = preview ? 'rgba(255, 255, 255, 0.9)' : cyan;
        ctx.setLineDash((preview ? [6, 4] : []).map((n) => n / s));
        ctx.beginPath();
        for (const g of guides) {
          if ('line' in g) lines.push([{ x: g.line.o.x - g.line.u.x * far, y: g.line.o.y - g.line.u.y * far }, { x: g.line.o.x + g.line.u.x * far, y: g.line.o.y + g.line.u.y * far }]);
          else {
            ctx.moveTo(g.circle.c.x + g.circle.r, g.circle.c.y);
            ctx.arc(g.circle.c.x, g.circle.c.y, g.circle.r, 0, Math.PI * 2);
          }
        }
        ctx.stroke();
        if (lines.length) line(cyan, [], lines);
        break;
      }
      case 'perspective':
      case 'persp2':
      case 'persp3': {
        // Vanishing points: a mark and faint rays every 15 degrees; two points also show their horizon.
        const rays: [Pt, Pt][] = [];
        for (const v of r.pts) for (let a = 0; a < 360; a += 15) rays.push([v, { x: v.x + Math.cos((a * Math.PI) / 180) * far, y: v.y + Math.sin((a * Math.PI) / 180) * far }]);
        ctx.lineWidth = 1 / s;
        line('rgba(255, 190, 60, 0.35)', [], rays);
        if (r.kind === 'persp2' && r.pts.length >= 2) {
          ctx.lineWidth = 1.5 / s;
          line('rgba(255, 190, 60, 0.9)', [], [extend(r.pts[0]!, r.pts[1]!)]);
        }
        ctx.lineWidth = 1.5 / s;
        ctx.setLineDash([]);
        ctx.fillStyle = preview ? 'rgba(255, 255, 255, 1)' : 'rgba(255, 190, 60, 1)';
        for (const v of r.pts) {
          ctx.beginPath();
          ctx.arc(v.x, v.y, 6 / s, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
    }
  }

  return {
    get dragging() {
      return drag !== null;
    },
    get any() {
      return rulers().length > 0;
    },
    get pending() {
      return pend !== null;
    },
    down(tool, e, p) {
      if (e.altKey && removeNear(p)) {
        d.redraw();
        return;
      }
      const kind: PendingKind | null = tool === 'rulerpen' ? 'pen' : tool === 'rulerpersp' && d.options().perspPoints > 1 ? (d.options().perspPoints === 2 ? 'persp2' : 'persp3') : null;
      if (kind) {
        if (pend && pend.kind !== kind) pend = null;
        const last = pend?.pts[pend.pts.length - 1];
        if (kind === 'pen' && pend && last && Math.hypot(p.x - last.x, p.y - last.y) * d.view.scale < 8) {
          commitPending(); // a second click on the last point (a double click) ends the polyline
          return;
        }
        pend = pend ?? { kind, pts: [] };
        pend.pts.push(p);
        if (pend.pts.length >= NEEDS[kind]) commitPending();
        else d.say(kind === 'pen' ? 'Clic para seguir la línea; Intro o doble clic la termina, Esc la cancela.' : `Perspectiva de ${kind === 'persp2' ? 2 : 3} puntos: marca el punto ${pend.pts.length + 1}.`);
        d.redraw();
        return;
      }
      if (tool === 'rulerpersp') {
        add({ kind: 'perspective', pts: [p] });
        d.say('Punto de fuga creado. Alt + clic cerca de una regla la borra.');
        d.redraw();
        return;
      }
      drag = { tool, start: p, now: p, path: [p] };
    },
    move(p) {
      if (!drag) return;
      drag.now = p;
      if (drag.tool === 'rulercurve') drag.path.push(p);
      d.redraw();
    },
    up() {
      if (!drag) return;
      const dr = drag;
      drag = null;
      const r = draft(dr);
      if (r) add(r);
      d.redraw();
    },
    finishPending() {
      commitPending();
    },
    cancelPending() {
      if (!pend) return;
      pend = null;
      d.redraw();
    },
    forStroke(start) {
      if (!d.snapOn() || !rulers().length) return null;
      const rs = rulers();
      const guide = followGuides(rs, start, 14 / d.view.scale);
      const persp = guide ? null : followPerspective(rs, start, 8 / d.view.scale);
      const flips = mirrors(rs);
      const follow = guide ?? persp;
      if (!follow && !flips.length) return null;
      return { follow: follow ?? ((p) => p), mirrors: flips };
    },
    clear() {
      const doc = d.doc();
      const cmd = recordRulers(doc, 'Borrar reglas', () => (doc.rulers = []));
      if (cmd) d.history().push(cmd);
      pend = null;
      d.redraw();
    },
    drawOverlay(ctx) {
      const s = d.view.scale;
      const all = rulers();
      if (!all.length && !drag && !pend) return;
      ctx.save();
      ctx.lineWidth = 1.5 / s;
      for (const r of all) drawRuler(ctx, r, s, false);
      if (drag) {
        const r = draft(drag);
        if (r) drawRuler(ctx, { ...r, id: 0 }, s, true);
        else if (drag.tool === 'rulercurve') {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.setLineDash([6 / s, 4 / s]);
          ctx.beginPath();
          drag.path.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
          ctx.stroke();
        }
      }
      if (pend) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.setLineDash([6 / s, 4 / s]);
        ctx.beginPath();
        pend.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255, 255, 255, 1)';
        for (const q of pend.pts) {
          ctx.beginPath();
          ctx.arc(q.x, q.y, 4 / s, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    },
  };
}
