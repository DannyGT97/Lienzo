import { commands } from './commands';
import { trackHighlight } from './menu-highlight';
import { MENUS, type MenuEntry } from './spec/menus';

const known = new Map<string, { label: string; shortcut?: string; check?: boolean }>();
const index = (items: MenuEntry[]): void => {
  for (const e of items) {
    if ('sep' in e) continue;
    if ('items' in e) index(e.items);
    else known.set(e.id, { label: e.label, shortcut: e.shortcut, check: e.check });
  }
};
for (const m of MENUS) index(m.items);

/** A context menu is a list of command ids; `'-'` is a separator. Labels and shortcuts come from the menu specification. */
export type ContextEntries = string[];

let open: HTMLElement | null = null;

export function closeContextMenu(): void {
  open?.remove();
  open = null;
}

export function showContextMenu(clientX: number, clientY: number, entries: ContextEntries): void {
  closeContextMenu();
  const panel = document.createElement('div');
  panel.className = 'menu-panel';
  panel.setAttribute('role', 'menu');
  trackHighlight(panel);
  for (const id of entries) {
    if (id === '-') {
      if (panel.lastElementChild && !panel.lastElementChild.classList.contains('menu-sep')) {
        const sep = document.createElement('div');
        sep.className = 'menu-sep';
        panel.append(sep);
      }
      continue;
    }
    const spec = known.get(id);
    if (!spec) continue;
    const live = commands.has(id) && commands.enabled(id);
    const item = document.createElement('div');
    item.className = 'menu-item' + (live ? '' : ' disabled');
    item.setAttribute('role', spec.check ? 'menuitemcheckbox' : 'menuitem');
    const mark = document.createElement('span');
    mark.className = 'menu-mark';
    mark.textContent = commands.checked(id) ? '✓' : '';
    const label = document.createElement('span');
    label.className = 'menu-label';
    label.textContent = spec.label.replace(/…$/, '…');
    item.append(mark, label);
    if (spec.shortcut) {
      const key = document.createElement('span');
      key.className = 'menu-key';
      key.textContent = spec.shortcut;
      item.append(key);
    }
    if (live) {
      item.addEventListener('click', () => {
        closeContextMenu();
        commands.run(id);
      });
    } else {
      item.title = 'Todavía no disponible';
    }
    panel.append(item);
  }
  if (panel.lastElementChild?.classList.contains('menu-sep')) panel.lastElementChild.remove();
  document.body.append(panel);
  const r = panel.getBoundingClientRect();
  panel.style.left = `${Math.max(4, Math.min(clientX, window.innerWidth - r.width - 4))}px`;
  panel.style.top = `${Math.max(4, Math.min(clientY, window.innerHeight - r.height - 4))}px`;
  open = panel;
  const dismiss = (e: Event): void => {
    if (e.target instanceof Node && panel.contains(e.target)) return;
    closeContextMenu();
    cleanup();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      closeContextMenu();
      cleanup();
    }
  };
  const cleanup = (): void => {
    document.removeEventListener('pointerdown', dismiss, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', closeContextMenu);
  };
  document.addEventListener('pointerdown', dismiss, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', closeContextMenu);
}

/** Open the menu on right click and on a long press of a finger (touch screens have no right button). */
export function attachContextMenu(target: HTMLElement, entries: (e: MouseEvent | PointerEvent) => ContextEntries | null, beforeOpen?: (e: Event) => void): void {
  target.addEventListener('contextmenu', (e) => {
    const list = entries(e);
    if (!list) return;
    e.preventDefault();
    beforeOpen?.(e);
    showContextMenu(e.clientX, e.clientY, list);
  });
}
