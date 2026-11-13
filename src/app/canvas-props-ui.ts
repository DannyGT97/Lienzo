import { hasPaper, paperOf, type CanvasProps } from '../engine/canvas-props';
import type { Document } from '../engine/document';
import { anchoredWindow } from '../engine/page-ops';
import { CENTER } from './canvas-resize';
import { PRESETS, formatLength, fromPx, hexToRgb, presetSize, rgbToHex, toPx, validate, type Unit } from './new-doc';

// "Propiedades básicas del lienzo": size, resolution, paper and frame guides in one place, laid out like Clip Studio's
// dialog. Size changes keep the old page centred; the resolution only changes how big the page is on paper.

const UNITS: Unit[] = ['px', 'mm', 'cm', 'in'];
let unit: Unit = 'mm';

export interface CanvasPropsDeps {
  doc: () => Document;
  /** Apply the changes as one history step; false when nothing was done. */
  commit: (p: CanvasProps) => boolean;
}

export function openCanvasProps(deps: CanvasPropsDeps): void {
  const doc = deps.doc();
  const dlg = document.createElement('dialog');
  dlg.id = 'cp';
  const paper = paperOf(doc);
  dlg.innerHTML = `
    <div class="cp-head">
      <label>Unidad <select id="cp-unit">${UNITS.map((u) => `<option value="${u}">${u}</option>`).join('')}</select></label>
      <span class="cp-spacer"></span>
      <button type="button" id="cp-ok" class="primary">Aceptar</button>
      <button type="button" id="cp-cancel">Cancelar</button>
    </div>
    <h4 class="cp-group">Lienzo</h4>
    <div class="cp-body">
      <div class="cp-form">
        <div class="cp-row">
          <label>Ancho <input id="cp-w" type="number" min="0" step="any" inputmode="decimal"></label>
          <button type="button" id="cp-swap" title="Intercambiar ancho y altura" aria-label="Intercambiar ancho y altura">⇄</button>
          <label>Altura <input id="cp-h" type="number" min="0" step="any" inputmode="decimal"></label>
        </div>
        <label>Personalizar <select id="cp-preset"><option value="custom">Personalizado</option>${PRESETS.map((p, i) => `<option value="${i}">${p.label}</option>`).join('')}</select></label>
        <label>Resolución (ppp) <input id="cp-dpi" type="number" min="10" max="2400" step="1"></label>
        <div class="cp-row">
          <label class="check"><input id="cp-paper-on" type="checkbox"> Color del papel</label>
          <input id="cp-paper" type="color" value="#ffffff" aria-label="Color del papel">
        </div>
      </div>
      <svg id="cp-preview" viewBox="0 0 120 120" role="img" aria-label="Vista previa de la página"></svg>
    </div>
    <h4 class="cp-group">Marco</h4>
    <label class="check"><input id="cp-frame" type="checkbox"> Añadir guías de sangrado y margen</label>
    <div class="cp-row" id="cp-frame-box">
      <label>Sangrado (mm) <input id="cp-bleed" type="number" min="0" step="any" value="3"></label>
      <label>Margen (mm) <input id="cp-margin" type="number" min="0" step="any" value="10"></label>
    </div>
    <p class="cp-err" id="cp-err" role="alert"></p>`;
  document.body.append(dlg);

  const $ = <T extends HTMLElement>(id: string): T => dlg.querySelector<T>(`#${id}`)!;
  const unitSel = $<HTMLSelectElement>('cp-unit');
  const wIn = $<HTMLInputElement>('cp-w');
  const hIn = $<HTMLInputElement>('cp-h');
  const dpiIn = $<HTMLInputElement>('cp-dpi');
  const presetSel = $<HTMLSelectElement>('cp-preset');
  const paperOn = $<HTMLInputElement>('cp-paper-on');
  const paperIn = $<HTMLInputElement>('cp-paper');
  const frameOn = $<HTMLInputElement>('cp-frame');
  const bleedIn = $<HTMLInputElement>('cp-bleed');
  const marginIn = $<HTMLInputElement>('cp-margin');
  const ok = $<HTMLButtonElement>('cp-ok');

  // The page in pixels is the truth; the fields only show it in the chosen unit at the chosen resolution.
  let px = { w: doc.width, h: doc.height };
  let dpi = doc.dpi;

  const close = (): void => {
    dlg.close();
    dlg.remove();
  };

  /** Pixels (rounded) for what is typed in a size field, or null while it is not a number. */
  const readPx = (el: HTMLInputElement): number | null => {
    const v = Number(el.value);
    return el.value.trim() !== '' && Number.isFinite(v) && v > 0 ? Math.round(toPx(v, unit, dpi)) : null;
  };
  const show = (except?: HTMLInputElement): void => {
    if (except !== wIn) wIn.value = formatLength(fromPx(px.w, unit, dpi), unit);
    if (except !== hIn) hIn.value = formatLength(fromPx(px.h, unit, dpi), unit);
  };

  const problem = (): string | null => validate(px.w, px.h, dpi);

  function preview(): void {
    const svg = $('cp-preview');
    const s = 100 / Math.max(px.w, px.h);
    const w = px.w * s;
    const h = px.h * s;
    const fill = hasPaper(doc) && !paperOn.checked ? 'none' : paperIn.value;
    svg.innerHTML = `<rect x="${(120 - w) / 2}" y="${(120 - h) / 2}" width="${w}" height="${h}" fill="${fill}" class="cp-page${fill === 'none' ? ' cp-clear' : ''}" />`;
  }

  function refresh(): void {
    const bad = problem();
    $('cp-err').textContent = bad ?? '';
    ok.disabled = bad !== null;
    paperIn.disabled = !paperOn.checked;
    $('cp-frame-box').hidden = !frameOn.checked;
    if (bad === null) preview();
  }

  // Start from the page as it is.
  unitSel.value = unit;
  dpiIn.value = String(dpi);
  paperOn.checked = paper !== null;
  paperOn.disabled = !hasPaper(doc);
  paperIn.value = rgbToHex(paper ?? [255, 255, 255]);
  show();
  refresh();

  for (const el of [wIn, hIn]) {
    el.addEventListener('input', () => {
      const v = readPx(el);
      if (v === null) return; // half-typed
      if (el === wIn) px.w = v;
      else px.h = v;
      presetSel.value = 'custom';
      refresh();
    });
    el.addEventListener('change', () => {
      show();
      refresh();
    });
  }
  dpiIn.addEventListener('input', () => {
    const v = Number(dpiIn.value);
    if (!Number.isFinite(v) || v <= 0) return;
    dpi = v;
    show();
    refresh();
  });
  unitSel.addEventListener('change', () => {
    unit = unitSel.value as Unit;
    show();
  });
  $('cp-swap').addEventListener('click', () => {
    px = { w: px.h, h: px.w };
    presetSel.value = 'custom';
    show();
    refresh();
  });
  presetSel.addEventListener('change', () => {
    const p = PRESETS[Number(presetSel.value)];
    if (!p) return;
    const s = presetSize(p);
    px = { w: s.w, h: s.h };
    dpi = s.dpi;
    dpiIn.value = String(dpi);
    show();
    refresh();
  });
  for (const el of [paperOn, paperIn, frameOn]) el.addEventListener('input', refresh);

  function accept(): void {
    if (problem()) return;
    const changed = px.w !== doc.width || px.h !== doc.height;
    const bleed = toPx(Number(bleedIn.value) || 0, 'mm', dpi);
    const margin = toPx(Number(marginIn.value) || 0, 'mm', dpi);
    const props: CanvasProps = {
      dpi,
      ...(changed ? { rect: anchoredWindow(doc.width, doc.height, px.w, px.h, CENTER) } : {}),
      ...(hasPaper(doc) ? { paper: paperOn.checked ? hexToRgb(paperIn.value) : null } : {}),
      ...(frameOn.checked ? { frame: [bleed, bleed + margin] } : {}),
    };
    close();
    deps.commit(props);
  }

  ok.addEventListener('click', accept);
  $('cp-cancel').addEventListener('click', close);
  dlg.addEventListener('cancel', close);
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
      e.preventDefault();
      accept();
    }
  });
  dlg.showModal();
}
