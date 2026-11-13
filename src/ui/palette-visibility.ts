/**
 * Which palettes of the docks are shown, kept between runs. Own design: the two docks' shown palettes are stored as
 * lists of ids; ids this version does not know (a palette renamed or removed since) are dropped when reading, and
 * anything unreadable gives back nothing, so the docks start from their defaults.
 */
export const SHOWN_KEY = 'lienzo.palettes.shown';

export interface ShownPalettes {
  right: Set<string>;
  left: Set<string>;
}

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;

const idsOf = (value: unknown, known: ReadonlySet<string>): Set<string> | null => {
  if (!Array.isArray(value)) return null;
  return new Set(value.filter((id): id is string => typeof id === 'string' && known.has(id)));
};

/** The shown palettes saved last time; null when nothing usable was saved (a docks keeps its defaults then). */
export function loadShown(storage: Reader, rightKnown: ReadonlySet<string>, leftKnown: ReadonlySet<string>): ShownPalettes | null {
  try {
    const raw = storage.getItem(SHOWN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { right?: unknown; left?: unknown } | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const right = idsOf(parsed.right, rightKnown);
    const left = idsOf(parsed.left, leftKnown);
    if (!right && !left) return null;
    return { right: right ?? new Set(), left: left ?? new Set() };
  } catch {
    return null;
  }
}

/** Write the shown palettes; returns false when storage refused (the choice then lasts for this session only). */
export function saveShown(storage: Writer, shown: { right: Iterable<string>; left: Iterable<string> }): boolean {
  try {
    storage.setItem(SHOWN_KEY, JSON.stringify({ right: [...shown.right], left: [...shown.left] }));
    return true;
  } catch {
    return false;
  }
}
