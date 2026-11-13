import type { GradientShape, GradientStop } from './gradient';
import type { ToneShape } from './tone';

type Rgb = readonly [number, number, number];

/** What a named gradient lays down: its colours, how it is laid and, for the manga ones, the halftone screen it is turned into. */
export interface GradientPresetResult {
  stops: GradientStop[];
  mode: 'paint' | 'erase';
  /** The shape the gradient wants (a sky runs top to bottom, a sun spreads out); the tool's shape choice wins when it is not "automatic". */
  shape?: GradientShape;
  /** A halftone screen that goes with the gradient (the manga ones); the tool's manga controls start from it. */
  halftone?: { shape: ToneShape; lpi: number; angle: number };
}

interface PresetDef {
  id: string;
  es: string;
  /**
   * Colour stops written as words: `#rrggbb` or `main` / `sub` (the drawing colours), then `:alpha` and `@position`.
   * Stops without a position are spread evenly; two stops at one position make a hard edge. A colour fading to
   * nothing keeps its own colour, so write it out (`#ffffff:0`).
   */
  stops: string;
  shape?: GradientShape;
  mode?: 'paint' | 'erase';
  halftone?: { shape: ToneShape; lpi: number; angle: number };
}

export interface GradientSection {
  es: string;
  presets: PresetDef[];
}

export interface GradientChip {
  id: string;
  es: string;
  sections: GradientSection[];
}

const p = (id: string, es: string, stops: string, extra: Partial<Omit<PresetDef, 'id' | 'es' | 'stops'>> = {}): PresetDef => ({ id, es, stops, ...extra });
const fade = { shape: 'dot', lpi: 60, angle: 45 } as const;

