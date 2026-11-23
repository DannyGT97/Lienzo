/**
 * What the Preferences window offers, as plain data and the few rules around it (which options are changed, how a search
 * matches, what "restore" does). No DOM here: `preferences-window.ts` draws it and the tests can use it on its own.
 *
 * An option with `soon` is shown but has no effect yet (it was already in the old window, disabled). It is dimmed and tagged
 * "Próximamente", and the window can hide all of them.
 */
import { UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_PRESETS, UI_SCALE_STEP } from './ui-scale-model';

export type Control =
  | { type: 'toggle' }
  | { type: 'segmented'; options: readonly { id: string; label: string }[] }
  /** A list of choices (options that do nothing yet use it). */
  | { type: 'select'; options: readonly string[] }
  /** A whole number on a slider with its box and, optionally, a menu of habitual values. */
  | { type: 'range'; min: number; max: number; step: number; unit: string; presets?: readonly number[] }
  /** A number with its unit (options that do nothing yet use it). */
  | { type: 'number'; unit?: string }
  /** A fact the person cannot change. */
  | { type: 'info'; value: string }
  /** A button that opens something else. */
  | { type: 'action'; action: 'shortcuts' | 'updates' | 'about'; label: string };

export interface PrefItem {
  /** The preference it edits (a key of `Prefs`); for options that do nothing yet, a name of its own. */
  key: string;
  label: string;
  /** One line that says what it does, under the name. */
  hint?: string;
  /** Other words that find it when searching. */
  keywords?: string;
  control: Control;
  /** Has no effect yet. */
  soon?: boolean;
  /** What the disabled control shows while it has no effect. */
  placeholder?: string | number | boolean;
  /** Only means something while this other (toggle) option is on. */
  needs?: string;
}

export interface PrefGroup {
  name?: string;
  /** A box of explanation above the group's options. */
  callout?: string;
  items: PrefItem[];
}

export interface PrefSection {
  id: string;
  title: string;
  icon: IconName;
  lead?: string;
  groups: PrefGroup[];
}

export type IconName = 'pen' | 'canvas' | 'ui' | 'layers' | 'file' | 'perf' | 'tablet' | 'ruler' | 'keys' | 'info';
export type Values = Record<string, unknown>;

const opts = (...pairs: [string, string][]): { id: string; label: string }[] => pairs.map(([id, label]) => ({ id, label }));

