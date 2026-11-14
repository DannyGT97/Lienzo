// The paint bucket on a heavy page: a tap right after choosing the tool, and a tap once the page it looks at has been composed in the
// background. Uses the open page (run `setup` first); each fill is undone.
const key = (k, o = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, cancelable: true, ...o }));
const tap = async (fx, fy) => {
  const c = toClient(L.doc.width * fx, L.doc.height * fy);
  const id = ++pointerId;
  const ev = (t, b) => canvas.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true, clientX: c.x, clientY: c.y, button: 0, buttons: b }));
  const t0 = performance.now();
  ev('pointerdown', 1);
  ev('pointerup', 0);
  return performance.now() - t0;
};
L.view.rot = 0; L.view.flip = false; L.view.tilt = 0; L.view.scale = 0.2; L.view.x = 40; L.view.y = 40; L.applyView();
await sleep(500);
L.setTool('brush');
await sleep(300);
L.setTool('fill');
const cold = await tap(0.01, 0.01);
await sleep(400);
key('z');
await sleep(500);
L.setTool('brush');
await sleep(300);
L.setTool('fill');
const waitMs = Number(ARGS.wait ?? 12000);
await sleep(waitMs);
const warm = await tap(0.012, 0.012);
await sleep(400);
key('z');
await sleep(500);
await sleep(Number(ARGS.wait ?? 12000)); // the page is composed again in the background after the undo
const again = await tap(0.014, 0.014);
await sleep(400);
key('z');
L.setTool('brush');
return {
  metrics: { layers: L.doc.layers.length, coldTapMs: Math.round(cold), tapAfterWaitingMs: Math.round(warm), waitedMs: waitMs, secondTapMs: Math.round(again) },
  checks: [
    check('toque justo al elegir la herramienta (ms)', Math.round(cold), TARGET === 'tablet' ? 6000 : 3000),
    check('toque con la página ya compuesta (ms)', Math.round(warm), TARGET === 'tablet' ? 700 : 250),
    check('segundo toque, tras deshacer y esperar (ms)', Math.round(again), TARGET === 'tablet' ? 700 : 250),
    check('sin errores', newErrors().length, 0),
  ],
};
