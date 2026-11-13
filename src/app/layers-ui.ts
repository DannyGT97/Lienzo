import type { BlendMode } from '../engine/blend';
import { layerMaskAt } from '../engine/composite';
import { newLayer, removeLayer, type Document, type Layer, type LayerKind, type LayerRole } from '../engine/document';
import type { Command } from '../engine/history';
import { duplicateLayer } from '../engine/layer-ops';
import { descendants, groupLayers, layerTree, moveLayer, moveLayerTo, normalizeLayers, ungroupFolder, type TreeNode } from '../engine/layer-tree';
import { applyMask, createMask, deleteMask, selectionFromMask, setMaskEnabled, type NewMask } from '../engine/mask-ops';
import { mergeVisible, type MergeScope } from '../engine/merge-ops';
import { Selection, selectionFromAlpha, type CombineMode } from '../engine/selection';
import { commands } from '../ui/commands';
import { icon } from '../ui/icons';

export interface LayersUiDeps {
  doc: () => Document;
  list: HTMLElement;
  /** The small picture of a layer's pixels (cached by the caller). */
  thumb: (layer: Layer) => HTMLCanvasElement;
  labels: Record<BlendMode, string>;
  kindLabel: Record<LayerKind, string>;
  /** Make a change of the layer structure undoable and redraw. */
  edit: (label: string, change: () => void, redraw?: boolean) => void;
  /** Hand over a history step that has already been applied. */
  push: (cmd: Command | null) => void;
  refresh: () => void;
  rename: (layer: Layer) => void;
  selection: () => Selection | null;
  replaceSelection: (sel: Selection | null, label: string) => void;
}

const MASK_THUMB = 28;

