# Pruebas del núcleo en dispositivo real

Miden y comprueban el motor (compositor, vista, herramientas, documento) con la GPU real, en la tableta y en escritorio. Las pruebas
de lógica pura están en `src/**/*.test.ts` (`npm test`); esto cubre lo que solo se ve con un dispositivo y un WebView.

```
npm run device -- tablet                       # setup, parity, zoom, pan, stress
npm run device -- tablet strokecost            # coste de cada muestra del lápiz
npm run device -- desktop setup,zoom --layers 20
```

- **tablet**: la APK debug abierta y la depuración USB activa. Solo se ejecutan `pidof` y `forward` del socket de depuración;
  no se lee nada del almacenamiento.
- **desktop**: la aplicación iniciada con `--remote-debugging-port=9222` (o `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`), o Chrome con
  ese puerto abierto sobre el servidor de desarrollo.

| Prueba | Qué comprueba |
| --- | --- |
| `setup` | Crea una página 4K a 600 ppp con muchas capas dibujadas (`--layers`, por defecto 36). |
| `parity` | El compositor da la misma imagen, byte a byte, con y sin sus atajos (copia parcial, sombreado por tile), a varios zooms. |
| `zoom` / `pan` | Tiempo de GPU por fotograma y fotogramas largos con zoom rápido y paneo. |
| `stress` | Acciones aleatorias (capas, deshacer, trazos, relleno, selecciones, vista…): sin errores, sin perder el contexto GL. `--steps`, `--seed`. |
| `fillcost` | El bote en una página con muchas capas: un toque recién elegida la herramienta (en frío) y con la página ya preparada. Se usa después de `setup`. |
| `strokecost` | Coste por muestra del lápiz según tamaño y dureza, y de los fotogramas mientras se pinta. |

Los límites están en cada prueba (`check(...)`), distintos para tableta y escritorio. `--out informe.json` guarda todo.

## Lápiz (`strokes/`)

```
node scripts/device-tests/strokes/record.mjs tablet --stab 0 --out traza.json
npx vite-node scripts/device-tests/strokes/analyze.ts traza.json
```

`record.mjs` abre una página nueva y la pantalla dice qué dibujar, paso a paso. Se graban los eventos del lápiz con su tiempo,
presión, inclinación, los puntos agrupados y los predichos del navegador y el fotograma en que se vieron. `analyze.ts` informa de
la frecuencia de muestreo, los retrasos, el error de la predicción (la del navegador y varias propias, en `predict.ts`) y de lo que
hace el estabilizador (`src/engine/stabilizer.ts`) sobre lo grabado.