/** Every gradient the tool offers, as the chips and sections the list shows them in. */
export const GRADIENT_CHIPS: readonly GradientChip[] = [
  {
    id: 'basic',
    es: 'Básicos',
    sections: [
      {
        es: 'Principales',
        presets: [
          p('foreground-to-transparent', 'Primer plano a transparente', 'main main:0'),
          p('foreground-to-background', 'Primer plano a fondo', 'main sub'),
          p('black-to-white', 'Negro a blanco', '#000000 #ffffff'),
          p('white-to-black', 'Blanco a negro', '#ffffff #000000'),
          p('grey-to-grey', 'Gris a gris', '#dddddd #555555'),
          p('double-mirror', 'Doble espejo', '#222222 #eeeeee #222222', { shape: 'mirrored' }),
        ],
      },
      {
        es: 'Franjas',
        presets: [
          p('stripe', 'Franjas', 'main@0 main@.25 sub@.25 sub@.5 main@.5 main@.75 sub@.75 sub@1'),
          p('background-color-stripe', 'Franjas de color de fondo', 'sub@0 sub@.25 main@.25 main@.5 sub@.5 sub@.75 main@.75 main@1'),
        ],
      },
      { es: 'Luz', presets: [p('photosphere', 'Esfera de luz', '#ffffff #ffffff:.55@.35 #ffffff:0@.72 #ffffff:0@1', { shape: 'radial' })] },
      { es: 'Borrar', presets: [p('gradient-erase', 'Borrar degradado', 'main main:0', { mode: 'erase' })] },
    ],
  },
  {
    id: 'landscape',
    es: 'Paisaje',
    sections: [
      {
        es: 'Cielo',
        presets: [
          p('blue-sky', 'Cielo azul', '#1e5ac8 #aad7ff'),
          p('midday-sky', 'Mediodía', '#3c8ceb #96c8fa@.7 #ebf5ff'),
          p('sunset', 'Atardecer', '#283278 #c85a6e@.4 #faa046@.75 #ffe182'),
          p('dawn', 'Amanecer', '#3b3b7a #e88fb0 #ffc98a #fff1c9'),
          p('night-sky', 'Cielo nocturno', '#05081e #141e50@.6 #3c4682'),
          p('twilight', 'Crepúsculo', '#1d1b4d #6a3d8f #d9668a #f9a86b'),
          p('storm', 'Tormenta', '#2e3440 #5b6577 #98a2b3'),
          p('aurora', 'Aurora', '#0b1d3a #1fa97a #7be0b0 #6f7be8'),
        ],
      },
      {
        es: 'Mar',
        presets: [
          p('deep-ocean', 'Océano profundo', '#021b3a #05508a #1fa0c9'),
          p('lagoon', 'Laguna', '#0b8aa6 #5fd1c4 #d6f7e8'),
          p('coast', 'Costa', '#0d6e9a #6fcbe0 #f3e3b3'),
          p('ice', 'Hielo', '#c9ecff #eaf8ff #8ac8ee'),
          p('tide', 'Marea', '#103a5c #2c86a8 #a8e6e0'),
          p('pearl', 'Perla', '#f5eef5 #d8e8f5 #f3e0e8'),
        ],
      },
      {
        es: 'Fuego',
        presets: [
          p('flame', 'Llama', '#7a0c00 #e8350a #ff9a1f #ffe36a'),
          p('embers', 'Brasas', '#2a0600 #9c1c00 #ff6a1a'),
          p('lava', 'Lava', '#1a0000 #c01800 #ff7a00 #ffd23a'),
          p('sun', 'Sol', '#fff7c2 #ffd23a@.3 #ff8a1a@.6 #ff8a1a:0@1', { shape: 'radial' }),
          p('spark', 'Chispa', '#ff4d00 #ffb300 #fff3a0'),
          p('smoke', 'Humo', '#2b2b2b #6e6e6e:0'),
        ],
      },
      {
        es: 'Plantas',
        presets: [
          p('forest', 'Bosque', '#0c3b1e #2f7d3a #8fcf6a'),
          p('meadow', 'Pradera', '#3f9a3a #a8dc5a #f2f7a0'),
          p('autumn', 'Otoño', '#6b2a10 #c2561a #f0a43a #f6dc7a'),
          p('moss', 'Musgo', '#2a3d1c #58742f #a7b86a'),
          p('spring', 'Primavera', '#7fd16a #f5e66a #ffb3c8'),
          p('jungle', 'Selva', '#052e1a #0c6b3c #38b56a #c0f0a0'),
        ],
      },
    ],
  },
  {
    id: 'materials',
    es: 'Materiales',
    sections: [
      {
        es: 'Metal',
        presets: [
          p('silver', 'Plata', '#8a8f99 #f2f4f7 #9aa0aa #e6e9ee #7c828c'),
          p('gold', 'Oro', '#8a5a00 #f5c84a #fff3b0 #d9a021 #8a5a00'),
          p('bronze', 'Bronce', '#5c3410 #c98a4a #f0c58f #a8682a'),
          p('chrome', 'Cromo', '#3a3f4a #e8ecf2 #6c7482 #f8fafc #4a505c'),
          p('copper', 'Cobre', '#6b2a14 #d77a4a #f6b98a #b9552c'),
          p('steel', 'Acero', '#2d333b #7b8794 #c5ced8 #6b7682'),
        ],
      },
      {
        es: 'Piel',
        presets: [
          p('skin-light', 'Piel clara', '#f7d9c4 #fbe8da'),
          p('skin-medium', 'Piel media', '#d9a27a #efc3a0'),
          p('skin-dark', 'Piel oscura', '#7a4a30 #a8704c'),
          p('blush', 'Rubor', '#f0788a:.9 #f0788a:0', { shape: 'radial' }),
          p('skin-shadow', 'Sombra de piel', '#c9906c #f7d9c4'),
          p('lips', 'Labios', '#b3394f #e87a8c'),
        ],
      },
    ],
  },
  {
    id: 'color',
    es: 'Color',
    sections: [
      {
        es: 'Pastel',
        presets: [
          p('cotton', 'Algodón', '#ffd6ec #d6e8ff'),
          p('peach', 'Melocotón', '#ffd9c2 #ffb8a0'),
          p('mint', 'Menta', '#d4f5e6 #a8e6cf'),
          p('lavender', 'Lavanda', '#e6d9ff #c4b0f5'),
          p('bubblegum', 'Chicle', '#ff9ed2 #ffd3ee'),
          p('vanilla', 'Vainilla', '#fff6d6 #ffe9a8'),
        ],
      },
      {
        es: 'Neón',
        presets: [
          p('neon-pink', 'Neón rosa', '#ff2d95 #ff8ac8'),
          p('neon-cyan', 'Neón cian', '#00e5ff #7cf5ff'),
          p('synthwave', 'Synthwave', '#2b0a5a #c81d9a #ff7a45'),
          p('cyberpunk', 'Ciberpunk', '#0a0a2a #6a1bd6 #00e5ff'),
          p('laser', 'Láser', '#00ff88 #00d4ff #6a5cff'),
          p('plasma', 'Plasma', '#ffffff #ff4de6@.35 #6a1bd6@.65 #0a0a2a', { shape: 'radial' }),
        ],
      },
      {
        es: 'Espectro',
        presets: [
          p('rainbow', 'Arcoíris', '#e62828 #faa01e@.2 #f0e628@.4 #3cc846@.6 #3278e6@.8 #8c3cc8'),
          p('soft-rainbow', 'Arcoíris suave', '#ff9aa2 #ffdac1 #fffcb0 #b5ead7 #a5c8ff #d7b5ff'),
          p('holographic', 'Holográfico', '#8ff0ff #ffa8f0 #fff0a0 #a8ffcf #a8b8ff'),
          p('bubble', 'Burbuja', '#8ff0ff #ffa8f0 #fff0a0 #a8ffcf #8ff0ff', { shape: 'conic' }),
          p('oil', 'Aceite', '#3a1c71 #d76d77 #ffaf7b #3a1c71', { shape: 'conic' }),
          p('prism', 'Prisma', '#ff3b3b #ffd23a #3bff8a #3b8aff #ff3bf0'),
        ],
      },
      {
        es: 'Fantasía',
        presets: [
          p('galaxy', 'Galaxia', '#0b0b2e #3b1c7a #c850c0 #ffcc70'),
          p('nebula', 'Nebulosa', '#ff7ad9 #7a4dff@.45 #0b0b2e', { shape: 'radial' }),
          p('dream', 'Sueño', '#a18cd1 #fbc2eb'),
          p('spell', 'Hechizo', '#6a1bd6 #00e5ff #ff4de6 #6a1bd6', { shape: 'conic' }),
          p('crystal', 'Cristal', '#c9f0ff #9ad0ff #e9d9ff'),
          p('venom', 'Veneno', '#1a3b0a #74d12c #e9ff6a'),
        ],
      },
    ],
  },
  {
    id: 'manga',
    es: 'Manga',
    sections: [
      { es: 'Degradado manga', presets: [p('manga-gradient', 'Degradado manga', 'main main:0', { halftone: fade })] },
      {
        es: 'Tramas',
        presets: [
          p('linear-tone', 'Tono lineal', 'main main:0', { halftone: { shape: 'line', lpi: 40, angle: 45 } }),
          p('dot-screen', 'Trama de puntos', 'main main:0', { halftone: { shape: 'dot', lpi: 30, angle: 45 } }),
          p('speed-lines', 'Líneas de velocidad', 'main main:0', { halftone: { shape: 'line', lpi: 20, angle: 0 } }),
          p('cross-screen', 'Trama cruzada', 'main main:0', { halftone: { shape: 'cross', lpi: 40, angle: 45 } }),
        ],
      },
      {
        es: 'Sombras y luz',
        presets: [
          p('soft-shadow', 'Sombra suave', '#ffffff #9a9a9a'),
          p('flash', 'Destello', '#ffffff #ffffff@.25 #111111', { shape: 'radial' }),
          p('vignette', 'Viñeta', '#000000:0 #000000:.85', { shape: 'radial' }),
          p('vignette-screen', 'Viñeta de trama', 'main:0 main', { shape: 'radial', halftone: fade }),
        ],
      },
    ],
  },
];

