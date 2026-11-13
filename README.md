# Lienzo

Editor de dibujo y manga, de código abierto y sin conexión, para Windows y tabletas Android. Escrito en TypeScript (Vite, Canvas/WebGL2) con Tauri 2.

> Proyecto independiente. No está afiliado a CELSYS. «Clip Studio Paint» es una marca de CELSYS; Lienzo lee y escribe sus archivos `.clip` solo por interoperabilidad.

## Qué hace
- Capas, carpetas, máscaras, modos de mezcla y capas de corrección tonal.
- Pinceles, goma, aerógrafo, bote de pintura, degradados, selecciones, transformar y filtros.
- Guarda y abre `.lienzo` (formato propio), PSD/PSB, OpenRaster y `.clip`; importa PNG, JPG, WebP, AVIF, BMP, TIFF, TGA, GIF, SVG y más.
- Autoguardado y recuperación de sesión, archivos recientes, paneles redimensionables, lápiz con presión y gestos táctiles.

## Privacidad y funcionamiento sin conexión
Lienzo funciona por completo **sin conexión**: sin cuentas, sin telemetría y sin enviar nada de tus dibujos. La aplicación lleva una política de seguridad de contenido estricta que no permite ninguna conexión a la web.

## Actualizaciones (solo si tú quieres)
Lienzo **nunca busca actualizaciones por su cuenta**. Solo si eliges **Ayuda ▸ Buscar actualizaciones…** y aceptas el aviso, la parte nativa de la aplicación (no la web interna) se conecta a `github.com/DannyGT97/Lienzo/releases`, mira si hay una versión más nueva y, si tú lo confirmas, la descarga. No se envía ningún dato tuyo. Antes de instalar se comprueba la **firma** del paquete con una clave pública incluida en la aplicación; si no coincide, no se instala.
- **Windows:** el actualizador oficial de Tauri.
- **Android:** el mismo comprobador firmado; Android te pide confirmar la instalación y exige que el paquete lleve la firma de Lienzo. Por esto la versión de Android incluye el permiso de Internet (y el de pedir la instalación de la actualización): solo se usan cuando eliges buscar actualizaciones.
Sin conexión, o sin pulsar nunca ese botón, todo lo demás funciona igual.

## Descargas
Instaladores para Windows (x64) y la APK de Android (arm64) en [Releases](../../releases).

## Desarrollo
Requisitos: Node.js, Rust y, para Android, el SDK y el NDK.

```bash
npm ci
npm run dev              # servidor de desarrollo en el navegador
npm test                 # pruebas
npm run tauri -- dev     # aplicación de escritorio
npm run tauri -- build   # instalador de Windows
```

## Licencia
[MIT](LICENSE). Avisos de terceros en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
