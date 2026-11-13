import { icon } from '../icons';
import type { PaletteInstance } from '../palette-dock';

export interface CompDeps {
  /** The comps of the document and whether the layers are right now as each one says. */
  list: () => { id: number; name: string; current: boolean }[];
  add: () => void;
  /** Save the layers' present state into the comp. */
  update: (id: number) => void;
  remove: (id: number) => void;
  /** Put the layers as the comp says. */
  apply: (id: number) => void;
  rename: (id: number) => void;
}

/** Layer comps: save the combination of visible layers, opacities and modes, and come back to it with a click. */
export function layerCompPalette(d: CompDeps): (body: HTMLElement) => PaletteInstance {
  return (body) => {
    body.classList.add('hist-body');
    let chosen: number | null = null;
    const bar = document.createElement('div');
    bar.className = 'nav-row ph-buttons';
    const button = (ic: string, tip: string, run: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = 'nav-btn';
      b.title = tip;
      b.innerHTML = icon(ic, 16);
      b.addEventListener('click', run);
      bar.append(b);
      return b;
    };
    button('plus', 'Nueva composición con el estado actual de las capas', () => d.add());
    const update = button('check', 'Guardar el estado actual de las capas en la composición elegida', () => chosen !== null && d.update(chosen));
    const remove = button('close', 'Borrar la composición elegida', () => chosen !== null && d.remove(chosen));
    const list = document.createElement('ol');
    list.className = 'hist-list';
    body.append(bar, list);
    const render = (): void => {
      const rows = d.list();
      if (chosen !== null && !rows.some((r) => r.id === chosen)) chosen = null;
      update.disabled = remove.disabled = chosen === null;
      list.replaceChildren();
      if (!rows.length) {
        const empty = document.createElement('li');
        empty.className = 'hist-row future';
        empty.textContent = 'Sin composiciones: «+» guarda el estado actual de las capas.';
        list.append(empty);
        return;
      }
      for (const r of rows) {
        const li = document.createElement('li');
        li.className = 'hist-row' + (r.current ? ' on' : '');
        li.textContent = r.name + (r.id === chosen ? '  ◂' : '');
        li.title = 'Clic: aplicar. Doble clic: cambiar el nombre.';
        li.addEventListener('click', () => {
          chosen = r.id;
          d.apply(r.id);
        });
        li.addEventListener('dblclick', () => d.rename(r.id));
        list.append(li);
      }
    };
    render();
    return { refresh: render };
  };
}
