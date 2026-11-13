import { isDrawerLayout, onLayoutModeChange, readUiScale } from './ui-scale';

type DockSide = 'left' | 'right';

/**
 * Widest a drawer gets, in the dock's own pixels (the same rule as `--drawer-cap` in studio.css): half the window, or
 * 380 screen pixels when that is more, but never under a usable 260 own pixels. `viewportWidth` is in own pixels too.
 */
export function drawerCap(viewportWidth: number, scale: number): number {
  return Math.max(Math.max(380, 0.5 * viewportWidth * scale) / scale, 260);
}

/** Keeps a useful canvas area on desktop and keeps drawers inside the viewport (and under the cap) on small screens. */
export function limitDockWidth(width: number, viewportWidth: number, otherWidth: number, drawer: boolean, scale = 1): number {
  const max = drawer ? Math.min(Math.max(200, viewportWidth - 40), drawerCap(viewportWidth, scale)) : Math.max(220, viewportWidth - otherWidth - 360);
  const min = Math.min(drawer ? 260 : 200, max);
  return Math.round(Math.min(max, Math.max(min, width)));
}

/** Narrowest the tool strip gets with mouse-sized buttons: one column of icon buttons with a few pixels either side. */
const TOOL_STRIP_MIN = 50;

/** Width one icon column needs, given the narrowest strip (one button column plus a few pixels either side). */
function toolCellWidth(stripMin: number): number {
  return stripMin - 6;
}

/**
 * Icon columns that fit a tool strip of this width: one until two cells fit, then one more per cell, up to four.
 * `stripMin` is the narrowest strip the buttons allow, which grows with the touch minimum at small interface scales.
 */
export function toolColumnCount(width: number, stripMin = TOOL_STRIP_MIN): number {
  const cell = toolCellWidth(stripMin);
  return width < 2 * cell + 8 ? 1 : Math.min(4, Math.max(2, Math.floor((width - 8) / cell)));
}

/** Width the subtool panel keeps beside a wider tool strip: more in a drawer, where its cards would otherwise be cut off. */
const SUBDOCK_MIN = 140;
const SUBDOCK_MIN_DRAWER = 180;

/**
 * Keeps the subtool panel usable while allowing the tool strip to open a second icon column. With the panel folded
 * away the strip is the whole dock, so only its own columns limit it.
 */
export function limitToolColumnWidth(width: number, dockWidth: number, alone = false, reserve = SUBDOCK_MIN, stripMin = TOOL_STRIP_MIN): number {
  // On its own the strip stops at four icon columns.
  const max = alone ? 4 * toolCellWidth(stripMin) + 8 : Math.max(stripMin, dockWidth - reserve);
  return Math.round(Math.min(max, Math.max(stripMin, width)));
}

