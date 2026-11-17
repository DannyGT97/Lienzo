/**
 * In-app replacements for confirm(), alert() and prompt(). The WebView on Android does not show
 * those browser dialogs (they silently answer "no"), so every question the app asks goes through here.
 */

function modal<T>(build: (dlg: HTMLDialogElement, done: (value: T) => void) => void, onCancel: T): Promise<T> {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'app-dialog';
    const done = (value: T): void => {
      if (dlg.open) dlg.close();
      dlg.remove();
      resolve(value);
    };
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      done(onCancel);
    });
    build(dlg, done);
    document.body.append(dlg);
    dlg.showModal();
  });
}

const text = (tag: string, content: string, cls = ''): HTMLElement => {
  const el = document.createElement(tag);
  el.textContent = content;
  if (cls) el.className = cls;
  return el;
};

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (primary) b.className = 'primary';
  b.addEventListener('click', onClick);
  return b;
}

/** Ask a yes/no question. Resolves true for the confirming button. */
export function confirmDialog(message: string, confirmLabel = 'Continuar', cancelLabel = 'Cancelar'): Promise<boolean> {
  return modal<boolean>((dlg, done) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.append(button(confirmLabel, () => done(true), true), button(cancelLabel, () => done(false)));
    dlg.append(text('p', message, 'msg'), row);
  }, false);
}

/** Ask which of several things to do. Resolves to the chosen option's value, or to `onCancel` when dismissed. */
export function choiceDialog<T>(message: string, options: { label: string; value: T; primary?: boolean }[], onCancel: T, grid = false): Promise<T> {
  return modal<T>((dlg, done) => {
    const row = document.createElement('div');
    row.className = grid ? 'row grid' : 'row';
    for (const o of options) row.append(button(o.label, () => done(o.value), o.primary ?? false));
    dlg.append(text('p', message, 'msg'), row);
  }, onCancel);
}

/** Show a message (possibly several lines) and wait for it to be dismissed. */
export function alertDialog(message: string, title = 'Aviso'): Promise<void> {
  return modal<void>((dlg, done) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.append(button('Aceptar', () => done(), true));
    dlg.append(text('h3', title), text('p', message, 'msg'), row);
  }, undefined);
}

/** Ask for a line of text. Resolves to null when cancelled. */
export function promptDialog(message: string, initial = ''): Promise<string | null> {
  return modal<string | null>((dlg, done) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = initial;
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      // Without this the same Enter, once the dialog closes, is "pressed" on the button that gets the focus back and opens it again.
      e.preventDefault();
      done(input.value);
    });
    const row = document.createElement('div');
    row.className = 'row';
    row.append(button('Aceptar', () => done(input.value), true), button('Cancelar', () => done(null)));
    dlg.append(text('p', message, 'msg'), input, row);
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
  }, null);
}
