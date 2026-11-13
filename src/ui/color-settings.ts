import { icon } from './icons';
import { makeDraggable } from './drag-dialog';
import { pickFromScreen, type ScreenPickOptions } from './screen-pick';
import { toHex, type RGB } from './color';
import { createColorPalettes, type Component } from './palettes/color';
import type { ColorDeps, ColorStores } from './palettes/color';

/** The colour the window edits: read it when the window opens, write it when the person accepts. */
export interface ColorSource {
  get: () => RGB;
  set: (rgb: RGB, from?: string) => void;
  /** What is under the eyedropper on something only the app can read (the drawing itself). */
  sample?: ScreenPickOptions['sample'];
}

const MODES = ['Por defecto', 'Círculo 1', 'Círculo 2', 'Conjunto', 'Historial'] as const;
const MODE_KEY = 'lienzo.colorWindowMode';

/**
 * "Ajustes de color", the window behind a double click on the main or the secondary colour. It works on a copy of the
 * colour: Aceptar gives it to the app, Cancelar (or Esc) leaves the colour as it was. The five pages are different
 * ways to pick it (square and bar, two kinds of wheel, the colour set, the history); the numbers on the right are
 * always the same colour in H S V, R G B, L a b, C M Y K and hexadecimal.
 */
export function openColorSettings(source: ColorSource, stores: ColorStores, title: string): Promise<void> {
  return new Promise((resolve) => {
    const initial = source.get();
    let current: RGB = [initial[0], initial[1], initial[2]];
    const listeners = new Set<(rgb: RGB, from?: string) => void>();
    const local: ColorDeps = {
      get: () => [current[0], current[1], current[2]],
      set: (rgb, from) => {
        current = [rgb[0], rgb[1], rgb[2]];
        for (const cb of listeners) cb(current, from);
      },
      subscribe: (cb) => void listeners.add(cb),
    };
    const palettes = createColorPalettes(local, stores, true);

    const dlg = document.createElement('dialog');
    dlg.className = 'app-dialog spec-dialog color-settings';
    const close = (accept: boolean): void => {
      if (accept) source.set(current, 'dialog');
      if (dlg.open) dlg.close();
      dlg.remove();
      resolve();
    };
    // A floating window, not a modal one: nothing darkens behind it and the canvas stays in view. Esc closes it while
    // the focus is inside it (the eyedropper takes its own Esc first).
    dlg.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close(false);
    });

    const heading = document.createElement('h3');
    heading.textContent = `Ajustes de color · ${title}`;

    // ---- the colour being made (new on top, the one it started from below) and the screen eyedropper
    const top = document.createElement('div');
    top.className = 'cs-top';
    const preview = document.createElement('div');
    preview.className = 'cs-preview';
    preview.innerHTML = '<i class="new"></i><i class="old"></i>';
    (preview.querySelector('.old') as HTMLElement).style.background = toHex(initial);
    const paintPreview = (): void => void ((preview.querySelector('.new') as HTMLElement).style.background = toHex(current));
    listeners.add(paintPreview);
    paintPreview();
    top.append(preview);
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'nav-btn cs-eye';
    pick.title = 'Cuentagotas: toma un color del lienzo o de la interfaz';
    pick.innerHTML = icon('eyedropper', 16);
    let picking = false;
    pick.addEventListener('click', () => {
      if (picking) return;
      picking = true;
      pick.classList.add('on');
      // A window that fills a small screen would cover what there is to pick: it steps aside meanwhile.
      const covers = window.matchMedia('(max-width: 860px)').matches || document.documentElement.classList.contains('touch-ui');
      void pickFromScreen({ sample: source.sample, hide: covers ? dlg : null }).then((rgb) => {
        picking = false;
        pick.classList.remove('on');
        if (rgb) local.set(rgb, 'eyedropper');
      });
    });
    top.append(pick);

    // ---- the five pages
    let component: Component = 0;
    const tabs = document.createElement('div');
    tabs.className = 'cs-tabs';
    const panes = document.createElement('div');
    panes.className = 'cs-panes';
    const makers = [
      (b: HTMLElement) => palettes.plane(b, () => component),
      palettes.wheel,
      palettes.disc,
      palettes.set,
      palettes.history,
    ];
    const instances = makers.map((make) => {
      const pane = document.createElement('div');
      pane.className = 'cs-pane';
      panes.append(pane);
      return { pane, inst: make(pane) };
    });
    let saved = 0;
    try {
      saved = Math.min(MODES.length - 1, Math.max(0, Number(localStorage.getItem(MODE_KEY)) || 0));
    } catch {
      // Storage blocked: start on the first page.
    }
    const tabButtons = MODES.map((name, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dock-tab';
      b.textContent = name;
      b.addEventListener('click', () => show(i));
      tabs.append(b);
      return b;
    });
    function show(i: number): void {
      tabButtons.forEach((t, j) => t.classList.toggle('on', j === i));
      instances.forEach((p, j) => (p.pane.hidden = j !== i));
      instances[i]!.inst.refresh?.();
      try {
        localStorage.setItem(MODE_KEY, String(i));
      } catch {
        // Not remembered, nothing else lost.
      }
    }
    top.append(tabs);

    // ---- the numbers
    const fieldsBox = document.createElement('div');
    fieldsBox.className = 'cs-fieldsbox';
    palettes.fields(fieldsBox, component, (c) => {
      component = c;
      instances[0]!.inst.refresh?.();
    });

    const main = document.createElement('div');
    main.className = 'cs-main';
    main.append(panes, fieldsBox);

    const row = document.createElement('div');
    row.className = 'row';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancelar';
    cancel.addEventListener('click', () => close(false));
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'primary';
    ok.textContent = 'Aceptar';
    ok.addEventListener('click', () => close(true));
    row.append(cancel, ok);

    dlg.append(heading, top, main, row);
    makeDraggable(dlg, heading);
    document.body.append(dlg);
    show(saved);
    dlg.show();
  });
}