/** Allows resizing the tool and palette docks without putting pointer handlers over the canvas. */
export function mountLayoutResizers(): void {
  const app = document.getElementById('app');
  const leftDock = document.getElementById('leftdock');
  const rightDock = document.getElementById('rightdock');
  const toolCol = document.getElementById('toolcol');
  if (!app || !leftDock || !rightDock || !toolCol) return;

  const root = document.documentElement;
  // The docks are zoomed by the interface scale, so every width here is in the docks' own (unscaled) pixels, as the CSS
  // variables are; rects and pointer positions are on screen and get divided by the scale.
  const initialWidth = (side: DockSide): number => {
    // In the grid the width may come from clamp(), so read the rendered dock instead of the variable.
    if (!isDrawerLayout()) {
      const rendered = (side === 'left' ? leftDock : rightDock).getBoundingClientRect().width / readUiScale();
      if (rendered > 0) return Math.round(rendered);
    }
    const variable = isDrawerLayout() ? `--drawer-${side}-width` : `--dock-${side}`;
    const value = Number.parseFloat(getComputedStyle(root).getPropertyValue(variable));
    return Number.isFinite(value) ? value : side === 'left' ? 286 : 286;
  };

  function resize(side: DockSide, width: number): number {
    const drawer = isDrawerLayout();
    const otherSide: DockSide = side === 'left' ? 'right' : 'left';
    const otherWidth = initialWidth(otherSide);
    const scale = readUiScale();
    const next = limitDockWidth(width, window.innerWidth / scale, otherWidth, drawer, scale);
    root.style.setProperty(drawer ? `--drawer-${side}-width` : `--dock-${side}`, `${next}px`);
    return next;
  }

  function makeHandle(side: DockSide, drawer: boolean): HTMLDivElement {
    const handle = document.createElement('div');
    handle.className = `layout-resizer ${drawer ? 'drawer-resizer' : 'grid-resizer'} ${side}-resizer`;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', side === 'left' ? 'Ajustar ancho del panel de herramientas' : 'Ajustar ancho del panel de paletas');
    handle.title = 'Arrastra para cambiar el ancho; usa las flechas del teclado para ajustar';
    handle.setAttribute('aria-valuemin', drawer ? '200' : '200');
    const scale = readUiScale();
    const viewport = window.innerWidth / scale;
    handle.setAttribute('aria-valuemax', drawer ? String(limitDockWidth(Infinity, viewport, 0, true, scale)) : String(Math.max(220, viewport - 580)));
    handle.setAttribute('aria-valuenow', String(initialWidth(side)));
    handle.tabIndex = 0;

    let startX = 0;
    let startWidth = 0;
    let pointerId: number | null = null;
    const fromPointer = (clientX: number): number =>
      resize(side, startWidth + (side === 'left' ? clientX - startX : startX - clientX) / readUiScale());

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      pointerId = event.pointerId;
      startX = event.clientX;
      startWidth = initialWidth(side);
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('dragging');
    });
    handle.addEventListener('pointermove', (event) => {
      if (pointerId !== event.pointerId) return;
      handle.setAttribute('aria-valuenow', String(fromPointer(event.clientX)));
    });
    const endDrag = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      handle.classList.remove('dragging');
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
    handle.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey ? 32 : 8;
      const direction = side === 'left' ? 1 : -1;
      const width = initialWidth(side);
      const next = event.key === 'Home' ? 200 : event.key === 'End' ? window.innerWidth / readUiScale() : width + (event.key === 'ArrowRight' ? step * direction : -step * direction);
      handle.setAttribute('aria-valuenow', String(resize(side, next)));
    });
    return handle;
  }

  app.style.position = 'relative';
  app.append(makeHandle('left', false), makeHandle('right', false));
  leftDock.append(makeHandle('left', true));
  rightDock.append(makeHandle('right', true));

  const toolHandle = document.createElement('div');
  toolHandle.className = 'layout-resizer toolcol-resizer';
  toolHandle.setAttribute('role', 'separator');
  toolHandle.setAttribute('aria-orientation', 'vertical');
  toolHandle.setAttribute('aria-label', 'Ajustar ancho de la barra de herramientas');
  toolHandle.title = 'Arrastra para ampliar la barra; al ensancharla aparecen más columnas de iconos';
  toolHandle.tabIndex = 0;
  toolCol.append(toolHandle);

  const toolWidth = (): number => toolCol.getBoundingClientRect().width / readUiScale();
  const leftDockWidth = (): number => leftDock.getBoundingClientRect().width / readUiScale();
  // The stylesheet owns the narrowest strip (its buttons grow with the touch minimum at small scales); `min-width` is
  // what the browser resolves it to, in the strip's own pixels.
  const stripMin = (): number => {
    const value = Number.parseFloat(getComputedStyle(toolCol).minWidth);
    return Number.isFinite(value) ? Math.max(TOOL_STRIP_MIN, value) : TOOL_STRIP_MIN;
  };
  const setColumns = (width: number): void => {
    const n = toolColumnCount(width, stripMin());
    toolCol.dataset.columns = String(n);
    toolCol.style.setProperty('--tp-cols', String(n));
  };
  const alone = (): boolean => document.body.classList.contains('subdock-collapsed');
  const reserve = (): number => (isDrawerLayout() ? SUBDOCK_MIN_DRAWER : SUBDOCK_MIN);
  const toolMax = (): number => limitToolColumnWidth(Infinity, leftDockWidth(), alone(), reserve(), stripMin());
  // The width the person dragged the strip to; until then the stylesheet sets it (and follows the interface scale).
  let chosenWidth: number | null = null;
  const setToolWidth = (width: number, fromPerson = false): number => {
    const next = limitToolColumnWidth(width, leftDockWidth(), alone(), reserve(), stripMin());
    if (fromPerson) chosenWidth = next;
    toolCol.style.width = `${next}px`;
    setColumns(next);
    toolHandle.setAttribute('aria-valuemin', String(stripMin()));
    toolHandle.setAttribute('aria-valuenow', String(next));
    toolHandle.setAttribute('aria-valuemax', String(toolMax()));
    return next;
  };
  // The window, the scale or the folded panel changed: keep the person's width inside the new limits, or let the
  // stylesheet size the strip again when they never chose one.
  const refreshToolWidth = (): void => {
    if (chosenWidth === null) {
      toolCol.style.removeProperty('width');
      setColumns(toolWidth());
      toolHandle.setAttribute('aria-valuemin', String(stripMin()));
      toolHandle.setAttribute('aria-valuenow', String(Math.round(toolWidth())));
      toolHandle.setAttribute('aria-valuemax', String(toolMax()));
    } else setToolWidth(chosenWidth);
  };
  refreshToolWidth();
  // Folding the subtool panel away makes the strip the whole dock: bring it back inside its own limit.
  new MutationObserver(refreshToolWidth).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  // The dock itself changes size with the window and between grid and drawer layouts.
  onLayoutModeChange(refreshToolWidth);
  window.addEventListener('resize', refreshToolWidth);

  let toolStartX = 0;
  let toolStartWidth = 0;
  let toolPointerId: number | null = null;
  toolHandle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    toolPointerId = event.pointerId;
    toolStartX = event.clientX;
    toolStartWidth = toolWidth();
    toolHandle.setPointerCapture(event.pointerId);
    toolHandle.classList.add('dragging');
  });
  toolHandle.addEventListener('pointermove', (event) => {
    if (toolPointerId !== event.pointerId) return;
    setToolWidth(toolStartWidth + (event.clientX - toolStartX) / readUiScale(), true);
  });
  const finishToolResize = (event: PointerEvent): void => {
    if (toolPointerId !== event.pointerId) return;
    toolPointerId = null;
    toolHandle.classList.remove('dragging');
    if (toolHandle.hasPointerCapture(event.pointerId)) toolHandle.releasePointerCapture(event.pointerId);
  };
  toolHandle.addEventListener('pointerup', finishToolResize);
  toolHandle.addEventListener('pointercancel', finishToolResize);
  toolHandle.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 32 : 8;
    const current = toolWidth();
    const next = event.key === 'Home' ? stripMin() : event.key === 'End' ? toolMax() : current + (event.key === 'ArrowRight' ? step : -step);
    setToolWidth(next, true);
  });
}
