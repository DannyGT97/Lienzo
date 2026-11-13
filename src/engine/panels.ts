import { contains, rectPoly, segmentTouches, splitConvex, type Poly, type Pt } from './geometry';

export interface Panel {
  id: number;
  /** Convex outline; the border is stroked along it. */
  points: Poly;
  border: number;
}

export const DEFAULT_BORDER = 5;
export const DEFAULT_GUTTER = 24;

const nextId = (panels: Panel[]): number => panels.reduce((m, p) => Math.max(m, p.id), 0) + 1;

export function addRectPanel(panels: Panel[], a: Pt, b: Pt, border = DEFAULT_BORDER): Panel[] {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  if (x1 - x0 < 8 || y1 - y0 < 8) return panels;
  return [...panels, { id: nextId(panels), points: rectPoly(x0, y0, x1, y1), border }];
}

/** A rows×cols page layout inside the page margins. */
export function gridPanels(
  panels: Panel[],
  page: { w: number; h: number },
  rows: number,
  cols: number,
  margin: number,
  gutter = DEFAULT_GUTTER,
  border = DEFAULT_BORDER,
): Panel[] {
  const cw = (page.w - 2 * margin - (cols - 1) * gutter) / cols;
  const ch = (page.h - 2 * margin - (rows - 1) * gutter) / rows;
  if (cw < 8 || ch < 8) return panels;
  const out = [...panels];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = margin + c * (cw + gutter);
      const y = margin + r * (ch + gutter);
      out.push({ id: nextId(out), points: rectPoly(x, y, x + cw, y + ch), border });
    }
  }
  return out;
}

/** Topmost panel containing the point. */
export function panelAt(panels: Panel[], p: Pt): Panel | null {
  for (let i = panels.length - 1; i >= 0; i--) if (contains(panels[i]!.points, p)) return panels[i]!;
  return null;
}

/**
 * Split every panel the drawn stroke a→b passes through (the way a "divide
 * frame" tool does); inside each one the cut runs along the whole line.
 * Panels the stroke does not reach are left untouched.
 */
export function splitPanels(panels: Panel[], a: Pt, b: Pt, gutter = DEFAULT_GUTTER): Panel[] {
  const out: Panel[] = [];
  let changed = false;
  for (const panel of panels) {
    const parts = segmentTouches(panel.points, a, b) ? splitConvex(panel.points, a, b, gutter) : null;
    if (!parts) {
      out.push(panel);
      continue;
    }
    changed = true;
    for (const points of parts) out.push({ id: nextId([...panels, ...out]), points, border: panel.border });
  }
  return changed ? out : panels;
}

export const removePanel = (panels: Panel[], id: number): Panel[] => panels.filter((p) => p.id !== id);
