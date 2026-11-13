import { thumbnail } from '../../engine/composite';
import type { Document } from '../../engine/document';
import { icon } from '../icons';
import type { PaletteInstance } from '../palette-dock';

export interface NavigatorDeps {
  doc: () => Document;
  view: () => { x: number; y: number; scale: number };
  stageSize: () => { w: number; h: number };
  /** The four corners of the page area shown on the stage (tilted when the view is turned). */
  visibleOutline: () => { x: number; y: number }[];
  orientation: () => { rot: number; flip: boolean; tilt?: number };
  rotateTo: (degrees: number) => void;
  flipHorizontal: () => void;
  resetOrientation: () => void;
  setZoom: (scale: number) => void;
  centerOn: (docX: number, docY: number) => void;
  fit: () => void;
  actualSize: () => void;
}

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 16;
/** How close (degrees) the rotation slider must be to a quarter turn to settle exactly on it. */
const ROT_CLING = 6;
const posToZoom = (pos: number): number => MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, pos / 1000);
const zoomToPos = (z: number): number => Math.round((Math.log(z / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM)) * 1000);

/** Navigator: a live thumbnail of the whole page with the visible area marked, plus zoom controls. */
export function createNavigator(d: NavigatorDeps): { build: (body: HTMLElement) => PaletteInstance; invalidate: () => void; viewChanged: () => void } {
  let canvas: HTMLCanvasElement;
  let overlay: HTMLCanvasElement;
  let slider: HTMLInputElement;
  let label: HTMLElement;
  let thumb: HTMLCanvasElement | null = null;
  let tw = 0;
  let th = 0;
  let timer = 0;
  let rotSlider: HTMLInputElement | null = null;
  let rotLabel: HTMLElement | null = null;
  let built = false;

  const MAX_W = 210;
  const MAX_H = 150;

  function layout(): void {
    const doc = d.doc();
    const k = Math.min(MAX_W / doc.width, MAX_H / doc.height);
    tw = Math.max(1, Math.round(doc.width * k));
    th = Math.max(1, Math.round(doc.height * k));
    for (const c of [canvas, overlay]) {
      c.width = tw;
      c.height = th;
      c.style.width = `${tw}px`;
      c.style.height = `${th}px`;
    }
  }

  function drawThumb(): void {
    if (!built) return;
    const doc = d.doc();
    layout();
    const data = thumbnail(doc, tw, th);
    thumb ??= document.createElement('canvas');
    thumb.width = tw;
    thumb.height = th;
    thumb.getContext('2d')!.putImageData(new ImageData(data, tw, th), 0, 0);
    const ctx = canvas.getContext('2d')!;
    // Checkerboard behind transparent areas, like the main canvas.
    for (let y = 0; y < th; y += 8)
      for (let x = 0; x < tw; x += 8) {
        ctx.fillStyle = ((x + y) / 8) % 2 ? '#d0d0d0' : '#ffffff';
        ctx.fillRect(x, y, 8, 8);
      }
    ctx.drawImage(thumb, 0, 0);
    drawRect();
  }

  function drawRect(): void {
    if (!built) return;
    const doc = d.doc();
    const k = tw / doc.width;
    const ctx = overlay.getContext('2d')!;
    ctx.clearRect(0, 0, tw, th);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ff4d4d';
    ctx.fillStyle = 'rgba(255, 77, 77, 0.10)';
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, tw, th); // only the part of the shown area that lies on the page
    ctx.clip();
    ctx.beginPath();
    d.visibleOutline().forEach((p, i) => (i ? ctx.lineTo(p.x * k, p.y * k) : ctx.moveTo(p.x * k, p.y * k)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    const o = d.orientation();
    if (rotSlider) {
      // The angle the page is turned by, folded into the slider's -180..180 range.
      const deg = Math.round(o.rot * 90 + ((o.tilt ?? 0) * 180) / Math.PI);
      const folded = ((((deg + 180) % 360) + 360) % 360) - 180;
      rotSlider.value = String(folded);
      if (rotLabel) rotLabel.textContent = `${folded}°`;
    }
    const z = d.view().scale;
    slider.value = String(zoomToPos(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))));
    label.textContent = `${Math.round(z * 100)} %`;
  }

  const api = {
    build(body: HTMLElement): PaletteInstance {
      body.classList.add('nav-body');
      body.innerHTML = `
        <div class="nav-thumb"><canvas class="nav-img"></canvas><canvas class="nav-rect"></canvas></div>
        <div class="nav-row">
          <button class="nav-btn" data-act="out" title="Alejar">${icon('zoom-out', 16)}</button>
          <input class="nav-zoom" type="range" min="0" max="1000" />
          <button class="nav-btn" data-act="in" title="Acercar">${icon('zoom-in', 16)}</button>
          <span class="nav-pct"></span>
        </div>
        <div class="nav-row">
          <button class="nav-btn wide" data-act="fit" title="Ver todo el lienzo">Ajustar</button>
          <button class="nav-btn wide" data-act="actual" title="Tamaño de píxel (100 %)">100 %</button>
          <button class="nav-btn" data-act="flip" title="Voltear la vista horizontalmente">${icon('swap', 16)}</button>
          <button class="nav-btn" data-act="reset" title="Restablecer rotación e inversión">${icon('rotate', 16)}</button>
        </div>
        <div class="nav-row">
          <span class="nav-lbl">Rotación</span>
          <input class="nav-rot" type="range" min="-180" max="180" step="1" value="0" title="Gira la vista (también con dos dedos sobre el lienzo)" />
          <span class="nav-deg"></span>
        </div>
        <div class="nav-row nav-presets">
          <button class="nav-btn wide" data-turn="0" title="Vista derecha">0°</button>
          <button class="nav-btn wide" data-turn="90" title="Girar la vista 90° a la derecha">90°</button>
          <button class="nav-btn wide" data-turn="180" title="Girar la vista 180°">180°</button>
          <button class="nav-btn wide" data-turn="-90" title="Girar la vista 90° a la izquierda">270°</button>
        </div>`;
      canvas = body.querySelector('.nav-img')!;
      overlay = body.querySelector('.nav-rect')!;
      slider = body.querySelector('.nav-zoom')!;
      label = body.querySelector('.nav-pct')!;
      built = true;
      slider.addEventListener('input', () => d.setZoom(posToZoom(Number(slider.value))));
      body.querySelector('[data-act="in"]')!.addEventListener('click', () => d.setZoom(d.view().scale * 1.25));
      body.querySelector('[data-act="out"]')!.addEventListener('click', () => d.setZoom(d.view().scale * 0.8));
      body.querySelector('[data-act="fit"]')!.addEventListener('click', () => d.fit());
      body.querySelector('[data-act="actual"]')!.addEventListener('click', () => d.actualSize());
      body.querySelector('[data-act="flip"]')!.addEventListener('click', () => d.flipHorizontal());
      body.querySelector('[data-act="reset"]')!.addEventListener('click', () => d.resetOrientation());
      rotSlider = body.querySelector('.nav-rot')!;
      rotLabel = body.querySelector('.nav-deg')!;
      rotSlider.addEventListener('input', () => {
        // Close to a quarter turn the slider clings to it, so straight views are easy to hit; in between it is free.
        const raw = Number(rotSlider!.value);
        const near = Math.round(raw / 90) * 90;
        const deg = Math.abs(raw - near) <= ROT_CLING ? near : raw;
        rotSlider!.value = String(deg);
        rotLabel!.textContent = `${deg}°`;
        d.rotateTo(deg);
      });
      for (const b of body.querySelectorAll<HTMLElement>('[data-turn]')) {
        b.addEventListener('click', () => d.rotateTo(Number(b.dataset.turn)));
      }
      // Click or drag on the thumbnail to move the view there.
      const move = (e: PointerEvent): void => {
        const r = overlay.getBoundingClientRect();
        const doc = d.doc();
        d.centerOn(((e.clientX - r.left) / r.width) * doc.width, ((e.clientY - r.top) / r.height) * doc.height);
      };
      overlay.addEventListener('pointerdown', (e) => {
        overlay.setPointerCapture(e.pointerId);
        move(e);
      });
      overlay.addEventListener('pointermove', (e) => {
        if (e.buttons) move(e);
      });
      drawThumb();
      return { refresh: drawThumb };
    },

    /** The page content changed: redraw the thumbnail once things settle. */
    invalidate(): void {
      if (!built) return;
      clearTimeout(timer);
      timer = window.setTimeout(drawThumb, 350);
    },

    viewChanged(): void {
      drawRect();
    },
  };
  return api;
}
