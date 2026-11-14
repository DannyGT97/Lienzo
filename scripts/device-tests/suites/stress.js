// Random work on the open page (layers, undo and redo, strokes, erase, fills, selections, view changes) to break the app:
// no error may be reported, the GL context must survive and the page must keep its layers. `--steps N --seed S`.
const steps = Number(ARGS.steps ?? 150);
const rand = rng(Number(ARGS.seed ?? 1));
const pick = (a) => a[Math.floor(rand() * a.length)];
const key = (k, o = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, cancelable: true, ...o }));
const click = (id) => document.getElementById(id)?.click();
const drag = async (tool, a, b) => {
  L.setTool(tool);
  const p0 = toClient(a[0] * L.doc.width, a[1] * L.doc.height);
  const p1 = toClient(b[0] * L.doc.width, b[1] * L.doc.height);
  const pts = []; for (let i = 0; i <= 10; i++) pts.push({ x: p0.x + (p1.x - p0.x) * i / 10, y: p0.y + (p1.y - p0.y) * i / 10 });
  await stroke(pts);
  L.setTool('brush');
};
const r2 = () => [rand(), rand()];
const actions = {
  add: () => click('add-layer'), dup: () => click('dup-layer'), folder: () => click('add-folder'),
  del: () => { if (L.doc.layers.length > 6) click('del-layer'); }, merge: () => { if (L.doc.layers.length > 6) click('merge-layer'); },
  up: () => click('up-layer'), down: () => click('down-layer'),
  undo: () => key('z'), redo: () => key('z', { shiftKey: true }), undo5: () => { for (let i = 0; i < 5; i++) key('z'); }, redo5: () => { for (let i = 0; i < 5; i++) key('y'); },
  stroke: () => stroke(wave(rand, 25), 1), eraser: async () => { L.setTool('erase'); await stroke(wave(rand, 25), 1); L.setTool('brush'); },
  fill: () => drag('fill', r2(), r2()), gradient: () => drag('gradient', r2(), r2()), figrect: () => drag('figrect', r2(), r2()),
  blur: () => drag('blur', r2(), r2()), smudge: () => drag('smudge', r2(), r2()),
  selrect: () => drag('selrect', r2(), [0.5 + rand() * 0.4, 0.5 + rand() * 0.4]), selall: () => key('a'), deselect: () => key('d'), cut: () => key('x'), copy: () => key('c'), paste: () => key('v'),
  zoomin: async () => { for (let i = 0; i < 8; i++) { wheel(-150, 0.3 + rand() * 0.4, 0.3 + rand() * 0.4); await sleep(16); } },
  zoomout: async () => { for (let i = 0; i < 8; i++) { wheel(150, 0.3 + rand() * 0.4, 0.3 + rand() * 0.4); await sleep(16); } },
  rotate: () => { L.view.rot = (L.view.rot + 1) % 4; L.applyView(); }, flip: () => { L.view.flip = !L.view.flip; L.applyView(); },
  tilt: () => { L.view.tilt = (rand() - 0.5) * 2; L.applyView(); }, untilt: () => { L.view.tilt = 0; L.applyView(); },
  fit: () => { L.view.rot = 0; L.view.flip = false; L.view.tilt = 0; L.view.scale = 0.2; L.view.x = 40; L.view.y = 40; L.applyView(); },
  hide: () => { const l = pick(L.doc.layers); l.visible = !l.visible; L.render(); },
  opacity: () => { const l = pick(L.doc.layers); l.opacity = rand(); L.render(); },
  blend: () => { const l = pick(L.doc.layers); l.blend = pick(['normal', 'multiply', 'screen', 'overlay', 'darken']); L.render(); },
  select: () => { L.doc.activeId = pick(L.doc.layers).id; L.refreshUi(); },
};
const names = Object.keys(actions);
const done = [];
const slow = [];
let failed = null;
const frames = await frameIntervals(async () => {
  for (let i = 0; i < steps; i++) {
    const a = pick(names);
    const t0 = performance.now();
    try { await actions[a](); } catch (e) { failed = { step: i, action: a, error: String((e && e.stack) || e).slice(0, 300) }; break; }
    // How long the page was blocked by this action (a frame callback that comes late shows how long the work took).
    await new Promise((r) => requestAnimationFrame(() => r()));
    const took = performance.now() - t0;
    if (took > 250) slow.push({ action: a, ms: Math.round(took), layers: L.doc.layers.length });
    done.push(a);
    await sleep(20 + Math.floor(rand() * 80));
    if (R.lost) { failed = { step: i, action: a, error: 'se perdió el contexto WebGL' }; break; }
    if (!L.doc.layers.length) { failed = { step: i, action: a, error: 'el documento se quedó sin capas' }; break; }
    document.querySelector('dialog[open]')?.querySelector('button:not(.primary)')?.click();
  }
});
const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
return {
  metrics: { steps: done.length, layers: L.doc.layers.length, failed, frameIntervalsMs: frames, heapMB: heap, slowActions: slow.sort((x, y) => y.ms - x.ms).slice(0, 8), lastActions: done.slice(-6) },
  checks: [
    check('sin fallos', failed ? 1 : 0, 0),
    check('sin errores', newErrors().length, 0),
    check('contexto WebGL vivo', R.lost ? 1 : 0, 0),
    check('fotogramas de más de 500 ms', frames.max > 500 ? 1 : 0, 0),
  ],
};
