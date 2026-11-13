/**
 * How a splitter between two stacked palettes moves their heights (CSS pixels). The palette above (`a`) follows the pointer;
 * the one below (`b`, null when it keeps the height of its content) gives or takes what `a` gains or loses, so the pair keeps
 * its total. Neither goes below `min`, and neither is made taller than its own content (`maxA`, `maxB`): the rest would be empty.
 */
export function splitPair(a: number, b: number | null, dy: number, min: number, maxA: number, maxB = Infinity, minB = min): { a: number; b: number | null } {
  // A palette is never given less than it needs to show its essential part, even when its content is shorter than that.
  const floorA = Math.min(min, maxA);
  let next = Math.max(floorA, Math.min(maxA, a + dy));
  if (b === null) return { a: next, b: null };
  const total = a + b;
  next = Math.max(next, total - maxB); // b cannot be taller than its content
  next = Math.min(next, total - Math.min(minB, maxB)); // nor shorter than what it needs
  next = Math.max(floorA, next);
  return { a: next, b: total - next };
}

/** Heights that were remembered, keeping only usable numbers. */
export function parseSizes(text: string | null): Record<string, number> {
  if (!text) return {};
  try {
    const raw = JSON.parse(text) as unknown;
    if (typeof raw !== 'object' || raw === null) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v) && v >= 24 && v <= 4000) out[k] = Math.round(v);
    return out;
  } catch {
    return {};
  }
}