/** The layer palette's list (a tree with folders), layer masks, draft/reference roles and the commands around them. */
export function createLayersUi(d: LayersUiDeps): {
  readonly editingMask: boolean;
  setEditingMask(on: boolean): void;
  renderList(): void;
  drawMaskThumbs(): void;
  addFolder(): void;
  addLayerAbove(name: string, kind?: LayerKind): Layer;
  register(): void;
  /** The layers a palette action applies to: the ticked ones, or just the active layer when none is ticked. */
  targets(): Layer[];
  /** Ids of the ticked layers (empty when none is ticked). */
  tickedIds(): number[];
  /** Tick exactly these layers of the open document (the rest are cleared); the list is not redrawn. */
  tickOnly(ids: readonly number[]): void;
  deleteTargets(): boolean;
  duplicateTargets(): void;
  groupTargets(): void;
  toggleLockTargets(): void;
  toggleDraftTargets(): void;
  /** Raise (+1) or lower (-1) the targets one place in their folders, keeping their order; each stops at its own limit. */
  moveTargets(delta: 1 | -1): void;
  /** Whether at least one target could move one place in that direction. */
  canMoveTargets(delta: 1 | -1): boolean;
  /** Make the active layer the one reference layer (or clear it); selection plays no part. */
  toggleReference(): void;
} {
  let editingMask = false;
  /** Layers ticked in the selection column (multi-selection); independent of the active layer, visibility and role. */
  // Layer ids repeat from one document to the next, so every document (tab) keeps its own ticks.
  const tickSets = new WeakMap<Document, Set<number>>();
  const checkedOf = (doc: Document): Set<number> => {
    let s = tickSets.get(doc);
    if (!s) tickSets.set(doc, (s = new Set()));
    return s;
  };
  const checked = {
    has: (id: number): boolean => checkedOf(d.doc()).has(id),
    add: (id: number): void => void checkedOf(d.doc()).add(id),
    delete: (id: number): boolean => checkedOf(d.doc()).delete(id),
    clear: (): void => checkedOf(d.doc()).clear(),
    ids: (): number[] => [...checkedOf(d.doc())],
  };
  const maskThumbs = new Map<Layer, HTMLCanvasElement>();
  const active = (): Layer => {
    const doc = d.doc();
    return doc.layers.find((l) => l.id === doc.activeId) ?? doc.layers[0]!;
  };

  // ---- multi-selection ----------------------------------------------------------------------------
  const ticked = (): Layer[] => d.doc().layers.filter((l) => checked.has(l.id));
  const tickedIds = (): number[] => ticked().map((l) => l.id);
  const tickOnly = (ids: readonly number[]): void => {
    checked.clear();
    for (const id of ids) checked.add(id);
  };
  const targets = (): Layer[] => {
    const t = ticked();
    return t.length ? t : [active()];
  };
  /** Targets without those already inside a targeted folder (a folder carries its members along). */
  const roots = (ls: Layer[]): Layer[] => {
    const ids = new Set(ls.map((l) => l.id));
    const doc = d.doc();
    const inside = (l: Layer): boolean => {
      for (let p = l.parent; p !== null; p = doc.layers.find((x) => x.id === p)?.parent ?? null) if (ids.has(p)) return true;
      return false;
    };
    return ls.filter((l) => !inside(l));
  };

  function deleteTargets(): boolean {
    const doc = d.doc();
    const ids = roots(targets()).map((l) => l.id);
    if (!ids.length || doc.layers.length <= 1) return false;
    checked.clear();
    d.edit(ids.length > 1 ? 'Borrar capas' : 'Borrar capa', () => {
      for (const id of ids) removeLayer(doc, id);
    });
    return true;
  }

  function duplicateTargets(): void {
    const doc = d.doc();
    const ids = roots(targets()).map((l) => l.id);
    checked.clear();
    d.edit(ids.length > 1 ? 'Duplicar capas' : 'Duplicar capa', () => {
      for (const id of ids) duplicateLayer(doc, id);
    });
  }

  function groupTargets(): void {
    const doc = d.doc();
    const ids = roots(targets()).map((l) => l.id);
    checked.clear();
    d.edit('Insertar capa en una carpeta nueva', () => void groupLayers(doc, ids, `Carpeta ${doc.nextId}`));
  }

  /** Set the flag on all targets, or clear it when they all have it already. */
  function toggleLockTargets(): void {
    const ls = targets();
    const lock = !ls.every((l) => l.locked);
    d.edit(lock ? 'Bloquear capa' : 'Desbloquear capa', () => ls.forEach((l) => (l.locked = lock)), false);
  }

  function toggleDraftTargets(): void {
    const ls = targets();
    const to: LayerRole = ls.every((l) => l.role === 'draft') ? 'normal' : 'draft';
    d.edit(to === 'draft' ? 'Capa de borrador' : 'Capa normal', () => ls.forEach((l) => (l.role = to)));
  }

  /** There is at most one reference layer: choosing another one silently takes the role from the previous one. */
  function toggleReference(): void {
    const doc = d.doc();
    const layer = active();
    const on = layer.role !== 'reference';
    d.edit(on ? 'Capa de referencia' : 'Capa normal', () => {
      for (const l of doc.layers) if (l.role === 'reference') l.role = 'normal';
      if (on) layer.role = 'reference';
    });
  }

  /** Neighbour of a layer among the layers of its own folder, `delta` places up the stack. */
  function neighbour(l: Layer, delta: number): Layer | undefined {
    const sibs = d.doc().layers.filter((x) => x.parent === l.parent);
    return sibs[sibs.indexOf(l) + delta];
  }

  function canMoveTargets(delta: 1 | -1): boolean {
    const ls = roots(targets());
    const ids = new Set(ls.map((l) => l.id));
    return ls.some((l) => {
      const n = neighbour(l, delta);
      return !!n && !ids.has(n.id);
    });
  }

  function moveTargets(delta: 1 | -1): void {
    const doc = d.doc();
    const ls = roots(targets());
    if (!canMoveTargets(delta)) return;
    const ids = new Set(ls.map((l) => l.id));
    d.edit(ls.length > 1 ? (delta > 0 ? 'Subir capas' : 'Bajar capas') : delta > 0 ? 'Subir capa' : 'Bajar capa', () => {
      // The ones in front go first, so a block of layers moves as a block and a layer at the edge holds back the ones behind it.
      for (const l of delta > 0 ? [...ls].reverse() : ls) {
        const n = neighbour(l, delta);
        if (n && !ids.has(n.id)) moveLayer(doc, l.id, delta);
      }
    });
  }

  /** Send the targets to the top or the bottom of their folders, keeping their order. */
  function reorderTargets(to: 'top' | 'bottom'): void {
    const doc = d.doc();
    const ls = roots(targets());
    d.edit('Cambiar el orden de las capas', () => {
      for (const l of to === 'top' ? ls : [...ls].reverse()) moveLayerTo(doc, l.id, l.parent, to === 'top' ? Infinity : 0);
    });
  }

  function toggleChecked(layer: Layer): void {
    if (!checked.delete(layer.id)) checked.add(layer.id);
    // What the commands and controls apply to changed: their enabled state must follow, not just the list.
    d.refresh();
  }

  // ---- the list ---------------------------------------------------------------------------------
  /**
   * Rows in the order of the layer list (bottom of the stack first; the list is drawn bottom-up, so the top layer
   * shows first). A folder follows its members, and those of a closed folder are left out.
   */
  function rows(): { layer: Layer; depth: number }[] {
    const out: { layer: Layer; depth: number }[] = [];
    const walk = (nodes: TreeNode[], depth: number): void => {
      for (const n of nodes) {
        if (n.layer.kind === 'folder' && n.layer.open) walk(n.children, depth + 1);
        out.push({ layer: n.layer, depth });
      }
    };
    walk(layerTree(d.doc().layers), 0);
    return out;
  }

  function maskThumb(layer: Layer): HTMLCanvasElement {
    let c = maskThumbs.get(layer);
    if (!c) {
      c = document.createElement('canvas');
      c.className = 'lthumb lmask';
      maskThumbs.set(layer, c);
    }
    paintMaskThumb(layer, c);
    return c;
  }

  function paintMaskThumb(layer: Layer, c: HTMLCanvasElement): void {
    const doc = d.doc();
    const k = MASK_THUMB / Math.max(doc.width, doc.height);
    c.width = Math.max(1, Math.round(doc.width * k));
    c.height = Math.max(1, Math.round(doc.height * k));
    const img = new ImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const v = layerMaskAt(layer, Math.min(doc.width - 1, Math.floor((x + 0.5) / k)), Math.min(doc.height - 1, Math.floor((y + 0.5) / k))) * 255;
        const i = (y * c.width + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    c.getContext('2d')!.putImageData(img, 0, 0);
  }

  function drawMaskThumbs(): void {
    for (const [layer, c] of maskThumbs) {
      if (layer.mask && c.isConnected) paintMaskThumb(layer, c);
    }
  }

  function renderList(): void {
    const doc = d.doc();
    if (editingMask && !active().mask) editingMask = false;
    d.list.replaceChildren();
    for (const l of [...maskThumbs.keys()]) if (!doc.layers.includes(l)) maskThumbs.delete(l);
    for (const id of checked.ids()) if (!doc.layers.some((l) => l.id === id)) checked.delete(id);
    for (const { layer, depth } of rows()) {
      const li = document.createElement('li');
      li.dataset.id = String(layer.id);
      const isActive = layer.id === doc.activeId;
      li.className = [isActive ? 'active' : '', layer.visible ? '' : 'hidden-layer', layer.kind === 'folder' ? 'folder-row' : '', layer.role !== 'normal' ? `role-${layer.role}` : '', checked.has(layer.id) ? 'checked' : ''].filter(Boolean).join(' ');
      li.style.setProperty('--depth', String(depth));

      const eye = document.createElement('button');
      eye.className = 'eye' + (layer.visible ? '' : ' off');
      eye.title = layer.visible ? 'Ocultar capa' : 'Mostrar capa';
      eye.innerHTML = icon(layer.visible ? 'eye' : 'eye-off', 16);
      eye.addEventListener('click', (e) => {
        e.stopPropagation();
        d.edit(layer.visible ? 'Ocultar capa' : 'Mostrar capa', () => (layer.visible = !layer.visible));
      });

      // Second column: the selection box. It only ticks the layer for multi-selection; the reference role has its own
      // button in the palette and its own flag in the row.
      const isChecked = checked.has(layer.id);
      const sel = document.createElement('button');
      sel.className = 'lsel' + (isChecked ? ' on' : '');
      sel.setAttribute('role', 'checkbox');
      sel.setAttribute('aria-checked', String(isChecked));
      sel.setAttribute('aria-label', `Seleccionar ${layer.name}`);
      sel.title = isChecked ? 'Quitar de la selección múltiple' : 'Añadir a la selección múltiple';
      sel.innerHTML = isChecked ? icon('check', 16) : '';
      sel.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleChecked(layer);
      });

      const arrow = document.createElement('button');
      arrow.className = 'lfold' + (layer.kind === 'folder' ? '' : ' none');
      if (layer.kind === 'folder') {
        arrow.innerHTML = icon(layer.open ? 'chevron-down' : 'chevron', 14);
        arrow.title = layer.open ? 'Cerrar la carpeta' : 'Abrir la carpeta';
        arrow.addEventListener('click', (e) => {
          e.stopPropagation();
          layer.open = !layer.open;
          d.refresh();
        });
      }

      let pic: HTMLElement;
      if (layer.kind === 'folder') {
        pic = document.createElement('span');
        pic.className = 'lthumb lfolder-icon';
        pic.innerHTML = icon('folder', 24);
      } else {
        pic = d.thumb(layer);
      }
      if (layer.mask && !editingMask && isActive) pic.classList.add('editing');
      pic.addEventListener('click', () => {
        if (editingMask && layer.id === doc.activeId) {
          editingMask = false;
          d.refresh();
        }
      });

      const text = document.createElement('span');
      text.className = 'ltext';
      const info = document.createElement('span');
      info.className = 'linfo';
      const mode = layer.kind === 'folder' && layer.through ? 'Pasar a través' : d.labels[layer.blend];
      // The text can shrink with an ellipsis; the flags after it keep their own box, so a narrow row never squeezes them.
      const modeText = document.createElement('span');
      modeText.className = 'lmode';
      modeText.textContent = `${Math.round(layer.opacity * 100)} % ${mode}`;
      info.append(modeText);
      if (layer.role === 'reference') info.insertAdjacentHTML('beforeend', `<span class="lflag ref" title="Capa de referencia">${icon('reference', 16)}</span>`);
      if (layer.role === 'draft') info.insertAdjacentHTML('beforeend', `<span class="lflag draft" title="Capa de borrador">${icon('draft', 16)}</span>`);
      if (layer.locked) info.insertAdjacentHTML('beforeend', `<span class="lflag" title="Capa bloqueada">${icon('lock', 16)}</span>`);
      if (layer.lockAlpha) info.insertAdjacentHTML('beforeend', `<span class="lflag" title="Transparencia bloqueada">${icon('lock-alpha', 16)}</span>`);
      if (d.kindLabel[layer.kind]) info.insertAdjacentHTML('beforeend', `<small>${d.kindLabel[layer.kind]}</small>`);
      const name = document.createElement('span');
      name.className = 'lname';
      name.textContent = layer.name;
      name.addEventListener('dblclick', () => d.rename(layer));
      text.append(info, name);

      const handle = document.createElement('span');
      handle.className = 'lhandle';
      handle.title = 'Arrastra para reordenar o meter la capa en una carpeta';
      handle.textContent = '≡';
      handle.addEventListener('pointerdown', (e) => startDrag(e, layer, handle));

      // The bar in front of the thumbnail lights up when the layer is clipped to the one below (as in Clip Studio); the
      // empty slot keeps every thumbnail on the same column.
      const clipBar = document.createElement('span');
      clipBar.className = 'lclip' + (layer.clip ? ' on' : '');
      if (layer.clip) clipBar.title = 'Ajustada a la capa inferior';
      li.append(eye, sel, arrow, clipBar, pic);
      if (layer.mask) {
        const m = maskThumb(layer);
        m.classList.toggle('editing', editingMask && isActive);
        m.classList.toggle('off', !layer.mask.enabled);
        m.title = layer.mask.enabled ? 'Máscara de capa (clic para dibujar en ella)' : 'Máscara desactivada';
        m.addEventListener('click', (e) => {
          e.stopPropagation();
          doc.activeId = layer.id;
          editingMask = true;
          d.refresh();
        });
        li.append(m);
      }
      li.append(text, handle);
      li.style.paddingLeft = `calc(2px + var(--depth) * 14px)`;
      li.addEventListener('click', () => {
        if (doc.activeId !== layer.id) editingMask = false;
        doc.activeId = layer.id;
        d.refresh();
      });
      d.list.append(li);
    }
  }

  // ---- drag to reorder ----------------------------------------------------------------------------
  type Zone = 'above' | 'below' | 'into';

  function startDrag(e: PointerEvent, layer: Layer, handle: HTMLElement): void {
    e.preventDefault();
    e.stopPropagation();
    const doc = d.doc();
    handle.setPointerCapture(e.pointerId);
    // Dragging a ticked layer drags every ticked one with it (a folder carries its own members).
    const moving = checked.has(layer.id) ? roots(ticked()) : [layer];
    const blocked = new Set<number>(moving.flatMap((l) => [l.id, ...descendants(doc, l.id).map((x) => x.id)]));
    let hit: { li: HTMLElement; zone: Zone; target: Layer } | null = null;
    const clear = (): void => d.list.querySelectorAll('.drop-above,.drop-below,.drop-into').forEach((el) => el.classList.remove('drop-above', 'drop-below', 'drop-into'));
    const move = (ev: PointerEvent): void => {
      clear();
      hit = null;
      const li = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('#layer-list li[data-id]');
      if (!li) return;
      const target = doc.layers.find((l) => l.id === Number(li.dataset.id));
      if (!target || blocked.has(target.id)) return;
      const r = li.getBoundingClientRect();
      const f = (ev.clientY - r.top) / r.height;
      const zone: Zone = target.kind === 'folder' && f > 0.28 && f < 0.72 ? 'into' : f < 0.5 ? 'above' : 'below';
      li.classList.add(`drop-${zone}`);
      hit = { li, zone, target };
    };
    const end = (ev: PointerEvent): void => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      move(ev);
      const h = hit as { li: HTMLElement; zone: Zone; target: Layer } | null;
      clear();
      if (!h || ev.type === 'pointercancel') return;
      d.edit(moving.length > 1 ? 'Mover capas' : 'Mover capa', () => {
        let placed = 0;
        for (const l of moving) {
          if (h.zone === 'into') {
            moveLayerTo(doc, l.id, h.target.id, Infinity);
            continue;
          }
          const parent = h.target.parent;
          const sibs = doc.layers.filter((x) => x.parent === parent && x.id !== l.id);
          const k = sibs.indexOf(h.target);
          moveLayerTo(doc, l.id, parent, h.zone === 'above' ? k + 1 + placed : k);
          placed++;
        }
        if (h.zone === 'into') h.target.open = true;
      });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  // ---- layers, folders, roles ------------------------------------------------------------------------
  /** A new layer right above the active one, in the same folder (inside it when a folder is active). */
  function addLayerAbove(name: string, kind: LayerKind = 'raster'): Layer {
    const doc = d.doc();
    const cur = active();
    const layer = newLayer(doc, name, kind);
    if (cur.kind === 'folder' && cur.open) {
      layer.parent = cur.id;
      doc.layers.splice(doc.layers.indexOf(cur), 0, layer);
    } else {
      layer.parent = cur.parent;
      doc.layers.splice(doc.layers.indexOf(cur) + 1, 0, layer);
    }
    normalizeLayers(doc);
    doc.activeId = layer.id;
    return layer;
  }

  function addFolder(): void {
    d.edit(
      'Nueva carpeta',
      () => {
        const doc = d.doc();
        const cur = active();
        const f = newLayer(doc, `Carpeta ${doc.nextId}`, 'folder');
        f.parent = cur.parent;
        doc.layers.splice(doc.layers.indexOf(cur) + 1, 0, f);
        normalizeLayers(doc);
        doc.activeId = f.id;
      },
      false,
    );
  }

  // ---- masks ----------------------------------------------------------------------------------------------
  const hasSel = (): boolean => !!d.selection();
  const canMask = (): boolean => {
    const l = active();
    return !l.mask && l.kind !== 'paper';
  };

  function newMask(mode: NewMask): void {
    const l = active();
    d.push(createMask(d.doc(), l.id, mode, d.selection()));
    editingMask = true;
    d.refresh();
  }

  function selectFromLayer(mode: CombineMode, from: 'pixels' | 'mask'): void {
    const doc = d.doc();
    const l = active();
    const shape = from === 'mask' ? selectionFromMask(doc, l) : selectionFromAlpha(l.surface);
    if (!shape || shape.isEmpty) return;
    const cur = d.selection();
    if (mode === 'replace' || !cur) {
      d.replaceSelection(mode === 'subtract' || mode === 'intersect' ? null : shape, 'Selección desde capa');
      return;
    }
    const base = cur.clone();
    base.combine(shape, mode);
    d.replaceSelection(base, 'Selección desde capa');
  }

  const merge = (scope: MergeScope, keep: boolean): void => d.push(mergeVisible(d.doc(), scope, keep));

  function register(): void {
    const doc = d.doc;
    const toggle = (id: string, run: () => void, checked?: () => boolean, enabled?: () => boolean): void => commands.register(id, { run, ...(checked ? { checked } : {}), ...(enabled ? { enabled } : {}) });
    commands.register('layerfoldernew', addFolder);
    toggle('layerfoldernewandinsert', groupTargets);
    toggle('layercancelfolder', () => {
      const l = active();
      const f = l.kind === 'folder' ? l : doc().layers.find((x) => x.id === l.parent);
      if (f) d.edit('Deshacer carpeta de capas', () => void ungroupFolder(doc(), f.id));
    }, undefined, () => active().kind === 'folder' || active().parent !== null);
    toggle('layershowallmask', () => newMask('show'), undefined, canMask);
    toggle('layeroutmask', () => newMask('selection'), undefined, () => canMask() && hasSel());
    toggle('layerinmask', () => newMask('outside'), undefined, () => canMask() && hasSel());
    toggle('layerdeletemask', () => d.push(deleteMask(doc(), active().id)), undefined, () => !!active().mask);
    toggle('layerapplymask', () => d.push(applyMask(doc(), active().id)), undefined, () => !!active().mask && active().kind !== 'folder');
    toggle('layervisiblemask', () => d.push(setMaskEnabled(doc(), active().id, !active().mask!.enabled)), () => !!active().mask?.enabled, () => !!active().mask);
    toggle('layerchangereferlayer', toggleReference, () => active().role === 'reference');
    toggle('layerchangedraftlayer', toggleDraftTargets, () => active().role === 'draft');
    toggle('layerordertop', () => reorderTargets('top'));
    toggle('layerorderbottom', () => reorderTargets('bottom'));
    toggle('layerselectupperlayer', () => step(1));
    toggle('layerselectlowerlayer', () => step(-1));
    for (const [id, mode] of [['layerselectfromlayernew', 'replace'], ['layerselectfromlayeradd', 'add'], ['layerselectfromlayersubtract', 'subtract'], ['layerselectfromlayermultiply', 'intersect']] as const) {
      toggle(id, () => selectFromLayer(mode, 'pixels'), undefined, () => active().kind !== 'folder');
    }
    toggle('layermergevisiblelayer', () => merge('visible', false));
    toggle('layermergevisiblelayercopy', () => merge('visible', true));
    toggle('layermergealllayer', () => merge('all', false));
    toggle('layerselectfrommask', () => selectFromLayer('replace', 'mask'), undefined, () => !!active().mask);
  }

  function step(delta: number): void {
    const doc = d.doc();
    const shown = rows().map((r) => r.layer);
    const i = shown.findIndex((l) => l.id === doc.activeId);
    const next = shown[i + delta];
    if (next) {
      doc.activeId = next.id;
      editingMask = false;
      d.refresh();
    }
  }

  return {
    get editingMask() {
      return editingMask;
    },
    setEditingMask(on: boolean) {
      editingMask = on && !!active().mask;
    },
    renderList,
    drawMaskThumbs,
    addFolder,
    addLayerAbove,
    register,
    targets,
    tickedIds,
    tickOnly,
    deleteTargets,
    duplicateTargets,
    groupTargets,
    toggleLockTargets,
    toggleDraftTargets,
    moveTargets,
    canMoveTargets,
    toggleReference,
  };
}
