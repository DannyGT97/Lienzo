import { cmykToRgb, DEFAULT_COLOR_SET, fromHex, hsvToRgb, labToRgb, rgbToCmyk, rgbToHsv, rgbToLab, toHex, type CMYK, type HSV, type Lab, type RGB } from '../color';
import { icon } from '../icons';
import type { PaletteInstance } from '../palette-dock';

export interface ColorDeps {
  get: () => RGB;
  /** Change the main drawing colour. `from` lets the caller avoid feedback loops. */
  set: (rgb: RGB, from?: string) => void;
  /** Be told whenever the colour changes (from any palette or the swatch). */
  subscribe: (cb: (rgb: RGB, from?: string) => void) => void;
}

/** The colours the person added to the set and the ones used lately: shared by every palette and window that shows them. */
export interface ColorStores {
  user: string[];
  recent: string[];
}

/** How many used colours the history keeps. */
export const HISTORY_MAX = 300;
const HISTORY_KEY = 'lienzo.colorHistory';

/** The history with `hex` first: a colour used again moves to the front instead of repeating. */
export function pushRecent(recent: readonly string[], hex: string, max = HISTORY_MAX): string[] {
  return [hex, ...recent.filter((c) => c !== hex)].slice(0, max);
}

function loadHistory(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function saveHistory(recent: readonly string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(recent));
  } catch {
    // Private mode or a full quota: the history just lasts for this session.
  }
}

/** `subscribe` is the main colour: whatever it settles on for a moment goes to the history, which is kept between sessions. */
export function createColorStores(subscribe: ColorDeps['subscribe']): ColorStores {
  const stores: ColorStores = { user: [], recent: loadHistory() };
  let timer = 0;
  subscribe((rgb, from) => {
    if (from === 'slot') return; // choosing the other swatch is not using a colour
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const hex = toHex(rgb);
      if (stores.recent[0] === hex) return;
      stores.recent.splice(0, stores.recent.length, ...pushRecent(stores.recent, hex));
      saveHistory(stores.recent);
    }, 900);
  });
  return stores;
}

/** Keeps the hue/saturation of a grey or black colour when only the RGB triple is known. */
function hsvFor(rgb: RGB, previous: HSV): HSV {
  const back = hsvToRgb(previous[0], previous[1], previous[2]);
  if (back[0] === rgb[0] && back[1] === rgb[1] && back[2] === rgb[2]) return previous;
  const [h, s, v] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
  return [s === 0 || v === 0 ? previous[0] : h, s, v];
}

/** Same idea for Lab and CMYK: keep what the person typed while it still means this RGB (grey inks, out-of-range Lab). */
function keepIfSame<T extends readonly number[]>(rgb: RGB, previous: T, toRgb: (v: T) => RGB, fresh: (rgb: RGB) => T): T {
  const back = toRgb(previous);
  return back[0] === rgb[0] && back[1] === rgb[1] && back[2] === rgb[2] ? previous : fresh(rgb);
}

/** Which of hue, saturation and value the vertical bar edits (the square shows the other two). */
export type Component = 0 | 1 | 2;

