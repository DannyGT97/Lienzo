import { Stroke, defaultBrush } from '../engine/brush';
import { flatten, flattenRegion } from '../engine/composite';
import { addLayer, createDocument, paintTarget } from '../engine/document';
import { groupLayers } from '../engine/layer-tree';
import { createMask } from '../engine/mask-ops';
import { Selection } from '../engine/selection';
import { fillLayer, setPixel } from '../engine/test-utils';
import { GLRenderer } from './gl-renderer';

/**
 * On-device measurements that decide whether a WebView-based app is enough:
 * canvas limits, brush and compositing speed, and pen input latency.
 */

export interface Report {
  [section: string]: Record<string, string | number | boolean>;
}

const median = (v: number[]): number => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const pct = (v: number[], p: number): number => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
};
const r1 = (n: number): number => Math.round(n * 10) / 10;

function environment(): Report[string] {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const gl = document.createElement('canvas').getContext('webgl2');
  const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
  const pe = PointerEvent.prototype as unknown as Record<string, unknown>;
  return {
    userAgent: nav.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    screen: `${screen.width}x${screen.height}`,
    cores: nav.hardwareConcurrency,
    'clase de memoria del dispositivo (GB, estimación del navegador; no es memoria libre)': nav.deviceMemory ?? 'n/d',
    maxTouchPoints: nav.maxTouchPoints,
    webgl2: !!gl,
    maxTextureSize: gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : 0,
    gpu: gl && dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'n/d',
    getCoalescedEvents: typeof pe.getCoalescedEvents === 'function',
    getPredictedEvents: typeof pe.getPredictedEvents === 'function',
    lowLatencyCanvas: document.createElement('canvas').getContext('2d', { desynchronized: true })?.getContextAttributes?.().desynchronized ?? false,
  };
}

