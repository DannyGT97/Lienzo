// Page side: helpers shared by the suites (run inside the app's web view, before each suite).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const L = window.__lienzo;
const R = L.renderer;
const stage = document.getElementById('stage');
const canvas = document.getElementById('canvas');
canvas.setPointerCapture = () => {}; // synthetic pointers have no capture to take
const errorsAtStart = (window.__errors || []).length;
const newErrors = () => (window.__errors || []).slice(errorsAtStart);

/** Percentiles of a list of numbers. */
const stats = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  const r = (v) => +v.toFixed(2);
  return { n: s.length, avg: r(s.reduce((x, y) => x + y, 0) / (s.length || 1)), p50: r(q(0.5)), p95: r(q(0.95)), max: r(s[s.length - 1] ?? 0) };
};

/** A deterministic random generator, so runs can be compared. */
const rng = (seed) => {
  let s = (seed * 7919) >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
};

/** A new document through the real dialog (the preset 13 is 3840 × 2160). */
const newDocument = async (preset = '13', dpi = '600') => {
  const nb = [...document.querySelectorAll('button')].find((x) => /^Nuevo/.test(x.title || ''));
  nb.click();
  await sleep(600);
  const d = document.querySelector('dialog[open]');
  const p = d.querySelector('#nd-preset');
  p.value = preset;
  p.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(150);
  const f = d.querySelector('#nd-dpi');
  f.value = dpi;
  f.dispatchEvent(new Event('input', { bubbles: true }));
  f.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(150);
  const before = L.doc;
  [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Crear').click();
  // Opening a page while a heavy one is open takes a while: wait until it really is the open one.
  for (let i = 0; i < 120 && L.doc === before; i++) await sleep(250);
  await sleep(1500);
};

const toClient = (dx, dy) => {
  const b = stage.getBoundingClientRect();
  const v = L.view;
  return { x: b.left + v.x + dx * v.scale, y: b.top + v.y + dy * v.scale };
};

let pointerId = 7000;
/** One stroke with the real input path: a list of client points, as a mouse (no pen state is touched). */
const stroke = async (pts, pause = 0) => {
  const id = ++pointerId;
  const ev = (t, p, b) =>
    canvas.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'mouse', isPrimary: true, pressure: 0.5, bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, buttons: b }));
  ev('pointerdown', pts[0], 1);
  for (let i = 1; i < pts.length; i++) {
    ev('pointermove', pts[i], 1);
    if (pause && i % 8 === 0) await sleep(pause);
  }
  ev('pointerup', pts[pts.length - 1], 0);
  await sleep(5);
};

/** A sweeping wave across the page, as page coordinates turned into client points. */
const wave = (rand, n = 40) => {
  const W = L.doc.width;
  const H = L.doc.height;
  const x0 = rand() * W * 0.2;
  const y0 = rand() * H;
  const amp = 100 + rand() * 500;
  const ph = rand() * 6.28;
  const dir = rand() < 0.5 ? 1 : -1;
  const pts = [];
  for (let j = 0; j <= n; j++) {
    const t = j / n;
    pts.push(toClient(x0 + t * W * 0.85, Math.min(H - 5, Math.max(5, y0 + dir * amp * Math.sin(ph + t * 9)))));
  }
  return pts;
};

/** Adds `count` layers with `strokes` waves each. */
const fillLayers = async (count, strokes = 5, seed = 12345) => {
  const rand = rng(seed);
  L.setTool('brush');
  for (let i = 0; i < count; i++) {
    document.getElementById('add-layer').click();
    await sleep(40);
    for (let k = 0; k < strokes; k++) await stroke(wave(rand), 2);
  }
  await sleep(500);
};

const wheel = (deltaY, fx = 0.5, fy = 0.5) => {
  const b = stage.getBoundingClientRect();
  stage.dispatchEvent(new WheelEvent('wheel', { deltaY, clientX: b.left + b.width * fx, clientY: b.top + b.height * fy, bubbles: true, cancelable: true }));
};

/** The GPU time of each frame drawn while `body` runs (a pixel read after every frame makes the CPU wait for the GPU). */
const gpuFrames = async (body) => {
  const cpu = [];
  const gpu = [];
  R.syncProfile = true;
  R.onFrame = (t0, c, s) => {
    cpu.push(c);
    gpu.push(s ?? 0);
  };
  await body();
  await sleep(700);
  R.syncProfile = false;
  R.onFrame = null;
  return { cpu: stats(cpu), gpu: stats(gpu) };
};

/** The interval between animation frames while `body` runs. */
const frameIntervals = async (body) => {
  const frames = [];
  let last = 0;
  let going = true;
  const loop = (t) => {
    if (last) frames.push(t - last);
    last = t;
    if (going) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  await body();
  await sleep(500);
  going = false;
  const s = stats(frames);
  return { ...s, over33: frames.filter((v) => v > 33).length, over50: frames.filter((v) => v > 50).length, over100: frames.filter((v) => v > 100).length };
};

/** A check against a limit; `ok` is whether `value` is within it (`max`: at most, `min`: at least). */
const check = (name, value, limit, kind = 'max') => ({ name, value, limit, kind, ok: kind === 'max' ? value <= limit : value >= limit });
