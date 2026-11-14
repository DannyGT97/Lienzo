// Panning back and forth at three zoom levels: GPU time per frame.
const out = {};
const checks = [];
const limit = TARGET === 'tablet' ? 28 : 12;
for (const scale of [0.25, 0.6, 1]) {
  L.view.scale = scale; L.view.x = 0; L.view.y = 0; L.applyView();
  await sleep(1500);
  const g = await gpuFrames(async () => {
    for (let i = 0; i < 90; i++) { L.view.x -= 12; L.view.y -= 6; L.applyView(); await sleep(16); }
    for (let i = 0; i < 90; i++) { L.view.x += 12; L.view.y += 6; L.applyView(); await sleep(16); }
  });
  out['escala ' + scale] = g.gpu;
  checks.push(check(`paneo a escala ${scale}, GPU p95 (ms)`, g.gpu.p95, limit));
}
L.view.scale = 0.2; L.view.x = 40; L.view.y = 40; L.applyView();
checks.push(check('sin errores', newErrors().length, 0));
return { metrics: { layers: L.doc.layers.length, gpuFrameMs: out }, checks };
