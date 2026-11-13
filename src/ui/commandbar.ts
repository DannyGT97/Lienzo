import { commands } from './commands';
import { icon } from './icons';
import { trackHighlight } from './menu-highlight';
import { COMMAND_BAR } from './spec/commandbar';

/** Icon strip under the menu bar. Buttons whose command is not live are disabled (and say so in the tooltip). */
export function mountCommandBar(host: HTMLElement): void {
  const buttons: { el: HTMLButtonElement; id: string }[] = [];
  COMMAND_BAR.forEach((group, gi) => {
    if (gi > 0) {
      const sep = document.createElement('span');
      sep.className = 'cb-sep';
      host.append(sep);
    }
    for (const item of group) {
      const b = document.createElement('button');
      b.className = 'cb-btn';
      b.dataset.command = item.id;
      b.innerHTML = icon(item.icon, 20);
      b.title = item.tip;
      b.setAttribute('aria-label', item.tip);
      b.addEventListener('click', () => commands.run(item.id));
      host.append(b);
      buttons.push({ el: b, id: item.id });
    }
  });

  const refresh = (): void => {
    for (const { el, id } of buttons) {
      const live = commands.has(id);
      el.disabled = !commands.enabled(id);
      el.classList.toggle('planned', !live);
      const checked = commands.checked(id);
      el.classList.toggle('on', !!checked);
      if (!live && !el.title.endsWith('(no disponible aún)')) el.title = `${el.title} (no disponible aún)`;
    }
  };
  commands.onChange(refresh);
  refresh();
  mountOverflow(host, buttons.map((b) => b.el));
}

/**
 * The bar sits above the canvas only, so on narrow windows the buttons that do not fit move into a "more" menu
 * (the last button of the bar), like the strip of commands above a document in other painting programs.
 */
function mountOverflow(host: HTMLElement, buttons: HTMLButtonElement[]): void {
  const more = document.createElement('button');
  more.className = 'cb-btn cb-more';
  more.innerHTML = icon('chevron-down', 18);
  more.title = 'Más comandos';
  more.setAttribute('aria-label', 'Más comandos');
  more.hidden = true;
  host.append(more);
  const seps = [...host.querySelectorAll<HTMLElement>('.cb-sep')];
  let hiddenOnes: HTMLButtonElement[] = [];

  function layout(): void {
    for (const el of [...buttons, ...seps]) el.hidden = false;
    more.hidden = true;
    hiddenOnes = [];
    // Ask the layout itself (gaps, separator margins and the interface scale all included) instead of summing widths.
    const spills = (): boolean => host.scrollWidth > host.clientWidth;
    if (!spills()) return;
    more.hidden = false;
    // Drop buttons from the end until the rest (plus the "more" button) fits.
    for (let i = buttons.length - 1; i >= 0 && spills(); i--) {
      buttons[i]!.hidden = true;
      hiddenOnes.unshift(buttons[i]!);
    }
    // Separators with nothing on one side look odd: hide the ones that no longer divide visible buttons.
    seps.forEach((sep) => {
      const prev = sep.previousElementSibling as HTMLElement | null;
      const next = sep.nextElementSibling as HTMLElement | null;
      const open = (e: HTMLElement | null): boolean => !!e && !e.hidden && !e.classList.contains('cb-sep') && !e.classList.contains('cb-more');
      sep.hidden = !(open(prev) && open(next));
    });
  }

  more.addEventListener('click', (e) => {
    e.stopPropagation();
    const old = document.querySelector('.cb-overflow');
    if (old) {
      old.remove();
      return;
    }
    const panel = document.createElement('div');
    panel.className = 'menu-panel cb-overflow';
    trackHighlight(panel);
    for (const b of hiddenOnes) {
      const item = document.createElement('div');
      const live = !b.disabled;
      item.className = 'menu-item' + (live ? '' : ' disabled');
      const label = (b.getAttribute('aria-label') ?? b.title).replace(/ \(no disponible aún\)$/, '');
      item.innerHTML = `<span class="menu-mark">${b.innerHTML}</span><span class="menu-label"></span>`;
      item.querySelector('.menu-label')!.textContent = label;
      if (live) {
        item.addEventListener('click', () => {
          panel.remove();
          b.click();
        });
      }
      panel.append(item);
    }
    document.body.append(panel);
    const r = more.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(4, Math.min(r.right - pr.width, window.innerWidth - pr.width - 4))}px`;
    panel.style.top = `${r.bottom + 2}px`;
    const close = (ev: Event): void => {
      if (ev.target instanceof Node && panel.contains(ev.target)) return;
      panel.remove();
      document.removeEventListener('pointerdown', close, true);
    };
    document.addEventListener('pointerdown', close, true);
  });

  new ResizeObserver(layout).observe(host);
  layout();
}
