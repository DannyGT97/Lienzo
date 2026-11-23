// Every filter on the open page: how long the window stands still while its slider is dragged (the preview), how long the first
// preview takes to appear, and how long and how still "Aplicar" leaves it. The page is left as it was (each application is undone).
// Runs on the active layer of the open document, so open a real page first (or run `setup` before).
// --tab <texto>: first shows the open document whose tab has that text.
if (ARGS.tab) {
  const tab = [...document.querySelectorAll('.dt-tab')].find((t) => t.textContent.toLowerCase().includes(String(ARGS.tab).toLowerCase()));
  if (tab) {
    tab.click();
    await sleep(2500);
  }
}
// The layer to filter: the visible, unlocked pixel layer with the most painted blocks (the one a person would be working on).
{
  let best = null;
  let most = -1;
  for (const l of L.doc.layers) {
    if (l.kind !== 'raster' || !l.visible || l.locked) continue;
    let n = 0;
    for (const _ of l.surface.entries()) n++;
    if (n > most) {
      most = n;
      best = l;
    }
  }
  if (best) {
    L.doc.activeId = best.id;
    L.refreshUi();
  }
}
const longest = { v: 0 };
let last = performance.now();
const beat = setInterval(() => {
  const n = performance.now();
  longest.v = Math.max(longest.v, n - last - 16);
  last = n;
}, 16);
const lap = () => {
  const v = longest.v;
  longest.v = 0;
  last = performance.now();
  return Math.round(v);
};
const frames = (n) => new Promise((r) => {
  const step = () => (--n <= 0 ? r() : requestAnimationFrame(step));
  requestAnimationFrame(step);
});
// The preview is complete when the panel no longer says it is working (a filter shown by the renderer never says so).
const settled = async (max) => {
  const t = performance.now();
  await frames(2);
  while (performance.now() - t < max) {
    const note = document.querySelector('#filter-panel .note');
    if (!note || note.hidden) return;
    await sleep(20);
  }
};
const undo = () => document.querySelector('[title^="Deshacer"]')?.click();
const ui = L.filtersUi;
const metrics = { page: `${L.doc.width}x${L.doc.height}`, layers: L.doc.layers.length };
const checks = [];
const FREEZE_MAX = 250; // ms the window may stand still in one go
const only = (ARGS.only ?? '').split(',').filter(Boolean);
const IDS = L.filterIds ?? 'invert,brightness,hsv,posterize,levels,balance,binarize,gradientmap,brightnessalpha,gaussian,motion,sharpen,pixelate,tonecurve,colormatch,radialblur,lensblur,crystallize,glow,dropshadow,wave'.split(',');
for (const id of IDS) {
  if (only.length && !only.includes(id)) continue;
  const m = {};
  try {
    lap();
    const t0 = performance.now();
    if (!ui.start(id)) { metrics[id] = 'no se pudo empezar'; continue; }
    await settled(120000);
    m.firstPreviewMs = Math.round(performance.now() - t0);
    m.startFreezeMs = lap();
    // a drag: a dozen slider events, 30 ms apart, over the first control (the way a finger moves it)
    const range = document.querySelector('#filter-panel input[type=range]');
    if (range) {
      const lo = Number(range.min), hi = Number(range.max);
      const td = performance.now();
      for (let i = 1; i <= 12; i++) {
        range.value = String(lo + ((hi - lo) * i) / 12);
        range.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(30);
      }
      const tr = performance.now();
      await settled(120000); // the preview of the last position is complete
      m.settleMs = Math.round(performance.now() - tr);
      m.dragMs = Math.round(performance.now() - td);
    }
    m.dragFreezeMs = lap();
    const ta = performance.now();
    ui.apply();
    for (let i = 0; i < 6000 && ui.active; i++) await sleep(20); // "Aplicar" runs in pieces: it is done when the panel is gone
    m.applyMs = Math.round(performance.now() - ta);
    m.applyFreezeMs = lap();
    undo();
    await sleep(500);
    lap();
  } catch (e) {
    m.error = String(e && e.message ? e.message : e);
    if (ui.active) ui.cancel();
  }
  metrics[id] = m;
  if (m.error) checks.push(check(`${id}: sin error (0 = sí)`, 1, 0));
  else {
    checks.push(check(`${id}: la ventana parada al mover el control (ms)`, m.dragFreezeMs, FREEZE_MAX));
    checks.push(check(`${id}: la ventana parada al aplicar (ms)`, m.applyFreezeMs, FREEZE_MAX));
  }
}
clearInterval(beat);
return { metrics, checks };
