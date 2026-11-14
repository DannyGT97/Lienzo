// How long each filter takes on a region the size of a screen (what a preview works on) and on a whole 4K page, in Node.
//   npx vite-node scripts/bench/filters.ts [width height]
import { Stroke, defaultBrush } from '../../src/engine/brush';
import { addLayer, createDocument, paintTarget } from '../../src/engine/document';
import { FILTERS, applyAreaFilter, applyPixelFilter, defaultValues } from '../../src/engine/filters';
import { Selection } from '../../src/engine/selection';

const W = Number(process.argv[2] ?? 3840);
const H = Number(process.argv[3] ?? 2160);
const doc = createDocument(W, H);
const layer = addLayer(doc, 'Dibujo');
let seed = 4242;
const rnd = (): number => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
for (let k = 0; k < 60; k++) {
  const s = new Stroke(paintTarget(layer), { ...defaultBrush, size: 30, stabilization: 0, color: [Math.floor(rnd() * 255), Math.floor(rnd() * 255), 90] });
  const x0 = rnd() * W * 0.3;
  const y0 = rnd() * H;
  for (let j = 0; j <= 40; j++) s.addPoint(x0 + (j / 40) * W * 0.6, Math.min(H - 5, Math.max(5, y0 + 300 * Math.sin(k + (j / 40) * 8))), 0.7);
  s.finish();
}
const ctx = { main: [0, 0, 0] as const, sub: [255, 255, 255] as const };
const screenRect = { x: Math.round(W / 2 - 960), y: Math.round(H / 2 - 540), w: 1920, h: 1080 };
const screen = Selection.rect(W, H, screenRect);
const time = (fn: () => void): number => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};
console.log(`Página ${W}×${H}, ${layer.surface.tileCount} tiles dibujados\n${'filtro'.padEnd(26)}  pantalla 1920×1080   página entera`);
for (const [id, f] of Object.entries(FILTERS)) {
  const v = defaultValues(f);
  // What a preview does: a rectangle the size of the screen (a limit for neighbourhood filters, a selection for pixel ones).
  const run = (shown: boolean): number =>
    Math.min(
      ...[1, 2, 3].map(() =>
        time(() => {
          if (f.kind === 'pixel') applyPixelFilter(layer.surface, layer.id, shown ? screen : null, f, v, ctx);
          else applyAreaFilter(layer.surface, layer.id, null, f, v, ctx, shown ? screenRect : undefined);
        }),
      ),
    );
  const a = run(true);
  const b = run(false);
  console.log(`${id.padEnd(26)}  ${a.toFixed(0).padStart(8)} ms      ${b.toFixed(0).padStart(8)} ms`);
}
