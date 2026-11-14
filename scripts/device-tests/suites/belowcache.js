// While a layer is painted, what lies under it is composed once and kept (`below` in the renderer). The picture after a stroke made
// that way must be the same as the one composed from every layer, and the stroke frames must cost less. Makes its own page.
await newDocument('13', '300');
await fillLayers(12, 3, 4242);
const layers = L.doc.layers;
L.doc.activeId = layers[7].id;
L.refreshUi();
L.view.rot = 0; L.view.flip = false; L.view.tilt = 0; L.view.scale = 0.3; L.view.x = 40; L.view.y = 40; L.applyView();
L.render();
await sleep(1200);
const keptBefore = R.belowValid;

// A stroke on the painted layer, frame by frame.
const strokeFrames = async () => gpuFrames(async () => {
  const id = ++pointerId;
  const pts = [];
  for (let j = 0; j <= 60; j++) pts.push(toClient(L.doc.width * 0.15 + (j / 60) * L.doc.width * 0.7, L.doc.height * 0.45 + Math.sin(j / 6) * 260));
  const ev = (t, p, b) => canvas.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'mouse', isPrimary: true, pressure: 0.5, bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, buttons: b }));
  ev('pointerdown', pts[0], 1);
  for (let i = 1; i < pts.length; i++) { ev('pointermove', pts[i], 1); await new Promise((r) => requestAnimationFrame(() => r())); }
  ev('pointerup', pts[pts.length - 1], 0);
});
L.setTool('brush');
L.setBrushSize(48);
const withCache = await strokeFrames();
const keptAfter = R.belowValid;
await sleep(600);

// The picture the screen has now, and the one composed from every layer.
const gl = R.gl;
const readCache = () => {
  const w = R.tw, h = R.th;
  const out = new Float32Array(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, R.cache.fbo);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, out);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return out;
};
const a = readCache();
R.belowValid = false;
R.invalidate();
await sleep(900);
const b = readCache();
let different = 0, maxd = 0, painted = 0;
for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > 1e-4) { different++; if (d > maxd) maxd = d; } if (i % 4 === 3 && a[i] > 0) painted++; }

// The same stroke with the kept picture switched off, for the cost.
R.belowValid = false;
const off = R.buildBelow; R.buildBelow = () => {};
const withoutCache = await strokeFrames();
R.buildBelow = off;
return {
  metrics: { layers: L.doc.layers.length, keptBefore, keptAfter, differentFloats: different, maxDifference: maxd, paintedPixels: painted, gpuFrameMsWithCache: withCache.gpu, gpuFrameMsWithout: withoutCache.gpu },
  checks: [
    check('lo de debajo se guarda antes de pintar', keptBefore ? 1 : 0, 1, 'min'),
    check('se sigue guardando tras pintar', keptAfter ? 1 : 0, 1, 'min'),
    check('misma imagen que componiendo todas las capas (valores distintos)', different, 0),
    check('hay algo pintado', painted, 1, 'min'),
    check('pintar con lo guardado no cuesta más (p50, ms)', withCache.gpu.p50, withoutCache.gpu.p50 * 1.1),
    check('sin errores', newErrors().length, 0),
  ],
};
