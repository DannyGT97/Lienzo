import { SIZE_CHOICES } from '../engine/brush-params';
import { PALETTE_SPECS, RIGHT_GROUPS, LEFT_EXTRA_GROUPS, DEFAULT_VISIBLE } from './spec/palettes';
import { mountDock, type DockApi, type PaletteBuilder } from './palette-dock';
import { createColorPalettes, type ColorDeps, type ColorStores } from './palettes/color';
import { layerCompPalette, type CompDeps } from './palettes/comps';
import { createNavigator, type NavigatorDeps } from './palettes/navigator';
import { brushDetailPalette, type BrushDetailDeps } from './palettes/brush-detail';
import { historyPalette, infoPalette, placeholderPalette, type HistoryDeps, type InfoRows, type Item } from './palettes/simple';

export interface StudioDeps {
  navigator: NavigatorDeps;
  color: ColorDeps;
  colorStores: ColorStores;
  history: HistoryDeps;
  info: () => InfoRows;
  comps: CompDeps;
  /** Static palettes whose markup lives in index.html (layers and layer properties): element ids to adopt. */
  adopt: Record<string, string>;
}

/** Content of the palettes that have structure but no behaviour yet. */
const PLACEHOLDERS: Record<string, Item[]> = {
  subview: [{ note: 'Muestra otra parte del lienzo mientras dibujas.' }, { slider: 'Zoom' }, { buttons: [{ icon: 'zoom-in', tip: 'Acercar' }, { icon: 'zoom-out', tip: 'Alejar' }] }],
  multiview: [{ note: 'Vista múltiple del lienzo.' }],
  colorblend: [{ gradient: true }, { note: 'Mezcla entre el color principal y el secundario.' }],
  colorguide: [{ note: 'Sugiere colores parecidos al principal.' }, { grid: 12, cols: 6 }],
  mix: [{ note: 'Mezcla colores como en una paleta de pintor.' }, { gradient: true }, { buttons: [{ icon: 'brush', tip: 'Pincel de mezcla' }, { icon: 'eraser', tip: 'Borrar' }] }],
  layerfind: [{ search: 'Buscar capas…' }, { checks: ['Solo nombres', 'Solo capas visibles'] }],
  lighttable: [{ checks: ['Usar mesa de luz', 'Mostrar imágenes de referencia'] }, { slider: 'Opacidad' }],
  material: [{ search: 'Buscar materiales…' }, { list: ['Todos los materiales', 'Monocromo', 'Tonos', 'Fondos', 'Efectos', 'Texto y globos', 'Modelos 3D', 'Imágenes'] }],
  action: [{ select: 'Conjunto', options: ['Acciones básicas'] }, { list: ['(sin acciones registradas)'] }, { buttons: [{ icon: 'action', tip: 'Ejecutar' }, { icon: 'plus', tip: 'Grabar' }, { icon: 'pause', tip: 'Detener' }] }],
  itembank: [{ note: 'Banco de elementos: guarda partes de tus dibujos para reutilizarlas.' }, { list: [], empty: 'Vacío' }],
  aligndistribute: [{ note: 'Alinea y distribuye objetos.' }, { buttons: [{ icon: 'align', tip: 'Alinear izquierda' }, { icon: 'align', tip: 'Alinear centro' }, { icon: 'align', tip: 'Alinear derecha' }, { icon: 'align', tip: 'Distribuir' }] }],
  quickaccess: [{ note: 'Atajos a herramientas y comandos.' }, { grid: 12, cols: 4 }],
  toolslider: [{ slider: 'Tamaño' }, { slider: 'Opacidad' }],
  relatedtool: [{ list: [], empty: 'Sin herramientas relacionadas' }],
  relatedcolor: [{ list: [], empty: 'Sin colores relacionados' }],
  editbar: [{ buttons: [{ icon: 'transform', tip: 'Transformar' }, { icon: 'copy', tip: 'Copiar' }, { icon: 'clear', tip: 'Borrar' }] }],
};

/** Builds the right-hand dock (and the palettes other docks reuse) from the specification. */
export function mountRightDock(host: HTMLElement, deps: StudioDeps, onChange: () => void, initial?: ReadonlySet<string>): {
  dock: DockApi;
  navigator: ReturnType<typeof createNavigator>;
  visible: Set<string>;
} {
  const nav = createNavigator(deps.navigator);
  const colors = createColorPalettes(deps.color, deps.colorStores);

  const adopt =
    (id: string): PaletteBuilder =>
    (body) => {
      const el = document.getElementById(id);
      if (el) {
        el.hidden = false;
        body.append(el);
      }
    };

  const builders: Record<string, PaletteBuilder> = {
    navigator: (b) => nav.build(b),
    colorcircle: colors.wheel,
    colorslider: colors.sliders,
    colorset: colors.set,
    colorhistory: colors.history,
    history: historyPalette(deps.history),
    memoryinformation: infoPalette(deps.info),
    layerorder: adopt(deps.adopt.layerorder!),
    property: adopt(deps.adopt.property!),
    layercomp: layerCompPalette(deps.comps),
  };
  for (const [id, items] of Object.entries(PLACEHOLDERS)) builders[id] = placeholderPalette(items);

  const visible = new Set(initial ?? DEFAULT_VISIBLE);
  const dock = mountDock({
    host,
    groups: RIGHT_GROUPS,
    specs: PALETTE_SPECS,
    builders,
    visible,
    onChange,
    // Made short, the layers keep their buttons and one layer in view; the colour wheel shrinks with its room, to a size still usable.
    keep: { layerorder: ['#layer-props', '#layer-list > li'] },
    floor: { colorcircle: 150 },
  });
  // Evita que el dock herede una posición desplazada al iniciar el espacio de trabajo.
  host.parentElement?.scrollTo({ top: 0, left: 0 });
  return { dock, navigator: nav, visible };
}

export interface LeftExtraDeps {
  size: () => number;
  setSize: (px: number) => void;
  /** The brush settings the detail palette edits. */
  detail: BrushDetailDeps;
}

/** Palettes that sit under the sub tool palette on the left. They start hidden; the Window menu shows them. */
export function mountLeftExtraDock(host: HTMLElement, deps: LeftExtraDeps, onChange: () => void, initial?: ReadonlySet<string>): DockApi {
  const builders: Record<string, PaletteBuilder> = {
    tooldetail: brushDetailPalette(deps.detail),
    brushsize: (body) => {
      body.classList.add('bs-body');
      const grid = document.createElement('div');
      grid.className = 'bs-grid';
      const buttons = SIZE_CHOICES.map((px) => {
        const b = document.createElement('button');
        b.className = 'bs-btn';
        b.title = `${px} px`;
        const d = Math.min(18, Math.max(2, Math.round(Math.sqrt(px) * 1.5)));
        b.innerHTML = `<span class="bs-dot" style="width:${d}px;height:${d}px"></span>${px}`;
        b.addEventListener('click', () => {
          deps.setSize(px);
          sync();
        });
        grid.append(b);
        return [px, b] as const;
      });
      body.append(grid);
      const sync = (): void => buttons.forEach(([px, b]) => b.classList.toggle('on', px === deps.size()));
      sync();
      return { refresh: sync };
    },
  };
  for (const id of LEFT_EXTRA_GROUPS.flat()) {
    if (!builders[id]) builders[id] = placeholderPalette(PLACEHOLDERS[id] ?? []);
  }
  return mountDock({ host, groups: LEFT_EXTRA_GROUPS, specs: PALETTE_SPECS, builders, visible: new Set(initial), onChange });
}
