// What a pen sample costs the app: the time its pointer event takes to handle (the stroke is laid down inside the handler),
// for several brush sizes and hardnesses, quick strokes of 120 samples. A sample that takes longer than a frame makes the
// stroke fall behind the pen. Uses the open page; strokes go on its active layer.
const cases = [];
const rand = rng(99);
const saved = { size: L.brush.size, hardness: L.brush.hardness, stab: L.brush.stabilization };
const hardnessInput = document.getElementById('hardness');
const setHardness = (h) => { hardnessInput.value = String(Math.round(h * 100)); hardnessInput.dispatchEvent(new Event('input', { bubbles: true })); };
L.setTool('brush');
L.view.rot = 0; L.view.flip = false; L.view.tilt = 0; L.view.scale = 0.3; L.view.x = 40; L.view.y = 40; L.applyView();
await sleep(600);
for (const size of [2, 8, 32, 128, 300]) {
  for (const hardness of [1, 0.3]) {
    L.setBrushSize(size);
    setHardness(hardness);
    const id = ++pointerId;
    const W = L.doc.width, H = L.doc.height;
    const y0 = H * (0.15 + rand() * 0.7);
    const pts = [];
    for (let j = 0; j <= 120; j++) pts.push(toClient(W * 0.05 + (j / 120) * W * 0.9, y0 + Math.sin(j / 9) * 160));
    const ev = (t, p, b) => canvas.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'mouse', isPrimary: true, pressure: 0.5, bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, buttons: b }));
    const cost = [];
    ev('pointerdown', pts[0], 1);
    for (let i = 1; i < pts.length; i++) {
      const t0 = performance.now();
      ev('pointermove', pts[i], 1);
      cost.push(performance.now() - t0);
      await new Promise((r) => requestAnimationFrame(() => r())); // one sample per frame, like a pen at 60 Hz
    }
    const t1 = performance.now();
    ev('pointerup', pts[pts.length - 1], 0);
    const up = performance.now() - t1;
    cases.push({ size, hardness, perSampleMs: stats(cost), endMs: +up.toFixed(1) });
    await sleep(80);
  }
}
// The frames drawn while stroking on this page: each sample recomposes the area it touched through every layer.
const live = {};
for (const size of [16, 128]) {
  L.setBrushSize(size);
  setHardness(1);
  live[size] = await gpuFrames(async () => {
    const id = ++pointerId;
    const pts = [];
    for (let j = 0; j <= 90; j++) pts.push(toClient(L.doc.width * 0.1 + (j / 90) * L.doc.width * 0.8, L.doc.height * 0.5 + Math.sin(j / 7) * 200));
    const ev = (t, p, b) => canvas.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'mouse', isPrimary: true, pressure: 0.5, bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, buttons: b }));
    ev('pointerdown', pts[0], 1);
    for (let i = 1; i < pts.length; i++) { ev('pointermove', pts[i], 1); await new Promise((r) => requestAnimationFrame(() => r())); }
    ev('pointerup', pts[pts.length - 1], 0);
  });
}
L.setBrushSize(saved.size);
setHardness(saved.hardness);
const frame = 16.7;
const worst = (pred) => Math.max(0, ...cases.filter(pred).map((c) => c.perSampleMs.p95));
return {
  metrics: { layers: L.doc.layers.length, cases, gpuFrameMsWhileStroking: Object.fromEntries(Object.entries(live).map(([k, v]) => [k + ' px', v.gpu])) },
  checks: [
    check('pincel fino (≤ 32 px): coste por muestra, p95 (ms)', worst((c) => c.size <= 32), TARGET === 'tablet' ? 8 : 4),
    check('pincel grande (128 px): coste por muestra, p95 (ms)', worst((c) => c.size === 128), TARGET === 'tablet' ? frame : 8),
    check('pincel enorme (300 px): coste por muestra, p95 (ms)', worst((c) => c.size === 300), TARGET === 'tablet' ? 40 : 16),
    check('trazo de 16 px: GPU por fotograma, p95 (ms)', live[16].gpu.p95, TARGET === 'tablet' ? 20 : 10),
    check('trazo de 128 px: GPU por fotograma, p95 (ms)', live[128].gpu.p95, TARGET === 'tablet' ? 25 : 12),
    check('sin errores', newErrors().length, 0),
  ],
};