/** Largest canvases that really allocate (some browsers fail silently). */
function canvasLimits(): Report[string] {
  const out: Report[string] = {};
  const sizes: [string, number, number][] = [
    ['A5 300dpi', 1748, 2480],
    ['A4 300dpi', 2480, 3508],
    ['A4 600dpi', 4961, 7016],
    ['A3 600dpi', 7016, 9921],
  ];
  for (const [name, w, h] of sizes) {
    try {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) {
        out[`canvas ${name} (${w}x${h})`] = 'sin contexto';
        continue;
      }
      ctx.fillStyle = '#f00';
      ctx.fillRect(w - 4, h - 4, 4, 4);
      const ok = ctx.getImageData(w - 1, h - 1, 1, 1).data[3] === 255;
      out[`canvas ${name} (${w}x${h})`] = ok ? 'ok' : 'FALLA (no dibuja)';
      c.width = 1;
      c.height = 1;
    } catch (e) {
      out[`canvas ${name} (${w}x${h})`] = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return out;
}

/**
 * A one-off reservation test: how many 32 MB buffers JS can allocate right now, up to a safe cap (the page may be killed
 * above it). It says nothing about free or used RAM and is not a monitor; the result is a snapshot of this moment.
 */
function memoryProbe(capMB = 512): Report[string] {
  const chunks: Uint8ClampedArray[] = [];
  let mb = 0;
  try {
    while (mb < capMB) {
      const c = new Uint8ClampedArray(32 * 1024 * 1024);
      c[c.length - 1] = 1; // touch it so it is really committed
      chunks.push(c);
      mb += 32;
    }
    return { 'prueba de reserva: reservado sin fallo (MB)': `${mb} (tope de prueba ${capMB}; no es RAM libre)` };
  } catch {
    return { 'prueba de reserva: reservado antes de fallar (MB)': `${mb} (no es RAM libre)` };
  } finally {
    chunks.length = 0;
  }
}

function enginePerf(): Report[string] {
  const W = 1000;
  const H = 1414;
  const doc = createDocument(W, H);
  fillLayer(doc.layers[0]!, [255, 255, 255, 255]);
  for (let i = 0; i < 4; i++) {
    const l = addLayer(doc, `L${i}`);
    l.blend = i % 2 ? 'multiply' : 'normal';
    l.opacity = 0.8;
    for (let y = 0; y < H; y += 97) for (let x = 0; x < W; x += 97) setPixel(l, x, y, [i * 60, 90, 200, 180]);
  }
  const layer = doc.layers[1]!;

  let t = performance.now();
  const stroke = new Stroke(paintTarget(layer), { ...defaultBrush, size: 64, hardness: 0.8, spacing: 0.1, stabilization: 0 });
  const stamps = 120;
  for (let i = 0; i < stamps; i++) stroke.addPoint(100 + i * 6, 300 + Math.sin(i / 8) * 80, 0.7);
  stroke.finish();
  const strokeMs = performance.now() - t;

  t = performance.now();
  flatten(doc);
  const fullMs = performance.now() - t;

  t = performance.now();
  for (let i = 0; i < 20; i++) flattenRegion(doc, { x: 200 + i, y: 250, w: 128, h: 128 });
  const dirtyMs = (performance.now() - t) / 20;

  return {
    'pincel 64px: ms por muestra de lápiz': Math.round((strokeMs / stamps) * 100) / 100,
    'trazo de 120 muestras (ms)': r1(strokeMs),
    'compuesto CPU 1000x1414, 6 capas (ms)': r1(fullMs),
    'compuesto CPU de un rectángulo 128x128 (ms)': r1(dirtyMs),
  };
}

/** Largest per-channel difference between the GPU and CPU compositors on a page with folders, masks and clipping. */
function foldersAndMasksDiff(): number {
  const W = 512;
  const H = 384;
  const doc = createDocument(W, H, 300);
  fillLayer(doc.layers[0]!, [255, 255, 255, 255]);
  const box = (name: string, x: number, y: number, w: number, h: number, rgba: [number, number, number, number]) => {
    const l = addLayer(doc, name);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
    l.surface.writeRect({ x, y, w, h }, data);
    return l;
  };
  const a = box('a', 50, 50, 300, 200, [220, 40, 40, 255]);
  const b = box('b', 100, 100, 300, 250, [40, 60, 220, 160]);
  b.blend = 'multiply';
  const c = box('c', 200, 20, 250, 300, [40, 200, 80, 220]);
  c.blend = 'screen';
  const d = box('d', 0, 0, W, H, [250, 220, 40, 100]);
  d.clip = true;
  const e = box('e', 10, 300, 480, 60, [30, 30, 30, 255]);
  e.blend = 'glowDodge';
  const f = groupLayers(doc, [b.id, c.id, d.id], 'F')!;
  f.through = false;
  f.blend = 'overlay';
  f.opacity = 0.8;
  createMask(doc, f.id, 'selection', Selection.ellipse(W, H, { x: 80, y: 40, w: 380, h: 300 }));
  createMask(doc, a.id, 'selection', Selection.rect(W, H, { x: 0, y: 0, w: 300, h: H }));
  const gl = new GLRenderer(document.createElement('canvas'));
  gl.setDocument(doc);
  const gpu = gl.snapshot({ x: 0, y: 0, w: W, h: H });
  const cpu = flatten(doc);
  let worst = 0;
  for (let i = 0; i < cpu.length; i++) worst = Math.max(worst, Math.abs(cpu[i]! - gpu[i]!));
  return worst;
}

/** The tiled engine on a huge page, and the GPU compositor against the CPU one. */
function tiledPerf(): Report[string] {
  const out: Report[string] = {};
  // A3 at 600 dpi: memory should be proportional to what is painted, not to the page.
  const big = createDocument(7016, 9921, 600);
  const layer = big.layers[0]!;
  const t0 = performance.now();
  const stroke = new Stroke(paintTarget(layer), { ...defaultBrush, size: 90, hardness: 0.9, stabilization: 0 });
  for (let i = 0; i < 80; i++) stroke.addPoint(600 + i * 70, 4000 + Math.sin(i / 6) * 600, 0.8);
  const patch = stroke.finish();
  out['A3 600 dpi: trazo largo (ms)'] = r1(performance.now() - t0);
  out['A3 600 dpi: teselas con tinta'] = layer.surface.tileCount;
  out['A3 600 dpi: memoria de píxeles (MB)'] = r1(layer.surface.pixelBytes / 1048576);
  out['A3 600 dpi: memoria del deshacer (MB)'] = r1((patch?.bytes ?? 0) / 1048576);
  out['A3 600 dpi: sin teselas equivaldría a (MB por capa)'] = Math.round((7016 * 9921 * 4) / 1048576);

  try {
    // GPU vs CPU on a small multi-layer page: time and agreement.
    const doc = createDocument(1024, 1024);
    fillLayer(doc.layers[0]!, [255, 255, 255, 255]);
    for (let i = 0; i < 5; i++) {
      const l = addLayer(doc, `G${i}`);
      l.blend = (['multiply', 'overlay', 'softLight', 'difference', 'normal'] as const)[i]!;
      l.opacity = 0.85;
      for (let y = 0; y < 1024; y += 53) for (let x = 0; x < 1024; x += 61) setPixel(l, x, y, [i * 50, 120, 255 - i * 40, 200]);
    }
    const c = document.createElement('canvas');
    const gl = new GLRenderer(c);
    gl.setDocument(doc);
    gl.resize({ w: 1024, h: 1024, left: 0, top: 0 }, { w: 1024, h: 1024 }, 1);
    gl.snapshot({ x: 0, y: 0, w: 1024, h: 1024 }); // warm up: uploads tiles, compiles shaders
    const t1 = performance.now();
    const img = gl.snapshot({ x: 0, y: 0, w: 1024, h: 1024 });
    out['compuesto GPU 1024x1024, 6 capas (ms, con lectura)'] = r1(performance.now() - t1);
    const cpu = flatten(doc);
    let worst = 0;
    for (let i = 0; i < cpu.length; i++) worst = Math.max(worst, Math.abs(cpu[i]! - img[i]!));
    out['diferencia máxima GPU vs CPU (de 255)'] = worst;
    out['texturas de tesela en GPU'] = gl.textureCount;
    out['diferencia máxima GPU vs CPU con carpetas y máscaras (de 255)'] = foldersAndMasksDiff();
  } catch (e) {
    out['compositor GPU'] = `error: ${e instanceof Error ? e.message : String(e)}`;
  }
  return out;
}

export interface TypeStats {
  samples: number;
  hz: number;
  coalescedAvg: number;
  predictedAvg: number;
  pressureMin: number;
  pressureMax: number;
  tilt: boolean;
}

export interface InputStats {
  samples: number;
  handlerDelayMs: { median: number; p95: number };
  paintDelayMs: { median: number; p95: number };
  byType: Record<string, TypeStats>;
}

/** Record pointer input on `el` for `seconds`: how fast events arrive and how late JS and paint are. */
export function measureInput(el: HTMLElement, seconds: number, onDone: (s: InputStats) => void): void {
  const handler: number[] = [];
  const paint: number[] = [];
  interface Acc {
    times: number[];
    coalesced: number;
    predicted: number;
    pmin: number;
    pmax: number;
    tilt: boolean;
  }
  const acc = new Map<string, Acc>();

  const onMove = (e: PointerEvent): void => {
    if (e.buttons === 0 && e.pointerType !== 'pen') return;
    const now = performance.now();
    handler.push(now - e.timeStamp);
    let a = acc.get(e.pointerType);
    if (!a) acc.set(e.pointerType, (a = { times: [], coalesced: 0, predicted: 0, pmin: Infinity, pmax: -Infinity, tilt: false }));
    a.times.push(now);
    a.coalesced += e.getCoalescedEvents?.().length ?? 1;
    a.predicted += e.getPredictedEvents?.().length ?? 0;
    a.pmin = Math.min(a.pmin, e.pressure);
    a.pmax = Math.max(a.pmax, e.pressure);
    if (e.tiltX || e.tiltY) a.tilt = true;
    const stamp = e.timeStamp;
    requestAnimationFrame(() => paint.push(performance.now() - stamp));
  };
  el.addEventListener('pointermove', onMove);

  window.setTimeout(() => {
    el.removeEventListener('pointermove', onMove);
    const byType: Record<string, TypeStats> = {};
    for (const [type, a] of acc) {
      const n = a.times.length;
      const span = Math.max(1, a.times[n - 1]! - a.times[0]!);
      byType[type] = {
        samples: n,
        hz: Math.round((n / span) * 1000),
        coalescedAvg: r1(a.coalesced / n),
        predictedAvg: r1(a.predicted / n),
        pressureMin: r1(a.pmin),
        pressureMax: r1(a.pmax),
        tilt: a.tilt,
      };
    }
    onDone({
      samples: handler.length,
      handlerDelayMs: { median: r1(median(handler)), p95: r1(pct(handler, 0.95)) },
      paintDelayMs: { median: r1(median(paint)), p95: r1(pct(paint, 0.95)) },
      byType,
    });
  }, seconds * 1000);
}

export function staticReport(): Report {
  const errs = (window as unknown as { __errors?: string[] }).__errors ?? [];
  return {
    ...(errs.length ? { 'errores recientes de la app': Object.fromEntries(errs.map((e, i) => [`#${i + 1}`, e])) } : {}),
    entorno: environment(),
    'límites de lienzo': canvasLimits(),
    'prueba de reserva de memoria': memoryProbe(),
    'rendimiento del motor': enginePerf(),
    'motor por teselas y GPU': tiledPerf(),
  };
}

export function formatReport(r: Report, input?: InputStats): string {
  const lines: string[] = [];
  for (const [section, entries] of Object.entries(r)) {
    lines.push(`## ${section}`);
    for (const [k, v] of Object.entries(entries)) lines.push(`${k}: ${v}`);
    lines.push('');
  }
  if (input) {
    lines.push('## entrada (lápiz/dedo/ratón)');
    lines.push(`muestras totales: ${input.samples}`);
    lines.push(`retraso hasta el evento JS (ms): mediana ${input.handlerDelayMs.median}, p95 ${input.handlerDelayMs.p95}`);
    lines.push(`retraso hasta el siguiente fotograma (ms): mediana ${input.paintDelayMs.median}, p95 ${input.paintDelayMs.p95}`);
    for (const [type, t] of Object.entries(input.byType)) {
      lines.push(
        `[${type}] muestras ${t.samples}; ${t.hz} Hz; agrupados/muestra ${t.coalescedAvg}; predichos ${t.predictedAvg}; ` +
          `presión ${t.pressureMin}–${t.pressureMax}; inclinación ${t.tilt ? 'sí' : 'no'}`,
      );
    }
  }
  return lines.join('\n');
}

/** Dialog with the static report and a scribble area for the input test. */
export function openDiagnostics(): void {
  const dlg = document.createElement('dialog');
  dlg.id = 'diag';
  dlg.innerHTML = `
    <h3>Diagnóstico del dispositivo</h3>
    <p class="hint">Mide lienzos grandes, velocidad del motor y latencia de entrada. La prueba de reserva intenta reservar hasta 512&nbsp;MB un instante para ver si el navegador lo permite; no mide la RAM libre ni la usada.</p>
    <div class="row"><button id="diag-run">Medir</button><button id="diag-copy" disabled>Copiar</button><button id="diag-close">Cerrar</button></div>
    <pre id="diag-out">Pulsa «Medir».</pre>
    <p class="hint" id="diag-hint" hidden>Ahora garabatea 5 segundos con el lápiz o el dedo en el recuadro.</p>
    <canvas id="diag-pad" width="600" height="220" hidden></canvas>`;
  document.body.append(dlg);
  const out = dlg.querySelector<HTMLPreElement>('#diag-out')!;
  const pad = dlg.querySelector<HTMLCanvasElement>('#diag-pad')!;
  const hint = dlg.querySelector<HTMLElement>('#diag-hint')!;
  const copy = dlg.querySelector<HTMLButtonElement>('#diag-copy')!;
  const run = dlg.querySelector<HTMLButtonElement>('#diag-run')!;
  let text = '';

  dlg.querySelector('#diag-close')!.addEventListener('click', () => {
    dlg.close();
    dlg.remove();
  });
  copy.addEventListener('click', () => void navigator.clipboard?.writeText(text));

  run.addEventListener('click', () => {
    run.disabled = true;
    out.textContent = 'Midiendo…';
    // Let the "Midiendo…" text paint before the blocking work starts.
    setTimeout(() => {
      const report = staticReport();
      text = formatReport(report);
      out.textContent = text;
      pad.hidden = false;
      hint.hidden = false;
      const ctx = pad.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, pad.width, pad.height);
      ctx.strokeStyle = '#000';
      ctx.lineCap = 'round';
      let last: { x: number; y: number } | null = null;
      const draw = (e: PointerEvent): void => {
        const r = pad.getBoundingClientRect();
        const p = { x: ((e.clientX - r.left) * pad.width) / r.width, y: ((e.clientY - r.top) * pad.height) / r.height };
        if (e.buttons && last) {
          ctx.lineWidth = 1 + e.pressure * 8;
          ctx.beginPath();
          ctx.moveTo(last.x, last.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
        last = e.buttons ? p : null;
      };
      pad.addEventListener('pointermove', draw);
      pad.addEventListener('pointerup', () => (last = null));
      measureInput(pad, 5, (stats) => {
        pad.removeEventListener('pointermove', draw);
        text = formatReport(report, stats);
        out.textContent = text;
        hint.hidden = true;
        run.disabled = false;
        copy.disabled = false;
      });
    }, 60);
  });
  dlg.showModal();
}
