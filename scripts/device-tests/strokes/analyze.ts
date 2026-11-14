// Analyses a pen trace from record.mjs:  node node_modules/vitest/../vite-node/vite-node.mjs scripts/device-tests/strokes/analyze.ts traza.json
// (or: npx vite-node scripts/device-tests/strokes/analyze.ts traza.json)
// It reports what the pen and the browser give (sample rate, delays, jitter), how good the browser's predicted points and a few
// own predictors are, and what the stabilizer does to the recorded strokes, in time and in pixels on screen.
import { readFileSync } from 'node:fs';
import { Stabilizer } from '../../../src/engine/stabilizer';
import { predictors, type Pt } from './predict';

type Raw = [number, number, number, number, number, number]; // time ms, x, y (page px), pressure, tiltX, tiltY
interface Ev { k: 'd' | 'm' | 'u'; now: number; pt: Raw; co?: Raw[]; pr?: Raw[]; frame?: number }
interface Stroke { step: string; type: string; scale: number; events: Ev[] }
interface Trace { dpr: number; ua: string; settings: Record<string, unknown>; strokes: Stroke[] }

const file = process.argv[2];
if (!file) throw new Error('Uso: vite-node analyze.ts <traza.json>');
const trace: Trace = JSON.parse(readFileSync(file, 'utf8'));

const q = (a: number[], p: number): number => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
};
const mean = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const f = (v: number, d = 1): string => v.toFixed(d);
const row = (name: string, a: number[], unit = ''): void => console.log(`  ${name.padEnd(34)} n=${String(a.length).padEnd(5)} media ${f(mean(a)).padStart(7)}  p50 ${f(q(a, 0.5)).padStart(7)}  p95 ${f(q(a, 0.95)).padStart(7)}  máx ${f(Math.max(0, ...a)).padStart(7)} ${unit}`);

/** The raw samples of a stroke in time order: the coalesced points of every event (or the event itself when it has none). */
function samples(s: Stroke): Raw[] {
  const out: Raw[] = [];
  for (const e of s.events) {
    if (e.k === 'm' && e.co?.length) out.push(...e.co);
    else out.push(e.pt);
  }
  return out.filter((p, i) => i === 0 || p[0] >= out[i - 1]![0]);
}

console.log(`Traza: ${file}\n  ${trace.strokes.length} trazos, dpr ${trace.dpr}, ajustes ${JSON.stringify(trace.settings)}\n  ${trace.ua.slice(0, 100)}`);

// ---- input --------------------------------------------------------------
console.log('\n== Entrada del lápiz');
const dts: number[] = [];
const evDts: number[] = [];
const perEvent: number[] = [];
const latency: number[] = [];
const queue: number[] = [];
let withPredicted = 0;
let moves = 0;
for (const s of trace.strokes) {
  const sm = samples(s);
  for (let i = 1; i < sm.length; i++) dts.push(sm[i]![0] - sm[i - 1]![0]);
  const m = s.events.filter((e) => e.k === 'm');
  for (let i = 1; i < m.length; i++) evDts.push(m[i]!.pt[0] - m[i - 1]!.pt[0]);
  for (const e of m) {
    moves++;
    perEvent.push(e.co?.length ?? 1);
    if (e.pr?.length) withPredicted++;
    if (e.frame) latency.push(e.frame - e.pt[0]);
    queue.push(e.now - e.pt[0]);
  }
}
row('intervalo entre muestras', dts, 'ms');
console.log(`  frecuencia de muestreo mediana: ${f(1000 / Math.max(0.1, q(dts, 0.5)), 0)} Hz`);
row('intervalo entre eventos', evDts, 'ms');
row('muestras por evento (agrupadas)', perEvent);
row('espera hasta que la app lo atiende', queue, 'ms');
row('del evento al fotograma siguiente', latency, 'ms');
console.log(`  eventos con puntos predichos: ${moves ? f((100 * withPredicted) / moves, 0) : 0} %`);

