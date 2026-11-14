// A 4K page at a high resolution with many layers, each with something drawn: the load the other suites run against.
const layers = Number(ARGS.layers ?? 36);
const t0 = performance.now();
await newDocument('13', String(ARGS.dpi ?? 600));
await fillLayers(layers, Number(ARGS.strokes ?? 5));
const tiles = L.doc.layers.map((l) => l.surface.tileCount);
return {
  metrics: { page: `${L.doc.width}x${L.doc.height} @${L.doc.dpi} ppp`, layers: L.doc.layers.length, tilesPerLayer: stats(tiles), seconds: Math.round((performance.now() - t0) / 1000) },
  checks: [check('sin errores', newErrors().length, 0), check('capas creadas', L.doc.layers.length, layers, 'min')],
};
