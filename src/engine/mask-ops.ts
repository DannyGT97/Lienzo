import type { Document, Layer, LayerMask } from './document';
import type { Command } from './history';
import { captureStructure, structureCommand } from './layer-ops';
import { Selection } from './selection';
import { TILE, TILE_BYTES, TiledSurface, type Tile } from './tiles';

/** Everything a mask holds, copied, so a change to it can be undone. */
export interface MaskState {
  base: 0 | 255;
  tiles: Map<number, Tile>;
}

export function captureMask(m: LayerMask): MaskState {
  const tiles = new Map<number, Tile>();
  for (const [tx, ty, t] of m.surface.entries()) tiles.set(m.surface.key(tx, ty), t.slice());
  return { base: m.base, tiles };
}

export function restoreMask(m: LayerMask, s: MaskState): void {
  m.surface.clear();
  m.base = s.base;
  for (const [k, t] of s.tiles) m.surface.put(m.surface.tx(k), m.surface.ty(k), t.slice());
}

const stateBytes = (s: MaskState): number => s.tiles.size * TILE_BYTES;

/** Run `change` on the layer's mask and describe it for the history (null when the layer has no mask or nothing changed). */
export function editMask(doc: Document, layerId: number, label: string, change: (m: LayerMask) => void): Command | null {
  const layer = doc.layers.find((l) => l.id === layerId);
  const mask = layer?.mask;
  if (!mask) return null;
  const before = captureMask(mask);
  change(mask);
  const after = captureMask(mask);
  if (before.base === after.base && before.tiles.size === after.tiles.size && [...before.tiles].every(([k, t]) => same(t, after.tiles.get(k)))) return null;
  const apply = (s: MaskState): void => {
    const m = doc.layers.find((l) => l.id === layerId)?.mask ?? mask;
    restoreMask(m, s);
  };
  return { label, region: null, bytes: stateBytes(before) + stateBytes(after), undo: () => apply(before), redo: () => apply(after) };
}

