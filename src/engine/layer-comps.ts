import type { BlendMode } from './blend';
import type { Document, Layer } from './document';
import type { Command } from './history';

/** What a layer comp remembers about one layer. */
export interface CompEntry {
  id: number;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  clip: boolean;
  lockAlpha: boolean;
  maskEnabled: boolean;
  open: boolean;
}

/** A named combination of layer settings (which layers show, how strongly, in which mode) that can be recalled later. */
export interface LayerComp {
  id: number;
  name: string;
  entries: CompEntry[];
}

const entryOf = (l: Layer): CompEntry => ({
  id: l.id,
  visible: l.visible,
  opacity: l.opacity,
  blend: l.blend,
  clip: l.clip,
  lockAlpha: l.lockAlpha,
  maskEnabled: l.mask?.enabled ?? true,
  open: l.open,
});

const cloneComp = (c: LayerComp): LayerComp => ({ ...c, entries: c.entries.map((e) => ({ ...e })) });

/** Record the current settings of every layer as a new comp (added to the document). */
export function addComp(doc: Document, name: string): LayerComp {
  const comp: LayerComp = { id: doc.nextCompId++, name, entries: doc.layers.map(entryOf) };
  doc.comps.push(comp);
  return comp;
}

/** Replace what a comp remembers by the current state of the layers. */
export function updateComp(doc: Document, id: number): boolean {
  const comp = doc.comps.find((c) => c.id === id);
  if (!comp) return false;
  comp.entries = doc.layers.map(entryOf);
  return true;
}

export function removeComp(doc: Document, id: number): boolean {
  const n = doc.comps.length;
  doc.comps = doc.comps.filter((c) => c.id !== id);
  return doc.comps.length < n;
}

export function renameComp(doc: Document, id: number, name: string): boolean {
  const comp = doc.comps.find((c) => c.id === id);
  if (!comp || comp.name === name) return false;
  comp.name = name;
  return true;
}

/** Put the layers back as the comp remembers them. Layers the comp does not know about (made later) are left alone. */
export function applyComp(doc: Document, id: number): boolean {
  const comp = doc.comps.find((c) => c.id === id);
  if (!comp) return false;
  const byId = new Map(doc.layers.map((l) => [l.id, l]));
  for (const e of comp.entries) {
    const l = byId.get(e.id);
    if (!l) continue;
    l.visible = e.visible;
    l.opacity = e.opacity;
    l.blend = e.blend;
    l.clip = e.clip;
    l.lockAlpha = e.lockAlpha;
    l.open = e.open;
    if (l.mask) l.mask.enabled = e.maskEnabled;
  }
  return true;
}

/** True when the layers are, for the things a comp remembers, exactly as the comp says. */
export function compMatches(doc: Document, comp: LayerComp): boolean {
  const byId = new Map(doc.layers.map((l) => [l.id, l]));
  return comp.entries.every((e) => {
    const l = byId.get(e.id);
    if (!l) return true;
    const now = entryOf(l);
    return (Object.keys(e) as (keyof CompEntry)[]).every((k) => now[k] === e[k]);
  });
}

/** Run `change` on the document's comps (add, rename, update, remove) and return the history step for it. */
export function recordComps(doc: Document, label: string, change: () => void): Command | null {
  const before = doc.comps.map(cloneComp);
  const nextBefore = doc.nextCompId;
  change();
  const after = doc.comps.map(cloneComp);
  const nextAfter = doc.nextCompId;
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  return {
    label,
    region: null,
    undo: () => {
      doc.comps = before.map(cloneComp);
      doc.nextCompId = nextBefore;
    },
    redo: () => {
      doc.comps = after.map(cloneComp);
      doc.nextCompId = nextAfter;
    },
  };
}
