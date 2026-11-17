/**
 * The window for Ayuda ▸ Buscar actualizaciones: one dialog that stays open and changes its content as the check moves along
 * (ask, look, offer, download, result), instead of a chain of separate confirm/alert boxes.
 */

export type UpdatesScreen =
  | { kind: 'intro'; current: string }
  | { kind: 'checking' }
  | { kind: 'uptodate'; current: string }
  | { kind: 'available'; current: string; version: string; notes: string }
  | { kind: 'installing'; version: string }
  | { kind: 'handoff' }
  | { kind: 'permission' }
  | { kind: 'error'; title: string; detail: string }
  | { kind: 'unavailable' };

/** What the person pressed: the main button, the secondary one, or closed the window. */
export type UpdatesChoice = 'primary' | 'secondary' | 'close';

export interface UpdatesWindow {
  /** Shows a screen. Resolves when the person answers; screens without buttons (working) resolve at once with 'close'. */
  show(screen: UpdatesScreen): Promise<UpdatesChoice>;
  close(): void;
}

/** Release notes are plain text or light Markdown: one entry per line, without the bullets and heading marks. */
export function noteLines(notes: string, max = 8): string[] {
  return notes
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]\s+|#{1,6}\s+|\d+[.)]\s+)/, '').replace(/[*_`]/g, '').trim())
    .filter(Boolean)
    .slice(0, max);
}

interface View {
  tone: 'info' | 'ok' | 'warn' | 'work';
  title: string;
  lead?: string;
  detail?: string;
  version?: { from: string; to?: string };
  notes?: string[];
  primary?: string;
  secondary?: string;
  /** Only for the screens that wait for the network: no buttons, no way to close by accident. */
  busy?: boolean;
}

export function viewOf(s: UpdatesScreen): View {
  switch (s.kind) {
    case 'intro':
      return {
        tone: 'info',
        title: 'Buscar actualizaciones',
        lead: 'Lienzo se conectará a github.com para ver si hay una versión nueva.',
        detail: 'No envía nada tuyo ni de tus dibujos. Sin conexión, el programa sigue funcionando igual.',
        version: { from: s.current },
        primary: 'Buscar',
        secondary: 'Cancelar',
      };
    case 'checking':
      return { tone: 'work', title: 'Buscando…', lead: 'Consultando la última versión publicada.', busy: true };
    case 'uptodate':
      return { tone: 'ok', title: 'Todo al día', lead: 'Tienes la última versión de Lienzo.', version: { from: s.current }, primary: 'Aceptar' };
    case 'available': {
      const notes = noteLines(s.notes);
      return {
        tone: 'info',
        title: 'Hay una versión nueva',
        lead: 'Se descargará de github.com y se comprobará su firma antes de instalarla. Tu trabajo se guarda antes de empezar.',
        version: { from: s.current, to: s.version },
        ...(notes.length ? { notes } : {}),
        primary: 'Instalar ahora',
        secondary: 'Más tarde',
      };
    }
    case 'installing':
      return { tone: 'work', title: `Descargando ${s.version}…`, lead: 'No cierres Lienzo. Se reiniciará solo al terminar.', busy: true };
    case 'handoff':
      return { tone: 'ok', title: 'Casi listo', lead: 'Confirma la instalación en la ventana de Android.', primary: 'Aceptar' };
    case 'permission':
      return {
        tone: 'warn',
        title: 'Falta un permiso',
        lead: 'Android necesita tu permiso para instalar.',
        detail: 'Activa «Permitir de esta fuente» para Lienzo y vuelve a elegir Buscar actualizaciones.',
        primary: 'Aceptar',
      };
    case 'error':
      return { tone: 'warn', title: s.title, lead: s.detail, detail: 'Lienzo sigue funcionando sin conexión.', primary: 'Aceptar' };
    case 'unavailable':
      return {
        tone: 'info',
        title: 'Actualizaciones',
        lead: 'Las actualizaciones solo están en la aplicación instalada (Windows y Android).',
        primary: 'Aceptar',
      };
  }
}

const ICON: Record<View['tone'], string> = { info: '↻', ok: '✓', warn: '!', work: '' };

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function openUpdatesWindow(): UpdatesWindow {
  const dlg = document.createElement('dialog');
  dlg.className = 'app-dialog updates-dialog';
  dlg.setAttribute('aria-labelledby', 'upd-title');
  document.body.append(dlg);
  let pending: ((c: UpdatesChoice) => void) | null = null;
  let busy = false;

  const answer = (c: UpdatesChoice): void => {
    const p = pending;
    pending = null;
    p?.(c);
  };
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (!busy) answer('close');
  });
  dlg.addEventListener('close', () => answer('close'));

  return {
    show(screen) {
      answer('close'); // never leave an earlier question waiting
      const v = viewOf(screen);
      busy = !!v.busy;
      dlg.dataset.tone = v.tone;
      dlg.replaceChildren();

      const badge = node('div', 'upd-badge');
      if (v.tone === 'work') badge.append(node('span', 'upd-spin'));
      else badge.textContent = ICON[v.tone];
      badge.setAttribute('aria-hidden', 'true');

      const head = node('div', 'upd-head');
      const title = node('h3', 'upd-title', v.title);
      title.id = 'upd-title';
      head.append(badge, title);
      dlg.append(head);

      if (v.lead) dlg.append(node('p', 'upd-lead', v.lead));
      if (v.version) {
        const box = node('div', 'upd-versions');
        const cur = node('div', 'upd-ver');
        cur.append(node('span', 'upd-ver-label', v.version.to ? 'Instalada' : 'Versión'), node('b', '', v.version.from || '—'));
        box.append(cur);
        if (v.version.to) {
          const next = node('div', 'upd-ver new');
          next.append(node('span', 'upd-ver-label', 'Nueva'), node('b', '', v.version.to));
          box.append(node('span', 'upd-arrow', '→'), next);
        }
        dlg.append(box);
      }
      if (v.notes) {
        const wrap = node('div', 'upd-notes');
        wrap.append(node('div', 'upd-notes-title', 'Novedades'));
        const ul = node('ul', '');
        for (const line of v.notes) ul.append(node('li', '', line));
        wrap.append(ul);
        dlg.append(wrap);
      }
      if (v.detail) dlg.append(node('p', 'upd-detail', v.detail));
      if (v.busy) {
        const bar = node('div', 'upd-bar');
        bar.append(node('i', ''));
        bar.setAttribute('role', 'progressbar');
        dlg.append(bar);
      }

      if (!dlg.open) dlg.showModal();
      if (v.busy || !v.primary) return Promise.resolve('close');

      const row = node('div', 'row');
      const main = node('button', 'primary', v.primary);
      main.addEventListener('click', () => answer('primary'));
      if (v.secondary) {
        const other = node('button', '', v.secondary);
        other.addEventListener('click', () => answer('secondary'));
        row.append(other, main);
      } else row.append(main);
      dlg.append(row);
      main.focus();
      return new Promise((resolve) => {
        pending = resolve;
      });
    },
    close() {
      pending = null;
      busy = false;
      if (dlg.open) dlg.close();
      dlg.remove();
    },
  };
}