/** The sections, in the order the list shows them. `memory` is read when the window opens: facts, not settings. */
export function buildSections(memory: readonly [string, string][] = []): PrefSection[] {
  const memoryItems: PrefItem[] = memory.map(([label, value], i) => ({ key: `memory.${i}`, label, control: { type: 'info', value } }));
  return [
    {
      id: 'draw',
      title: 'Dibujo',
      icon: 'pen',
      lead: 'Cómo reaccionan el lápiz y el cursor mientras dibujas.',
      groups: [
        {
          name: 'Lápiz',
          items: [
            { key: 'usePressure', label: 'Usar la presión del lápiz', hint: 'Si lo desactivas, todos los trazos se hacen a presión máxima, como con un ratón.', control: { type: 'toggle' } },
            {
              key: 'pressureCurve',
              label: 'Curva de presión',
              hint: 'Cuánto hay que apretar: «Suave» responde con poco esfuerzo; «Firme» exige apretar más.',
              keywords: 'sensibilidad',
              control: { type: 'segmented', options: opts(['default', 'Predeterminada'], ['soft', 'Suave'], ['firm', 'Firme']) },
              needs: 'usePressure',
            },
            { key: 'stabilizeLive', label: 'Corrección de trazo en tiempo real', hint: 'Suaviza el trazo mientras lo haces.', keywords: 'estabilización', control: { type: 'toggle' }, soon: true, placeholder: true },
            { key: 'eraserTip', label: 'Cambiar a borrador con el extremo del lápiz', hint: 'Para lápices con goma en la parte de atrás.', control: { type: 'toggle' }, soon: true, placeholder: true },
          ],
        },
        {
          name: 'Cursor',
          items: [
            { key: 'brushOutline', label: 'Mostrar el contorno del pincel', hint: 'Un círculo con el tamaño real del pincel.', control: { type: 'toggle' } },
            { key: 'brushCrosshair', label: 'Mostrar una cruz en el centro', hint: 'Ayuda a apuntar con precisión.', control: { type: 'toggle' } },
            { key: 'cursorShape', label: 'Forma del cursor de dibujo', control: { type: 'select', options: ['Círculo del tamaño del pincel', 'Cruz', 'Punto'] }, soon: true, placeholder: 'Círculo del tamaño del pincel' },
          ],
        },
      ],
    },
    {
      id: 'canvas',
      title: 'Lienzo',
      icon: 'canvas',
      lead: 'El área de trabajo alrededor de tu página.',
      groups: [
        {
          items: [
            { key: 'workBg', label: 'Color de fondo del área de trabajo', control: { type: 'segmented', options: opts(['dark', 'Gris oscuro'], ['gray', 'Gris'], ['black', 'Negro']) }, soon: true, placeholder: 'dark' },
            { key: 'checker', label: 'Mostrar el tablero de transparencia', control: { type: 'toggle' }, soon: true, placeholder: true },
            { key: 'zoomQuality', label: 'Calidad de la vista al acercar', hint: '«Píxeles» muestra los píxeles sin suavizar.', control: { type: 'segmented', options: opts(['smooth', 'Suavizada'], ['pixels', 'Píxeles']) }, soon: true, placeholder: 'smooth' },
            { key: 'wheelScrolls', label: 'Desplazar con la rueda del ratón', hint: 'Desactivado: la rueda acerca y aleja.', control: { type: 'toggle' }, soon: true, placeholder: false },
          ],
        },
      ],
    },
    {
      id: 'ui',
      title: 'Interfaz',
      icon: 'ui',
      lead: 'Tamaño y aspecto de las barras y paneles. El lienzo nunca se escala.',
      groups: [
        {
          name: 'Aspecto',
          items: [
            {
              key: 'uiScale',
              label: 'Escala de la interfaz',
              hint: 'Barras y paneles más grandes o más pequeños. Útil en pantallas táctiles.',
              keywords: 'tamaño zoom',
              control: { type: 'range', min: UI_SCALE_MIN, max: UI_SCALE_MAX, step: UI_SCALE_STEP, unit: '%', presets: UI_SCALE_PRESETS },
            },
            { key: 'theme', label: 'Tema', control: { type: 'segmented', options: opts(['dark', 'Oscuro'], ['light', 'Claro']) }, soon: true, placeholder: 'dark' },
            { key: 'iconSize', label: 'Tamaño de los iconos', control: { type: 'segmented', options: opts(['s', 'Pequeño'], ['m', 'Mediano'], ['l', 'Grande']) }, soon: true, placeholder: 'm' },
            { key: 'tooltips', label: 'Mostrar pistas al pasar el cursor', control: { type: 'toggle' }, soon: true, placeholder: true },
          ],
        },
        {
          name: 'Avisos',
          items: [
            {
              key: 'noticeSpeed',
              label: 'Duración de los avisos',
              hint: 'Cuánto tiempo se queda en pantalla cada mensaje corto.',
              control: { type: 'segmented', options: opts(['fast', '2 s'], ['normal', '3 s'], ['slow', '4 s'], ['slower', '7 s']) },
            },
          ],
        },
        { name: 'Idioma', items: [{ key: 'language', label: 'Idioma', control: { type: 'select', options: ['Español'] }, soon: true, placeholder: 'Español' }] },
      ],
    },
    {
      id: 'layers',
      title: 'Capas',
      icon: 'layers',
      lead: 'Cómo se muestran y se nombran las capas.',
      groups: [
        {
          items: [
            { key: 'layerNaming', label: 'Nombre de las capas nuevas', control: { type: 'segmented', options: opts(['numbered', 'Capa N'], ['plain', 'Sin número']) }, soon: true, placeholder: 'numbered' },
            { key: 'layerThumbs', label: 'Mostrar miniaturas de capa', control: { type: 'toggle' }, soon: true, placeholder: true },
            { key: 'layerThumbSize', label: 'Tamaño de las miniaturas', control: { type: 'segmented', options: opts(['s', 'Pequeña'], ['m', 'Mediana'], ['l', 'Grande']) }, soon: true, placeholder: 'm' },
          ],
        },
      ],
    },
    {
      id: 'file',
      title: 'Archivo y copias',
      icon: 'file',
      lead: 'Lienzo guarda copias de recuperación de tus documentos abiertos para que no pierdas trabajo si algo falla.',
      groups: [
        {
          name: 'Copias de recuperación',
          callout: 'Aunque desactives las copias periódicas, Lienzo <b>siempre</b> guarda una al enviar la app a segundo plano, al cerrarla y al guardar el archivo. Y antes de salir con cambios sin guardar, <b>siempre te pregunta</b>.',
          items: [
            { key: 'autosave', label: 'Copias periódicas', hint: 'Guarda una copia de recuperación cada cierto tiempo mientras trabajas.', keywords: 'autoguardado', control: { type: 'toggle' } },
            { key: 'autosaveMinutes', label: 'Cada cuánto', control: { type: 'range', min: 1, max: 120, step: 1, unit: 'min', presets: [1, 5, 15, 30, 60] }, needs: 'autosave' },
            { key: 'onlyIfChanged', label: 'Solo si hay cambios', hint: 'No escribe nada mientras no hayas tocado el documento.', control: { type: 'toggle' }, soon: true, placeholder: true },
            { key: 'maxCopies', label: 'Copias que se conservan', hint: 'Se borran las más antiguas.', control: { type: 'number', unit: 'copias' }, soon: true, placeholder: 5 },
          ],
        },
        {
          name: 'Guardado',
          items: [
            { key: 'saveFormat', label: 'Formato de guardado por defecto', control: { type: 'select', options: ['Lienzo (.lienzo)', 'PSD', 'OpenRaster (.ora)'] }, soon: true, placeholder: 'Lienzo (.lienzo)' },
            { key: 'saveInPlace', label: 'Guardar también sobre el archivo cada cierto tiempo', hint: 'Además de la copia de recuperación, escribe en tu propio archivo.', control: { type: 'toggle' }, soon: true, placeholder: false },
          ],
        },
      ],
    },
    {
      id: 'perf',
      title: 'Rendimiento',
      icon: 'perf',
      lead: 'Deshacer usa memoria. Más pasos significa más margen para corregir, pero menos memoria libre para dibujar.',
      groups: [
        ...(memoryItems.length ? [{ name: 'Memoria ahora', items: memoryItems }] : []),
        {
          name: 'Deshacer',
          items: [
            { key: 'historySteps', label: 'Pasos de deshacer', keywords: 'historial', control: { type: 'range', min: 10, max: 1000, step: 10, unit: 'pasos', presets: [50, 200, 500, 1000] } },
            {
              key: 'undoMemoryMb',
              label: 'Memoria para deshacer',
              hint: 'Cuando se llena, se olvidan los pasos más antiguos y Lienzo te avisa.',
              control: { type: 'range', min: 32, max: 4096, step: 32, unit: 'MB', presets: [128, 256, 512, 1024, 2048] },
            },
          ],
        },
      ],
    },
    {
      id: 'tablet',
      title: 'Tableta y tacto',
      icon: 'tablet',
      lead: 'Lápiz, dedo y gestos.',
      groups: [
        {
          name: 'Dedo',
          items: [
            { key: 'fingerDraws', label: 'Permitir dibujar con el dedo al iniciar', hint: 'Desactivado: el dedo solo mueve y hace zoom; el lápiz dibuja.', control: { type: 'toggle' } },
            { key: 'touchGestures', label: 'Gestos táctiles (pellizcar para acercar)', control: { type: 'toggle' }, soon: true, placeholder: true },
            { key: 'palmRejection', label: 'Ignorar la palma de la mano', hint: 'Evita rayas accidentales mientras apoyas la mano.', control: { type: 'toggle' }, soon: true, placeholder: true },
          ],
        },
        { name: 'Lápiz', items: [{ key: 'penApi', label: 'Interfaz del lápiz', hint: 'Solo en Windows.', control: { type: 'select', options: ['Automática', 'Windows Ink', 'Wintab'] }, soon: true, placeholder: 'Automática' }] },
      ],
    },
    {
      id: 'units',
      title: 'Reglas y unidades',
      icon: 'ruler',
      lead: 'Cómo se miden las cosas.',
      groups: [
        {
          items: [
            { key: 'lengthUnit', label: 'Unidad de longitud', control: { type: 'select', options: ['Píxeles', 'Milímetros', 'Centímetros', 'Pulgadas', 'Puntos'] }, soon: true, placeholder: 'Píxeles' },
            { key: 'textUnit', label: 'Unidad del texto', control: { type: 'select', options: ['Puntos', 'Q', 'Píxeles'] }, soon: true, placeholder: 'Puntos' },
            { key: 'defaultDpi', label: 'Resolución por defecto', hint: 'Para los documentos nuevos.', control: { type: 'number', unit: 'ppp' }, soon: true, placeholder: 300 },
          ],
        },
      ],
    },
    {
      id: 'keys',
      title: 'Atajos de teclado',
      icon: 'keys',
      lead: 'Hoy solo se pueden consultar; cambiarlos llegará más adelante.',
      groups: [{ items: [{ key: 'action.shortcuts', label: 'Ver todos los atajos', hint: 'Abre la lista con buscador.', control: { type: 'action', action: 'shortcuts', label: 'Abrir lista…' } }] }],
    },
    {
      id: 'about',
      title: 'Acerca de y novedades',
      icon: 'info',
      groups: [
        {
          name: 'Versión',
          items: [
            { key: 'action.about', label: 'Acerca de Lienzo', hint: 'Versión y datos de esta instalación.', control: { type: 'action', action: 'about', label: 'Abrir…' } },
            { key: 'action.updates', label: 'Buscar actualizaciones', hint: 'Lienzo no busca por su cuenta: solo cuando se lo pides.', control: { type: 'action', action: 'updates', label: 'Buscar' } },
          ],
        },
      ],
    },
  ];
}