/** Pointer capture helper: `at` gets the pointer position inside `el` as 0..1 fractions, on press and while dragging. */
function dragOn(el: HTMLElement, at: (x: number, y: number, first: boolean) => boolean | void): void {
  let on = false;
  const pos = (e: PointerEvent, first: boolean): void => {
    const r = el.getBoundingClientRect();
    if (at((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, first) === false) on = false;
  };
  el.addEventListener('pointerdown', (e) => {
    on = true;
    el.setPointerCapture(e.pointerId);
    pos(e, true);
  });
  el.addEventListener('pointermove', (e) => on && pos(e, false));
  el.addEventListener('pointerup', () => (on = false));
  el.addEventListener('pointercancel', () => (on = false));
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function marker(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#000';
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
}

function barMarker(ctx: CanvasRenderingContext2D, w: number, y: number): void {
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#000';
  ctx.strokeRect(1, y - 3, w - 2, 6);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#fff';
  ctx.strokeRect(1, y - 3, w - 2, 6);
}

/** `large` draws the wheel for a roomy window (the colour settings) instead of the narrow docked palette. */
export function createColorPalettes(d: ColorDeps, stores: ColorStores, large = false): {
  wheel: (body: HTMLElement) => PaletteInstance;
  plane: (body: HTMLElement, component: () => Component) => PaletteInstance;
  disc: (body: HTMLElement) => PaletteInstance;
  fields: (body: HTMLElement, component: Component, onComponent: (c: Component) => void) => PaletteInstance;
  sliders: (body: HTMLElement) => PaletteInstance;
  set: (body: HTMLElement) => PaletteInstance;
  history: (body: HTMLElement) => PaletteInstance;
} {
  const { user, recent } = stores;
  let hsv: HSV = rgbToHsv(...d.get());
  let lab: Lab = rgbToLab(...d.get());
  let cmyk: CMYK = rgbToCmyk(...d.get());
  const redraws: Array<(from?: string) => void> = [];
  d.subscribe((rgb, from) => {
    hsv = hsvFor(rgb, hsv);
    lab = keepIfSame(rgb, lab, (v) => labToRgb(...v), (c) => rgbToLab(...c));
    cmyk = keepIfSame(rgb, cmyk, (v) => cmykToRgb(...v), (c) => rgbToCmyk(...c));
    for (const r of redraws) r(from);
  });
  const setHsv = (next: HSV, from: string): void => {
    hsv = next;
    d.set(hsvToRgb(next[0], next[1], next[2]), from);
  };

  // ---- colour wheel: hue ring with a saturation/value square inside
  function wheel(body: HTMLElement): PaletteInstance {
    const k = large ? 1.8 : 1;
    const S = Math.round(176 * k);
    const c = S / 2;
    const R = 82 * k;
    const r = 64 * k;
    const q = r * 0.7;
    body.classList.add('color-body');
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    canvas.className = 'wheel';
    body.append(canvas);
    const swatches = document.createElement('div');
    swatches.className = 'wheel-info';
    swatches.innerHTML = '<span class="chip main"></span><span class="hex"></span><span class="hsv"></span>';
    body.append(swatches);
    const ctx = canvas.getContext('2d')!;

    function draw(): void {
      const img = ctx.createImageData(S, S);
      const [h, s, v] = hsv;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const dx = x + 0.5 - c;
          const dy = y + 0.5 - c;
          const dist = Math.hypot(dx, dy);
          const o = (y * S + x) * 4;
          if (dist >= r - 0.5 && dist <= R + 0.5) {
            const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
            const rgb = hsvToRgb(ang, 1, 1);
            img.data[o] = rgb[0];
            img.data[o + 1] = rgb[1];
            img.data[o + 2] = rgb[2];
            img.data[o + 3] = 255 * Math.min(1, Math.min(dist - (r - 0.5), R + 0.5 - dist) + 0.5);
          } else if (Math.abs(dx) <= q && Math.abs(dy) <= q) {
            const rgb = hsvToRgb(h, (dx + q) / (2 * q), 1 - (dy + q) / (2 * q));
            img.data[o] = rgb[0];
            img.data[o + 1] = rgb[1];
            img.data[o + 2] = rgb[2];
            img.data[o + 3] = 255;
          }
        }
      }
      ctx.putImageData(img, 0, 0);
      const mark = (x: number, y: number): void => {
        ctx.beginPath();
        ctx.arc(x, y, 5.5 * k, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000';
        ctx.stroke();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      };
      const a = (h * Math.PI) / 180;
      mark(c + Math.cos(a) * ((r + R) / 2), c + Math.sin(a) * ((r + R) / 2));
      mark(c - q + s * 2 * q, c - q + (1 - v) * 2 * q);
      const rgb = hsvToRgb(h, s, v);
      (swatches.querySelector('.chip') as HTMLElement).style.background = toHex(rgb);
      swatches.querySelector('.hex')!.textContent = toHex(rgb).toUpperCase();
      swatches.querySelector('.hsv')!.textContent = `H ${Math.round(h)} S ${Math.round(s * 100)} V ${Math.round(v * 100)}`;
    }

    let mode: 'hue' | 'sv' | null = null;
    const apply = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * S - c;
      const y = ((e.clientY - rect.top) / rect.height) * S - c;
      if (mode === 'hue') {
        setHsv([(Math.atan2(y, x) * 180) / Math.PI, hsv[1], hsv[2]], 'wheel');
      } else if (mode === 'sv') {
        const s = Math.min(1, Math.max(0, (x + q) / (2 * q)));
        const v = Math.min(1, Math.max(0, 1 - (y + q) / (2 * q)));
        setHsv([hsv[0], s, v], 'wheel');
      }
      draw();
    };
    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * S - c;
      const y = ((e.clientY - rect.top) / rect.height) * S - c;
      const dist = Math.hypot(x, y);
      mode = dist >= r - 6 && dist <= R + 8 ? 'hue' : Math.abs(x) <= q + 6 && Math.abs(y) <= q + 6 ? 'sv' : null;
      if (!mode) return;
      canvas.setPointerCapture(e.pointerId);
      apply(e);
    });
    canvas.addEventListener('pointermove', (e) => mode && apply(e));
    canvas.addEventListener('pointerup', () => (mode = null));
    canvas.addEventListener('pointercancel', () => (mode = null));
    redraws.push(draw);
    draw();
    return { refresh: draw };
  }

  // ---- square + vertical bar ("Por defecto"): the bar edits one of H, S, V and the square the other two
  function plane(body: HTMLElement, component: () => Component): PaletteInstance {
    const N = 200;
    const BW = 28;
    body.classList.add('color-body', 'cs-plane');
    const sq = document.createElement('canvas');
    const bar = document.createElement('canvas');
    sq.width = sq.height = bar.height = N;
    bar.width = BW;
    sq.className = 'cs-square';
    bar.className = 'cs-bar';
    body.append(sq, bar);
    const sctx = sq.getContext('2d')!;
    const bctx = bar.getContext('2d')!;
    const squareColor = (c: Component, x: number, y: number): RGB => (c === 0 ? hsvToRgb(hsv[0], x, y) : c === 1 ? hsvToRgb(x * 360, hsv[1], y) : hsvToRgb(x * 360, y, hsv[2]));
    const barColor = (c: Component, t: number): RGB => (c === 0 ? hsvToRgb(t * 360, 1, 1) : c === 1 ? hsvToRgb(hsv[0], 1 - t, hsv[2]) : hsvToRgb(hsv[0], hsv[1], 1 - t));
    function draw(): void {
      const c = component();
      const img = sctx.createImageData(N, N);
      for (let py = 0; py < N; py++)
        for (let px = 0; px < N; px++) {
          const rgb = squareColor(c, (px + 0.5) / N, 1 - (py + 0.5) / N);
          const o = (py * N + px) * 4;
          img.data[o] = rgb[0];
          img.data[o + 1] = rgb[1];
          img.data[o + 2] = rgb[2];
          img.data[o + 3] = 255;
        }
      sctx.putImageData(img, 0, 0);
      const [x, y] = c === 0 ? [hsv[1], hsv[2]] : c === 1 ? [hsv[0] / 360, hsv[2]] : [hsv[0] / 360, hsv[1]];
      marker(sctx, x! * N, (1 - y!) * N);
      for (let py = 0; py < N; py++) {
        bctx.fillStyle = toHex(barColor(c, (py + 0.5) / N));
        bctx.fillRect(0, py, BW, 1);
      }
      barMarker(bctx, BW, (c === 0 ? hsv[0] / 360 : 1 - hsv[c]) * N);
    }
    dragOn(sq, (fx, fy) => {
      const x = clamp01(fx);
      const y = 1 - clamp01(fy);
      const c = component();
      setHsv(c === 0 ? [hsv[0], x, y] : c === 1 ? [Math.min(359.99, x * 360), hsv[1], y] : [Math.min(359.99, x * 360), y, hsv[2]], 'plane');
    });
    dragOn(bar, (_fx, fy) => {
      const t = clamp01(fy);
      const c = component();
      setHsv(c === 0 ? [Math.min(359.99, t * 360), hsv[1], hsv[2]] : c === 1 ? [hsv[0], 1 - t, hsv[2]] : [hsv[0], hsv[1], 1 - t], 'plane');
    });
    redraws.push(draw);
    draw();
    return { refresh: draw };
  }

  // ---- round wheel (hue around, saturation outwards) + vertical value bar ("Círculo de colores 2")
  function disc(body: HTMLElement): PaletteInstance {
    const N = 200;
    const BW = 28;
    const R = N / 2 - 3;
    body.classList.add('color-body', 'cs-plane');
    const wheel = document.createElement('canvas');
    const bar = document.createElement('canvas');
    wheel.width = wheel.height = bar.height = N;
    bar.width = BW;
    wheel.className = 'cs-square cs-disc';
    bar.className = 'cs-bar';
    body.append(wheel, bar);
    const wctx = wheel.getContext('2d')!;
    const bctx = bar.getContext('2d')!;
    function draw(): void {
      // Drawn at least a little bright, so a black colour still shows where to pick.
      const shade = Math.max(hsv[2], 0.25);
      const img = wctx.createImageData(N, N);
      for (let py = 0; py < N; py++)
        for (let px = 0; px < N; px++) {
          const dx = px + 0.5 - N / 2;
          const dy = py + 0.5 - N / 2;
          const dist = Math.hypot(dx, dy);
          if (dist > R + 0.5) continue;
          const rgb = hsvToRgb((Math.atan2(dy, dx) * 180) / Math.PI, Math.min(1, dist / R), shade);
          const o = (py * N + px) * 4;
          img.data[o] = rgb[0];
          img.data[o + 1] = rgb[1];
          img.data[o + 2] = rgb[2];
          img.data[o + 3] = 255 * clamp01(R + 1 - dist);
        }
      wctx.putImageData(img, 0, 0);
      const a = (hsv[0] * Math.PI) / 180;
      marker(wctx, N / 2 + Math.cos(a) * hsv[1] * R, N / 2 + Math.sin(a) * hsv[1] * R);
      for (let py = 0; py < N; py++) {
        bctx.fillStyle = toHex(hsvToRgb(hsv[0], hsv[1], 1 - (py + 0.5) / N));
        bctx.fillRect(0, py, BW, 1);
      }
      barMarker(bctx, BW, (1 - hsv[2]) * N);
    }
    dragOn(wheel, (fx, fy, first) => {
      const x = (fx - 0.5) * N;
      const y = (fy - 0.5) * N;
      if (first && Math.hypot(x, y) > R + 8) return false; // a press outside the wheel does nothing
      setHsv([(Math.atan2(y, x) * 180) / Math.PI, clamp01(Math.hypot(x, y) / R), hsv[2]], 'disc');
    });
    dragOn(bar, (_fx, fy) => setHsv([hsv[0], hsv[1], 1 - clamp01(fy)], 'disc'));
    redraws.push(draw);
    draw();
    return { refresh: draw };
  }

  // ---- every numeric form of the colour in one place: H S V (one of them drives the bar), R G B, L a b, C M Y K, hex
  function fields(body: HTMLElement, component: Component, onComponent: (c: Component) => void): PaletteInstance {
    body.classList.add('cs-fields');
    interface Field {
      k: string;
      min: number;
      max: number;
      get: () => number;
      set: (v: number) => void;
    }
    const rgbField = (i: 0 | 1 | 2, k: string): Field => ({
      k,
      min: 0,
      max: 255,
      get: () => d.get()[i],
      set: (v) => d.set(d.get().map((c, j) => (j === i ? v : c)) as RGB, 'fields'),
    });
    const hsvField = (i: 0 | 1 | 2, k: string, max: number): Field => ({
      k,
      min: 0,
      max,
      get: () => hsv[i] * (i === 0 ? 1 : 100),
      set: (v) => setHsv(hsv.map((c, j) => (j === i ? v / (i === 0 ? 1 : 100) : c)) as HSV, 'fields'),
    });
    const labField = (i: 0 | 1 | 2, k: string, min: number, max: number): Field => ({
      k,
      min,
      max,
      get: () => lab[i],
      set: (v) => {
        lab = lab.map((c, j) => (j === i ? v : c)) as Lab;
        d.set(labToRgb(...lab), 'fields');
      },
    });
    const cmykField = (i: 0 | 1 | 2 | 3, k: string): Field => ({
      k,
      min: 0,
      max: 100,
      get: () => cmyk[i],
      set: (v) => {
        cmyk = cmyk.map((c, j) => (j === i ? v : c)) as CMYK;
        d.set(cmykToRgb(...cmyk), 'fields');
      },
    });
    const groups: Array<{ fields: Field[]; radio?: boolean }> = [
      { fields: [hsvField(0, 'H', 359), hsvField(1, 'S', 100), hsvField(2, 'V', 100)], radio: true },
      { fields: [rgbField(0, 'R'), rgbField(1, 'G'), rgbField(2, 'B')] },
      { fields: [labField(0, 'L', 0, 100), labField(1, 'a', -128, 127), labField(2, 'b', -128, 127)] },
      { fields: [cmykField(0, 'C'), cmykField(1, 'M'), cmykField(2, 'Y'), cmykField(3, 'K')] },
    ];
    const inputs: Array<{ el: HTMLInputElement; f: Field }> = [];
    for (const g of groups) {
      const box = document.createElement('div');
      box.className = 'cs-group';
      g.fields.forEach((f, i) => {
        const row = document.createElement('label');
        row.className = 'cs-field';
        const key = g.radio ? `<input type="radio" name="cs-component" aria-label="La barra cambia ${f.k}"${i === component ? ' checked' : ''} />` : '';
        row.innerHTML = `${key}<span class="cs-k">${f.k}</span><input type="number" min="${f.min}" max="${f.max}" step="1" />`;
        const el = row.querySelector('input[type="number"]') as HTMLInputElement;
        el.addEventListener('change', () => f.set(Math.min(f.max, Math.max(f.min, Number(el.value) || 0))));
        row.querySelector('input[type="radio"]')?.addEventListener('change', () => onComponent(i as Component));
        inputs.push({ el, f });
        box.append(row);
      });
      body.append(box);
    }
    const hexRow = document.createElement('label');
    hexRow.className = 'cs-field cs-hexrow';
    hexRow.innerHTML = '<span class="cs-k">#</span><input class="cs-hex" type="text" maxlength="7" spellcheck="false" />';
    const hex = hexRow.querySelector('input')!;
    hex.addEventListener('change', () => /^#?[0-9a-fA-F]{6}$/.test(hex.value) && d.set(fromHex(hex.value.startsWith('#') ? hex.value : `#${hex.value}`), 'fields'));
    body.append(hexRow);
    const sync = (): void => {
      for (const { el, f } of inputs) if (document.activeElement !== el) el.value = String(Math.round(f.get()));
      if (document.activeElement !== hex) hex.value = toHex(d.get()).toUpperCase();
    };
    redraws.push(sync);
    sync();
    return { refresh: sync };
  }

  // ---- numeric sliders: H S V and R G B
  function sliders(body: HTMLElement): PaletteInstance {
    body.classList.add('color-body', 'slider-body');
    const rows = [
      { k: 'H', max: 360, get: () => hsv[0], set: (v: number) => setHsv([v, hsv[1], hsv[2]], 'sliders') },
      { k: 'S', max: 100, get: () => hsv[1] * 100, set: (v: number) => setHsv([hsv[0], v / 100, hsv[2]], 'sliders') },
      { k: 'V', max: 100, get: () => hsv[2] * 100, set: (v: number) => setHsv([hsv[0], hsv[1], v / 100], 'sliders') },
      { k: 'R', max: 255, get: () => d.get()[0], set: (v: number) => d.set([v, d.get()[1], d.get()[2]], 'sliders') },
      { k: 'G', max: 255, get: () => d.get()[1], set: (v: number) => d.set([d.get()[0], v, d.get()[2]], 'sliders') },
      { k: 'B', max: 255, get: () => d.get()[2], set: (v: number) => d.set([d.get()[0], d.get()[1], v], 'sliders') },
    ];
    const els = rows.map((row) => {
      const wrap = document.createElement('div');
      wrap.className = 'cs-row';
      wrap.innerHTML = `<span class="cs-k">${row.k}</span><input type="range" min="0" max="${row.max}" step="1" /><input type="number" min="0" max="${row.max}" />`;
      const [range, num] = [...wrap.querySelectorAll('input')] as HTMLInputElement[];
      const push = (v: number): void => row.set(Math.min(row.max, Math.max(0, v)));
      range!.addEventListener('input', () => push(Number(range!.value)));
      num!.addEventListener('change', () => push(Number(num!.value) || 0));
      body.append(wrap);
      return { range: range!, num: num!, row };
    });
    const hexRow = document.createElement('div');
    hexRow.className = 'cs-row';
    hexRow.innerHTML = '<span class="cs-k">#</span><input class="cs-hex" type="text" maxlength="7" spellcheck="false" />';
    const hex = hexRow.querySelector('input')!;
    hex.addEventListener('change', () => /^#?[0-9a-fA-F]{6}$/.test(hex.value) && d.set(fromHex(hex.value.startsWith('#') ? hex.value : `#${hex.value}`), 'sliders'));
    body.append(hexRow);
    const sync = (): void => {
      for (const e of els) {
        const v = Math.round(e.row.get());
        if (document.activeElement !== e.num) e.num.value = String(v);
        e.range.value = String(v);
      }
      if (document.activeElement !== hex) hex.value = toHex(d.get());
    };
    redraws.push(sync);
    sync();
    return { refresh: sync };
  }

  // ---- colour set (grid of swatches) and colour history
  function grid(body: HTMLElement, colors: () => string[], withAdd: boolean): PaletteInstance {
    body.classList.add('color-body');
    const box = document.createElement('div');
    box.className = 'swatch-grid';
    body.append(box);
    if (withAdd) {
      const row = document.createElement('div');
      row.className = 'nav-row';
      const add = document.createElement('button');
      add.className = 'nav-btn wide';
      add.innerHTML = `${icon('plus', 14)} Añadir color actual`;
      add.addEventListener('click', () => {
        user.push(toHex(d.get()));
        render();
      });
      const del = document.createElement('button');
      del.className = 'nav-btn wide';
      del.disabled = true;
      del.title = 'Todavía no disponible';
      del.textContent = 'Borrar';
      row.append(add, del);
      body.append(row);
    }
    const render = (): void => {
      box.replaceChildren();
      for (const hex of colors()) {
        const b = document.createElement('button');
        b.className = 'sw';
        b.style.background = hex;
        b.title = hex.toUpperCase();
        b.addEventListener('click', () => d.set(fromHex(hex), 'set'));
        box.append(b);
      }
    };
    render();
    return { refresh: render };
  }

  return {
    wheel,
    plane,
    disc,
    fields,
    sliders,
    set: (body) => grid(body, () => [...DEFAULT_COLOR_SET, ...user], true),
    history: (body) => grid(body, () => (recent.length ? recent : ['#000000']), false),
  };
}
