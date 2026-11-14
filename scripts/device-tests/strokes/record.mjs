// Records a guided pen session on the device and saves it as a trace to analyse (see analyze.ts).
//
//   node scripts/device-tests/strokes/record.mjs <tablet|desktop> [--stab 0] [--size 10] [--out traza.json] [--mouse 1]
//
// A new page is opened and the screen says what to draw, step by step. Use stabilization 0 for the recording: the stabilizer is
// replayed offline on the raw pen path, so any setting can be judged from one recording.
import { readFileSync, writeFileSync } from 'node:fs';
import { connect, reach } from '../cdp.mjs';

const argv = process.argv.slice(2);
const target = argv[0] ?? 'tablet';
const flags = {};
for (let i = 1; i < argv.length; i += 2) flags[argv[i].replace(/^--/, '')] = argv[i + 1];
const here = new URL('../', import.meta.url);
const lib = readFileSync(new URL('lib.js', here), 'utf8');
const recorder = readFileSync(new URL('strokes/recorder.js', here), 'utf8');
const out = flags.out ?? `traza-${target}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;

const page = await connect(reach(target, { port: flags.port ? Number(flags.port) : undefined }));
const ready = await page.ev(`(async () => { const TARGET = ${JSON.stringify(target)}; const ARGS = ${JSON.stringify(flags)};\n${lib}\n${recorder}\n})()`);
console.log('Listo:', JSON.stringify(ready));
console.log('Dibuja en la tableta lo que pone arriba de la pantalla. Esperando…');
let last = '';
for (;;) {
  const s = await page.ev(`JSON.stringify({ done: window.__rec.done, step: window.__rec.stepIndex, count: window.__rec.count, strokes: window.__rec.data.strokes.length })`);
  if (s !== last) { console.log(' ', s); last = s; }
  if (JSON.parse(s).done) break;
  await new Promise((r) => setTimeout(r, 1500));
}
const data = JSON.parse(await page.ev('JSON.stringify(window.__rec.data)'));
await page.ev('window.__rec.stop()');
writeFileSync(out, JSON.stringify(data));
console.log(`Guardado ${out}: ${data.strokes.length} trazos.`);
page.close();
