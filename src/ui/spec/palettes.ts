// The 32 palette kinds, with our Spanish titles and
// the Window-menu command that shows or hides each one.

export interface PaletteSpec {
  id: string;
  title: string;
  icon: string;
  command: string;
}

const P = (id: string, title: string, icon: string, command: string): [string, PaletteSpec] => [id, { id, title, icon, command }];

export const PALETTE_SPECS: Record<string, PaletteSpec> = Object.fromEntries([
  P('tool', 'Herramientas', 'pen', 'windowshowtoolpalette'),
  P('subtool', 'Subherramienta', 'subtool', 'windowshowsubtoolpalette'),
  P('tooloption', 'Propiedades de herramienta', 'settings', 'windowshowtooloptionpalette'),
  P('tooldetail', 'Detalle de subherramienta', 'settings', 'windowshowtooldetailpalette'),
  P('toolslider', 'Deslizador de herramienta', 'colorslider', 'windowshowtoolsliderpalette'),
  P('brushsize', 'Tamaño del pincel', 'brush', 'windowshowbrushsizepalette'),
  P('quickaccess', 'Acceso rápido', 'quick', 'windowshowquickaccesspalette'),
  P('editbar', 'Barra de edición', 'transform', 'windowshowedithbarpalette'),
  P('colorcircle', 'Círculo de color', 'color', 'windowshowcolorcirclepalette'),
  P('colorslider', 'Deslizadores de color', 'colorslider', 'windowshowcolorsliderpalette'),
  P('colorset', 'Conjunto de colores', 'colorset', 'windowshowcolorsetpalette'),
  P('colorhistory', 'Historial de colores', 'history', 'windowshowcolorhistorypalette'),
  P('colorblend', 'Color intermedio', 'gradient', 'windowshowcolorblendpalette'),
  P('colorguide', 'Color aproximado', 'color', 'windowshowcolorguidepalette'),
  P('mix', 'Mezcla de colores', 'mix', 'windowshowmixpalette'),
  P('layerorder', 'Capas', 'layers', 'windowshowlayerorderpalette'),
  P('layerfind', 'Buscar capa', 'search', 'windowshowlayerfindpalette'),
  P('property', 'Propiedades de capa', 'layerprop', 'windowshowlayerpropertypalette'),
  P('layercomp', 'Composiciones de capa', 'layers', 'windowshowlayercomppalette'),
  P('lighttable', 'Mesa de luz', 'eye', 'windowshowlighttablepalette'),
  P('navigator', 'Navegador', 'navigator', 'windowshownavigatorpalette'),
  P('subview', 'Vista secundaria', 'navigator', 'windowshowsubviewpalette'),
  P('multiview', 'Vista múltiple', 'navigator', 'windowshowmultiviewpalette'),
  P('memoryinformation', 'Información', 'info', 'windowshowmemoryinfopalette'),
  P('history', 'Historial', 'history', 'windowshowhistorypalette'),
  P('action', 'Acciones automáticas', 'action', 'windowshowactionpalette'),
  P('material', 'Materiales', 'material', 'windowshowmaterialpalette1'),
  P('itembank', 'Banco de elementos', 'material', 'windowshowitembankpalette'),
  P('aligndistribute', 'Alinear y distribuir', 'align', 'windowshowaligndistributepalette'),
  P('timeline', 'Línea de tiempo', 'timeline', 'windowshowtimelinepalette'),
  P('relatedtool', 'Herramientas relacionadas', 'pen', 'windowshowrelatedtoolpalette'),
  P('relatedcolor', 'Colores relacionados', 'color', 'windowshowrelatedcolorpalette'),
]);

/** Right-hand dock: each inner array is one tab group (in order, top to bottom). */
export const RIGHT_GROUPS: string[][] = [
  ['navigator', 'subview', 'memoryinformation'],
  ['colorcircle', 'colorslider', 'colorset', 'colorhistory', 'colorblend', 'colorguide', 'mix'],
  ['property'],
  ['layerorder', 'layerfind', 'layercomp', 'lighttable'],
  ['material', 'history', 'action', 'itembank', 'aligndistribute'],
];

/** Extra palettes that live under the sub tool / tool property palettes on the left. */
export const LEFT_EXTRA_GROUPS: string[][] = [['brushsize', 'quickaccess', 'toolslider', 'tooldetail'], ['relatedtool', 'relatedcolor']];

/** What is shown the first time (the rest is available from the Window menu). */
export const DEFAULT_VISIBLE = new Set<string>([
  'tool', 'subtool', 'tooloption',
  'navigator', 'memoryinformation',
  'colorcircle', 'colorslider', 'colorset',
  'property',
  'layerorder',
  'history', 'material', 'action',
]);