const BY_ID = new Map<string, PresetDef>(GRADIENT_CHIPS.flatMap((c) => c.sections.flatMap((s) => s.presets)).map((d) => [d.id, d]));

/** The ids of every gradient the tool offers. */
export const GRADIENT_IDS: readonly string[] = [...BY_ID.keys()];

const hex = (s: string): Rgb => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

/** Read the stop words of a preset (see PresetDef.stops) into stops; `main` and `sub` are the drawing colours. */
function parseStops(text: string, main: Rgb, sub: Rgb): GradientStop[] {
  const words = text.split(' ');
  return words.map((w, i) => {
    const [head, at] = w.split('@') as [string, string | undefined];
    const [name, alpha] = head.split(':') as [string, string | undefined];
    const color = name === 'main' ? main : name === 'sub' ? sub : hex(name);
    return { t: at !== undefined ? Number(at) : i / Math.max(1, words.length - 1), color, alpha: alpha !== undefined ? Number(alpha) : 1 };
  });
}

/** What a named gradient lays down; `main` and `sub` are the drawing colours. An unknown id is the foreground fading to transparent. */
export function presetStops(id: string, main: Rgb, sub: Rgb): GradientPresetResult {
  const d = BY_ID.get(id) ?? BY_ID.get('foreground-to-transparent')!;
  return { stops: parseStops(d.stops, main, sub), mode: d.mode ?? 'paint', shape: d.shape, halftone: d.halftone };
}
