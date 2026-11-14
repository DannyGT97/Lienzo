// Fast zoom in and out over the open page: GPU time per frame and frame intervals. Run `setup` first for a heavy page.
const sr = stage.getBoundingClientRect();
const burst = async (cycles) => {
  for (let c = 0; c < cycles; c++) {
    for (const d of [-150, 150]) for (let i = 0; i < 12; i++) { wheel(d); await sleep(30); }
  }
};
const fit = async () => { L.view.rot = 0; L.view.flip = false; L.view.tilt = 0; L.view.scale = 0.2; L.view.x = 40; L.view.y = 40; L.applyView(); await sleep(900); };
await fit();
const frames = await frameIntervals(() => burst(4));
await fit();
const gpu = await gpuFrames(() => burst(3));
const lim = TARGET === 'tablet' ? { gpuP95: 20, over100: 0, over50: 2 } : { gpuP95: 10, over100: 0, over50: 1 };
return {
  metrics: { layers: L.doc.layers.length, frameIntervalsMs: frames, gpuFrameMs: gpu.gpu, cpuFrameMs: gpu.cpu },
  checks: [
    check('GPU por fotograma, p95 (ms)', gpu.gpu.p95, lim.gpuP95),
    check('fotogramas de más de 100 ms', frames.over100, lim.over100),
    check('fotogramas de más de 50 ms', frames.over50, lim.over50),
    check('sin errores', newErrors().length, 0),
  ],
};
