// Every way of saving, one after another, on a page of many layers with real pixels: how long each one takes and, above all, the longest
// the window stood still meanwhile (a 16 ms heartbeat's biggest gap). Nothing is written: the page is encoded as a save does, no more.
// A format that holds the window for more than a moment fails here before it reaches a person.
const rnd = (seed) => {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0);
};
const doc = L.doc;
const w = Math.min(1100, doc.width - 1);
const h = Math.min(900, doc.height - 1);
doc.layers.forEach((layer, i) => {
  const r = rnd(i + 3);
  const x = (i * 97) % Math.max(1, doc.width - w);
  const y = (i * 61) % Math.max(1, doc.height - h);
  const buf = new Uint8ClampedArray(w * h * 4);
  const u32 = new Uint32Array(buf.buffer);
  for (let k = 0; k < u32.length; k++) u32[k] = r() | 0xff000000;
  layer.surface.writeRect({ x, y, w, h }, buf);
});
await sleep(4000); // the page shows the new pixels (a repaint of every layer) before anything is measured

const FREEZE_MAX = 250; // ms: a tap or a drag still feels attended to
const cases = [
  ['document', 'lienzo'],
  ['document', 'psd'],
  ['document', 'psb'],
  ['document', 'ora'],
  ['image', 'png'],
  ['image', 'jpg'],
  ['image', 'webp'],
  ['image', 'bmp'],
  ['image', 'tif'],
  ['image', 'tga'],
  ['image', 'psd'],
];
// What the window does with nothing running: the gaps below mean something only above this.
let idleWorst = 0;
{
  let last = performance.now();
  const beat = setInterval(() => {
    const n = performance.now();
    idleWorst = Math.max(idleWorst, n - last - 16);
    last = n;
  }, 16);
  await sleep(2000);
  clearInterval(beat);
}
const metrics = { idleWorstMs: Math.round(idleWorst), layers: doc.layers.length, page: `${doc.width}x${doc.height}` };
const checks = [];
for (const [kind, format] of cases) {
  const name = `${kind === 'image' ? 'imagen ' : ''}${format}`;
  try {
    const r = await L.probeEncode(kind, format);
    metrics[name] = r;
    checks.push(check(`${name}: la ventana parada, como mucho (ms)`, r.worstFreezeMs, FREEZE_MAX));
  } catch (err) {
    metrics[name] = String(err && err.message ? err.message : err);
    checks.push(check(`${name}: se pudo codificar (0 = sí)`, 1, 0));
  }
  await sleep(400);
}
return { metrics, checks };
