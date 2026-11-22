/**
 * Leaving the program with changes that are in no file. The autosave keeps a copy, but the person is always asked first: a change
 * made and not saved must never be something the program drops without saying so, on the computer or on the tablet.
 *
 * The flow is plain (`createExitGuard`, tested with stand-ins); what differs by place is only where the request comes from:
 *  - the window's close button (desktop app),
 *  - the back button or gesture (Android, where there is no close button),
 *  - closing or reloading the page (a browser).
 */

export type LeaveChoice = 'save' | 'discard' | 'cancel';

export interface ExitDeps {
  /** The names of the documents that hold changes that are in no file (empty when there is nothing to lose). */
  unsaved(): string[];
  /** Ask what to do with them. Dismissing the question counts as `cancel`. */
  ask(message: string, saveLabel: string): Promise<LeaveChoice>;
  /** Save every one of them (asking where, for a document with no file). True when none is left unsaved. */
  saveAll(): Promise<boolean>;
  /** The person chose to let the changes go: their autosave copies go too, as when a tab is closed without saving. */
  discard(): Promise<void>;
  /** Really close the program. */
  quit(): Promise<void>;
}

/** What the question says: which documents, and what each answer does. */
export function leaveMessage(titles: readonly string[]): string {
  if (titles.length === 1) return `«${titles[0]}» tiene cambios sin guardar. ¿Quieres guardarlos antes de salir?`;
  const shown = titles.slice(0, 5).map((t) => `«${t}»`).join(', ');
  const more = titles.length > 5 ? ` y ${titles.length - 5} más` : '';
  return `${titles.length} documentos tienen cambios sin guardar: ${shown}${more}. ¿Quieres guardarlos antes de salir?`;
}

export function createExitGuard(deps: ExitDeps): { requestExit(): Promise<void> } {
  let asking = false;
  return {
    /** The person wants to leave. Returns after the program is closing, or after they changed their mind (then nothing happened). */
    async requestExit(): Promise<void> {
      // A second press (a double tap on back, another close click) while the question is up must not stack another question.
      if (asking) return;
      asking = true;
      try {
        const titles = deps.unsaved();
        if (titles.length) {
          const choice = await deps.ask(leaveMessage(titles), titles.length === 1 ? 'Guardar' : 'Guardar todo');
          if (choice === 'cancel') return;
          if (choice === 'save') {
            if (!(await deps.saveAll())) return; // a save was cancelled or failed: stay, the person was told
          } else {
            await deps.discard();
          }
        }
        await deps.quit();
      } finally {
        asking = false;
      }
    },
  };
}

/** A dialog that is open, closed the way Escape would (its own `cancel` handler decides what that means). True when there was one. */
export function dismissOpenDialog(doc: Pick<Document, 'querySelector'> = document): boolean {
  const dlg = doc.querySelector<HTMLDialogElement>('dialog[open]');
  if (!dlg) return false;
  const cancel = new Event('cancel', { cancelable: true });
  dlg.dispatchEvent(cancel);
  if (!cancel.defaultPrevented && dlg.open) dlg.close();
  return true;
}

export interface ExitSources {
  requestExit(): Promise<void>;
  /** Whether there is something to lose (for the browser, which can only ask the person, not run our question). */
  hasUnsaved(): boolean;
  /** Close anything that is open on top (a menu); true when something was. */
  closeOverlay?(): boolean;
}

/** Hook the places a request to leave comes from. Never throws: without a hook the program simply closes as it always did. */
export async function installExitHooks(src: ExitSources, where: { app: boolean; android: boolean }): Promise<void> {
  if (!where.app) {
    window.addEventListener('beforeunload', (e) => {
      if (!src.hasUnsaved()) return;
      e.preventDefault();
      e.returnValue = ''; // the browser words the question itself
    });
    return;
  }
  try {
    if (where.android) {
      const { onBackButtonPress } = await import('@tauri-apps/api/app');
      // Registering takes the back button over completely: closing what is open on top comes first, as it did by itself before.
      await onBackButtonPress(() => {
        if (dismissOpenDialog()) return;
        if (src.closeOverlay?.()) return;
        void src.requestExit();
      });
      return;
    }
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      void src.requestExit();
    });
  } catch {
    // no hook: the window closes by itself, and the autosave copy is what is left
  }
}