// ---- prediction ---------------------------------------------------------
console.log('\n== Predicción (error en píxeles de pantalla; positivo = se pasa de largo)');
const horizons = [16, 33, 50];
type Acc = Record<string, Record<number, { err: number[]; over: number[] }>>;
const acc: Acc = {};
const bump = (name: string, h: number, err: number, over: number): void => {
  ((acc[name] ??= {})[h] ??= { err: [], over: [] }).err.push(err);
  acc[name]![h]!.over.push(over);
};
for (const s of trace.strokes) {
  const sm = samples(s);
  const at = (t: number): Pt | null => {
    // The pen's real position at time t, interpolated between the samples around it.
    for (let i = 1; i < sm.length; i++) {
      if (sm[i]![0] >= t && sm[i - 1]![0] <= t) {
        const a = sm[i - 1]!;
        const b = sm[i]!;
        const u = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
        return { x: a[1] + (b[1] - a[1]) * u, y: a[2] + (b[2] - a[2]) * u };
      }
    }
    return null;
  };
  const m = s.events.filter((e) => e.k === 'm');
  for (const e of m) {
    const t0 = e.pt[0];
    // The recent samples with distinct times (the down, move and up events can repeat one sample).
    const history: { t: number; x: number; y: number }[] = [];
    for (const p of sm) {
      if (p[0] > t0) break;
      const last = history[history.length - 1];
      if (!last || p[0] - last.t >= 2) history.push({ t: p[0], x: p[1], y: p[2] });
    }
    history.splice(0, Math.max(0, history.length - 8));
    if (history.length < 4) continue;
    const dir = { x: e.pt[1] - history[history.length - 2]!.x, y: e.pt[2] - history[history.length - 2]!.y };
    const dl = Math.hypot(dir.x, dir.y) || 1;
    const measure = (name: string, h: number, p: Pt | null): void => {
      const real = at(t0 + h);
      if (!p || !real) return;
      bump(name, h, Math.hypot(p.x - real.x, p.y - real.y) * s.scale, (((p.x - real.x) * dir.x + (p.y - real.y) * dir.y) / dl) * s.scale);
    };
    for (const h of horizons) {
      measure('sin predicción (se queda)', h, { x: e.pt[1], y: e.pt[2] });
      // The browser's predicted point nearest in time to the horizon.
      let best: Raw | null = null;
      for (const p of e.pr ?? []) if (!best || Math.abs(p[0] - (t0 + h)) < Math.abs(best[0] - (t0 + h))) best = p;
      if (best && Math.abs(best[0] - (t0 + h)) < 9) measure('del navegador', h, { x: best[1], y: best[2] });
      for (const [name, fn] of Object.entries(predictors)) measure(name, h, fn(history, h));
    }
  }
}
for (const name of Object.keys(acc)) {
  for (const h of horizons) {
    const a = acc[name]![h];
    if (!a) continue;
    console.log(`  ${name.padEnd(28)} a +${String(h).padEnd(2)} ms  n=${String(a.err.length).padEnd(5)} error medio ${f(mean(a.err)).padStart(6)}  p95 ${f(q(a.err, 0.95)).padStart(6)}  sesgo ${f(mean(a.over)).padStart(6)} px`);
  }
}

// ---- stabilizer ---------------------------------------------------------
console.log('\n== Estabilizador sobre lo grabado (en pantalla; retraso = cuánto va por detrás del lápiz)');
const byStep = new Map<string, Stroke[]>();
for (const s of trace.strokes) (byStep.get(s.step) ?? byStep.set(s.step, []).get(s.step)!).push(s);
for (const stab of [0.3, 0.6, 0.8]) {
  for (const [timed, bySpeed, half] of [[false, false, 0], [true, false, 0], [false, true, 8], [false, true, 20], [false, true, 40]] as const) {
    const lagPx: number[] = [];
    const lagMs: number[] = [];
    const jit: number[] = [];
    const endGap: number[] = [];
    const tailGap: number[] = [];
    for (const s of trace.strokes) {
      const sm = samples(s);
      if (sm.length < 8) continue;
      const st = new Stabilizer({ stabilization: stab, bySpeed, speedHalf: half || undefined });
      const out = sm.map((p) => st.next(p[1], p[2], 1, timed ? p[0] : undefined));
      for (let i = 4; i < sm.length; i++) {
        const d = Math.hypot(out[i]!.x - sm[i]![1], out[i]!.y - sm[i]![2]) * s.scale;
        lagPx.push(d);
        // in time: how long ago the pen was where the smoothed point is now (best match along the recent path)
        let best = 0;
        let bestD = Infinity;
        for (let tau = 0; tau <= 300; tau += 4) {
          const u = sm[i]![0] - tau;
          let k = i;
          while (k > 0 && sm[k]![0] > u) k--;
          const a = sm[k]!;
          const b = sm[Math.min(sm.length - 1, k + 1)]!;
          const w = b[0] === a[0] ? 0 : (u - a[0]) / (b[0] - a[0]);
          const d = Math.hypot(a[1] + (b[1] - a[1]) * w - out[i]!.x, a[2] + (b[2] - a[2]) * w - out[i]!.y);
          if (d < bestD) {
            bestD = d;
            best = tau;
          }
        }
        lagMs.push(best);
      }
      const second = (xs: number[]): number => Math.sqrt(mean(xs.slice(2).map((_, i) => (xs[i + 2]! - 2 * xs[i + 1]! + xs[i]!) ** 2)));
      const rawJ = second(sm.map((p) => p[1])) + second(sm.map((p) => p[2]));
      const outJ = second(out.map((p) => p.x)) + second(out.map((p) => p.y));
      if (rawJ > 0) jit.push(outJ / rawJ);
      const last = sm[sm.length - 1]!;
      endGap.push(Math.hypot(out[out.length - 1]!.x - last[1], out[out.length - 1]!.y - last[2]) * s.scale);
      // the same after the smoothing has run on the last sample for up to 16 steps (what the stroke does now when it ends)
      for (let i = 0; i < 16 && Math.hypot(st.current!.x - last[1], st.current!.y - last[2]) >= 0.75; i++) st.next(last[1], last[2], 1, timed ? last[0] + (i + 1) * 16.67 : undefined);
      tailGap.push(Math.hypot(st.current!.x - last[1], st.current!.y - last[2]) * s.scale);
    }
    console.log(
      `  estab ${stab} ${bySpeed ? `vel. (mitad ${half})` : timed ? 'por tiempo' : 'por muestra'}  retraso ${f(mean(lagPx)).padStart(5)} px (p95 ${f(q(lagPx, 0.95)).padStart(5)}) ≈ ${f(mean(lagMs), 0).padStart(3)} ms   temblor restante ${f(100 * mean(jit), 0).padStart(3)} %   salto final ${f(mean(endGap)).padStart(5)} px → ${f(mean(tailGap)).padStart(4)} px`,
    );
  }
}
