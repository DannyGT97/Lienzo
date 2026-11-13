// Original line icons (24×24, stroke = currentColor). Drawn for Lienzo; they do not reproduce any other app's artwork.

const P = (d: string, extra = ''): string => `<path d="${d}" ${extra}/>`;
const C = (cx: number, cy: number, r: number, extra = ''): string => `<circle cx="${cx}" cy="${cy}" r="${r}" ${extra}/>`;
const R = (x: number, y: number, w: number, h: number, rx = 1.5, extra = ''): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ${extra}/>`;
const L = (x1: number, y1: number, x2: number, y2: number, extra = ''): string => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${extra}/>`;
const E = (cx: number, cy: number, rx: number, ry: number, extra = ''): string => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${extra}/>`;
const T = (x: number, y: number, s: string, size = 8): string =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="700" fill="currentColor" stroke="none" text-anchor="middle" font-family="system-ui,sans-serif">${s}</text>`;

const f2 = (n: number): number => Math.round(n * 100) / 100;
/** `n` short lines around (cx, cy) running from radius r1 to r2; `start` turns the whole fan. */
const rays = (cx: number, cy: number, r1: number, r2: number, n: number, extra = '', start = 0): string => {
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = start + (i * 2 * Math.PI) / n;
    out += L(f2(cx + r1 * Math.cos(a)), f2(cy + r1 * Math.sin(a)), f2(cx + r2 * Math.cos(a)), f2(cy + r2 * Math.sin(a)), extra);
  }
  return out;
};
/** A spiky star outline with `n` points. */
const spikes = (cx: number, cy: number, r1: number, r2: number, n: number): string => {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 === 0 ? r2 : r1;
    pts.push(`${f2(cx + r * Math.cos(a))} ${f2(cy + r * Math.sin(a))}`);
  }
  return P(`M${pts.join('L')}z`);
};

/** Circled plus in the lower right corner; the shape it is added to is drawn open there instead of filled behind it. */
const badge = (): string => C(17.5, 17.5, 4.5) + L(17.5, 15.3, 17.5, 19.7) + L(15.3, 17.5, 19.7, 17.5);

