// Page side of the pen recording: a guided session on a new page that tells the person what to draw, step by step, and keeps
// every pen event with its time, pressure, tilt, the coalesced and predicted points the browser gave, and the frame it was seen at.
const STEPS = [
  { id: 'recta-lenta', text: 'Línea RECTA y LENTA, de izquierda a derecha (unos 4 s)', strokes: 3, scale: 0.35 },
  { id: 'recta-rapida', text: 'Línea RECTA y RÁPIDA, de izquierda a derecha', strokes: 4, scale: 0.35 },
  { id: 'circulo-lento', text: 'CÍRCULOS grandes y LENTOS (uno por trazo)', strokes: 3, scale: 0.35 },
  { id: 'circulo-rapido', text: 'CÍRCULOS RÁPIDOS (uno por trazo)', strokes: 4, scale: 0.35 },
  { id: 'zigzag', text: 'ZIGZAG con esquinas marcadas, a velocidad normal', strokes: 3, scale: 0.35 },
  { id: 'letras', text: 'Escribe una palabra con tu letra, tamaño pequeño', strokes: 4, scale: 0.35 },
  { id: 'espiral', text: 'ESPIRAL de fuera hacia dentro, lenta', strokes: 2, scale: 0.35 },
  { id: 'presion', text: 'Línea curva con PRESIÓN: empieza suave y aprieta poco a poco', strokes: 3, scale: 0.35 },
  { id: 'hachuras', text: 'HACHURAS: trazos cortos y rápidos, uno junto a otro', strokes: 12, scale: 0.35 },
  { id: 'zoom-alto', text: 'ZOOM ALTO: línea lenta y un círculo pequeño', strokes: 4, scale: 1.5 },
  { id: 'zoom-bajo', text: 'ZOOM BAJO: línea larga y un círculo grande', strokes: 4, scale: 0.12 },
];

window.__rec?.stop?.();
const data = { startedAt: new Date().toISOString(), dpr: devicePixelRatio, ua: navigator.userAgent, steps: STEPS.map((s) => s.id), settings: null, strokes: [] };
window.__rec = { data, done: false, stepIndex: 0, count: 0, stop: () => {} };

// A page of its own, so nothing else is touched.
await newDocument('13', '300');
L.setTool('brush');
L.setBrushSize(Number(ARGS.size ?? 10));
const set = (id, v) => { const e = document.getElementById(id); if (e) { e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); } };
set('hardness', 100);
set('stab', Number(ARGS.stab ?? 0));
const flag = (id) => !!document.getElementById(id)?.checked;
data.settings = { size: L.brush.size, stabilization: L.brush.stabilization, hardness: L.brush.hardness, byZoom: flag('stabzoom'), bySpeed: flag('stabspeed'), predict: flag('predict') };

const box = document.createElement('div');
box.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:99999;background:rgba(20,22,30,.94);color:#fff;border:2px solid #5b8ad6;border-radius:12px;padding:12px 18px;font:600 18px system-ui;max-width:70vw;text-align:center;pointer-events:none';
document.body.append(box);
const show = () => {
  const s = STEPS[window.__rec.stepIndex];
  box.textContent = s ? `Paso ${window.__rec.stepIndex + 1} de ${STEPS.length}: ${s.text}  (${window.__rec.count}/${s.strokes})` : 'Terminado. ¡Gracias!';
};
const gotoStep = () => {
  const s = STEPS[window.__rec.stepIndex];
  if (!s) { window.__rec.done = true; return; }
  L.view.scale = s.scale; L.view.rot = 0; L.view.flip = false; L.view.tilt = 0;
  const st = stage.getBoundingClientRect();
  L.view.x = Math.round(st.width / 2 - (L.doc.width * s.scale) / 2);
  L.view.y = Math.round(st.height / 2 - (L.doc.height * s.scale) / 2);
  L.applyView();
};
gotoStep();
show();

let cur = null;
const pt = (e) => { const p = L.toDoc(e); return [+e.timeStamp.toFixed(2), +p.x.toFixed(2), +p.y.toFixed(2), +e.pressure.toFixed(4), +(e.tiltX || 0).toFixed(1), +(e.tiltY || 0).toFixed(1)]; };
const onDown = (e) => {
  if (e.pointerType === 'mouse' && !ARGS.mouse) return;
  const s = STEPS[window.__rec.stepIndex];
  if (!s) return;
  cur = { step: s.id, type: e.pointerType, scale: L.view.scale, events: [] };
  cur.events.push({ k: 'd', now: performance.now(), pt: pt(e) });
};
const onMove = (e) => {
  if (!cur || e.pointerType === 'mouse' && !ARGS.mouse) return;
  const co = (e.getCoalescedEvents?.() ?? []).map(pt);
  const pr = (e.getPredictedEvents?.() ?? []).map(pt);
  const rec = { k: 'm', now: performance.now(), pt: pt(e), co, pr, frame: 0 };
  cur.events.push(rec);
  requestAnimationFrame((t) => { rec.frame = +t.toFixed(2); });
};
const end = (e) => {
  if (!cur) return;
  cur.events.push({ k: 'u', now: performance.now(), pt: pt(e) });
  data.strokes.push(cur);
  cur = null;
  const s = STEPS[window.__rec.stepIndex];
  window.__rec.count++;
  if (s && window.__rec.count >= s.strokes) { window.__rec.stepIndex++; window.__rec.count = 0; gotoStep(); }
  show();
};
canvas.addEventListener('pointerdown', onDown, true);
canvas.addEventListener('pointermove', onMove, true);
canvas.addEventListener('pointerup', end, true);
canvas.addEventListener('pointercancel', end, true);
window.__rec.stop = () => {
  canvas.removeEventListener('pointerdown', onDown, true);
  canvas.removeEventListener('pointermove', onMove, true);
  canvas.removeEventListener('pointerup', end, true);
  canvas.removeEventListener('pointercancel', end, true);
  box.remove();
};
return { ready: true, steps: STEPS.length, settings: data.settings };
