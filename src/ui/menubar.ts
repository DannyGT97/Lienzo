import { commands } from './commands';
import { icon } from './icons';
import { trackHighlight } from './menu-highlight';
import { MENUS, dynamicMenus, type MenuEntry } from './spec/menus';
import { onTouchUi, touchUi } from './touch-mode';
import { isDrawerLayout, onLayoutModeChange, readUiScale } from './ui-scale';

/**
 * Menu bar with nested drop-down panels. Entries whose command has no handler are shown disabled, so the whole
 * structure is visible long before every feature exists. Works with mouse, touch (tap) and keyboard (Esc); a menu opens only when its button is clicked.
 */
export function mountMenuBar(host: HTMLElement): { openAll: () => void } {
  // Narrow window, or the touch layout on a tablet-sized one: menus open as one full-width list.
  const NARROW = window.matchMedia('(max-width: 860px)');
  // The 860 px query is a device width; the docks' own layout (drawers) follows the interface scale.
  const COMPACT = { get matches(): boolean { return NARROW.matches || window.innerWidth / readUiScale() <= 860 || (touchUi() && isDrawerLayout()); } };
  let panels: HTMLElement[] = [];
  let openButton: HTMLElement | null = null;

  const closeAll = (): void => {
    for (const p of panels) p.remove();
    panels = [];
    openButton?.classList.remove('open');
    openButton = null;
  };

  const closeFrom = (depth: number): void => {
    for (const p of panels.splice(depth)) p.remove();
  };

  function buildPanel(items: MenuEntry[], depth: number): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'menu-panel';
    panel.setAttribute('role', 'menu');
    if (depth > 0 && COMPACT.matches) {
      // On a narrow screen a sub-menu takes the whole width, so it brings its own way back.
      const back = document.createElement('div');
      back.className = 'menu-item menu-back';
      back.innerHTML = `<span class="menu-mark">${icon('chevron', 12)}</span><span class="menu-label">Atrás</span>`;
      back.addEventListener('click', () => closeFrom(depth));
      panel.append(back);
    }
    let openRow: HTMLElement | null = null; // the row whose sub-menu is open stays lit while the pointer is in it
    const highlight = trackHighlight(panel, () => openRow);
    for (const entry of items) {
      if ('sep' in entry) {
        const sep = document.createElement('div');
        sep.className = 'menu-sep';
        panel.append(sep);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'menu-item';
      row.setAttribute('role', 'menuitem');
      const mark = document.createElement('span');
      mark.className = 'menu-mark';
      const label = document.createElement('span');
      label.className = 'menu-label';
      const key = document.createElement('span');
      key.className = 'menu-key';
      row.append(mark, label, key);

      // The narrow menu drops the explanations in parentheses (the full label stays in the tooltip and on the desktop).
      const shown = COMPACT.matches && entry.short ? entry.short : entry.label;
      if ('items' in entry) {
        label.textContent = shown;
        key.innerHTML = icon('chevron', 12);
        row.classList.add('has-sub');
        const open = (): void => {
          closeFrom(depth + 1);
          const sub = buildPanel((entry.dynamic ? dynamicMenus.get(entry.dynamic)?.() : undefined) ?? entry.items, depth + 1);
          place(sub, row, true);
          panels.push(sub);
          openRow = row;
          highlight(row);
        };
        row.addEventListener('pointerenter', (e) => {
          if (e.pointerType === 'mouse') open();
        });
        row.addEventListener('click', open);
      } else {
        label.textContent = shown;
        key.textContent = entry.shortcut ?? '';
        const live = commands.has(entry.id);
        const on = live && commands.enabled(entry.id);
        if (!on) row.classList.add('disabled');
        row.setAttribute('aria-disabled', String(!on));
        if (entry.check && commands.checked(entry.id)) {
          mark.innerHTML = icon('check', 14);
          row.classList.add('checked');
        }
        row.title = live ? '' : 'Todavía no disponible';
        row.addEventListener('pointerenter', (e) => {
          if (e.pointerType !== 'mouse') return;
          openRow = null;
          closeFrom(depth + 1);
        });
        row.addEventListener('click', () => {
          if (!on) return;
          closeAll();
          commands.run(entry.id);
        });
      }
      panel.append(row);
    }
    return panel;
  }

  /** Put a panel next to its anchor and keep it inside the window. */
  function place(panel: HTMLElement, anchor: HTMLElement, side: boolean): void {
    document.body.append(panel);
    const a = anchor.getBoundingClientRect();
    const w = panel.offsetWidth;
    let x = side ? a.right - 2 : a.left;
    let y = side ? a.top - 4 : a.bottom;
    if (side && COMPACT.matches) {
      x = 4;
      panel.style.width = `${window.innerWidth - 8}px`;
      y = 4;
    } else if (x + w > window.innerWidth - 4) x = side ? Math.max(4, a.left - w + 2) : Math.max(4, window.innerWidth - w - 4);
    if (side) {
      // A fly-out may slide up to fit, but never past the top of the window.
      panel.style.maxHeight = `${window.innerHeight - 12}px`;
      if (y + panel.offsetHeight > window.innerHeight - 4) y = Math.max(4, window.innerHeight - panel.offsetHeight - 4);
    } else {
      // A top-level menu hangs from its button (never over the bar) and scrolls when it is taller than what is left.
      panel.style.maxHeight = `${Math.max(120, window.innerHeight - y - 8)}px`;
    }
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
  }

  function openTop(items: MenuEntry[], button: HTMLElement): void {
    closeAll();
    const panel = buildPanel(items, 0);
    place(panel, button, false);
    panels = [panel];
    button.classList.add('open');
    openButton = button;
  }

  let compactShown = false;
  function render(): void {
    host.replaceChildren();
    compactShown = COMPACT.matches;
    if (compactShown) {
      const b = document.createElement('button');
      b.className = 'menu-top menu-burger';
      b.innerHTML = `${icon('menu', 18)}<span>Menú</span>`;
      b.addEventListener('click', () => (b.classList.contains('open') ? closeAll() : openTop(MENUS.map((m) => ({ label: m.label, items: m.items })), b)));
      host.append(b);
      return;
    }
    for (const menu of MENUS) {
      const b = document.createElement('button');
      b.className = 'menu-top';
      b.textContent = menu.label;
      b.addEventListener('click', () => (b.classList.contains('open') ? closeAll() : openTop(menu.items, b)));
      host.append(b);
    }
  }

  render();
  const relayout = (): void => {
    closeAll();
    render();
  };
  NARROW.addEventListener('change', relayout);
  onLayoutModeChange(relayout);
  window.addEventListener('resize', () => { if (COMPACT.matches !== compactShown) relayout(); });
  onTouchUi(relayout);
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    if (panels.length && !t.closest('.menu-panel') && !t.closest('.menu-top')) closeAll();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
  });
  window.addEventListener('blur', closeAll);

  return {
    openAll: () => {
      const first = host.querySelector<HTMLElement>('.menu-top');
      if (first) openTop(COMPACT.matches ? MENUS.map((m) => ({ label: m.label, items: m.items })) : MENUS[0]!.items, first);
    },
  };
}
