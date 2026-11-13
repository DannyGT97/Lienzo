import { icon } from './icons';

/** Timeline panel along the bottom of the canvas. Structure only: every control is disabled until animation exists. */
export function mountTimeline(host: HTMLElement): { toggle: () => void; isVisible: () => boolean; onChange: (cb: () => void) => void } {
  const soon = 'Todavía no disponible';
  const btn = (name: string, tip: string): string => `<button class="tbtn" disabled title="${tip} (${soon.toLowerCase()})">${icon(name, 16)}</button>`;
  const cells = Array.from({ length: 24 }, (_, i) => `<span class="tl-cell">${i + 1}</span>`).join('');
  host.innerHTML = `
    <header class="tl-head">
      <strong>Línea de tiempo</strong>
      <div class="tl-controls">
        ${btn('tl-first', 'Primer cuadro')}${btn('tl-prev', 'Cuadro anterior')}${btn('tl-play', 'Reproducir')}${btn('tl-next', 'Cuadro siguiente')}${btn('tl-last', 'Último cuadro')}${btn('tl-loop', 'Repetir')}
        <label class="tl-fps">Cuadros por segundo
          <select disabled title="${soon}"><option>12</option><option>24</option><option>30</option></select>
        </label>
      </div>
      <button class="tl-close tbtn" title="Cerrar">${icon('close', 14)}</button>
    </header>
    <div class="tl-body">
      <div class="tl-tracks">
        <div class="tl-ruler">${cells}</div>
        <div class="tl-empty">Sin animación. Aquí se organizarán los cuadros y las pistas cuando exista la animación.</div>
      </div>
    </div>`;
  const listeners: Array<() => void> = [];
  const toggle = (): void => {
    host.hidden = !host.hidden;
    for (const cb of listeners) cb();
  };
  host.querySelector('.tl-close')!.addEventListener('click', toggle);
  return { toggle, isVisible: () => !host.hidden, onChange: (cb) => listeners.push(cb) };
}
