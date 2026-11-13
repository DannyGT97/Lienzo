import { icon } from './icons';
import { isDrawerLayout, onLayoutModeChange } from './ui-scale';

const KEY = 'lienzo.palettes.collapsed';
/** The side drawers of a tablet or a phone keep their own folds: what was folded on a desktop does not hide palettes there. */
const keyFor = (): string => (isDrawerLayout() ? `${KEY}.drawer` : KEY);

function load(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function save(key: string, s: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...s]));
  } catch {
    // Storage may be unavailable (private window); folding still works for the session.
  }
}

const sets = new Map<string, Set<string>>();
const foldedNow = (): Set<string> => {
  const key = keyFor();
  let set = sets.get(key);
  if (!set) sets.set(key, (set = load(key)));
  return set;
};
const redraws = new Set<() => void>();
onLayoutModeChange(() => redraws.forEach((r) => r()));

/** Apply the remembered fold state to a palette and return the button that toggles it. */
export function foldButton(palette: HTMLElement, key: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'ph-fold';
  const apply = (): void => {
    const on = foldedNow().has(key);
    palette.classList.toggle('collapsed', on);
    btn.innerHTML = icon(on ? 'chevron' : 'chevron-down', 14);
    btn.title = on ? 'Desplegar la paleta' : 'Plegar la paleta';
    btn.setAttribute('aria-expanded', String(!on));
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const folded = foldedNow();
    if (folded.has(key)) folded.delete(key);
    else folded.add(key);
    save(keyFor(), folded);
    apply();
  });
  redraws.add(apply);
  apply();
  return btn;
}

/** Palettes written in index.html: add the fold button to their header. */
export function armStaticPalettes(): void {
  document.querySelectorAll<HTMLElement>('section.palette[id]').forEach((p) => {
    const head = p.querySelector<HTMLElement>(':scope > .palette-head');
    if (head && !head.querySelector('.ph-fold')) head.prepend(foldButton(p, p.id));
  });
}
