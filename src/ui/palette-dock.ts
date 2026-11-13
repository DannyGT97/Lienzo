import { icon } from './icons';
import { foldButton } from './collapsible';
import { parseSizes, splitPair } from './dock-resize';
import { isDrawerLayout, readUiScale } from './ui-scale';
import type { PaletteSpec } from './spec/palettes';

export interface PaletteInstance {
  /** Called when the palette becomes visible or its data may have changed. */
  refresh?: () => void;
}

export type PaletteBuilder = (body: HTMLElement) => PaletteInstance | void;

export interface DockOptions {
  host: HTMLElement;
  groups: string[][];
  specs: Record<string, PaletteSpec>;
  builders: Record<string, PaletteBuilder>;
  visible: Set<string>;
  /** Called after any visibility change (so menus can update their check marks). */
  onChange?: () => void;
  /**
   * What must stay fully in view when a palette is made short, as selectors inside it, top to bottom: the palette is never
   * shorter than the bottom of the last one found (the layer buttons and one layer, say).
   */
  keep?: Record<string, string[]>;
  /** A least height (CSS pixels) for palettes whose content shrinks to fit (the colour wheel). */
  floor?: Record<string, number>;
}

export interface DockApi {
  show(id: string): void;
  hide(id: string): void;
  toggle(id: string): void;
  isVisible(id: string): boolean;
  refresh(id?: string): void;
}

/**
 * A column of palette groups. Palettes in the same group are tabs of one panel; a group disappears when none of its
 * palettes are visible. Palette bodies are built the first time they are shown and then kept (so their controls keep state).
 */
