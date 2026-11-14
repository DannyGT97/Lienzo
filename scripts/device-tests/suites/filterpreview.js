// The preview of a filter on a heavy page: how long it takes to show, how the slider feels, and that zooming with the preview on
// stays smooth. Uses the open page (run `setup` first). Chooses a drawn layer, tries two filters and cancels them.
const res = {};
const checks = [];
const slider = () => document.querySelector('#filter-panel input[type=range]');
const fitView = async (scale) => { L.view.rot = 0; L.view.flip = false; L.view.tilt = 0; L.view.scale = scale; L.view.x = 40; L.view.y = 40; L.applyView(); await sleep(700); };
const zoomBurst = async () => { for (let c = 0; c < 3; c++) for (const d of [-150, 150]) for (let i = 0; i < 10; i++) { wheel(d); await sleep(30); } };
const layers = L.doc.layers;
const target = layers.find((l, i) => i > 3 && l.surface.tileCount > 20) ?? layers[layers.length - 2];
L.doc.activeId = target.id;
L.refreshUi();
await fitView(0.3);

for (const [id, limit] of [['gaussian', TARGET === 'tablet' ? 2500 : 700], ['motion', TARGET === 'tablet' ? 2500 : 700]]) {
  const t0 = performance.now();
  const ok = L.filtersUi.start(id);
  const startMs = performance.now() - t0;
  await sleep(1200);
  // the slider: ten changes, 120 ms apart; what blocked the page while the previews ran
  const sl = slider();
  const sweep = await frameIntervals(async () => {
    for (let i = 0; i < 10; i++) { sl.value = String(Number(sl.min) + ((Number(sl.max) - Number(sl.min)) * (i + 1)) / 12); sl.dispatchEvent(new Event('input', { bubbles: true })); await sleep(120); }
  });
  await sleep(800);
  const zoom = await frameIntervals(zoomBurst);
  await sleep(500);
  L.filtersUi.cancel();
  await sleep(400);
  res[id] = { started: ok, startMs: Math.round(startMs), slider: sweep, zoomWithPreview: zoom };
  checks.push(check(`${id}: la vista previa sale (ms)`, Math.round(startMs), limit));
  checks.push(check(`${id}: al mover el deslizador, el fotograma más largo (ms)`, Math.round(sweep.max), TARGET === 'tablet' ? 1500 : 600));
  checks.push(check(`${id}: zoom con la vista previa, fotogramas de más de 100 ms`, zoom.over100, 0));
  checks.push(check(`${id}: zoom con la vista previa, fotograma más largo (ms)`, Math.round(zoom.max), TARGET === 'tablet' ? 400 : 150));
}
checks.push(check('sin errores', newErrors().length, 0));
return { metrics: { layers: L.doc.layers.length, targetTiles: target.surface.tileCount, ...res }, checks };
