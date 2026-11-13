import type { Guides } from '../engine/guides';

export type Unit = 'px' | 'mm' | 'cm' | 'in';

/** What the dialog hands back: the page, how its paper looks and the guides the manga settings asked for. */
export interface NewDocSpec {
  name: string;
  width: number;
  height: number;
  dpi: number;
  /** Colour of the paper layer; null = no paper (the page starts transparent). */
  paper: [number, number, number] | null;
  guides: Guides;
}

/** Print sizes are physical (mm), screen sizes are pixels; each preset says which one it is defined in. */
export type Preset = { label: string; w: number; h: number; unit: 'mm' | 'px'; dpi: number };

export const PRESETS: Preset[] = [
  { label: 'A3', w: 297, h: 420, unit: 'mm', dpi: 300 },
  { label: 'A4', w: 210, h: 297, unit: 'mm', dpi: 300 },
  { label: 'A5', w: 148, h: 210, unit: 'mm', dpi: 300 },
  { label: 'A6', w: 105, h: 148, unit: 'mm', dpi: 300 },
  { label: 'B4', w: 257, h: 364, unit: 'mm', dpi: 300 },
  { label: 'B5', w: 182, h: 257, unit: 'mm', dpi: 300 },
  { label: 'B6 · tomo manga (tankōbon)', w: 128, h: 182, unit: 'mm', dpi: 600 },
  { label: 'B5 manga a 600 ppp', w: 182, h: 257, unit: 'mm', dpi: 600 },
  { label: 'Postal', w: 100, h: 148, unit: 'mm', dpi: 300 },
  { label: 'Cuadrado 210 mm', w: 210, h: 210, unit: 'mm', dpi: 300 },
  { label: 'Tira de webtoon · 800 × 1280', w: 800, h: 1280, unit: 'px', dpi: 72 },
  { label: 'Red social · 1080 × 1350', w: 1080, h: 1350, unit: 'px', dpi: 72 },
  { label: 'Pantalla HD · 1920 × 1080', w: 1920, h: 1080, unit: 'px', dpi: 72 },
  { label: 'Pantalla 4K · 3840 × 2160', w: 3840, h: 2160, unit: 'px', dpi: 72 },
];

/** A preset as pixels at its own resolution. */
export function presetSize(p: Preset): { w: number; h: number; dpi: number } {
  const px = (v: number): number => (p.unit === 'px' ? v : Math.round(toPx(v, 'mm', p.dpi)));
  return { w: px(p.w), h: px(p.h), dpi: p.dpi };
}

/** Largest page accepted: tiles keep memory proportional to ink, but the page still has to be addressable. */
export const MAX_PIXELS = 200_000_000;
export const MAX_SIDE = 20_000;

export function validate(w: number, h: number, dpi: number): string | null {
  if (![w, h, dpi].every((n) => Number.isFinite(n) && n > 0)) return 'Escribe números positivos.';
  if (w < 16 || h < 16) return 'La página debe medir al menos 16 px por lado.';
  if (w > MAX_SIDE || h > MAX_SIDE) return `Cada lado debe ser como máximo ${MAX_SIDE} px.`;
  if (w * h > MAX_PIXELS) return `La página no puede superar ${MAX_PIXELS / 1e6} megapíxeles.`;
  if (dpi < 10 || dpi > 2400) return 'Los ppp deben estar entre 10 y 2400.';
  return null;
}

// ---- units ------------------------------------------------------------------
const MM_PER_IN = 25.4;
const UNIT_MM: Record<Exclude<Unit, 'px'>, number> = { mm: 1, cm: 10, in: MM_PER_IN };

/** A length in `unit` as pixels at `dpi`. */
export function toPx(value: number, unit: Unit, dpi: number): number {
  return unit === 'px' ? value : ((value * UNIT_MM[unit]) / MM_PER_IN) * dpi;
}

/** A length in pixels at `dpi` as `unit`. */
export function fromPx(px: number, unit: Unit, dpi: number): number {
  return unit === 'px' ? px : (px / dpi) * (MM_PER_IN / UNIT_MM[unit]);
}

/** A length in `unit` as millimetres; pixels need the resolution. */
export function toMm(value: number, unit: Unit, dpi: number): number {
  return unit === 'px' ? (value / dpi) * MM_PER_IN : value * UNIT_MM[unit];
}

const DECIMALS: Record<Unit, number> = { px: 0, mm: 1, cm: 2, in: 2 };

