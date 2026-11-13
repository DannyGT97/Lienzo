import type { Document, Layer } from './document';
import { newLayer } from './document';

/**
 * Layers live in one flat list (bottom to top) and folders are expressed with `parent` ids. The list is kept in
 * "folder last" order: the members of a folder are listed, in their own order, immediately before the folder.
 * Every function here that changes membership or order restores that order, so code that only walks the flat
 * list (the layer palette, undo snapshots) never has to think about nesting.
 */
export interface TreeNode {
  layer: Layer;
  /** Members of a folder, bottom to top. */
  children: TreeNode[];
}

/** The layers as a forest (top-level nodes bottom to top). A member whose folder is missing counts as top level. */
export function layerTree(layers: readonly Layer[]): TreeNode[] {
  const nodes = new Map<number, TreeNode>();
  for (const layer of layers) nodes.set(layer.id, { layer, children: [] });
  const roots: TreeNode[] = [];
  for (const layer of layers) {
    const node = nodes.get(layer.id)!;
    const up = layer.parent !== null ? nodes.get(layer.parent) : undefined;
    if (up && up.layer.kind === 'folder' && up !== node && !reaches(nodes, up, layer.id)) up.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** True when walking up from `from` runs into the layer `id` (which would make a cycle). */
function reaches(nodes: Map<number, TreeNode>, from: TreeNode, id: number): boolean {
  let at: TreeNode | undefined = from;
  for (let guard = 0; at && guard < nodes.size + 1; guard++) {
    if (at.layer.id === id) return true;
    at = at.layer.parent !== null ? nodes.get(at.layer.parent) : undefined;
  }
  return false;
}

/** The flat "folder last" order of a forest. */
export function flattenTree(nodes: readonly TreeNode[]): Layer[] {
  const out: Layer[] = [];
  const walk = (list: readonly TreeNode[]): void => {
    for (const n of list) {
      walk(n.children);
      out.push(n.layer);
    }
  };
  walk(nodes);
  return out;
}

/** Fix `parent` ids that point nowhere and put the list back in folder-last order. */
export function normalizeLayers(doc: Document): void {
  const tree = layerTree(doc.layers);
  const walk = (list: TreeNode[], parent: number | null): void => {
    for (const n of list) {
      n.layer.parent = parent;
      walk(n.children, n.layer.kind === 'folder' ? n.layer.id : null);
    }
  };
  walk(tree, null);
  doc.layers = flattenTree(tree);
}

const find = (nodes: readonly TreeNode[], id: number): { list: TreeNode[]; index: number; node: TreeNode } | null => {
  const walk = (list: TreeNode[]): { list: TreeNode[]; index: number; node: TreeNode } | null => {
    for (let i = 0; i < list.length; i++) {
      if (list[i]!.layer.id === id) return { list, index: i, node: list[i]! };
      const hit = walk(list[i]!.children);
      if (hit) return hit;
    }
    return null;
  };
  return walk(nodes as TreeNode[]);
};

/** Folders that contain the layer, nearest first. */
export function ancestors(doc: Document, id: number): Layer[] {
  const byId = new Map(doc.layers.map((l) => [l.id, l]));
  const out: Layer[] = [];
  let at = byId.get(id);
  for (let guard = 0; at && at.parent !== null && guard < doc.layers.length; guard++) {
    at = byId.get(at.parent);
    if (at) out.push(at);
  }
  return out;
}

/** How deep a layer sits (0 = top level). */
export const depthOf = (doc: Document, id: number): number => ancestors(doc, id).length;

/** Every layer inside the folder, at any depth. */
export function descendants(doc: Document, id: number): Layer[] {
  const hit = find(layerTree(doc.layers), id);
  return hit ? flattenTree(hit.node.children) : [];
}

/** The layer is shown only when it and every folder around it is visible. */
export function effectivelyVisible(doc: Document, id: number): boolean {
  const l = doc.layers.find((x) => x.id === id);
  return !!l && l.visible && ancestors(doc, id).every((f) => f.visible);
}

/** Move a layer past its next sibling, above (delta > 0) or below (delta < 0), keeping it in its folder. */
export function moveLayer(doc: Document, id: number, delta: number): void {
  const tree = layerTree(doc.layers);
  const hit = find(tree, id);
  if (!hit) return;
  const j = hit.index + delta;
  if (j < 0 || j >= hit.list.length) return;
  const [node] = hit.list.splice(hit.index, 1);
  hit.list.splice(j, 0, node!);
  doc.layers = flattenTree(tree);
}

/**
 * Put a layer (with its members, for a folder) into `parent` (null = top level) at `index` among that folder's
 * members, counted bottom to top. Returns false when the move is impossible (a folder into itself).
 */
export function moveLayerTo(doc: Document, id: number, parent: number | null, index: number): boolean {
  const tree = layerTree(doc.layers);
  const hit = find(tree, id);
  if (!hit) return false;
  let target: TreeNode[];
  if (parent === null) target = tree;
  else {
    const dest = find(tree, parent);
    if (!dest || dest.node.layer.kind !== 'folder' || find(hit.node.children, parent) || parent === id) return false;
    target = dest.node.children;
  }
  hit.list.splice(hit.index, 1);
  target.splice(Math.max(0, Math.min(index, target.length)), 0, hit.node);
  hit.node.layer.parent = parent;
  doc.layers = flattenTree(tree);
  return true;
}

/** A new folder takes the place of the topmost of `ids` and gathers all of them (those in the same folder as it). */
export function groupLayers(doc: Document, ids: readonly number[], name = 'Carpeta'): Layer | null {
  const tree = layerTree(doc.layers);
  const picked = ids.map((i) => find(tree, i)).filter((h): h is NonNullable<typeof h> => !!h);
  if (!picked.length) return null;
  const top = picked.reduce((a, b) => (doc.layers.indexOf(b.node.layer) > doc.layers.indexOf(a.node.layer) ? b : a));
  const list = top.list;
  const members = picked.filter((h) => h.list === list).map((h) => h.node);
  const folder = newLayer(doc, name, 'folder');
  folder.parent = top.node.layer.parent;
  const at = list.indexOf(top.node);
  const node: TreeNode = { layer: folder, children: [] };
  // Members keep their relative order.
  const ordered = list.filter((n) => members.includes(n));
  for (const n of ordered) {
    list.splice(list.indexOf(n), 1);
    n.layer.parent = folder.id;
    node.children.push(n);
  }
  // Every other member sat below the topmost one, so the folder goes where the topmost used to be.
  list.splice(at - (ordered.length - 1), 0, node);
  doc.layers = flattenTree(tree);
  doc.activeId = folder.id;
  return folder;
}

/** Dissolve a folder: its members move up into the folder it was in, keeping their place. */
export function ungroupFolder(doc: Document, id: number): boolean {
  const tree = layerTree(doc.layers);
  const hit = find(tree, id);
  if (!hit || hit.node.layer.kind !== 'folder') return false;
  for (const c of hit.node.children) c.layer.parent = hit.node.layer.parent;
  hit.list.splice(hit.index, 1, ...hit.node.children);
  doc.layers = flattenTree(tree);
  if (doc.activeId === id) doc.activeId = hit.node.children[hit.node.children.length - 1]?.layer.id ?? doc.layers[0]!.id;
  return true;
}
