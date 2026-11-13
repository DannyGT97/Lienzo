import type { BrushPreset } from './spec/tool-map';

/** How a sub tool's sample stroke is drawn in the sub tool palette. Original artwork, generated from simple parameters. */
export interface PreviewStyle {
  /** Thickest point of the stroke, 0..1 of the preview height. */
  width: number;
  /** 0 = very soft edge, 1 = crisp edge. */
  hardness: number;
  /** Amount of tapering at both ends, 0..1. */
  taper: number;
  /** Texture of the edge: 0 = clean. */
  rough: number;
  eraser?: boolean;
}

const STROKE_TOOLS = new Set(['pen', 'sketch', 'brush', 'airbrush', 'eraser', 'blend', 'decoration', 'correct-line']);

export const hasStrokePreview = (toolId: string): boolean => STROKE_TOOLS.has(toolId);

/** Small stable number from a string, so every sub tool gets its own (but always the same) variation. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

export function previewFor(toolId: string, subId: string, preset?: BrushPreset): PreviewStyle {
  const v = hash(subId);
  const base: Record<string, PreviewStyle> = {
    pen: { width: 0.34, hardness: 1, taper: 0.7, rough: 0 },
    'correct-line': { width: 0.2, hardness: 1, taper: 0.4, rough: 0 },
    sketch: { width: 0.2, hardness: 0.6, taper: 0.5, rough: 0.6 },
    brush: { width: 0.5, hardness: 0.75, taper: 0.45, rough: 0.2 },
    airbrush: { width: 0.7, hardness: 0.1, taper: 0.15, rough: 0 },
    eraser: { width: 0.45, hardness: 0.9, taper: 0.1, rough: 0, eraser: true },
    blend: { width: 0.55, hardness: 0.35, taper: 0.2, rough: 0.1 },
    decoration: { width: 0.4, hardness: 0.8, taper: 0.3, rough: 0.4 },
  };
  const s = { ...(base[toolId] ?? base.pen!) };
  s.width = Math.min(0.85, Math.max(0.1, s.width * (0.75 + v * 0.5)));
  s.taper = Math.min(0.9, Math.max(0, s.taper + (v - 0.5) * 0.3));
  if (preset?.size !== undefined) s.width = Math.min(0.85, Math.max(0.08, 0.1 + Math.log10(1 + preset.size) * 0.3));
  if (preset?.hardness !== undefined) s.hardness = preset.hardness;
  return s;
}

const W = 120;
const H = 36;

/** An SVG sample stroke: a gentle wave whose thickness follows the style. Painted in the current text colour. */
export function strokeSvg(style: PreviewStyle, seed: string): string {
  const n = 28;
  const phase = hash(seed) * Math.PI;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = 8 + t * (W - 16);
    const y = H / 2 + Math.sin(t * Math.PI * 1.6 + phase) * 6 - (t - 0.5) * 4;
    const edge = Math.min(1, t / (0.05 + style.taper * 0.4), (1 - t) / (0.05 + style.taper * 0.4));
    const wobble = 1 + (style.rough ? Math.sin(i * 7.3 + phase * 5) * style.rough * 0.25 : 0);
    const w = (H * style.width * Math.pow(Math.max(0, edge), 0.7) * wobble) / 2;
    top.push(`${x.toFixed(1)},${(y - w).toFixed(1)}`);
    bottom.push(`${x.toFixed(1)},${(y + w).toFixed(1)}`);
  }
  const points = top.concat(bottom.reverse()).join(' ');
  const blur = (1 - style.hardness) * 3.2;
  const id = `bl${Math.round(blur * 10)}`;
  const filter = blur > 0.2 ? `<defs><filter id="${id}" x="-10%" y="-60%" width="120%" height="220%"><feGaussianBlur stdDeviation="${blur.toFixed(1)}"/></filter></defs>` : '';
  const fill = style.eraser ? 'fill="currentColor" opacity="0.55"' : 'fill="currentColor"';
  return `<svg class="st-preview" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${filter}<polygon points="${points}" ${fill}${blur > 0.2 ? ` filter="url(#${id})"` : ''}/></svg>`;
}
