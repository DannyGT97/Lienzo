// Time of the whole-page operations of the engine on a 4K page, in Node (no browser): the numbers to bring down.
//   npx vite-node scripts/bench/core-ops.ts [width height]
import { gaussianBlur } from '../../src/engine/filters';
import { applyGradient } from '../../src/engine/gradient';
import { TiledSurface } from '../../src/engine/tiles';
import { TILE } from '../../src/engine/tiles';
import { Stroke, defaultBrush } from '../../src/engine/brush';
import { addLayer, createDocument, paintTarget } from '../../src/engine/document';
import { flattenRegion } from '../../src/engine/composite';
import { flattenToSurface } from '../../src/engine/merge-ops';
import { wandSelect } from '../../src/engine/selection';

const W = Number(process.argv[2] ?? 3840);
const H = Number(process.argv[3] ?? 2160);
const time = (name: string, fn: () => void, reps = 3): void => {
  const t: number[] = [];
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    fn();
    t.push(performance.now() - t0);
  }
  console.log(`${name.padEnd(38)} ${Math.min(...t).toFixed(0).padStart(6)} ms (mejor de ${reps})`);
};

const blank = (): TiledSurface => new TiledSurface(W, H, TILE);
console.log(`Página ${W}×${H}`);

const lin = { shape: 'linear' as const, from: { x: 0, y: 0 }, to: { x: W, y: H }, stops: [{ t: 0, color: [0, 0, 0] as const, alpha: 1 }, { t: 1, color: [255, 200, 0] as const, alpha: 1 }] };
time('degradado lineal', () => applyGradient(blank(), 1, null, lin));
time('degradado lineal con tramado', () => applyGradient(blank(), 1, null, { ...lin, dither: true }));
time('degradado radial', () => applyGradient(blank(), 1, null, { ...lin, shape: 'radial', to: { x: W / 2, y: H / 2 } }));
time('degradado cónico', () => applyGradient(blank(), 1, null, { ...lin, shape: 'conic' }));
time('degradado repetido', () => applyGradient(blank(), 1, null, { ...lin, repeat: 'repeat', to: { x: 300, y: 300 } }));

const buf = new Float32Array(W * H * 4);
for (let i = 0; i < buf.length; i++) buf[i] = ((i * 2654435761) >>> 8) % 1000 / 1000;
time('desenfoque gaussiano, radio 12', () => gaussianBlur(buf.slice(), W, H, 6));
time('desenfoque gaussiano, radio 60', () => gaussianBlur(buf.slice(), W, H, 30));

// A page of drawn layers, like the app's stress page: 20 layers with 5 wide strokes each.
const doc = createDocument(W, H);
let seed = 12345;
const rnd = (): number => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
for (let i = 0; i < 20; i++) {
  const layer = addLayer(doc, `Capa ${i + 2}`);
  for (let k = 0; k < 5; k++) {
    const s = new Stroke(paintTarget(layer), { ...defaultBrush, size: 16, stabilization: 0, color: [Math.floor(rnd() * 255), 40, 90] });
    const x0 = rnd() * W * 0.2;
    const y0 = rnd() * H;
    const amp = 100 + rnd() * 500;
    const ph = rnd() * 6.28;
    for (let j = 0; j <= 40; j++) s.addPoint(x0 + (j / 40) * W * 0.85, Math.min(H - 5, Math.max(5, y0 + amp * Math.sin(ph + (j / 40) * 9))), 0.6);
    s.finish();
  }
}
console.log(`${doc.layers.length} capas, ${doc.layers.reduce((n, l) => n + l.surface.tileCount, 0)} tiles`);
time('fusionar las capas (CPU)', () => flattenToSurface(doc, doc.layers), 2);
time('componer toda la página (CPU)', () => flattenRegion(doc, { x: 0, y: 0, w: W, h: H }), 2);
const look = { width: W, height: H, tile: (tx: number, ty: number) => flattenRegion(doc, { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE }) };
time('relleno mirando todas las capas', () => wandSelect(W, H, look, 5, 5, { tolerance: 16, contiguous: true }), 1);
