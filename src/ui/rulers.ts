export interface RulerDeps {
  view: () => { x: number; y: number; scale: number };
  /** A drag began on a ruler: the top ruler makes horizontal guides, the left one vertical guides. */
  onGuide?: (axis: 'v' | 'h', e: PointerEvent) => void;
}

const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
const SIZE = 20;

/** Pixel rulers along the top and left edges of the canvas area. They only draw while visible. */
export function mountRulers(stage: HTMLElement, d: RulerDeps): { toggle: () => void; isVisible: () => boolean; redraw: () => void; suppress: (on: boolean) => void } {
  const top = document.createElement('canvas');
  const left = document.createElement('canvas');
  top.className = 'ruler ruler-top';
  left.className = 'ruler ruler-left';
  const corner = document.createElement('div');
  corner.className = 'ruler-corner';
  for (const e of [top, left, corner]) {
    e.hidden = true;
    stage.append(e);
  }
  let visible = false;
  /** The rulers measure an unturned page: while the view is turned they stay out of the way. */
  let suppressed = false;
  const show = (): void => {
    for (const e of [top, left, corner]) e.hidden = !visible || suppressed;
  };
  top.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    d.onGuide?.('h', e);
  });
  left.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    d.onGuide?.('v', e);
  });

  function draw(c: HTMLCanvasElement, horizontal: boolean): void {
    const dpr = window.devicePixelRatio || 1;
    const length = horizontal ? stage.clientWidth - SIZE : stage.clientHeight - SIZE;
    const w = horizontal ? length : SIZE;
    const h = horizontal ? SIZE : length;
    if (w <= 0 || h <= 0) return;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#2a2a2f';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#8a8c96';
    g.fillStyle = '#a9abb4';
    g.font = '10px system-ui, sans-serif';
    g.lineWidth = 1;
    const v = d.view();
    const origin = (horizontal ? v.x : v.y) - SIZE; // screen offset of document 0 inside this ruler
    const s = v.scale;
    const step = STEPS.find((n) => n * s >= 60) ?? STEPS[STEPS.length - 1]!;
    const minor = step / 10 >= 1 && (step / 10) * s >= 6 ? step / 10 : 0;
    const from = Math.floor(-origin / s / (minor || step)) * (minor || step);
    const to = (length - origin) / s;
    g.beginPath();
    for (let n = from; n <= to; n += minor || step) {
      const p = Math.round(origin + n * s) + 0.5;
      const major = Math.abs(n % step) < 1e-6;
      const len = major ? SIZE : minor && Math.abs(n % (step / 2)) < 1e-6 ? SIZE * 0.55 : SIZE * 0.3;
      if (horizontal) {
        g.moveTo(p, SIZE);
        g.lineTo(p, SIZE - len);
      } else {
        g.moveTo(SIZE, p);
        g.lineTo(SIZE - len, p);
      }
      if (major) {
        if (horizontal) g.fillText(String(Math.round(n)), p + 3, 9);
        else {
          g.save();
          g.translate(9, p - 3);
          g.rotate(-Math.PI / 2);
          g.fillText(String(Math.round(n)), 0, 0);
          g.restore();
        }
      }
    }
    g.stroke();
    g.strokeStyle = '#46464e';
    g.strokeRect(0.5, 0.5, w - 1, h - 1);
  }

  const redraw = (): void => {
    if (!visible || suppressed) return;
    draw(top, true);
    draw(left, false);
  };
  return {
    toggle: () => {
      visible = !visible;
      show();
      redraw();
    },
    suppress: (on) => {
      if (suppressed === on) return;
      suppressed = on;
      show();
      redraw();
    },
    isVisible: () => visible,
    redraw,
  };
}