/** Text for a length field: no trailing zeros, so 210 mm reads "210" and not "210.0". */
export function formatLength(value: number, unit: Unit): string {
  return String(Number(value.toFixed(DECIMALS[unit])));
}

// ---- manga page layout --------------------------------------------------------
export interface ComicSettings {
  /** Finished (trimmed) page size, mm. */
  trimW: number;
  trimH: number;
  /** Bleed: ink that runs past the finished edge so trimming leaves no white, mm. */
  bleed: number;
  /** Inner border: the frame the drawing lives in, as a margin in mm from the finished edge. */
  margin: number;
}

export interface ComicLayout {
  width: number;
  height: number;
  guides: Guides;
}

/** The pixel page for a manga setup, with a guide on each side of the trim box and of the inner border. */
export function comicLayout(c: ComicSettings, dpi: number): ComicLayout {
  const px = (mm: number): number => Math.round(toPx(mm, 'mm', dpi));
  const bleed = px(c.bleed);
  const trimW = px(c.trimW);
  const trimH = px(c.trimH);
  const margin = px(c.margin);
  const width = trimW + 2 * bleed;
  const height = trimH + 2 * bleed;
  const lines = (xs: number[], limit: number): number[] => [...new Set(xs)].filter((x) => x > 0 && x < limit).sort((a, b) => a - b);
  // A zero bleed puts the trim box on the page edge, where a guide would only be in the way.
  return {
    width,
    height,
    guides: {
      v: lines([bleed, bleed + trimW, bleed + margin, bleed + trimW - margin], width),
      h: lines([bleed, bleed + trimH, bleed + margin, bleed + trimH - margin], height),
    },
  };
}

/** Why a manga setup cannot be drawn, or null when it can. */
export function validateComic(c: ComicSettings): string | null {
  const nums = [c.trimW, c.trimH, c.bleed, c.margin];
  if (!nums.every((n) => Number.isFinite(n) && n >= 0) || c.trimW <= 0 || c.trimH <= 0) {
    return 'El tamaño cortado, el sangrado y el margen deben ser números positivos.';
  }
  if (2 * c.margin >= Math.min(c.trimW, c.trimH)) return 'El margen del marco interior es mayor que la página.';
  return null;
}

export function rgbToHex(c: readonly [number, number, number]): string {
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0xffffff;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---- dialog -----------------------------------------------------------------
interface Remembered {
  unit: Unit;
  preset: string;
  dpi: number;
  w: number;
  h: number;
  paper: string;
  noPaper: boolean;
  comic: boolean;
  bleed: number;
  margin: number;
}

const STORE_KEY = 'lienzo.newdoc';
const DEFAULTS: Remembered = { unit: 'mm', preset: '1', dpi: 300, w: 210, h: 297, paper: '#ffffff', noPaper: false, comic: false, bleed: 3, margin: 15 };

function recall(): Remembered {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Remembered>) };
  } catch {
    // Blocked or corrupt storage just means the defaults.
  }
  return DEFAULTS;
}

function remember(r: Remembered): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(r));
  } catch {
    // Not being able to remember is not worth bothering anyone about.
  }
}