export const ICONS: Record<string, string> = {
  // ---- app / file
  menu: L(4, 7, 20, 7) + L(4, 12, 20, 12) + L(4, 17, 20, 17),
  home: P('M4 11 12 4l8 7') + P('M6 10v9h12v-9'),
  new: P('M6 3h8l4 4v14H6z') + P('M14 3v4h4') + L(12, 11, 12, 17) + L(9, 14, 15, 14),
  open: P('M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z'),
  save: P('M5 4h11l3 3v13H5z') + R(8, 4, 7, 5, 0.5) + R(8, 13, 8, 7, 0.5),
  'export-jpg': P('M6 3h8l4 4v14H6z') + P('M14 3v4h4') + T(12, 17, 'JPG', 5.5),
  'export-png': P('M6 3h8l4 4v14H6z') + P('M14 3v4h4') + T(12, 17, 'PNG', 5.5),
  'export-psd': P('M6 3h8l4 4v14H6z') + P('M14 3v4h4') + T(12, 17, 'PSD', 5.5),
  undo: P('M9 8H4v-5') + P('M4 8a9 9 0 1 1 2.5 8.5'),
  redo: P('M15 8h5V3') + P('M20 8a9 9 0 1 0-2.5 8.5'),
  clear: P('M4 6.5h16') + P('M9.5 6.5V4h5v2.5') + P('M6 6.5l1.2 13.5h9.6L18 6.5') + L(10, 10, 10, 17) + L(14, 10, 14, 17),
  'clear-outside': R(7, 7, 10, 10, 1, 'stroke-dasharray="2 2"') + L(3, 3, 6, 6) + L(21, 3, 18, 6) + L(3, 21, 6, 18) + L(21, 21, 18, 18),
  fill: P('M4.5 12.5 11 6l7 7-6.1 6.1a1.5 1.5 0 0 1-2.1 0l-5.3-5.3a1.5 1.5 0 0 1 0-2.1z') + P('M11 6 8.5 3.5') + L(6, 12, 16.5, 12) + P('M20 14.5c1.3 1.7 1.5 3 0 4-1.5-1-1.3-2.3 0-4z'),
  transform: R(6, 6, 12, 12, 0.5) + R(4, 4, 4, 4, 0.5, 'fill="currentColor"') + R(16, 4, 4, 4, 0.5, 'fill="currentColor"') + R(4, 16, 4, 4, 0.5, 'fill="currentColor"') + R(16, 16, 4, 4, 0.5, 'fill="currentColor"'),
  deselect: R(5, 5, 14, 14, 1, 'stroke-dasharray="2.5 2.5"') + L(9, 9, 15, 15) + L(15, 9, 9, 15),
  invert: R(4, 4, 16, 16, 1, 'stroke-dasharray="2.5 2.5"') + P('M12 4v16') + P('M12 4a8 8 0 0 1 0 16z" fill="currentColor'),
  'show-selection': R(5, 5, 14, 14, 1, 'stroke-dasharray="3 2"') + C(12, 12, 2.2),
  'snap-ruler': L(4, 18, 20, 6) + L(4, 18, 4, 14) + L(4, 18, 8, 18) + C(14, 12, 1.6, 'fill="currentColor"'),
  'snap-special': P('M4 19 12 5l8 14') + L(12, 5, 12, 19) + C(12, 5, 1.6, 'fill="currentColor"'),
  'snap-grid': R(4, 4, 16, 16, 1) + L(9.3, 4, 9.3, 20) + L(14.7, 4, 14.7, 20) + L(4, 9.3, 20, 9.3) + L(4, 14.7, 20, 14.7),
  'help-book': P('M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z') + P('M5 17a3 3 0 0 1 3-3h10'),
  'help-support': C(12, 12, 8) + P('M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7') + C(12, 17, 0.6, 'fill="currentColor"'),

  // ---- tools
  hand: P('M8 12V6a1.3 1.3 0 0 1 2.6 0v4') + P('M10.6 9V4.8a1.3 1.3 0 0 1 2.6 0V9') + P('M13.2 9V5.8a1.3 1.3 0 0 1 2.6 0V10') + P('M15.8 10a1.3 1.3 0 0 1 2.6 0v4.5c0 3.2-2 5.5-5.2 5.5H12c-2 0-3-1-4.2-2.6L5.3 14a1.3 1.3 0 0 1 2-1.6L8 13'),
  pen: P('M8.5 3.5h7l2 8L12 21l-5.5-9.5z') + L(12, 21, 12, 14.4) + C(12, 12.6, 1.5) + L(8.5, 7.5, 15.5, 7.5),
  pencil: P('M5 19.5l1-4 9.2-9.2 3 3L9 18.5z') + P('M5 19.5l1-4 3 3z') + L(13.4, 8.1, 16.4, 11.1) + P('M15.2 6.3l1.6-1.6a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1l-1.6 1.6'),
  brush: P('M14 4c3-1 6 0 6 0s1 3 0 6l-6 6-4-4z') + P('M10 12c-3 0-4 2-4 4 0 2-1 3-2 4 3 0 7 0 8-3 1-2 0-3-2-5z'),
  airbrush: R(3, 10, 9, 6, 2) + L(12, 13, 15, 13) + L(5.5, 10, 5.5, 6.5) + L(3.5, 6.5, 8.5, 6.5) + C(18, 9.5, 0.9, 'fill="currentColor"') + C(20.5, 12, 0.9, 'fill="currentColor"') + C(18, 14.5, 0.9, 'fill="currentColor"') + C(21, 8, 0.7, 'fill="currentColor"') + C(21, 16, 0.7, 'fill="currentColor"'),
  eraser: P('M5 14 14 5l5 5-9 9H7z') + P('M10 9l5 5') + L(7, 19, 20, 19),
  blend: C(9.5, 12, 5.5) + C(14.5, 12, 5.5) + P('M12 7.3a5.5 5.5 0 0 1 0 9.4'),
  gradient: R(4, 5, 16, 14, 1.5) + R(7, 5, 3, 14, 0, 'fill="currentColor" fill-opacity=".2" stroke="none"') + R(10, 5, 3, 14, 0, 'fill="currentColor" fill-opacity=".45" stroke="none"') + R(13, 5, 3, 14, 0, 'fill="currentColor" fill-opacity=".7" stroke="none"') + R(16, 5, 3.5, 14, 0, 'fill="currentColor" fill-opacity=".95" stroke="none"'),
  wand: L(4, 20, 12.5, 11.5) + L(12.5, 11.5, 14, 13) + P('M17 3l1.3 3.2L21.5 7.5l-3.2 1.3L17 12l-1.3-3.2L12.5 7.5l3.2-1.3z') + L(6, 7, 6, 9.5) + L(4.75, 8.25, 7.25, 8.25),
  select: R(5, 5, 14, 14, 1, 'stroke-dasharray="3 2.4"'),
  'select-lasso': P('M12 5c5 0 8 2 8 5s-3 5-8 5c-1 0-2 0-3-.3') + P('M9 14.7c-2 .8-3 2.2-2 3.8 1 1.6 3 1.5 3-.2') + P('M12 5C7 5 4 7 4 10c0 2 1 3.5 3 4.5'),
  figure: R(4, 11, 9, 9, 0.5) + C(15, 9, 5),
  cursor: P('M6 3l12 8-5.5 1.2L15 19l-2.5 1-2.5-6.5L6 17z'),
  correct: P('M4 18C8 6 14 6 18 12') + C(4, 18, 1.6, 'fill="currentColor"') + C(11, 7.5, 1.6) + C(18, 12, 1.6, 'fill="currentColor"'),
  liquify: P('M3 9c3-3 5 3 9 0s6 3 9 0') + P('M3 15c3-3 5 3 9 0s6 3 9 0'),
  eyedropper: P('M14.2 6.2 17.8 9.8') + P('M15.6 4.8a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8l-1.4 1.4-3.6-3.6z') + P('M16.4 10.2 8 18.6l-1 .4-1.8 1.8-.9-.9 1.8-1.8.4-1 8.4-8.4z') + C(5.2, 20.2, 0.5, 'fill="currentColor"'),
  sparkle: P('M12 3c.8 4 2 5.2 6 6-4 .8-5.2 2-6 6-.8-4-2-5.2-6-6 4-.8 5.2-2 6-6z') + P('M18 16c.3 1.5.8 2 2.3 2.3-1.5.3-2 .8-2.3 2.3-.3-1.5-.8-2-2.3-2.3 1.5-.3 2-.8 2.3-2.3z'),
  text: L(6, 5, 18, 5) + L(12, 5, 12, 19) + L(9, 19, 15, 19),
  ruler: P('M3 15 15 3l6 6L9 21z') + L(7, 11, 9, 13) + L(10, 8, 12, 10) + L(13, 5, 15, 7) + L(5, 13, 6.5, 14.5),
  balloon: P('M5 6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H11l-4 4v-4H7a2 2 0 0 1-2-2z'),
  frame: R(4, 4, 7, 7, 0.5) + R(13, 4, 7, 7, 0.5) + R(4, 13, 16, 7, 0.5),
  flash: P('M12 3l1.6 5.4L19 6l-3.4 4.6L21 12l-5.4 1.4L19 18l-5.4-2.4L12 21l-1.6-5.4L5 18l3.4-4.6L3 12l5.4-1.4L5 6l5.4 2.4z'),
  lines: L(12, 3, 12, 8) + L(12, 16, 12, 21) + L(3, 12, 8, 12) + L(16, 12, 21, 12) + L(5.6, 5.6, 9, 9) + L(15, 15, 18.4, 18.4) + L(18.4, 5.6, 15, 9) + L(9, 15, 5.6, 18.4),
  tone: C(8, 8, 1.7, 'fill="currentColor"') + C(16, 8, 1.7, 'fill="currentColor"') + C(8, 16, 1.7, 'fill="currentColor"') + C(16, 16, 1.7, 'fill="currentColor"') + C(12, 12, 1.7, 'fill="currentColor"'),
  panel: R(4, 4, 7, 16, 0.5) + R(13, 4, 7, 7, 0.5) + R(13, 13, 7, 7, 0.5),
  'zoom-in': C(11, 11, 6) + L(16, 16, 20, 20) + L(9, 11, 13, 11) + L(11, 9, 11, 13),
  'zoom-out': C(11, 11, 6) + L(16, 16, 20, 20) + L(9, 11, 13, 11),
  rotate: P('M20 11a8 8 0 1 0-2.3 5.7') + P('M20 5v6h-6'),
  bell: P('M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z') + P('M10 20.5a2 2 0 0 0 4 0'),

  // ---- palettes and generic UI
  navigator: R(4, 5, 16, 14, 1.5) + R(8, 9, 7, 6, 0.5),
  color: C(12, 12, 8) + C(12, 12, 3),
  colorslider: L(4, 8, 20, 8) + L(4, 16, 20, 16) + C(9, 8, 2, 'fill="currentColor"') + C(15, 16, 2, 'fill="currentColor"'),
  colorset: R(4, 4, 6, 6, 0.5) + R(14, 4, 6, 6, 0.5) + R(4, 14, 6, 6, 0.5) + R(14, 14, 6, 6, 0.5),
  layers: P('M12 4 3 9l9 5 9-5z') + P('M3 13l9 5 9-5'),
  layerprop: L(5, 7, 19, 7) + L(5, 12, 19, 12) + L(5, 17, 19, 17) + C(9, 7, 2, 'fill="#2b2b2e"') + C(15, 12, 2, 'fill="#2b2b2e"') + C(10, 17, 2, 'fill="#2b2b2e"'),
  history: P('M4 12a8 8 0 1 0 2.5-5.8') + P('M4 4v4h4') + L(12, 8, 12, 12) + L(12, 12, 15, 14),
  info: C(12, 12, 8) + L(12, 11, 12, 16) + C(12, 8, 0.6, 'fill="currentColor"'),
  material: R(4, 4, 16, 16, 1.5) + P('M4 15l5-4 4 3 3-2 4 3') + C(9, 8.5, 1.4),
  action: P('M8 5l11 7-11 7z'),
  timeline: R(3, 6, 18, 12, 1) + L(7, 6, 7, 18) + L(11, 6, 11, 18) + L(15, 6, 15, 18) + L(3, 12, 21, 12),
  subtool: L(5, 7, 19, 7) + L(5, 12, 19, 12) + L(5, 17, 19, 17),
  quick: P('M13 3 5 14h6l-1 7 8-11h-6z'),
  search: C(11, 11, 6) + L(16, 16, 20, 20),
  align: L(4, 4, 4, 20) + R(7, 6, 10, 4, 0.5) + R(7, 14, 6, 4, 0.5),
  mix: P('M4 14c0-5 4-9 9-9s7 3 7 6-2 3-4 3-2 1-2 3-2 3-4 3c-3 0-6-2-6-6z') + C(9, 11, 1.2, 'fill="currentColor"') + C(13, 9, 1.2, 'fill="currentColor"'),
  chevron: P('M9 6l6 6-6 6'),
  'chevron-down': P('M6 9l6 6 6-6'),
  check: P('M5 12.5 10 17 19 7'),
  plus: L(12, 5, 12, 19) + L(5, 12, 19, 12),
  minus: L(5, 12, 19, 12),
  close: L(6, 6, 18, 18) + L(18, 6, 6, 18),
  eye: P('M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z') + C(12, 12, 3),
  'eye-off': P('M3 3l18 18') + P('M10.5 6.2A9 9 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3 3.6M6.4 7.6C3.7 9.5 2 12 2 12s4 7 10 7c1.5 0 2.8-.4 4-1') + P('M9.9 9.9a3 3 0 0 0 4.2 4.2'),
  lock: R(5.5, 10.5, 13, 10, 1.8, 'fill="currentColor"') + P('M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5'),
  link: P('M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1') + P('M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'),
  folder: P('M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z'),
  mask: R(3.5, 3.5, 17, 17, 2) + C(12, 12, 5, 'fill="currentColor"'),
  copy: P('M14.5 9V5A1.5 1.5 0 0 0 13 3.5H5A1.5 1.5 0 0 0 3.5 5v8A1.5 1.5 0 0 0 5 14.5h4') + R(9, 9, 11.5, 11.5, 1.5) + L(12.3, 14.75, 17.2, 14.75) + L(14.75, 12.3, 14.75, 17.2),
  'folder-new': P('M12 17H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5l2 2h6a1 1 0 0 1 1 1v3.3') + badge(),
  clip: R(3.5, 10.5, 12, 10, 1.2, 'fill="currentColor" fill-opacity=".3"') + R(8.5, 3.5, 12, 10, 1.2, 'stroke-dasharray="2.4 2"') + P('M12 17h3'),
  'lock-alpha': R(3, 3, 11, 11, 0.8) + R(3, 3, 5.5, 5.5, 0, 'fill="currentColor"') + R(8.5, 8.5, 5.5, 5.5, 0, 'fill="currentColor"') + R(11.5, 13, 9.5, 8, 1.4, 'fill="currentColor"') + P('M14.25 13v-1.5a2 2 0 0 1 4 0V13'),
  draft: P('M5 19l1-3.5 10-10 2.5 2.5-10 10z') + P('M14 7l2.5 2.5') + P('M4 21c2-2 3.5 1 5.5-.6S13 19.4 15 20.4 18.5 21 20 19.8'),
  reference: P('M10 20.5l1-11h2l1 11z') + R(10, 6, 4, 3.4, 0.6) + P('M10 6l2-2.6L14 6') + P('M8.2 7.7H4.5M15.8 7.7h3.7M8.6 5.6 5.5 4.2M15.4 5.6l3.1-1.4') + L(7.5, 20.5, 16.5, 20.5),
  'layer-new': P('M12.3 16.5H5A1.5 1.5 0 0 1 3.5 15V5A1.5 1.5 0 0 1 5 3.5h10A1.5 1.5 0 0 1 16.5 5v7.3') + badge(),
  'layer-vector': P('M9 3l6 3.2v6.6L9 16 3 12.8V6.2z') + P('M3 6.2l6 3.2 6-3.2M9 9.4V16') + badge(),
  merge: R(5, 3.5, 14, 6, 1) + R(5, 14.5, 14, 6, 1, 'fill="currentColor" fill-opacity=".3"') + P('M12 10.5v3m0 0-1.8-1.8M12 13.5l1.8-1.8'),
  rename: P('M4 20l1-4 11-11 3 3L8 19z') + L(14, 7, 17, 10),
  'tl-first': L(6, 5, 6, 19) + P('M18 6v12l-9-6z'),
  'tl-prev': P('M16 6v12l-9-6z'),
  'tl-play': P('M8 5l11 7-11 7z'),
  'tl-next': P('M8 6v12l9-6z'),
  'tl-last': L(18, 5, 18, 19) + P('M6 6v12l9-6z'),
  'tl-loop': P('M5 11V9a3 3 0 0 1 3-3h10l-2-2') + P('M19 13v2a3 3 0 0 1-3 3H6l2 2'),
  'fold-left': P('M13 6l-6 6 6 6') + P('M19 6l-6 6 6 6'),
  'fold-right': P('M11 6l6 6-6 6') + P('M5 6l6 6-6 6'),
  up: P('M12 19V5') + P('M6 11l6-6 6 6'),
  down: P('M12 5v14') + P('M6 13l6 6 6-6'),
  pause: L(9, 5, 9, 19) + L(15, 5, 15, 19),
  more: C(6, 12, 1.4, 'fill="currentColor"') + C(12, 12, 1.4, 'fill="currentColor"') + C(18, 12, 1.4, 'fill="currentColor"'),
  settings: C(12, 12, 3) + P('M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1'),
  swap: P('M5 9h13l-3-3') + P('M19 15H6l3 3'),
  // ---- one drawing per sub tool of selection, fill, figure and ruler (they stand on the tool button and in the sub tool cards)
  'sel-ellipse': E(12, 12, 8, 6, 'stroke-dasharray="3 2.4"'),
  'sel-polyline': P('M5 17 8 6l8 2 3 8z', 'stroke-dasharray="2.6 2.2"') + C(5, 17, 1.2, 'fill="currentColor"') + C(8, 6, 1.2, 'fill="currentColor"') + C(16, 8, 1.2, 'fill="currentColor"') + C(19, 16, 1.2, 'fill="currentColor"'),
  'sel-pen': P('M4 12c0-4 3-7 8-7', 'stroke-dasharray="2.6 2.2"') + P('M4 12c0 3 2 5 5 5', 'stroke-dasharray="2.6 2.2"') + P('M10 20l.8-3.2 8-8 2.4 2.4-8 8z') + L(16.5, 11.3, 18.9, 13.7),
  'sel-shrink': R(3.5, 3.5, 17, 17, 1, 'stroke-dasharray="2.6 2.2"') + R(8.5, 8.5, 7, 7, 0.5) + P('M6 6l2 2M18 6l-2 2M6 18l2-2M18 18l-2-2'),
  'sel-magnet': P('M5 8c3-4 9-4 12-1', 'stroke-dasharray="2.6 2.2"') + P('M5 8c-1 3 0 5 3 6', 'stroke-dasharray="2.6 2.2"') + P('M13 12v4a3.5 3.5 0 0 0 7 0v-4') + L(13, 12, 15.5, 12) + L(17.5, 12, 20, 12),
  'fill-layers': P('M3.5 14.5 9 9l6 6-4.9 4.9a1.4 1.4 0 0 1-2 0l-4.6-4.6a1.4 1.4 0 0 1 0-.8z') + P('M9 9 7 7') + P('M17 3l4 2.2-4 2.2-4-2.2z') + P('M13 8l4 2.2 4-2.2') + P('M20 15c1.2 1.5 1.3 2.6 0 3.5-1.3-.9-1.2-2 0-3.5z'),
  'fill-own': P('M3.5 14.5 9 9l6 6-4.9 4.9a1.4 1.4 0 0 1-2 0l-4.6-4.6a1.4 1.4 0 0 1 0-.8z') + P('M9 9 7 7') + P('M17 3l4 2.2-4 2.2-4-2.2z') + P('M20 15c1.2 1.5 1.3 2.6 0 3.5-1.3-.9-1.2-2 0-3.5z'),
  'fill-enclose': P('M6 9c0-3 4-4 6-3s6 0 6 3v6c0 3-4 4-6 3s-6 0-6-3z', 'stroke-dasharray="2.6 2.2"') + P('M12 9.5c1.6 2 1.8 3.4 0 4.6-1.8-1.2-1.6-2.6 0-4.6z', 'fill="currentColor"'),
  'fill-lasso': P('M11 5c4.5 0 7.5 1.7 7.5 4.2S15.500 13.500 11 13.500c-1 0-1.900-.1-2.700-.3') + P('M8.300 13.200c-1.800.7-2.600 2-1.800 3.300.9 1.400 2.700 1.300 2.700-.2') + P('M11 5C6.500 5 3.500 6.700 3.500 9.200c0 1.800 1 3 2.700 3.800') + P('M18 15.500c1.500 1.900 1.700 3.300 0 4.500-1.700-1.200-1.500-2.600 0-4.500z', 'fill="currentColor"'),
  'fill-leftover': P('M8.500 3.500h7l2 8L12 21l-5.500-9.500z') + L(12, 21, 12, 14.400) + C(12, 12.600, 1.500) + C(19.500, 18, 0.900, 'fill="currentColor"') + C(4.500, 18, 0.900, 'fill="currentColor"') + C(19.500, 5, 0.900, 'fill="currentColor"'),
  'fig-line': L(5, 19, 19, 5) + C(5, 19, 1.600, 'fill="currentColor"') + C(19, 5, 1.600, 'fill="currentColor"'),
  'fig-curve': P('M4 18C6 6 16 4 20 12') + C(4, 18, 1.500, 'fill="currentColor"') + C(20, 12, 1.500, 'fill="currentColor"'),
  'fig-polyline': P('M4 18 9 8l5 8 6-11') + C(4, 18, 1.400, 'fill="currentColor"') + C(9, 8, 1.400, 'fill="currentColor"') + C(14, 16, 1.400, 'fill="currentColor"') + C(20, 5, 1.400, 'fill="currentColor"'),
  'fig-wave': P('M3 14c3-8 5-8 7 0s4 8 7 0 3-5 4-3'),
  'fig-bezier': P('M5 18C6 6 18 6 19 18') + L(5, 18, 8, 9, 'stroke-width="1" stroke-dasharray="1.500 1.500"') + L(19, 18, 16, 9, 'stroke-width="1" stroke-dasharray="1.500 1.500"') + R(3.500, 16.500, 3, 3, 0.300) + R(17.500, 16.500, 3, 3, 0.300) + C(8, 9, 1.200) + C(16, 9, 1.200),
  'fig-rect': R(4, 6, 16, 12, 1),
  'fig-ellipse': E(12, 12, 8, 6),
  'fig-polygon': P('M12 4l7 5.100-2.700 8.400H7.700L5 9.100z'),
  'ruler-line': L(4, 19, 20, 5) + L(7, 16, 9, 18) + L(10, 13, 12, 15) + L(13, 10, 15, 12) + L(16, 7, 18, 9),
  'ruler-curve': P('M4 18C8 6 14 5 20 11') + L(5, 15, 7, 16) + L(8.500, 10, 10.500, 11.500) + L(13, 7.500, 14, 9.500) + L(17, 7.800, 17.800, 9.800),
  'ruler-figure': E(10, 12, 6, 5) + R(12, 11, 8, 8, 0.500) + L(14, 11, 14, 13) + L(16, 11, 16, 12.500) + L(18, 11, 18, 13),
  'ruler-pen': L(3.500, 18.500, 14, 8, 'stroke-dasharray="2 2"') + P('M12 20l.8-3.200 7.200-7.200 2.400 2.400L15.200 19.200z') + L(17, 11.800, 19.400, 14.200),
  'ruler-special': C(12, 12, 3) + C(12, 12, 7.500) + L(12, 2, 12, 5) + L(12, 19, 12, 22) + L(2, 12, 5, 12) + L(19, 12, 22, 12),
  'ruler-guide': L(3, 9, 21, 9, 'stroke-dasharray="3 2.500"') + L(15, 3, 15, 21, 'stroke-dasharray="3 2.500"') + C(15, 9, 1.500, 'fill="currentColor"'),
  'ruler-persp': L(3, 8, 21, 8, 'stroke-dasharray="3 2.500"') + C(12, 8, 1.400, 'fill="currentColor"') + L(12, 8, 4, 20) + L(12, 8, 12, 20) + L(12, 8, 20, 20),
  'ruler-sym': L(12, 3, 12, 21, 'stroke-dasharray="3 2.500"') + P('M9.500 7 5 12l4.500 5') + P('M14.500 7 19 12l-4.500 5'),
  // ---- the rest of the tools: one drawing per sub tool, as for selection, fill, figure and ruler
  'op-layer': R(3.5, 3.5, 10, 10, 1, 'stroke-dasharray="2.6 2.2"') + R(10.5, 10.5, 10, 10, 1),
  'op-move': L(12, 3, 12, 21) + L(3, 12, 21, 12) + P('M9 6l3-3 3 3') + P('M9 18l3 3 3-3') + P('M6 9l-3 3 3 3') + P('M18 9l3 3-3 3'),
  'op-tone': C(6, 7, 1.5, 'fill="currentColor"') + C(11, 7, 1.5, 'fill="currentColor"') + C(6, 12, 1.5, 'fill="currentColor"') + C(11, 12, 1.5, 'fill="currentColor"') + C(6, 17, 1.5, 'fill="currentColor"') + C(11, 17, 1.5, 'fill="currentColor"') + L(15, 12, 21, 12) + P('M18.5 9.5 21 12l-2.5 2.5'),
  'op-light': R(4, 8, 12, 12, 1, 'stroke-dasharray="2.2 2"') + R(8, 4, 12, 12, 1),
  'pick-layer': P('M3 17l8 4 8-4') + P('M3 13l8 4 8-4-8-4z') + L(14, 9, 19, 4) + P('M17.5 2.5 21.5 6.5'),
  'wand-own': L(4, 20, 12.5, 11.5) + L(12.5, 11.5, 14, 13) + P('M17 3l1.3 3.2L21.5 7.5l-3.2 1.3L17 12l-1.3-3.2L12.5 7.5l3.2-1.3z') + R(14.5, 14.5, 6.5, 6.5, 1),
  'wand-ref': L(4, 20, 12.5, 11.5) + L(12.5, 11.5, 14, 13) + P('M17 3l1.3 3.2L21.5 7.5l-3.2 1.3L17 12l-1.3-3.2L12.5 7.5l3.2-1.3z') + L(16, 14.5, 16, 21) + P('M16 14.5h4.5l-1.2 2 1.2 2H16'),
  'text-circle': P('M4 17a8 8 0 0 1 16 0') + T(12, 14, 'A', 9),
  'balloon-rough': P('M5 7l2-2.4 2.2 1.2L11.500 4l2.300 1.800L16.200 4.600 18.500 6.500 19.200 9l-1 2.200.800 2.300-2 1.400H11l-4 4v-4H6.200L5 13.500l.8-2.200z'),
  'balloon-ellipse': E(12, 10, 8, 6) + P('M9 15.500l-2 4 5-3'),
  'balloon-curve': P('M4 10c0-4 4-6 8-6s8 2 8 6-3 6-6 6l-4 4v-4c-3-1-6-2-6-6z') + P('M7.500 9.500c1.500-1.200 3-1.200 4.500 0s3 1.200 4.500 0'),
  'balloon-rect': R(4, 5, 16, 11, 0.5) + P('M8 16v4l4-4'),
  'balloon-pen': R(3, 4, 11, 7, 2.500) + P('M10 20l.8-3.200 8-8 2.400 2.400-8 8z'),
  'balloon-tail': P('M7 4h10l-5 16z'),
  'balloon-thought': C(15.500, 8, 5) + C(8, 15, 2.200) + C(5, 19.500, 1.300),
  'frame-rect': R(4, 5, 16, 14, 0.5),
  'frame-rough': P('M4 6l4-1 4 1 4-1 4 1-1 4 1 4-1 4-4-1-4 1-4-1-1-4 1-4z'),
  'frame-poly': P('M5 7l11-3 4 9-6 7-9-3z'),
  'frame-pen': R(3, 4, 11, 8, 0.5) + P('M10 20l.8-3.200 8-8 2.400 2.400-8 8z'),
  'frame-split': R(4, 4, 16, 16, 0.5) + L(4, 16, 20, 8, 'stroke-dasharray="2.600 2"'),
  'frame-folder': P('M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z') + R(7, 11, 4, 4, 0.5) + R(13, 11, 4, 4, 0.5),
  'flash-pattern': rays(12, 12, 5, 9.500, 8) + C(12, 12, 2.200),
  'flash-dense': rays(12, 12, 3.500, 10, 16),
  'flash-urchin': C(12, 12, 4) + rays(12, 12, 6, 10, 12),
  'flash-firework': rays(12, 10, 2, 6.500, 8) + L(12, 17, 12, 21, 'stroke-dasharray="1.500 1.500"'),
  'focus-scattered': rays(12, 12, 6, 10, 9),
  'focus-dark': rays(12, 12, 7, 10.500, 20, 'stroke-width="2.400"'),
  'focus-dense': rays(12, 12, 8, 10.500, 26),
  'focus-bright': C(12, 12, 3.500) + rays(12, 12, 6, 9.500, 8),
  'focus-burst': spikes(12, 12, 5, 10, 10),
  'speed-scattered': L(3, 7, 13, 7) + L(8, 12, 20, 12) + L(4, 17, 15, 17),
  'speed-dark': L(3, 7, 13, 7, 'stroke-width="2.800"') + L(8, 12, 20, 12, 'stroke-width="2.800"') + L(4, 17, 15, 17, 'stroke-width="2.800"'),
  'speed-gloom': L(6, 4, 6, 12) + L(11, 4, 11, 18) + L(16, 4, 16, 10) + L(20, 4, 20, 14),
  'grad-free': R(4, 5, 16, 14, 1.5) + C(8.500, 9.500, 1.600, 'fill="currentColor"') + C(15.500, 8.500, 1.600, 'fill="currentColor"') + C(12, 15, 1.600, 'fill="currentColor"'),
  'grad-free-light': R(4, 5, 16, 14, 1.5) + C(8.500, 9.500, 1.600) + C(15.500, 8.500, 1.600) + C(12, 15, 1.600),
  'grad-free-dark': R(4, 5, 16, 14, 1.5, 'fill="currentColor" fill-opacity=".35"') + C(8.500, 9.500, 2, 'fill="currentColor"') + C(15.500, 8.500, 2, 'fill="currentColor"') + C(12, 15, 2, 'fill="currentColor"'),
  'speed-rain': L(8, 4, 5, 11) + L(14, 5, 11, 12) + L(20, 4, 17, 11) + L(11, 14, 8, 21) + L(18, 14, 15, 21),
};

/** SVG markup for an icon (empty box when the name is unknown). */
export function icon(name: string, size = 18): string {
  const body = ICONS[name] ?? R(5, 5, 14, 14, 2);
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
