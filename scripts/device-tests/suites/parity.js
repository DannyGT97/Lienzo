// The compositor must give the same picture however it saves work: a whole-page compose with every shortcut turned off is the
// reference, and the normal one must match it byte for byte, at several zoom levels, on a page of mixed blend modes, opacity,
// clipping and a hidden layer. Adds 10 layers to the open page.
const rand = rng(777);
const modes = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'colorDodge', 'normal', 'softLight', 'difference', 'normal'];
const opacity = [1, 0.8, 0.6, 1, 0.5, 0.9, 0.7, 1, 0.4, 1];
L.setTool('brush');
for (let i = 0; i < 10; i++) {
  document.getElementById('add-layer').click();
  await sleep(30);
  for (let k = 0; k < 3; k++) await stroke(wave(rand, 30), 0);
  const l = L.doc.layers[L.doc.layers.length - 1];
  l.blend = modes[i]; l.opacity = opacity[i];
  if (i === 3 || i === 7) l.clip = true;
  if (i === 5) l.visible = false;
}
L.render();
await sleep(400);
const W = L.doc.width, H = L.doc.height;
const res = {};
const checks = [];
const compose = R.compose.bind(R);
const bounds = R.tileBounds.bind(R);
const copy = R.copyBackdrop.bind(R);
for (const s of [1, 0.3, 0.1]) {
  const rect = { x: Math.round(W * 0.05), y: Math.round(H * 0.05), w: 600, h: 450 };
  R.compose = (d, w, h, m, rc) => compose(d, w, h, { ox: -rect.x * s, oy: -rect.y * s, s }, rc);
  // Reference: whole tiles shaded, the whole backdrop copied for every layer.
  R.tileBounds = () => ({ x0: 0, y0: 0, x1: 256, y1: 256 });
  R.copyBackdrop = (st, v) => { st.stale = null; return copy(st, v); };
  const reference = R.snapshot(rect);
  R.tileBounds = bounds;
  R.copyBackdrop = copy;
  const actual = R.snapshot(rect);
  R.compose = compose;
  let different = 0, painted = 0;
  for (let i = 0; i < reference.length; i++) { if (reference[i] !== actual[i]) different++; if (i % 4 === 0 && reference[i] !== 255) painted++; }
  res['escala ' + s] = { differentBytes: different, nonWhitePixels: painted };
  checks.push(check(`escala ${s}: bytes distintos`, different, 0));
  checks.push(check(`escala ${s}: hay algo dibujado`, painted, 1, 'min'));
}
checks.push(check('sin errores', newErrors().length, 0));
return { metrics: res, checks };
