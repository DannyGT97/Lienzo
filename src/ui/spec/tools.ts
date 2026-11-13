// The tool tree: groups, sub tools, default shortcuts and Spanish names.

export interface SubToolDef {
  id: string;
  es: string;
}

export interface ToolGroupDef {
  id: string;
  es: string;
  subtools: SubToolDef[];
}

export interface ToolDef {
  id: string;
  es: string;
  icon: string;
  shortcut: string | null;
  groups: ToolGroupDef[];
}

export const TOOLS: ToolDef[] = [
  { id: "gradient", es: "Degradado", icon: "gradient", shortcut: "G", groups: [
    { id: "gradient.gradient", es: "Degradado", subtools: [
      { id: "gradient.gradient.foreground-to-transparent", es: "Primer plano a transparente" },
      { id: "gradient.gradient.foreground-to-background", es: "Primer plano a fondo" },
      { id: "gradient.gradient.stripe", es: "Franjas" },
      { id: "gradient.gradient.background-color-stripe", es: "Franjas de color de fondo" },
      { id: "gradient.gradient.photosphere", es: "Esfera de luz" },
      { id: "gradient.gradient.blue-sky", es: "Cielo azul" },
      { id: "gradient.gradient.midday-sky", es: "Cielo de mediodía" },
      { id: "gradient.gradient.sunset", es: "Atardecer" },
      { id: "gradient.gradient.night-sky", es: "Cielo nocturno" },
      { id: "gradient.gradient.rainbow", es: "Arcoíris" },
      { id: "gradient.gradient.gradient-erase", es: "Borrar degradado" },
      { id: "gradient.gradient.manga-gradient", es: "Degradado manga" }
    ] },
    { id: "gradient.freeform-gradient", es: "Degradado libre", subtools: [
      { id: "gradient.freeform-gradient.normal-paint", es: "Pintura normal" },
      { id: "gradient.freeform-gradient.the-lightest-shadow", es: "Sombra más clara" },
      { id: "gradient.freeform-gradient.the-deepest-shadow", es: "Sombra más oscura" }
    ] }
  ] },
  { id: "move", es: "Vista", icon: "hand", shortcut: null, groups: [
    { id: "move.move", es: "Vista", subtools: [
      { id: "move.move.hand", es: "Mano" },
      { id: "move.move.rotate", es: "Girar vista" },
      { id: "move.move.zoom-in", es: "Acercar" },
      { id: "move.move.zoom-out", es: "Alejar" }
    ] }
  ] },
  { id: "pen", es: "Pluma", icon: "pen", shortcut: "P", groups: [
    { id: "pen.pen", es: "Pluma", subtools: [
      { id: "pen.pen.g-pen", es: "Pluma G" },
      { id: "pen.pen.real-g-pen", es: "Pluma G real" },
      { id: "pen.pen.mapping-pen", es: "Pluma de mapa" },
      { id: "pen.pen.turnip-pen", es: "Pluma nabo" },
      { id: "pen.pen.textured-pen", es: "Pluma con textura" },
      { id: "pen.pen.rough-pen", es: "Pluma áspera" },
      { id: "pen.pen.calligraphy", es: "Caligrafía" },
      { id: "pen.pen.milli-pen", es: "Pluma milimétrica" },
      { id: "pen.pen.felt-pen", es: "Rotulador de fieltro" },
      { id: "pen.pen.dot-pen", es: "Pluma de puntos" },
      { id: "pen.pen.flat-marker", es: "Marcador plano" }
    ] }
  ] },
  { id: "correct-line", es: "Corregir línea", icon: "correct", shortcut: "Y", groups: [
    { id: "correct-line.correct-line", es: "Corregir línea", subtools: [
      { id: "correct-line.correct-line.control-point", es: "Punto de control" },
      { id: "correct-line.correct-line.pinch-vector-line", es: "Pellizcar línea vectorial" },
      { id: "correct-line.correct-line.simplify-vector-line", es: "Simplificar línea vectorial" },
      { id: "correct-line.correct-line.connect-vector-lines", es: "Unir líneas vectoriales" },
      { id: "correct-line.correct-line.adjust-line-width", es: "Ajustar grosor de línea" },
      { id: "correct-line.correct-line.redraw-vector-line", es: "Redibujar línea vectorial" },
      { id: "correct-line.correct-line.redraw-vector-line-width", es: "Redibujar grosor vectorial" }
    ] },
    { id: "correct-line.remove-dust", es: "Quitar manchas", subtools: [
      { id: "correct-line.remove-dust.remove-dust", es: "Quitar manchas" },
      { id: "correct-line.remove-dust.fill-leftover", es: "Rellenar restos" },
      { id: "correct-line.remove-dust.select-dust", es: "Seleccionar manchas" }
    ] }
  ] },
  { id: "sketch", es: "Boceto", icon: "pencil", shortcut: "P", groups: [
    { id: "sketch.sketch", es: "Boceto", subtools: [
      { id: "sketch.sketch.pencil", es: "Lápiz" },
      { id: "sketch.sketch.mechanical-pencil", es: "Portaminas" },
      { id: "sketch.sketch.charcoal", es: "Carboncillo" },
      { id: "sketch.sketch.crayon", es: "Crayón" },
      { id: "sketch.sketch.pastel", es: "Pastel" },
      { id: "sketch.sketch.chalk", es: "Tiza" }
    ] }
  ] },
  { id: "brush", es: "Pincel", icon: "brush", shortcut: "B", groups: [
    { id: "brush.watercolor", es: "Acuarela", subtools: [
      { id: "brush.watercolor.round-watercolor-brush", es: "Pincel acuarela redondo" },
      { id: "brush.watercolor.flat-watercolor-brush", es: "Pincel acuarela plano" },
      { id: "brush.watercolor.soft-bleed", es: "Difuminado suave" },
      { id: "brush.watercolor.wet-wash", es: "Aguada húmeda" },
      { id: "brush.watercolor.rough-wash", es: "Aguada áspera" },
      { id: "brush.watercolor.watercolor-splash", es: "Salpicadura de acuarela" },
      { id: "brush.watercolor.watery-brush", es: "Pincel aguado" },
      { id: "brush.watercolor.brush-pen", es: "Pluma pincel" },
      { id: "brush.watercolor.dry-ink", es: "Tinta seca" },
      { id: "brush.watercolor.watery-ink", es: "Tinta aguada" },
      { id: "brush.watercolor.wet-blotting-ink", es: "Tinta con manchas húmedas" }
    ] },
    { id: "brush.thick-paint", es: "Pintura espesa", subtools: [
      { id: "brush.thick-paint.round-mixing-brush", es: "Pincel de mezcla redondo" },
      { id: "brush.thick-paint.gouache", es: "Gouache" },
      { id: "brush.thick-paint.dry-gouache", es: "Gouache seco" },
      { id: "brush.thick-paint.thin-gouache-brush", es: "Pincel de gouache fino" },
      { id: "brush.thick-paint.oil-paint", es: "Óleo" },
      { id: "brush.thick-paint.thick-oil-paint", es: "Óleo espeso" },
      { id: "brush.thick-paint.pointillism", es: "Puntillismo" },
      { id: "brush.thick-paint.gouache-blender", es: "Mezclador de gouache" },
      { id: "brush.thick-paint.paint-and-apply", es: "Pintar y aplicar" }
    ] }
  ] },
  { id: "liquify", es: "Licuar", icon: "liquify", shortcut: "J", groups: [
    { id: "liquify.liquify", es: "Licuar", subtools: [
      { id: "liquify.liquify.liquify", es: "Licuar" }
    ] }
  ] },
  { id: "airbrush", es: "Aerógrafo", icon: "airbrush", shortcut: "B", groups: [
    { id: "airbrush.airbrush", es: "Aerógrafo", subtools: [
      { id: "airbrush.airbrush.soft", es: "Suave" },
      { id: "airbrush.airbrush.spray", es: "Spray" },
      { id: "airbrush.airbrush.droplet", es: "Gotas" },
      { id: "airbrush.airbrush.noise", es: "Ruido" },
      { id: "airbrush.airbrush.running-color-spray", es: "Spray con chorreo" }
    ] }
  ] },
  { id: "eraser", es: "Borrador", icon: "eraser", shortcut: "E", groups: [
    { id: "eraser.eraser", es: "Borrador", subtools: [
      { id: "eraser.eraser.hard", es: "Duro" },
      { id: "eraser.eraser.soft", es: "Suave" },
      { id: "eraser.eraser.kneaded-eraser", es: "Goma moldeable" },
      { id: "eraser.eraser.rough", es: "Áspero" },
      { id: "eraser.eraser.dynamic-eraser", es: "Borrador dinámico" },
      { id: "eraser.eraser.vector", es: "Vectorial" },
      { id: "eraser.eraser.multiple-layers", es: "Varias capas" },
      { id: "eraser.eraser.snap-eraser", es: "Borrador con imán" }
    ] }
  ] },
  { id: "blend", es: "Mezclar", icon: "blend", shortcut: "J", groups: [
    { id: "blend.blend", es: "Mezclar", subtools: [
      { id: "blend.blend.blend", es: "Mezclar" },
      { id: "blend.blend.blur", es: "Desenfocar" },
      { id: "blend.blend.finger-tip", es: "Dedo" },
      { id: "blend.blend.painterly-blender", es: "Mezclador pictórico" },
      { id: "blend.blend.wet-bleed-blender", es: "Mezclador húmedo" },
      { id: "blend.blend.textured-blender", es: "Mezclador con textura" },
      { id: "blend.blend.copy-stamp", es: "Sello de copia" }
    ] }
  ] },
  { id: "fill", es: "Relleno", icon: "fill", shortcut: "G", groups: [
    { id: "fill.fill", es: "Relleno", subtools: [
      { id: "fill.fill.refer-other-layers", es: "Referir otras capas" },
      { id: "fill.fill.refer-only-to-editing-layer", es: "Solo la capa en edición" },
      { id: "fill.fill.enclose-and-fill", es: "Encerrar y rellenar" },
      { id: "fill.fill.lasso-fill", es: "Relleno con lazo" },
      { id: "fill.fill.leftover-pen", es: "Pluma de restos" }
    ] }
  ] },
  { id: "auto-select", es: "Selección automática", icon: "wand", shortcut: "W", groups: [
    { id: "auto-select.auto-select", es: "Selección automática", subtools: [
      { id: "auto-select.auto-select.refer-to-all-layers", es: "Referir todas las capas" },
      { id: "auto-select.auto-select.refer-to-editing-layer-only", es: "Solo la capa en edición" },
      { id: "auto-select.auto-select.selection-for-referred-layers", es: "Selección por capas de referencia" }
    ] }
  ] },
  { id: "selection-area", es: "Selección", icon: "select", shortcut: "M", groups: [
    { id: "selection-area.selection-area", es: "Selección", subtools: [
      { id: "selection-area.selection-area.lasso", es: "Lazo" },
      { id: "selection-area.selection-area.rectangle", es: "Rectángulo" },
      { id: "selection-area.selection-area.ellipse", es: "Elipse" },
      { id: "selection-area.selection-area.polyline", es: "Polilínea" },
      { id: "selection-area.selection-area.selection-pen", es: "Pluma de selección" },
      { id: "selection-area.selection-area.erase-selection", es: "Borrar selección" },
      { id: "selection-area.selection-area.shrink-selection", es: "Reducir selección" },
      { id: "selection-area.selection-area.magnetic-lasso", es: "Lazo magnético" }
    ] }
  ] },
  { id: "figure", es: "Figura", icon: "figure", shortcut: "U", groups: [
    { id: "figure.direct-draw", es: "Dibujo directo", subtools: [
      { id: "figure.direct-draw.straight-line", es: "Línea recta" },
      { id: "figure.direct-draw.curve", es: "Curva" },
      { id: "figure.direct-draw.polyline", es: "Polilínea" },
      { id: "figure.direct-draw.continuous-curve", es: "Curva continua" },
      { id: "figure.direct-draw.bezier-curve", es: "Curva Bézier" },
      { id: "figure.direct-draw.rectangle", es: "Rectángulo" },
      { id: "figure.direct-draw.ellipse", es: "Elipse" },
      { id: "figure.direct-draw.polygon", es: "Polígono" }
    ] }
  ] },
  { id: "operation", es: "Operación", icon: "cursor", shortcut: null, groups: [
    { id: "operation.operation", es: "Operación", subtools: [
      { id: "operation.operation.object", es: "Objeto" },
      { id: "operation.operation.select-layer", es: "Seleccionar capa" },
      { id: "operation.operation.move-layer", es: "Mover capa" },
      { id: "operation.operation.move-tone-pattern", es: "Mover trama de tono" },
      { id: "operation.operation.move-grid", es: "Mover cuadrícula" },
      { id: "operation.operation.light-table", es: "Mesa de luz" },
      { id: "operation.operation.edit-timeline", es: "Editar línea de tiempo" }
    ] }
  ] },
  { id: "eyedropper", es: "Cuentagotas", icon: "eyedropper", shortcut: "I", groups: [
    { id: "eyedropper.eyedropper", es: "Cuentagotas", subtools: [
      { id: "eyedropper.eyedropper.pick-displayed-color", es: "Tomar color mostrado" },
      { id: "eyedropper.eyedropper.pick-color-from-layer", es: "Tomar color de la capa" }
    ] }
  ] },
  { id: "decoration", es: "Decoración", icon: "sparkle", shortcut: "B", groups: [
    { id: "decoration.effect", es: "Efectos", subtools: [
      { id: "decoration.effect.sparkle", es: "Destello" },
      { id: "decoration.effect.bloodstain", es: "Mancha de sangre" },
      { id: "decoration.effect.dappled-light", es: "Luz moteada" },
      { id: "decoration.effect.glitter", es: "Purpurina" },
      { id: "decoration.effect.soft-circle", es: "Círculo suave" },
      { id: "decoration.effect.feather", es: "Pluma de ave" },
      { id: "decoration.effect.petal", es: "Pétalo" },
      { id: "decoration.effect.rose", es: "Rosa" },
      { id: "decoration.effect.cherry", es: "Cerezo" }
    ] },
    { id: "decoration.background", es: "Fondos", subtools: [
      { id: "decoration.background.leaves", es: "Hojas" },
      { id: "decoration.background.grass", es: "Hierba" },
      { id: "decoration.background.trees", es: "Árboles" },
      { id: "decoration.background.grassland", es: "Pradera" },
      { id: "decoration.background.grass-patch", es: "Mata de hierba" },
      { id: "decoration.background.fallen-leaves", es: "Hojas caídas" },
      { id: "decoration.background.ground", es: "Suelo" },
      { id: "decoration.background.crack", es: "Grieta" },
      { id: "decoration.background.cloud", es: "Nube" },
      { id: "decoration.background.rubble", es: "Escombros" },
      { id: "decoration.background.book", es: "Libro" },
      { id: "decoration.background.building", es: "Edificio" }
    ] },
    { id: "decoration.clothing", es: "Ropa", subtools: [
      { id: "decoration.clothing.lace", es: "Encaje" },
      { id: "decoration.clothing.simple-frill", es: "Volante simple" },
      { id: "decoration.clothing.braid", es: "Trenza" },
      { id: "decoration.clothing.thin-chain", es: "Cadena fina" },
      { id: "decoration.clothing.button", es: "Botón" },
      { id: "decoration.clothing.zipper", es: "Cremallera" },
      { id: "decoration.clothing.chain", es: "Cadena" },
      { id: "decoration.clothing.bead-chain", es: "Cadena de cuentas" }
    ] },
    { id: "decoration.hatching-and-sand-pattern", es: "Tramado y arena", subtools: [
      { id: "decoration.hatching-and-sand-pattern.gauze", es: "Gasa" },
      { id: "decoration.hatching-and-sand-pattern.gauze-cloud", es: "Nube de gasa" },
      { id: "decoration.hatching-and-sand-pattern.cross-hatching-x1", es: "Entramado x1" },
      { id: "decoration.hatching-and-sand-pattern.cross-hatching-x4", es: "Entramado x4" },
      { id: "decoration.hatching-and-sand-pattern.rough-crosshatch", es: "Entramado áspero" },
      { id: "decoration.hatching-and-sand-pattern.light-crosshatch", es: "Entramado ligero" },
      { id: "decoration.hatching-and-sand-pattern.black-soot", es: "Hollín negro" },
      { id: "decoration.hatching-and-sand-pattern.cross-hatching-for-tone-scraping", es: "Entramado (para raspar tonos)" },
      { id: "decoration.hatching-and-sand-pattern.sand-for-tone-scraping", es: "Arena (para raspar tonos)" }
    ] },
    { id: "decoration.ruled-line", es: "Líneas decorativas", subtools: [
      { id: "decoration.ruled-line.waved-line", es: "Línea ondulada" },
      { id: "decoration.ruled-line.rough-edged", es: "Borde áspero" },
      { id: "decoration.ruled-line.bumpy", es: "Irregular" },
      { id: "decoration.ruled-line.dashed-line", es: "Línea discontinua" },
      { id: "decoration.ruled-line.dotted-line", es: "Línea de puntos" },
      { id: "decoration.ruled-line.star", es: "Estrella" },
      { id: "decoration.ruled-line.melody", es: "Melodía" }
    ] }
  ] },
  { id: "text", es: "Texto", icon: "text", shortcut: "T", groups: [
    { id: "text.text", es: "Texto", subtools: [
      { id: "text.text.text", es: "Texto" },
      { id: "text.text.circular-text", es: "Texto circular" }
    ] }
  ] },
  { id: "ruler", es: "Regla", icon: "ruler", shortcut: "U", groups: [
    { id: "ruler.create-ruler", es: "Crear regla", subtools: [
      { id: "ruler.create-ruler.linear-ruler", es: "Regla lineal" },
      { id: "ruler.create-ruler.curve-ruler", es: "Regla curva" },
      { id: "ruler.create-ruler.figure-ruler", es: "Regla de figura" },
      { id: "ruler.create-ruler.ruler-pen", es: "Pluma de regla" },
      { id: "ruler.create-ruler.special-ruler", es: "Regla especial" },
      { id: "ruler.create-ruler.guide", es: "Guía" },
      { id: "ruler.create-ruler.perspective-ruler", es: "Regla de perspectiva" },
      { id: "ruler.create-ruler.symmetrical-ruler", es: "Regla simétrica" }
    ] }
  ] },
  { id: "comic", es: "Cómic", icon: "balloon", shortcut: "N", groups: [
    { id: "comic.balloon", es: "Globo", subtools: [
      { id: "comic.balloon.rounded-balloon", es: "Globo redondeado" },
      { id: "comic.balloon.rough-rounded-balloon", es: "Globo redondeado áspero" },
      { id: "comic.balloon.ellipse-balloon", es: "Globo elíptico" },
      { id: "comic.balloon.curve-balloon", es: "Globo curvo" },
      { id: "comic.balloon.rectangle-balloon", es: "Globo rectangular" },
      { id: "comic.balloon.balloon-pen", es: "Pluma de globo" },
      { id: "comic.balloon.balloon-tail", es: "Cola de globo" },
      { id: "comic.balloon.thought-balloon-tail", es: "Cola de pensamiento" }
    ] },
    { id: "comic.frame-border", es: "Borde de viñeta", subtools: [
      { id: "comic.frame-border.rectangle-frame", es: "Viñeta rectangular" },
      { id: "comic.frame-border.rough-rectangle", es: "Rectángulo áspero" },
      { id: "comic.frame-border.polyline-frame", es: "Viñeta poligonal" },
      { id: "comic.frame-border.frame-border-pen", es: "Pluma de viñeta" },
      { id: "comic.frame-border.divide-frame-border", es: "Dividir viñeta" },
      { id: "comic.frame-border.divide-frame-folder", es: "Dividir carpeta de viñetas" }
    ] },
    { id: "comic.flash", es: "Destellos", subtools: [
      { id: "comic.flash.flash-pattern", es: "Patrón de destello" },
      { id: "comic.flash.flash", es: "Destellos" },
      { id: "comic.flash.dense-flash", es: "Destello denso" },
      { id: "comic.flash.sea-urchin-flash", es: "Destello erizo" },
      { id: "comic.flash.firework", es: "Fuegos artificiales" }
    ] },
    { id: "comic.focus-lines", es: "Líneas de enfoque", subtools: [
      { id: "comic.focus-lines.scattered-focus-lines", es: "Líneas de enfoque dispersas" },
      { id: "comic.focus-lines.dark-focus-lines-curved", es: "Líneas de enfoque oscuras (curvas)" },
      { id: "comic.focus-lines.dense-focus-lines", es: "Líneas de enfoque densas" },
      { id: "comic.focus-lines.brightness", es: "Brillo" },
      { id: "comic.focus-lines.burst", es: "Explosión" }
    ] },
    { id: "comic.speed-lines", es: "Líneas de velocidad", subtools: [
      { id: "comic.speed-lines.scattered-speed-lines", es: "Líneas de velocidad dispersas" },
      { id: "comic.speed-lines.dark-speed-lines", es: "Líneas de velocidad oscuras" },
      { id: "comic.speed-lines.gloom", es: "Líneas de abatimiento" },
      { id: "comic.speed-lines.rain", es: "Lluvia" }
    ] }
  ] }
];
