// Default command bar (top strip of icon buttons): 22 items in 7 groups; icons and Spanish tooltips are our own.

export interface BarItem {
  id: string;
  icon: string;
  tip: string;
}

export const COMMAND_BAR: BarItem[][] = [
  [
    { id: 'applicationtilingmenu', icon: 'menu', tip: 'Mostrar el menú de la aplicación' },
    { id: 'filehome', icon: 'home', tip: 'Inicio: explorador de archivos' },
  ],
  [
    { id: 'filenew', icon: 'new', tip: 'Nuevo (Ctrl+N)' },
    { id: 'fileopen', icon: 'open', tip: 'Abrir (Ctrl+O)' },
    { id: 'filesave', icon: 'save', tip: 'Guardar (Ctrl+S)' },
    { id: 'filesavemergeimagejpg', icon: 'export-jpg', tip: 'Exportar como JPEG' },
    { id: 'filesavemergeimagepng', icon: 'export-png', tip: 'Exportar como PNG' },
    { id: 'filesavemergeimagepsd', icon: 'export-psd', tip: 'Exportar como PSD de una capa' },
  ],
  [
    { id: 'undo', icon: 'undo', tip: 'Deshacer (Ctrl+Z)' },
    { id: 'redo', icon: 'redo', tip: 'Rehacer (Ctrl+Y)' },
  ],
  [
    { id: 'clear', icon: 'clear', tip: 'Borrar' },
    { id: 'editclearoutofselectarea', icon: 'clear-outside', tip: 'Borrar fuera de la selección' },
    { id: 'editpaint', icon: 'fill', tip: 'Rellenar' },
    { id: 'transformstretch', icon: 'transform', tip: 'Escalar y rotar (Ctrl+T)' },
  ],
  [
    { id: 'selectdeselect', icon: 'deselect', tip: 'Deseleccionar (Ctrl+D)' },
    { id: 'selectinvert', icon: 'invert', tip: 'Invertir selección' },
    { id: 'selectshow', icon: 'show-selection', tip: 'Mostrar el borde de la selección' },
  ],
  [
    { id: 'viewsnapruler', icon: 'snap-ruler', tip: 'Ajustar a reglas (Ctrl+1)' },
    { id: 'viewsnapspecialruler', icon: 'snap-special', tip: 'Ajustar a regla especial (Ctrl+2)' },
    { id: 'viewsnapgrid', icon: 'snap-grid', tip: 'Ajustar a la cuadrícula (Ctrl+3)' },
  ],
  [
    { id: 'helponlinehowto', icon: 'help-book', tip: 'Cómo se usa (F1)' },
    { id: 'helponlinesupport', icon: 'help-support', tip: 'Soporte' },
  ],
];