export function mountDock(o: DockOptions): DockApi {
  interface Group {
    ids: string[];
    el: HTMLElement;
    tabs: HTMLElement;
    bodies: Map<string, HTMLElement>;
    active: string | null;
  }
  const instances = new Map<string, PaletteInstance>();
  const groups: Group[] = o.groups.map((ids) => {
    const el = document.createElement('section');
    el.className = 'palette dock-group';
    const tabs = document.createElement('header');
    tabs.className = 'palette-head dock-tabs';
    el.append(tabs);
    o.host.append(el);
    return { ids, el, tabs, bodies: new Map(), active: null };
  });

  const groupOf = (id: string): Group | undefined => groups.find((g) => g.ids.includes(id));

  // ---- heights the person gave the palettes ------------------------------------------------------
  // A palette without a height of its own is as tall as its content. Dragging the splitter under it gives it one (its content
  // then scrolls inside it) and the palette below gives or takes the difference, so the space is shared between neighbours.
  const SIZE_KEY = 'lienzo.dock.heights';
  const sizeKey = (): string => (isDrawerLayout() ? `${SIZE_KEY}.drawer` : SIZE_KEY);
  const loadSizes = (): Record<string, number> => {
    try {
      return parseSizes(localStorage.getItem(sizeKey()));
    } catch {
      return {};
    }
  };
  let sizes = loadSizes();
  const saveSizes = (): void => {
    try {
      localStorage.setItem(sizeKey(), JSON.stringify(sizes));
    } catch {
      // storage may be unavailable: the heights then last for the session
    }
  };
  const sizeId = (g: Group): string => g.ids[0]!;
  /** CSS pixels of an element (the dock is zoomed by the interface scale, which getBoundingClientRect includes). */
  const heightOf = (e: HTMLElement): number => e.getBoundingClientRect().height / readUiScale();
  function applySize(g: Group): void {
    // The last palette takes whatever height the others leave, so it has no height of its own.
    const stored = g.el.classList.contains('fill') ? undefined : sizes[sizeId(g)];
    g.el.classList.toggle('sized', !!stored);
    const px = stored ? Math.max(stored, minHeightOf(g)) : 0;
    g.el.style.height = px ? `${px}px` : '';
    // Content that shrinks to fit (the colour wheel) reads how much room is left below the header from `--dock-room`.
    for (const body of g.bodies.values()) {
      if (px) body.style.setProperty('--dock-room', `${px - heightOf(g.tabs) - 2}px`);
      else body.style.removeProperty('--dock-room');
    }
  }
  /** Run `measure` with the palette as it would be with no height of its own (the class that lets its content scroll is off too). */
  function unsized<T>(g: Group, measure: () => T): T {
    const was = g.el.style.height;
    const floor = g.el.style.minHeight;
    const sized = g.el.classList.contains('sized');
    const fills = g.el.classList.contains('fill');
    g.el.style.height = '';
    g.el.style.minHeight = '';
    g.el.classList.remove('sized', 'fill');
    try {
      return measure();
    } finally {
      g.el.style.height = was;
      g.el.style.minHeight = floor;
      g.el.classList.toggle('sized', sized);
      g.el.classList.toggle('fill', fills);
    }
  }
  /** The height a palette would have with no height of its own: its header and its content. */
  function naturalHeight(g: Group): number {
    const body = g.bodies.get(g.active ?? '');
    const h = unsized(g, () => (body ? heightOf(g.tabs) + body.scrollHeight / readUiScale() + 2 : heightOf(g.el)));
    return h;
  }
  const MIN_HEIGHT = 56;
  /**
   * The least height a palette may be given: enough for its header and what it says must stay in view, and never below the
   * general minimum. Measured with the palette at its natural height, from where the last essential element ends.
   */
  function minHeightOf(g: Group): number {
    const id = g.active ?? '';
    const body = g.bodies.get(id);
    let min = Math.max(MIN_HEIGHT, o.floor?.[id] ?? 0);
    const selectors = o.keep?.[id];
    if (!body || !selectors?.length) return min;
    const scale = readUiScale();
    return Math.ceil(
      unsized(g, () => {
        let bottom = 0;
        for (const sel of selectors) {
          // The one that shows first (a list may run bottom to top, so the first in the document is not always the top one).
          let top: HTMLElement | null = null;
          for (const el of body.querySelectorAll<HTMLElement>(sel)) if (!top || el.getBoundingClientRect().top < top.getBoundingClientRect().top) top = el;
          if (top) bottom = Math.max(bottom, top.getBoundingClientRect().bottom);
        }
        if (bottom <= 0) return min;
        const pad = parseFloat(getComputedStyle(body).paddingBottom) || 0;
        return Math.max(min, (bottom - g.el.getBoundingClientRect().top) / scale + pad + 1);
      }),
    );
  }

  function startSplit(e: PointerEvent, above: Group, below: Group | null): void {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // the pointer may already be gone; the move and up events still reach the handle
    }
    const scale = readUiScale();
    const startY = e.clientY;
    const a0 = heightOf(above.el);
    // The palette below takes part when it has a height of its own, or when it is the one that fills (it gives or takes the room,
    // and cannot be squeezed below its minimum); a folded one keeps its header's height whatever happens above it.
    const belowFills = !!below && below.el.classList.contains('fill');
    const belowSized = below && !isFolded(below) && (belowFills || sizes[sizeId(below)] !== undefined) ? heightOf(below.el) : null;
    // When the palette below shares the room, either may be given more than its content needs (it is only empty space in it); with
    // nothing to share with, the palette above is not made taller than its content.
    const maxA = belowSized !== null ? Infinity : naturalHeight(above);
    const maxB = Infinity;
    const minA = minHeightOf(above);
    const minB = below ? minHeightOf(below) : MIN_HEIGHT;
    handle.classList.add('on');
    const move = (ev: PointerEvent): void => {
      const r = splitPair(a0, belowSized, (ev.clientY - startY) / scale, minA, maxA, maxB, minB);
      sizes[sizeId(above)] = Math.round(r.a);
      applySize(above);
      if (below && r.b !== null && !belowFills) {
        sizes[sizeId(below)] = Math.round(r.b);
        applySize(below);
      }
    };
    const end = (): void => {
      handle.classList.remove('on');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      saveSizes();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  /** The last palette shown fills the dock down to its bottom (its content scrolls inside it), never below its minimum. */
  const roomWatch = new WeakSet<HTMLElement>();
  const isFolded = (g: Group): boolean => g.el.classList.contains('collapsed');
  function markFill(): void {
    // The last palette that is open (a folded one is only its header and cannot take the room).
    const open = groups.filter((g) => !g.el.hidden && !isFolded(g));
    for (const g of groups) {
      const fills = open[open.length - 1] === g;
      g.el.classList.toggle('fill', fills);
      if (!fills) {
        g.el.style.minHeight = '';
        continue;
      }
      g.el.classList.remove('sized');
      g.el.style.height = '';
      g.el.style.minHeight = '';
      g.el.style.minHeight = `${minHeightOf(g)}px`;
      for (const body of g.bodies.values()) {
        if (roomWatch.has(body)) continue;
        roomWatch.add(body);
        // What shrinks to fit (the colour wheel) reads the room from `--dock-room`; a palette that fills has no fixed height to take it from.
        new ResizeObserver(() => {
          if (g.el.classList.contains('fill')) body.style.setProperty('--dock-room', `${body.getBoundingClientRect().height / readUiScale()}px`);
        }).observe(body);
      }
    }
  }

  /** A splitter under every palette that has another palette below it. */
  function placeSplitters(): void {
    for (const s of o.host.querySelectorAll('.dock-splitter')) s.remove();
    const shown = groups.filter((g) => !g.el.hidden);
    shown.forEach((g, n) => {
      const below = shown[n + 1];
      // No handle where dragging would do nothing: under a palette that fills (nothing open below it to share with) or under a folded one.
      if (!below || g.el.classList.contains('fill') || isFolded(g)) return;
      const s = document.createElement('div');
      s.className = 'dock-splitter';
      s.setAttribute('role', 'separator');
      s.title = 'Arrastra para repartir el alto · doble toque: alto automático';
      s.addEventListener('pointerdown', (e) => startSplit(e, g, below));
      s.addEventListener('dblclick', () => {
        delete sizes[sizeId(g)];
        applySize(g);
        saveSizes();
      });
      g.el.after(s);
    });
  }

  function render(g: Group): void {
    const vis = g.ids.filter((id) => o.visible.has(id));
    g.el.hidden = vis.length === 0;
    if (!vis.length) {
      markFill();
      placeSplitters();
      return;
    }
    if (!g.active || !vis.includes(g.active)) g.active = vis[0]!;
    g.tabs.replaceChildren(foldButton(g.el, 'dock:' + g.ids[0]));
    // What sticks under the header (the layer buttons) needs to know how tall the header is.
    const headH = heightOf(g.tabs);
    if (headH > 0) g.el.style.setProperty('--dock-head-h', `${headH}px`);
    for (const id of vis) {
      const spec = o.specs[id]!;
      const b = document.createElement('button');
      b.className = 'dock-tab' + (id === g.active ? ' on' : '');
      b.title = spec.title;
      b.innerHTML = vis.length > 1 ? icon(spec.icon, 15) : '';
      const label = document.createElement('span');
      label.textContent = vis.length > 1 && id !== g.active ? '' : spec.title;
      b.append(label);
      b.addEventListener('click', () => {
        g.active = id;
        render(g);
      });
      g.tabs.append(b);
    }
    for (const id of vis) {
      let body = g.bodies.get(id);
      if (!body) {
        body = document.createElement('div');
        body.className = 'palette-body dock-body';
        body.dataset.palette = id;
        g.bodies.set(id, body);
        g.el.append(body);
        const inst = o.builders[id]?.(body);
        if (inst) instances.set(id, inst);
      }
      body.hidden = id !== g.active;
    }
    for (const [id, body] of g.bodies) if (!vis.includes(id)) body.hidden = true;
    markFill();
    placeSplitters();
    applySize(g);
    instances.get(g.active)?.refresh?.();
  }

  const api: DockApi = {
    show(id) {
      o.visible.add(id);
      const g = groupOf(id);
      if (g) {
        g.active = id;
        render(g);
      }
      o.onChange?.();
    },
    hide(id) {
      o.visible.delete(id);
      const g = groupOf(id);
      if (g) render(g);
      o.onChange?.();
    },
    toggle(id) {
      if (o.visible.has(id)) api.hide(id);
      else api.show(id);
    },
    isVisible: (id) => o.visible.has(id),
    refresh(id) {
      if (id) {
        instances.get(id)?.refresh?.();
        return;
      }
      for (const g of groups) if (g.active && !g.el.hidden) instances.get(g.active)?.refresh?.();
    },
  };

  // Folding or unfolding a palette changes which one fills the dock and where the handles belong.
  const wasFolded = new Map<Group, boolean>(groups.map((g) => [g, false]));
  const watchFold = new MutationObserver(() => {
    let changed = false;
    for (const g of groups) {
      const now = isFolded(g);
      if (wasFolded.get(g) !== now) {
        wasFolded.set(g, now);
        changed = true;
      }
    }
    if (!changed) return;
    markFill();
    placeSplitters();
    for (const g of groups) if (!g.el.hidden) applySize(g);
  });
  for (const g of groups) watchFold.observe(g.el, { attributes: true, attributeFilter: ['class'] });
  for (const g of groups) render(g);
  return api;
}
