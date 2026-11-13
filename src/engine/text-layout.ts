export interface LayoutItem {
  text: string;
  /** Centre of the item, relative to the top-left of the text area. */
  cx: number;
  cy: number;
}

export interface TextLayout {
  items: LayoutItem[];
  width: number;
  height: number;
  /** False when the text overflows the area even at the smallest size. */
  fits: boolean;
  fontSize: number;
}

export interface LayoutOptions {
  areaW: number;
  areaH: number;
  fontSize: number;
  vertical: boolean;
  /** Pixel width of a string at `fontSize` (the caller binds the font). */
  measure: (s: string) => number;
  lineHeight?: number;
}

const isCjk = (ch: string): boolean => /[⺀-鿿가-힯豈-﫿＀-￯]/.test(ch);

/** Break one paragraph into lines no wider than `maxW`. Words wrap; CJK breaks per character. */
export function wrapParagraph(par: string, maxW: number, measure: (s: string) => number): string[] {
  const tokens = par.match(/[⺀-鿿가-힯豈-﫿＀-￯]|[^\s⺀-鿿가-힯豈-﫿＀-￯]+|\s+/g) ?? [];
  const lines: string[] = [];
  let cur = '';
  const flush = (): void => {
    lines.push(cur.trimEnd());
    cur = '';
  };
  for (const tok of tokens) {
    const isSpace = /^\s+$/.test(tok);
    if (isSpace && cur === '') continue;
    if (measure(cur + tok) <= maxW || cur === '') {
      // A single token wider than the line is split by character.
      if (cur === '' && measure(tok) > maxW && !isCjk(tok)) {
        for (const ch of tok) {
          if (measure(cur + ch) > maxW && cur !== '') flush();
          cur += ch;
        }
      } else {
        cur += tok;
      }
    } else {
      flush();
      if (!isSpace) cur = tok;
    }
  }
  if (cur !== '' || lines.length === 0) flush();
  return lines;
}

function layoutOnce(text: string, o: LayoutOptions, fontSize: number): TextLayout {
  const lh = fontSize * (o.lineHeight ?? 1.25);
  if (!o.vertical) {
    const lines = text.split('\n').flatMap((p) => wrapParagraph(p, o.areaW, o.measure));
    const height = lines.length * lh;
    const top = (o.areaH - height) / 2;
    const widest = Math.max(0, ...lines.map((l) => o.measure(l)));
    return {
      items: lines.map((t, i) => ({ text: t, cx: o.areaW / 2, cy: top + (i + 0.5) * lh })),
      width: widest,
      height,
      fits: height <= o.areaH + 0.5 && widest <= o.areaW + 0.5,
      fontSize,
    };
  }
  // Vertical writing: characters stack top to bottom, columns run right to left.
  const charH = fontSize * 1.05;
  const perColumn = Math.max(1, Math.floor(o.areaH / charH));
  const columns: string[][] = [];
  for (const par of text.split('\n')) {
    const chars = [...par];
    if (chars.length === 0) columns.push([]);
    for (let i = 0; i < chars.length; i += perColumn) columns.push(chars.slice(i, i + perColumn));
  }
  const colW = lh;
  const totalW = columns.length * colW;
  const items: LayoutItem[] = [];
  let tallest = 0;
  columns.forEach((col, c) => {
    const cx = o.areaW / 2 + totalW / 2 - (c + 0.5) * colW;
    const top = (o.areaH - col.length * charH) / 2;
    tallest = Math.max(tallest, col.length * charH);
    col.forEach((ch, r) => items.push({ text: ch, cx, cy: top + (r + 0.5) * charH }));
  });
  return { items, width: totalW, height: tallest, fits: totalW <= o.areaW + 0.5 && charH <= o.areaH + 0.5, fontSize };
}

/**
 * Lay the text out at `fontSize`, shrinking until it fits the area
 * (never below `minSize`). `measure` must be bound to the font size it is
 * called with, so callers pass a factory per size.
 */
export function fitText(
  text: string,
  o: Omit<LayoutOptions, 'measure'> & { measureAt: (fontSize: number) => (s: string) => number },
  minSize = 8,
): TextLayout {
  let size = o.fontSize;
  for (;;) {
    const layout = layoutOnce(text, { ...o, measure: o.measureAt(size) }, size);
    if (layout.fits || size <= minSize) return layout;
    size = Math.max(minSize, size - 1);
  }
}