export const itemsOf = (section: PrefSection): PrefItem[] => section.groups.flatMap((g) => g.items);
/** Whether the option does something today. */
export const isLive = (item: PrefItem): boolean => !item.soon;
/** Whether the option holds a preference the person can change (not a fact, not a button). */
export const isEditable = (item: PrefItem): boolean => isLive(item) && item.control.type !== 'info' && item.control.type !== 'action';
export const isChanged = (item: PrefItem, values: Values, defaults: Values): boolean => isEditable(item) && item.key in defaults && values[item.key] !== defaults[item.key];

/** How many options of a section differ from their default. */
export const changedCount = (section: PrefSection, values: Values, defaults: Values): number => itemsOf(section).filter((i) => isChanged(i, values, defaults)).length;

/** The values with every live option of `section` (or of all of them) back at its default. */
export function restore(sections: readonly PrefSection[], values: Values, defaults: Values, only?: string): Values {
  const next = { ...values };
  for (const s of sections) {
    if (only !== undefined && s.id !== only) continue;
    for (const i of itemsOf(s)) if (isEditable(i) && i.key in defaults) next[i.key] = defaults[i.key];
  }
  return next;
}

/** Lower case without accents, so «presion» finds «presión». */
export const fold = (text: string): string => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export interface Hit {
  section: PrefSection;
  items: PrefItem[];
}

/** The options that match a search, by section. Matches the name, the hint, the extra words and the section's name. */
export function search(sections: readonly PrefSection[], query: string, showSoon: boolean): Hit[] {
  const q = fold(query.trim());
  if (!q) return [];
  const hits: Hit[] = [];
  for (const section of sections) {
    const items = itemsOf(section).filter((i) => (showSoon || isLive(i)) && fold(`${i.label} ${i.hint ?? ''} ${i.keywords ?? ''} ${section.title}`).includes(q));
    if (items.length) hits.push({ section, items });
  }
  return hits;
}

/** What the autosave interval means in plain words. */
export function autosaveHint(values: Values): string {
  if (!values.autosave) return 'Las copias periódicas están desactivadas.';
  const n = Number(values.autosaveMinutes);
  return `Con ${n} min, lo máximo que perderías si la app se cerrara de golpe es ${n} min de trabajo.`;
}
