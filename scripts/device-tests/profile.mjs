// CPU profile of an action in the running app (desktop or tablet): which functions the time goes to.
//
//   node scripts/device-tests/profile.mjs <tablet|desktop> "<javascript that returns a promise>" [--top 18]
//
// The expression runs in the page, with the helpers of `lib.js` in scope (L, R, stroke, wave, sleep, wheel…).
import { readFileSync } from 'node:fs';
import { connect, reach } from './cdp.mjs';

const [target, expr, ...rest] = process.argv.slice(2);
const top = Number(rest[rest.indexOf('--top') + 1] || 18);
if (!target || !expr) {
  console.error('Uso: node scripts/device-tests/profile.mjs <tablet|desktop> "<expresión>" [--top 18]');
  process.exit(2);
}
const lib = readFileSync(new URL('lib.js', import.meta.url), 'utf8');
// "@stress" runs a suite (its steps and seed come from `--steps N --seed S`) under the profiler.
const flags = Object.fromEntries(rest.filter((x) => x.startsWith('--')).map((x) => [x.slice(2), rest[rest.indexOf(x) + 1]]));
const body = expr.startsWith('@') ? `(async () => { ${readFileSync(new URL(`suites/${expr.slice(1)}.js`, import.meta.url), 'utf8')} })()` : expr;
const page = await connect(reach(target));
await page.call('Profiler.enable');
await page.call('Profiler.setSamplingInterval', { interval: 200 });
await page.call('Profiler.start');
const t0 = Date.now();
let value;
try {
  value = await page.ev(`(async () => { const TARGET = ${JSON.stringify(target)}; const ARGS = ${JSON.stringify(flags)};\n${lib}\n return await (${body}); })()`);
} finally {
  const { result } = await page.call('Profiler.stop');
  const p = result.profile;
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const self = new Map();
  for (let i = 0; i < p.samples.length; i++) {
    const n = byId.get(p.samples[i]);
    const f = n.callFrame;
    const k = `${f.functionName || '(anónima)'}  ${f.url.split('/').slice(-1)[0].split('?')[0]}:${f.lineNumber + 1}`;
    self.set(k, (self.get(k) ?? 0) + (p.timeDeltas[i] ?? 0));
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  console.log(`Duración ${Date.now() - t0} ms; resultado: ${JSON.stringify(value)}`);
  for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${(v / 1000).toFixed(0).padStart(7)} ms ${((100 * v) / total).toFixed(0).padStart(3)} %  ${k}`);
  page.close();
}
