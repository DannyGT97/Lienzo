import type { Resolution } from '../engine/canvas-props';
import type { Document } from '../engine/document';
import type { ResampleMethod } from '../engine/resample';
import { makeDraggable } from '../ui/drag-dialog';
import { formatLength, fromPx, toPx, validate, type Unit } from './new-doc';

// "Cambiar resolución de imagen", laid out like Clip Studio's: size, scale, interpolation method, resolution and unit.
// With "No cambiar los píxeles" the picture stays as it is and only its printed size changes (the resolution moves);
// without it the picture is re-sampled to the new size.

const UNITS: Unit[] = ['px', 'mm', 'cm', 'in'];
const METHODS: { id: ResampleMethod; label: string }[] = [
  { id: 'average', label: 'Alta precisión' },
  { id: 'bicubic', label: 'Bicúbico' },
  { id: 'bilinear', label: 'Bilineal' },
  { id: 'nearest', label: 'Vecino más cercano' },
];
const DPIS = [72, 96, 150, 300, 350, 400, 600, 1200];
let unit: Unit = 'px';
let method: ResampleMethod = 'average';

export interface ResolutionDeps {
  doc: () => Document;
  /** Apply the change as one history step; false when nothing was done. */
  commit: (r: Resolution) => boolean;
}

export function openResolution(deps: ResolutionDeps): void {
  const doc = deps.doc();
  const orig = { w: doc.width, h: doc.height, dpi: doc.dpi };
  const dlg = document.createElement('dialog');
  dlg.id = 'rs';
  dlg.innerHTML = `
    <h3>Cambiar resolución de imagen</h3>
    <div class="rs-body">
      <div class="rs-form">
        <div class="rs-grid">
          <label for="rs-w">Ancho</label><input id="rs-w" type="number" min="0" step="any" inputmode="decimal">
          <label for="rs-h">Altura</label><input id="rs-h" type="number" min="0" step="any" inputmode="decimal">
          <label for="rs-s">Escala</label><input id="rs-s" type="number" min="0" step="0.01" inputmode="decimal">
          <label for="rs-m">Método</label><select id="rs-m">${METHODS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('')}</select>
          <label for="rs-d">Resolución</label><input id="rs-d" type="number" min="1" step="any" inputmode="decimal" list="rs-dpis">
          <label for="rs-u">Unidad</label><select id="rs-u">${UNITS.map((u) => `<option value="${u}">${u}</option>`).join('')}</select>
        </div>
        <datalist id="rs-dpis">${DPIS.map((d) => `<option value="${d}"></option>`).join('')}</datalist>
        <label class="rs-check"><input id="rs-keep" type="checkbox"> No cambiar los píxeles</label>
        <label class="rs-check"><input id="rs-lock" type="checkbox" checked> Mantener proporción</label>
        <p class="rs-err" id="rs-err" role="alert"></p>
      </div>
      <div class="rs-buttons">
        <button type="button" id="rs-ok" class="primary">Aceptar</button>
        <button type="button" id="rs-cancel">Cancelar</button>
      </div>
    </div>`;
  document.body.append(dlg);
  makeDraggable(dlg, dlg.querySelector('h3')!); // its resize listener ends by itself once the dialog is removed

  const $ = <T extends HTMLElement>(id: string): T => dlg.querySelector<T>(`#${id}`)!;
  const wIn = $<HTMLInputElement>('rs-w');
  const hIn = $<HTMLInputElement>('rs-h');
  const sIn = $<HTMLInputElement>('rs-s');
  const mSel = $<HTMLSelectElement>('rs-m');
  const dIn = $<HTMLInputElement>('rs-d');
  const uSel = $<HTMLSelectElement>('rs-u');
  const keepIn = $<HTMLInputElement>('rs-keep');
  const lockIn = $<HTMLInputElement>('rs-lock');
  const ok = $<HTMLButtonElement>('rs-ok');

  // The picture in pixels and its resolution are the truth; the fields only show them in the chosen unit.
  let px = { w: orig.w, h: orig.h };
  let dpi = orig.dpi;

  const close = (): void => {
    dlg.close();
    dlg.remove();
  };

  const show = (except?: HTMLInputElement): void => {
    if (except !== wIn) wIn.value = formatLength(fromPx(px.w, unit, dpi), unit);
    if (except !== hIn) hIn.value = formatLength(fromPx(px.h, unit, dpi), unit);
    if (except !== sIn) sIn.value = (px.w / orig.w).toFixed(2);
    if (except !== dIn) dIn.value = String(Math.round(dpi * 100) / 100);
  };

  const problem = (): string | null => validate(px.w, px.h, dpi);
  const changed = (): boolean => px.w !== orig.w || px.h !== orig.h || dpi !== orig.dpi;

  function refresh(): void {
    const bad = problem();
    $('rs-err').textContent = bad ?? '';
    ok.disabled = bad !== null || !changed();
    const keep = keepIn.checked;
    sIn.disabled = keep;
    mSel.disabled = keep;
    // Without re-sampling a length in pixels has nothing to change, so only physical units edit the size.
    wIn.disabled = hIn.disabled = keep && unit === 'px';
  }

  /** A length typed in the current unit, in pixels at the current resolution; null while it is not a number. */
  const typed = (el: HTMLInputElement): number | null => {
    const v = Number(el.value);
    return el.value.trim() !== '' && Number.isFinite(v) && v > 0 ? v : null;
  };

  function onSize(el: HTMLInputElement): void {
    const v = typed(el);
    if (v === null) return; // half-typed
    const side = el === wIn ? 'w' : 'h';
    if (keepIn.checked) {
      // The pixels stay: a new printed length means a new resolution.
      if (unit === 'px') return;
      dpi = px[side] / toPx(v, unit, 1);
      show(el);
    } else {
      px[side] = Math.max(1, Math.round(toPx(v, unit, dpi)));
      if (lockIn.checked) {
        if (side === 'w') px.h = Math.max(1, Math.round((px.w * orig.h) / orig.w));
        else px.w = Math.max(1, Math.round((px.h * orig.w) / orig.h));
      }
      show(el);
    }
    refresh();
  }
  for (const el of [wIn, hIn]) {
    el.addEventListener('input', () => onSize(el));
    el.addEventListener('change', () => {
      show();
      refresh();
    });
  }
  sIn.addEventListener('input', () => {
    const v = typed(sIn);
    if (v === null) return;
    px = { w: Math.max(1, Math.round(orig.w * v)), h: Math.max(1, Math.round(orig.h * v)) };
    show(sIn);
    refresh();
  });
  sIn.addEventListener('change', () => {
    show();
    refresh();
  });
  dIn.addEventListener('input', () => {
    const v = typed(dIn);
    if (v === null) return;
    // Re-sampling keeps the printed size, so more dots per inch means more pixels.
    if (!keepIn.checked) px = { w: Math.max(1, Math.round((px.w * v) / dpi)), h: Math.max(1, Math.round((px.h * v) / dpi)) };
    dpi = v;
    show(dIn);
    refresh();
  });
  dIn.addEventListener('change', () => {
    show();
    refresh();
  });
  uSel.addEventListener('change', () => {
    unit = uSel.value as Unit;
    show();
    refresh();
  });
  mSel.addEventListener('change', () => void (method = mSel.value as ResampleMethod));
  keepIn.addEventListener('change', () => {
    px = { w: orig.w, h: orig.h }; // the pixels are the original ones; only the resolution moves
    show();
    refresh();
  });

  function accept(): void {
    if (problem() || !changed()) return;
    const resample = px.w !== orig.w || px.h !== orig.h;
    close();
    deps.commit({ dpi, ...(resample ? { size: { width: px.w, height: px.h, method } } : {}) });
  }

  uSel.value = unit;
  mSel.value = method;
  show();
  refresh();
  ok.addEventListener('click', accept);
  $('rs-cancel').addEventListener('click', close);
  dlg.addEventListener('cancel', close);
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
      e.preventDefault();
      accept();
    }
  });
  dlg.showModal();
}