/** Ask for the size and look of a new document; resolves to null when cancelled. */
export function askNewDocument(): Promise<NewDocSpec | null> {
  return new Promise((resolve) => {
    const saved = recall();
    const dlg = document.createElement('dialog');
    dlg.id = 'new-doc';
    dlg.innerHTML = `
      <h3>Nuevo documento</h3>
      <div class="nd-body">
        <div class="nd-form">
          <label>Nombre <input id="nd-name" type="text" value="Sin título" maxlength="80" /></label>
          <div class="row">
            <label class="grow">Tamaño
              <select id="nd-preset">${PRESETS.map((p, i) => `<option value="${i}">${p.label}</option>`).join('')}<option value="custom">Personalizado</option></select>
            </label>
            <label>Unidad
              <select id="nd-unit"><option>px</option><option>mm</option><option>cm</option><option>in</option></select>
            </label>
          </div>
          <div class="row nd-size">
            <label class="grow"><span id="nd-wl">Ancho</span> <input id="nd-w" type="number" min="0" step="any" /></label>
            <button id="nd-swap" type="button" title="Girar la página (vertical / horizontal)" aria-label="Girar la página">⇄</button>
            <label class="grow"><span id="nd-hl">Alto</span> <input id="nd-h" type="number" min="0" step="any" /></label>
            <label class="nd-dpi">ppp <input id="nd-dpi" type="number" min="10" max="2400" /></label>
          </div>
          <div class="row">
            <label>Color del papel <input id="nd-paper" type="color" value="#ffffff" /></label>
            <label class="check"><input id="nd-nopaper" type="checkbox" /> Sin papel (transparente)</label>
          </div>
          <label class="check"><input id="nd-comic" type="checkbox" /> Ajustes de manga: sangrado y marco interior</label>
          <div id="nd-comic-box" class="nd-comic" hidden>
            <div class="row">
              <label class="grow">Sangrado (mm) <input id="nd-bleed" type="number" min="0" step="any" /></label>
              <label class="grow">Margen del marco (mm) <input id="nd-margin" type="number" min="0" step="any" /></label>
            </div>
            <p class="hint">El tamaño de arriba es el de la página ya cortada. El lienzo suma el sangrado por cada lado y se marcan guías en el corte y en el marco.</p>
          </div>
        </div>
        <div class="nd-side">
          <svg id="nd-preview" viewBox="0 0 160 160" role="img" aria-label="Vista previa de la página"></svg>
          <p class="hint" id="nd-info"></p>
        </div>
      </div>
      <p class="hint nd-err" id="nd-err" role="alert"></p>
      <div class="row"><button id="nd-ok">Crear</button><button id="nd-cancel">Cancelar</button></div>`;
    document.body.append(dlg);
    const $ = <T extends HTMLElement>(id: string): T => dlg.querySelector<T>(`#${id}`)!;
    const name = $<HTMLInputElement>('nd-name');
    const preset = $<HTMLSelectElement>('nd-preset');
    const unitSel = $<HTMLSelectElement>('nd-unit');
    const w = $<HTMLInputElement>('nd-w');
    const h = $<HTMLInputElement>('nd-h');
    const dpi = $<HTMLInputElement>('nd-dpi');
    const paper = $<HTMLInputElement>('nd-paper');
    const noPaper = $<HTMLInputElement>('nd-nopaper');
    const comic = $<HTMLInputElement>('nd-comic');
    const bleed = $<HTMLInputElement>('nd-bleed');
    const margin = $<HTMLInputElement>('nd-margin');
    const unit = (): Unit => unitSel.value as Unit;
    let shownUnit: Unit = unit();

    /** The page the fields describe, or why they do not describe one. */
    const read = (): { page: ComicLayout | null; error: string | null } => {
      const d = Number(dpi.value);
      const u = unit();
      const wv = Number(w.value);
      const hv = Number(h.value);
      if (comic.checked) {
        const settings: ComicSettings = { trimW: toMm(wv, u, d), trimH: toMm(hv, u, d), bleed: Number(bleed.value), margin: Number(margin.value) };
        const bad = validateComic(settings) ?? (d > 0 ? null : 'Escribe números positivos.');
        if (bad) return { page: null, error: bad };
        const page = comicLayout(settings, d);
        return { page, error: validate(page.width, page.height, d) };
      }
      const width = Math.round(toPx(wv, u, d));
      const height = Math.round(toPx(hv, u, d));
      return { page: { width, height, guides: { v: [], h: [] } }, error: validate(width, height, d) };
    };

    const preview = (page: ComicLayout | null): void => {
      const svg = $('nd-preview');
      if (!page || !(page.width > 0 && page.height > 0)) {
        svg.innerHTML = '';
        return;
      }
      const s = 140 / Math.max(page.width, page.height);
      const pw = page.width * s;
      const ph = page.height * s;
      const ox = (160 - pw) / 2;
      const oy = (160 - ph) / 2;
      const lines = [
        ...page.guides.v.map((x) => `<line x1="${ox + x * s}" y1="${oy}" x2="${ox + x * s}" y2="${oy + ph}" />`),
        ...page.guides.h.map((y) => `<line x1="${ox}" y1="${oy + y * s}" x2="${ox + pw}" y2="${oy + y * s}" />`),
      ];
      svg.innerHTML = `<rect x="${ox}" y="${oy}" width="${pw}" height="${ph}" fill="${noPaper.checked ? 'none' : paper.value}" class="nd-page${noPaper.checked ? ' nd-clear' : ''}" />
        <g class="nd-guides">${lines.join('')}</g>`;
    };

    const info = (): void => {
      const { page, error } = read();
      preview(page);
      $('nd-err').textContent = error ?? '';
      if (!page || !(page.width > 0 && page.height > 0)) {
        $('nd-info').textContent = '';
        return;
      }
      const d = Number(dpi.value);
      const mp = (page.width * page.height) / 1e6;
      const mm = `${formatLength(fromPx(page.width, 'mm', d), 'mm')} × ${formatLength(fromPx(page.height, 'mm', d), 'mm')} mm`;
      $('nd-info').textContent = `Lienzo ${page.width} × ${page.height} px · ${mm} · ${mp.toFixed(1)} Mpx. Una capa llena ocuparía ${(mp * 4).toFixed(0)} MB; en blanco no cuesta nada.`;
    };

    const setLabels = (): void => {
      $('nd-wl').textContent = comic.checked ? 'Ancho cortada' : 'Ancho';
      $('nd-hl').textContent = comic.checked ? 'Alto cortada' : 'Alto';
      $('nd-comic-box').hidden = !comic.checked;
    };

    const applyPreset = (): void => {
      const p = PRESETS[Number(preset.value)];
      if (!p) return;
      dpi.value = String(p.dpi);
      // Pixel presets only make sense in pixels; physical ones keep the unit the user picked.
      if (p.unit === 'px') unitSel.value = 'px';
      else if (unit() === 'px') unitSel.value = 'mm';
      shownUnit = unit();
      const u = unit();
      const show = (v: number): string => formatLength(p.unit === 'px' ? v : fromPx(toPx(v, 'mm', p.dpi), u, p.dpi), u);
      w.value = show(p.w);
      h.value = show(p.h);
      info();
    };

    // Restore the last choice.
    unitSel.value = saved.unit;
    shownUnit = unit();
    dpi.value = String(saved.dpi);
    paper.value = saved.paper;
    noPaper.checked = saved.noPaper;
    paper.disabled = saved.noPaper;
    comic.checked = saved.comic;
    bleed.value = String(saved.bleed);
    margin.value = String(saved.margin);
    if (PRESETS[Number(saved.preset)]) {
      preset.value = saved.preset;
      applyPreset();
    } else {
      preset.value = 'custom';
      w.value = formatLength(saved.w, saved.unit);
      h.value = formatLength(saved.h, saved.unit);
    }
    setLabels();
    info();

    preset.addEventListener('change', () => {
      if (preset.value !== 'custom') applyPreset();
    });
    unitSel.addEventListener('change', () => {
      // The physical size stays put when the unit changes.
      const d = Number(dpi.value);
      for (const el of [w, h]) {
        const px = toPx(Number(el.value), shownUnit, d);
        if (Number.isFinite(px)) el.value = formatLength(fromPx(px, unit(), d), unit());
      }
      shownUnit = unit();
      info();
    });
    $('nd-swap').addEventListener('click', () => {
      [w.value, h.value] = [h.value, w.value];
      info();
    });
    for (const el of [w, h]) {
      el.addEventListener('input', () => {
        preset.value = 'custom';
        info();
      });
    }
    for (const el of [dpi, paper, bleed, margin]) el.addEventListener('input', info);
    noPaper.addEventListener('change', () => {
      paper.disabled = noPaper.checked;
      info();
    });
    comic.addEventListener('change', () => {
      setLabels();
      info();
    });

    const close = (r: NewDocSpec | null): void => {
      dlg.close();
      dlg.remove();
      resolve(r);
    };
    $('nd-cancel').addEventListener('click', () => close(null));
    dlg.addEventListener('cancel', () => close(null));
    $('nd-ok').addEventListener('click', () => {
      const { page, error } = read();
      if (error || !page) {
        $('nd-err').textContent = error ?? 'Revisa las medidas.';
        return;
      }
      remember({
        unit: unit(),
        preset: preset.value,
        dpi: Number(dpi.value),
        w: Number(w.value),
        h: Number(h.value),
        paper: paper.value,
        noPaper: noPaper.checked,
        comic: comic.checked,
        bleed: Number(bleed.value),
        margin: Number(margin.value),
      });
      close({
        name: name.value.trim() || 'Sin título',
        width: page.width,
        height: page.height,
        dpi: Number(dpi.value),
        paper: noPaper.checked ? null : hexToRgb(paper.value),
        guides: page.guides,
      });
    });
    dlg.showModal();
    name.select();
  });
}
