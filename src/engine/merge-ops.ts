import { flattenRegion } from './composite';
import type { Document, Layer } from './document';
import { newLayer } from './document';
import type { Command } from './history';
import { captureStructure, structureCommand } from './layer-ops';
import { descendants, effectivelyVisible, normalizeLayers } from './layer-tree';
import { TiledSurface } from './tiles';

const BAND = 256;

/** Composite `layers` (with the folders among them) into a new surface, as if they were the whole picture. */
export function flattenToSurface(doc: Document, layers: readonly Layer[]): TiledSurface {
  const only: Document = { ...doc, layers: [...layers] };
  const out = new TiledSurface(doc.width, doc.height);
  for (let y = 0; y < doc.height; y += BAND) {
    const h = Math.min(BAND, doc.height - y);
    out.writeRect({ x: 0, y, w: doc.width, h }, flattenRegion(only, { x: 0, y, w: doc.width, h }));
  }
  return out;
}

export type MergeScope = 'visible' | 'all';

/** The layers that go into "merge visible" (or "merge all", which also takes the paper): shown, normal ones. */
export function mergeCandidates(doc: Document, scope: MergeScope): Layer[] {
  return doc.layers.filter((l) => l.role === 'normal' && (scope === 'all' || l.kind !== 'paper') && effectivelyVisible(doc, l.id));
}

/**
 * Combine the visible layers into one raster layer. With `keep` the originals stay and the result is added on
 * top as a new layer; otherwise they are replaced by it. Hidden, draft and reference layers are left alone.
 */
export function mergeVisible(doc: Document, scope: MergeScope, keep: boolean): Command | null {
  const picked = mergeCandidates(doc, scope);
  if (picked.filter((l) => l.kind !== 'folder').length < (keep ? 1 : 2)) return null;
  const before = captureStructure(doc);
  const merged = newLayer(doc, keep ? 'Capas visibles' : 'Capas combinadas');
  merged.surface = flattenToSurface(doc, picked);
  // It sits where the topmost combined layer was (or on top of everything when the originals stay).
  const top = Math.max(...picked.map((l) => doc.layers.indexOf(l)));
  const topParent = doc.layers[top]!.parent;
  merged.parent = keep ? null : topParent;
  if (!keep) {
    const gone = new Set(picked.map((l) => l.id));
    const above = doc.layers.slice(top + 1);
    doc.layers = [...doc.layers.slice(0, top + 1).filter((l) => !gone.has(l.id)), merged, ...above];
  } else {
    doc.layers.push(merged);
  }
  normalizeLayers(doc);
  doc.activeId = merged.id;
  return structureCommand(doc, keep ? 'Combinar visibles en una capa nueva' : scope === 'all' ? 'Combinar todas las capas' : 'Combinar capas visibles', before, captureStructure(doc));
}

/** A folder can be turned into one raster layer when it holds something. */
export const canFlattenFolder = (doc: Document, id: number): boolean => {
  const f = doc.layers.find((l) => l.id === id);
  return !!f && f.kind === 'folder' && descendants(doc, id).length > 0;
};

/** Replace a folder and everything in it with one raster layer that looks the same on a blank page. */
export function flattenFolder(doc: Document, id: number): Command | null {
  if (!canFlattenFolder(doc, id)) return null;
  const folder = doc.layers.find((l) => l.id === id)!;
  const members = descendants(doc, id);
  const before = captureStructure(doc);
  const merged = newLayer(doc, folder.name);
  merged.surface = flattenToSurface(doc, [...members, folder]);
  merged.parent = folder.parent;
  merged.visible = folder.visible;
  merged.clip = folder.clip;
  const gone = new Set([id, ...members.map((l) => l.id)]);
  const at = doc.layers.indexOf(folder);
  doc.layers = [...doc.layers.slice(0, at).filter((l) => !gone.has(l.id)), merged, ...doc.layers.slice(at + 1).filter((l) => !gone.has(l.id))];
  normalizeLayers(doc);
  doc.activeId = merged.id;
  return structureCommand(doc, 'Combinar carpeta', before, captureStructure(doc));
}