function same(a: Tile, b: Tile | undefined): boolean {
  if (!b) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export type NewMask = 'show' | 'hide' | 'selection' | 'outside';

/** A tile of a mask holding the given coverage (alpha) per pixel. */
function maskTile(cov: Uint8Array | number): Tile {
  const t = new Uint8ClampedArray(TILE_BYTES).fill(255);
  for (let i = 0; i < TILE * TILE; i++) t[i * 4 + 3] = typeof cov === 'number' ? cov : cov[i]!;
  return t;
}

/**
 * Give a layer a mask: everything shown ('show'), everything hidden ('hide'), only the selection shown
 * ('selection') or only what is outside the selection shown ('outside').
 */
export function createMask(doc: Document, layerId: number, mode: NewMask, sel?: Selection | null): Command | null {
  const layer = doc.layers.find((l) => l.id === layerId);
  if (!layer || layer.mask || layer.kind === 'paper') return null;
  const before = captureStructure(doc);
  const surface = new TiledSurface(doc.width, doc.height);
  let base: 0 | 255 = mode === 'show' ? 255 : 0;
  if ((mode === 'selection' || mode === 'outside') && sel) {
    const flip = mode === 'outside';
    base = (flip ? 255 - sel.outside : sel.outside) as 0 | 255;
    for (const [tx, ty, t] of sel.entries()) {
      const cov = flip ? t.map((v) => 255 - v) : t;
      const tile = maskTile(cov);
      surface.put(tx, ty, tile);
      surface.dropIfUniform(tx, ty, base);
    }
  }
  layer.mask = { surface, base, enabled: true };
  return structureCommand(doc, 'Crear máscara de capa', before, captureStructure(doc));
}

/** Throw the mask away (what it hid shows again). */
export function deleteMask(doc: Document, layerId: number): Command | null {
  const layer = doc.layers.find((l) => l.id === layerId);
  if (!layer?.mask) return null;
  const before = captureStructure(doc);
  delete layer.mask;
  return structureCommand(doc, 'Eliminar máscara de capa', before, captureStructure(doc));
}

export function setMaskEnabled(doc: Document, layerId: number, enabled: boolean): Command | null {
  const layer = doc.layers.find((l) => l.id === layerId);
  if (!layer?.mask || layer.mask.enabled === enabled) return null;
  const before = captureStructure(doc);
  layer.mask.enabled = enabled;
  return structureCommand(doc, enabled ? 'Activar máscara' : 'Desactivar máscara', before, captureStructure(doc));
}

/** Show what is hidden and hide what is shown. */
export function invertMask(doc: Document, layerId: number): Command | null {
  return editMask(doc, layerId, 'Invertir máscara', (m) => {
    m.base = (255 - m.base) as 0 | 255;
    for (const [tx, ty, t] of [...m.surface.entries()]) {
      for (let i = 3; i < t.length; i += 4) t[i] = 255 - t[i]!;
      m.surface.touch(tx, ty);
      m.surface.dropIfUniform(tx, ty, m.base);
    }
  });
}

/** Show (255) or hide (0) the selected part of the layer; partly selected pixels move part of the way. */
export function fillMask(doc: Document, layerId: number, sel: Selection, value: 0 | 255): Command | null {
  return editMask(doc, layerId, value === 255 ? 'Mostrar selección en la máscara' : 'Ocultar selección en la máscara', (m) => {
    const s = m.surface;
    const oldBase = m.base;
    // Tiles whose pixels may change; everything else is uniform and either untouched (outside = 0) or
    // all becomes `value` (outside = 255), which just moves the mask's default.
    const keys = new Set<number>();
    for (const [tx, ty] of sel.entries()) keys.add(s.key(tx, ty));
    if (sel.outside === 255) for (const [tx, ty] of s.entries()) keys.add(s.key(tx, ty));
    for (const k of keys) {
      const tx = s.tx(k);
      const ty = s.ty(k);
      const cov = sel.tile(tx, ty);
      if (cov === 0) continue;
      let t = s.get(tx, ty);
      if (!t) {
        t = s.ensure(tx, ty);
        t.fill(255);
        for (let i = 3; i < t.length; i += 4) t[i] = oldBase;
      }
      for (let i = 0; i < TILE * TILE; i++) {
        const c = cov === 255 ? 255 : cov[i]!;
        if (c) t[i * 4 + 3] = t[i * 4 + 3]! + (value - t[i * 4 + 3]!) * (c / 255);
      }
      s.touch(tx, ty);
    }
    if (sel.outside === 255) m.base = value;
    for (const k of keys) s.dropIfUniform(s.tx(k), s.ty(k), m.base);
  });
}

/** The part of the layer the mask shows, as a selection. */
export function selectionFromMask(doc: Document, layer: Layer): Selection | null {
  const m = layer.mask;
  if (!m) return null;
  const sel = new Selection(doc.width, doc.height);
  sel.outside = m.base;
  for (const [tx, ty, t] of m.surface.entries()) {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const px = tx * TILE + x;
        const py = ty * TILE + y;
        if (px < doc.width && py < doc.height) sel.set(px, py, t[(y * TILE + x) * 4 + 3]!);
      }
    }
  }
  sel.prune();
  return sel;
}

/** Make the mask part of the layer's own pixels (their alpha is multiplied by the mask) and remove the mask. */
export function applyMask(doc: Document, layerId: number): Command | null {
  const layer = doc.layers.find((l) => l.id === layerId);
  const m = layer?.mask;
  if (!layer || !m || layer.kind === 'folder') return null;
  const before = captureStructure(doc);
  const patches: { tx: number; ty: number; before: Tile; after: Tile | undefined }[] = [];
  for (const [tx, ty, t] of [...layer.surface.entries()]) {
    const mt = m.surface.get(tx, ty);
    const old = t.slice();
    const next = t.slice();
    for (let i = 0; i < TILE * TILE; i++) {
      const k = mt ? mt[i * 4 + 3]! : m.base;
      if (k !== 255) next[i * 4 + 3] = (next[i * 4 + 3]! * k) / 255;
    }
    layer.surface.put(tx, ty, next);
    if (layer.surface.dropIfEmpty(tx, ty)) patches.push({ tx, ty, before: old, after: undefined });
    else patches.push({ tx, ty, before: old, after: next.slice() });
  }
  delete layer.mask;
  const after = captureStructure(doc);
  const put = (which: 'before' | 'after'): void => {
    for (const p of patches) {
      const t = p[which];
      layer.surface.put(p.tx, p.ty, t ? t.slice() : undefined);
    }
  };
  return structureCommand(doc, 'Aplicar máscara a la capa', before, after, {
    undo: () => put('before'),
    redo: () => put('after'),
    bytes: patches.length * TILE_BYTES * 2,
  });
}
