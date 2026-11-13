import { bodyOutline, tailShapes, textArea, type Balloon } from '../engine/balloon';
import type { Document, Layer } from '../engine/document';
import type { Poly } from '../engine/geometry';
import type { Panel } from '../engine/panels';
import { fitText } from '../engine/text-layout';
import { TILE, tileRange, type Rect } from '../engine/tiles';

let scratch: HTMLCanvasElement | null = null;

function tileContext(): CanvasRenderingContext2D {
  if (!scratch) {
    scratch = document.createElement('canvas');
    scratch.width = TILE;
    scratch.height = TILE;
  }
  return scratch.getContext('2d', { willReadFrequently: true })!;
}

const path = (ctx: CanvasRenderingContext2D, poly: Poly): void => {
  ctx.beginPath();
  poly.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
};

function drawBalloon(ctx: CanvasRenderingContext2D, b: Balloon): void {
  const body = bodyOutline(b);
  const tails = tailShapes(b);
  if (body.length) {
    // Stroke first, then fill over it: the fill hides the seam where the tail meets the body,
    // so only the outer silhouette keeps its outline.
    ctx.lineJoin = b.shape === 'shout' ? 'miter' : 'round';
    ctx.miterLimit = 6;
    ctx.lineWidth = b.border * 2;
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#fff';
    const shapes = [body, ...tails];
    for (const s of shapes) {
      path(ctx, s);
      ctx.stroke();
    }
    for (const s of shapes) {
      path(ctx, s);
      ctx.fill();
    }
  }
  if (!b.text.trim()) return;

  const area = textArea(b);
  const family = b.fontFamily;
  const measureAt = (size: number) => (s: string) => {
    ctx.font = `${size}px ${family}`;
    return ctx.measureText(s).width;
  };
  const layout = fitText(b.text, {
    areaW: area.w,
    areaH: area.h,
    fontSize: b.fontSize,
    vertical: b.vertical,
    measureAt,
  });
  ctx.font = `${layout.fontSize}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const item of layout.items) {
    const x = area.x + item.cx;
    const y = area.y + item.cy;
    if (b.shape === 'none') {
      // Free text gets a white halo so it stays readable over artwork.
      ctx.lineWidth = Math.max(3, layout.fontSize * 0.18);
      ctx.strokeStyle = '#fff';
      ctx.strokeText(item.text, x, y);
    }
    ctx.fillStyle = '#000';
    ctx.fillText(item.text, x, y);
  }
}

function drawPanel(ctx: CanvasRenderingContext2D, p: Panel): void {
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = p.border;
  path(ctx, p.points);
  ctx.stroke();
}

const grow = (r: Rect, pad: number): Rect => ({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad });

/** Where an object's ink can fall, as a few rectangles (a panel is a thin frame, not a filled box). */
function panelRects(p: Panel): Rect[] {
  const pad = p.border * 3 + 2; // room for mitred corners
  return p.points.map((a, i) => {
    const b = p.points[(i + 1) % p.points.length]!;
    return grow({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }, pad);
  });
}

function balloonRect(b: Balloon): Rect {
  let x0 = b.x;
  let y0 = b.y;
  let x1 = b.x + b.w;
  let y1 = b.y + b.h;
  for (const p of tailShapes(b).flat()) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return grow({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, b.border * 3 + b.fontSize * 0.5 + 4);
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Rasterise the vector objects of a panels/balloons layer tile by tile, drawing only
 * the tiles their ink can reach (plus the ones that held ink before, to clear them).
 * No canvas ever has the size of the page. Returns the area that changed, or null.
 */
export function renderObjectsLayer(layer: Layer, doc: Pick<Document, 'width' | 'height'>): Rect | null {
  const items: { rects: Rect[]; draw: (ctx: CanvasRenderingContext2D) => void }[] = [];
  if (layer.kind === 'panels') {
    for (const p of layer.panels ?? []) items.push({ rects: panelRects(p), draw: (c) => drawPanel(c, p) });
  } else if (layer.kind === 'balloons') {
    for (const b of layer.balloons ?? []) items.push({ rects: [balloonRect(b)], draw: (c) => drawBalloon(c, b) });
  } else {
    return null;
  }

  const surface = layer.surface;
  const grid = { tilesX: surface.tilesX, tilesY: surface.tilesY };
  const wanted = new Set<number>();
  for (const it of items) {
    for (const r of it.rects) {
      const { tx0, ty0, tx1, ty1 } = tileRange(grid, r);
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) wanted.add(surface.key(tx, ty));
    }
  }
  const todo = new Set<number>([...wanted, ...(layer.renderedTiles ?? [])]);
  const inked = new Set<number>();
  const ctx = tileContext();
  let dirty: Rect | null = null;

  for (const key of todo) {
    const tx = surface.tx(key);
    const ty = surface.ty(key);
    const tileRect: Rect = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, TILE, TILE);
    ctx.setTransform(1, 0, 0, 1, -tileRect.x, -tileRect.y);
    let drew = false;
    for (const it of items) {
      if (!it.rects.some((r) => overlaps(r, tileRect))) continue;
      ctx.save();
      it.draw(ctx);
      ctx.restore();
      drew = true;
    }
    let has = false;
    if (drew) {
      const data = ctx.getImageData(0, 0, TILE, TILE).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 0) {
          has = true;
          break;
        }
      }
      if (has) surface.put(tx, ty, data);
    }
    if (has) inked.add(key);
    else if (surface.get(tx, ty)) surface.put(tx, ty, undefined);
    dirty = dirty
      ? {
          x: Math.min(dirty.x, tileRect.x),
          y: Math.min(dirty.y, tileRect.y),
          w: Math.max(dirty.x + dirty.w, tileRect.x + TILE) - Math.min(dirty.x, tileRect.x),
          h: Math.max(dirty.y + dirty.h, tileRect.y + TILE) - Math.min(dirty.y, tileRect.y),
        }
      : tileRect;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  layer.renderedTiles = inked;
  void doc;
  return dirty;
}
