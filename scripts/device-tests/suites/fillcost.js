// The bucket on a page with many layers: how long a tap takes when the tool was just chosen (the page it looks at is not composed yet)
// and when it has had time to be (`warmLook`). The time is the longest the page stood still (a late animation frame), not the CPU alone.
const tap = async (fx, fy) => {
  const p = toClient(fx * L.doc.width, fy * L.doc.height);
  const t0 = performance.now();
  await stroke([p, p]);
  await new Promise((r) => requestAnimationFrame(() => r()));
  await new Promise((r) => requestAnimationFrame(() => r()));
  return Math.round(performance.now() - t0);
};
const out = { layers: L.doc.layers.length, page: `${L.doc.width}x${L.doc.height}` };
L.setTool('fill');
out.coldTapMs = await tap(0.31, 0.42);
await sleep(6000);
out.warmTapMs = await tap(0.62, 0.35);
L.setTool('brush');
await sleep(300);
L.setTool('fill');
out.coldAgainMs = await tap(0.2, 0.8);
L.setTool('brush');
return {
  metrics: out,
  checks: [check('toque del bote en frío (ms)', out.coldTapMs, 1200), check('toque del bote con la página preparada (ms)', out.warmTapMs, 600)],
};
