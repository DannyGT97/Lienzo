// Tests of the app's core on a real device: the compositor, the view, the tools and the document, with the real GPU.
//
//   node scripts/device-tests/run.mjs <tablet|desktop> [suites] [--layers 36] [--steps 150] [--seed 1] [--port N] [--out report.json]
//
// suites: comma list of setup,parity,zoom,pan,stress (default: setup,parity,zoom,pan,stress). `setup` makes a new 4K page at
// 600 ppp with many drawn layers; the others use the page that is open. Exit code 1 when any check fails.
// The pen suites (strokes) are in `strokes/`, see its README.
//
// tablet:  the debug app open on the tablet (USB debugging on); only `pidof` and the debug socket `forward` are run with adb,
//          nothing of the tablet's storage is read.
// desktop: the app started with --remote-debugging-port=9222 (or WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS for the installed one).
import { readFileSync, writeFileSync } from 'node:fs';
import { connect, reach } from './cdp.mjs';

const argv = process.argv.slice(2);
const target = argv[0];
const flags = {};
const rest = [];
for (let i = 1; i < argv.length; i++) {
  if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i];
  else rest.push(argv[i]);
}
if (!target || !['tablet', 'desktop'].includes(target)) {
  console.error('Uso: node scripts/device-tests/run.mjs <tablet|desktop> [setup,parity,zoom,pan,stress] [--layers 36] [--steps 150] [--seed 1] [--out informe.json]');
  process.exit(2);
}
const suites = (rest[0] ?? 'setup,parity,zoom,pan,stress').split(',');
const here = new URL('.', import.meta.url);
const lib = readFileSync(new URL('lib.js', here), 'utf8');

const port = reach(target, { port: flags.port ? Number(flags.port) : undefined, device: flags.device });
const page = await connect(port);
console.log(`Destino: ${target} · ${page.title} (${page.url})`);
const report = { target, date: new Date().toISOString(), suites: {} };
let failed = 0;
try {
  for (const name of suites) {
    const code = readFileSync(new URL(`suites/${name}.js`, here), 'utf8');
    const t0 = Date.now();
    let result;
    try {
      result = await page.ev(`(async () => { const TARGET = ${JSON.stringify(target)}; const ARGS = ${JSON.stringify(flags)};\n${lib}\n${code}\n})()`);
    } catch (e) {
      result = { metrics: {}, checks: [{ name: 'la prueba termina', value: String(e.message).slice(0, 300), limit: 'sin excepción', ok: false }] };
    }
    report.suites[name] = { seconds: Math.round((Date.now() - t0) / 1000), ...result };
    console.log(`\n== ${name} (${report.suites[name].seconds} s)`);
    for (const c of result.checks ?? []) {
      if (!c.ok) failed++;
      console.log(`  ${c.ok ? 'OK  ' : 'FALLA'} ${c.name}: ${c.value} (${c.kind === 'min' ? 'mínimo' : 'máximo'} ${c.limit})`);
    }
  }
} finally {
  page.close();
}
if (flags.out) writeFileSync(flags.out, JSON.stringify(report, null, 2));
console.log(failed ? `\n${failed} comprobaciones fallan.` : '\nTodo en orden.');
process.exit(failed ? 1 : 0);
