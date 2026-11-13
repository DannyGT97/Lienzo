/**
 * What was open when the app was left: the tabs in order, which one was showing, or that no document was open at all.
 * It is only a list of autosave keys (the documents themselves live in the autosave store, see `autosave.ts`), kept in
 * localStorage so that the next start can open the same tabs again instead of a blank canvas.
 *
 * Reading is defensive: anything that is not a well-formed record is "no record", and the app then starts as it did
 * before there was one.
 */
import type { StoredAutosave } from './autosave';

export const SESSION_KEY = 'lienzo.session.v1';

export interface SessionRecord {
  /** No document was open (the last tab had been closed): the next start shows the welcome panel, not a canvas. */
  empty: boolean;
  /** The autosave keys of the open documents, in tab order. */
  tabs: string[];
  /** The key of the document that was showing, or null. */
  active: string | null;
}

export const serializeSession = (r: SessionRecord): string => JSON.stringify({ v: 1, empty: r.empty, tabs: r.tabs, active: r.active });

export function parseSession(text: string | null): SessionRecord | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as { v?: unknown; empty?: unknown; tabs?: unknown; active?: unknown } | null;
    if (!v || v.v !== 1 || typeof v.empty !== 'boolean' || !Array.isArray(v.tabs)) return null;
    const tabs = [...new Set(v.tabs.filter((k): k is string => typeof k === 'string' && k.length > 0))];
    const active = typeof v.active === 'string' && tabs.includes(v.active) ? v.active : null;
    return { empty: v.empty && tabs.length === 0, tabs, active };
  } catch {
    return null;
  }
}

export const readSession = (): SessionRecord | null => {
  try {
    return parseSession(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
};

/** Writes `r` unless it is what was written last. Storage that cannot be used just means the session is not kept. */
let lastWritten: string | null = null;
export function writeSession(r: SessionRecord): void {
  const text = serializeSession(r);
  if (text === lastWritten) return;
  try {
    localStorage.setItem(SESSION_KEY, text);
    lastWritten = text;
  } catch {
    // private mode or full storage: the session is simply not remembered
  }
}

export interface RestorePlan {
  /** The copies of the open documents, in tab order. A tab whose copy is gone is not here. */
  open: StoredAutosave[];
  /** The key of the copy that was showing (null when it is not among `open`). */
  active: string | null;
  /** Copies with unsaved changes that no tab of the record owns: they are offered to the person, as always. */
  orphans: StoredAutosave[];
  /** Copies that hold nothing to offer (a saved document nobody had open): they are deleted. */
  stale: StoredAutosave[];
  /** Start with no document open. */
  emptyStart: boolean;
}

/** Whether a copy holds changes that exist nowhere else (copies written before there was a flag all do). */
export const hasUnsavedChanges = (s: StoredAutosave): boolean => s.entry.unsaved !== false;

/**
 * What a copy is worth once the file it belongs to has been looked at (`fileChangedAt`: when the file last changed, or
 * null when that cannot be told).
 *  - `current`: the file has not changed since the copy was made (or cannot be told): the copy is put back as usual.
 *  - `behind`: the file is newer and the copy holds nothing the file lacks: it can be dropped.
 *  - `diverged`: the file is newer but the copy has changes that are in no file. It is never put back on top of the
 *    file (saving would overwrite the newer file) and never dropped (those changes exist nowhere else): the person decides.
 */
export type CopyVerdict = 'current' | 'behind' | 'diverged';

export function judgeCopy(s: StoredAutosave, fileChangedAt: number | null): CopyVerdict {
  if (fileChangedAt === null || fileChangedAt < s.entry.savedAt) return 'current';
  return hasUnsavedChanges(s) ? 'diverged' : 'behind';
}

export function planRestore(record: SessionRecord | null, stored: StoredAutosave[]): RestorePlan {
  const byKey = new Map(stored.map((s) => [s.key, s]));
  const owned = new Set(record?.tabs ?? []);
  const open = (record?.tabs ?? []).flatMap((k) => byKey.get(k) ?? []);
  const rest = stored.filter((s) => !owned.has(s.key));
  return {
    open,
    active: record?.active && open.some((s) => s.key === record.active) ? record.active : (open[0]?.key ?? null),
    orphans: rest.filter(hasUnsavedChanges),
    stale: rest.filter((s) => !hasUnsavedChanges(s)),
    emptyStart: !!record?.empty && open.length === 0,
  };
}
