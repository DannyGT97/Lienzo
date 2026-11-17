/**
 * The window that asks for a folder of the library (to move something into, or to save in): the folders as an indented list,
 * the one chosen marked, the ones that cannot be chosen greyed with the reason, "Nueva carpeta" to make the one that is missing,
 * and an answer that can always be taken back ("Cancelar", Escape, or a tap outside). Rows are tall enough for a finger.
 */
import { baseRel } from './library';

export interface PickFolderOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  /** Every folder, depth first, with "" (the library itself) first. Called again after a folder is made. */
  load(): Promise<string[]>;
  /** Why `rel` cannot be chosen, or null when it can. */
  blocked?(rel: string): string | null;
  /** Make a folder inside `parent`; its path, or null when nothing was made. Without it the button is not shown. */
  create?(parent: string): Promise<string | null>;
}

const FOLDER = '<svg viewBox="0 0 64 48" aria-hidden="true"><path d="M4 8a4 4 0 0 1 4-4h14l6 6h28a4 4 0 0 1 4 4v26a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="currentColor"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** Resolves to the folder chosen ("" is the library itself), or null when the window was closed without choosing. */
export function pickFolder(o: PickFolderOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const dlg = el('dialog', 'app-dialog pick-dialog');
    const title = el('h3', '', o.title);
    const msg = o.message ? el('p', 'msg', o.message) : null;
    const list = el('div', 'pick-list');
    list.setAttribute('role', 'listbox');
    list.tabIndex = 0;
    const foot = el('div', 'pick-foot');
    const make = o.create ? el('button', 'pick-new', '＋ Nueva carpeta') : null;
    const cancel = el('button', '', 'Cancelar');
    const ok = el('button', 'primary', o.confirmLabel);
    for (const b of [cancel, ok, ...(make ? [make] : [])]) b.type = 'button';
    foot.append(...(make ? [make] : []), el('span', 'pick-gap'), cancel, ok);
    dlg.append(title, ...(msg ? [msg] : []), list, foot);

    let folders: string[] = [];
    let chosen: string | null = null;
    const blockedWhy = (f: string): string | null => o.blocked?.(f) ?? null;

    const mark = (): void => {
      for (const row of list.querySelectorAll<HTMLElement>('.pick-row')) {
        const on = row.dataset.rel === chosen;
        row.classList.toggle('on', on);
        row.setAttribute('aria-selected', String(on));
      }
      ok.disabled = chosen === null;
      list.querySelector<HTMLElement>('.pick-row.on')?.scrollIntoView({ block: 'nearest' });
    };

    const draw = (): void => {
      list.replaceChildren();
      for (const f of folders) {
        const why = blockedWhy(f);
        const row = el('button', `pick-row${why ? ' off' : ''}`);
        row.type = 'button';
        row.dataset.rel = f;
        row.setAttribute('role', 'option');
        if (why) row.setAttribute('aria-disabled', 'true');
        row.style.paddingLeft = `${12 + (f ? f.split('/').length : 0) * 20}px`;
        const icon = el('span', 'pick-icon');
        icon.innerHTML = FOLDER;
        row.append(icon, el('span', 'pick-name', f ? baseRel(f) : 'Biblioteca'));
        if (why) row.append(el('span', 'pick-why', why));
        row.addEventListener('click', () => {
          if (why) return;
          chosen = f;
          mark();
        });
        row.addEventListener('dblclick', () => {
          if (!why) finish(f);
        });
        list.append(row);
      }
      mark();
    };

    const reload = async (select?: string): Promise<void> => {
      folders = await o.load().catch(() => ['']);
      if (select !== undefined && folders.includes(select)) chosen = select;
      if (chosen !== null && (!folders.includes(chosen) || blockedWhy(chosen))) chosen = null;
      draw();
    };

    function finish(value: string | null): void {
      dlg.close();
      dlg.remove();
      resolve(value);
    }

    cancel.addEventListener('click', () => finish(null));
    ok.addEventListener('click', () => finish(chosen));
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish(null);
    });
    // A tap on the dimmed area outside the window closes it, as "Cancelar".
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) finish(null);
    });
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && chosen !== null && document.activeElement === list) {
        e.preventDefault();
        finish(chosen);
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && document.activeElement === list) {
        e.preventDefault();
        const ok2 = folders.filter((f) => !blockedWhy(f));
        const at = chosen === null ? -1 : ok2.indexOf(chosen);
        const next = ok2[Math.max(0, Math.min(ok2.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (next !== undefined) {
          chosen = next;
          mark();
        }
      }
    });
    make?.addEventListener('click', () => {
      void (async () => {
        const made = await o.create!(chosen ?? '');
        if (made !== null) await reload(made);
      })();
    });

    document.body.append(dlg);
    dlg.showModal();
    void reload().then(() => {
      // The first folder that can be chosen starts selected, so a single tap on the button is enough in the common case.
      if (chosen === null) chosen = folders.find((f) => !blockedWhy(f)) ?? null;
      mark();
      list.focus({ preventScroll: true });
    });
  });
}
