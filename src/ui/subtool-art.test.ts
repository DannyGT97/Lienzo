import { describe, expect, it } from 'vitest';
import { buttonIconName, cardPreview, drawingOf, gradientSwatch, rowIconName } from './subtool-art';
import { DEFAULT_SUBTOOL, PALETTE_TOOLS, isLive } from './spec/tool-map';
import { ICONS } from './icons';
import { hasStrokePreview } from './stroke-preview';
import { parseLastSubtools } from './tool-palettes';

describe('sub tool art', () => {
  it('starts the selection tool on the rectangle', () => {
    expect(DEFAULT_SUBTOOL['selection-area']).toBe('selection-area.selection-area.rectangle');
    expect(isLive(DEFAULT_SUBTOOL['selection-area']!)).toBe(true);
  });
  it('the button follows the sub tool only for tools that should', () => {
    expect(buttonIconName('selection-area', 'select', 'selection-area.selection-area.ellipse')).toBe('sel-ellipse');
    expect(buttonIconName('selection-area', 'select', undefined)).toBe('select');
    expect(buttonIconName('pen', 'pen', 'pen.pen.g-pen')).toBe('pen');
    expect(drawingOf('nope')).toBeUndefined();
  });
  it('gradients get a swatch card and the others a compact row with their drawing', () => {
    expect(gradientSwatch('gradient.gradient.sunset')).toContain('linear-gradient');
    expect(gradientSwatch('fill.fill.lasso-fill')).toBeUndefined();
    expect(cardPreview('gradient.gradient.sunset')).toContain('st-swatch');
    expect(cardPreview('ruler.create-ruler.linear-ruler')).toBe('');
    expect(cardPreview('pen.pen.g-pen')).toBe('');
    expect(rowIconName('ruler', 'ruler.create-ruler.linear-ruler')).toBe('ruler-line');
    expect(rowIconName('ruler', 'nope')).toBe('ruler');
  });
  it('each gradient swatch shows the shape and screen of its gradient', () => {
    expect(gradientSwatch('gradient.gradient.sun')).toContain('radial-gradient');
    expect(gradientSwatch('gradient.gradient.bubble')).toContain('conic-gradient');
    expect(gradientSwatch('gradient.gradient.linear-tone')).toContain('repeating-linear-gradient');
    expect(cardPreview('gradient.gradient.gradient-erase')).toContain('<svg');
    expect(cardPreview('gradient.gradient.cyberpunk')).not.toContain('<svg');
  });
  it('the gradient tool files its presets in six chips under section headings', () => {
    const t = PALETTE_TOOLS.find((x) => x.id === 'gradient')!;
    expect(t.groups.map((g) => g.es)).toEqual(['Básicos', 'Paisaje', 'Materiales', 'Color', 'Manga', 'Degradado libre']);
    const all = t.groups.flatMap((g) => g.subtools as { id: string; section?: string }[]);
    expect(all.filter((s) => s.id.startsWith('gradient.gradient.')).every((s) => s.section && isLive(s.id))).toBe(true);
    expect(isLive('gradient.gradient.background-color-stripe') && isLive('gradient.gradient.photosphere') && isLive('gradient.gradient.manga-gradient')).toBe(true);
  });
  it('ignores stored choices that no longer exist', () => {
    const m = parseLastSubtools({ 'selection-area': 'selection-area.selection-area.lasso', fill: 'nope', ghost: 'x' });
    expect([...m]).toEqual([['selection-area', 'selection-area.selection-area.lasso']]);
    expect(parseLastSubtools('x').size).toBe(0);
  });
  it('every sub tool of a tool without sample strokes has a drawing or a swatch, and every drawing exists', () => {
    for (const t of PALETTE_TOOLS) {
      if (hasStrokePreview(t.id) || t.groups.flatMap((g) => g.subtools).length < 2) continue;
      for (const g of t.groups) {
        for (const sub of g.subtools) {
          const name = drawingOf(sub.id);
          expect(name !== undefined || cardPreview(sub.id) !== '', sub.id).toBe(true);
          if (name) expect(ICONS[name], `${sub.id} -> ${name}`).toBeDefined();
        }
      }
    }
  });
});
