/**
 * What "Acerca de" says: which version this is and what kind of build it is. The official release and the test build (the one
 * installed with adb, or run with `tauri dev`) are different apps on Android (another identifier, another signature), so the
 * person needs to be able to tell them apart. The facts come from the native side (`build_info` in src-tauri/src/lib.rs).
 */

export interface BuildInfo {
  /** A development or test build (`debug_assertions`), not the one published as a release. */
  debug: boolean;
  /** `windows`, `android`, `macos`, `linux`. */
  os: string;
  /** The app's identifier: `app.lienzo.studio`, with `.debug` on a test build for Android. */
  identifier: string;
}

declare const __APP_VERSION__: string;

/** The version of a page running in a browser (the desktop and Android apps ask the system instead). */
export const pageVersion = (): string => (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '?');

const OS: Record<string, string> = { windows: 'Windows', android: 'Android', macos: 'macOS', linux: 'Linux' };
export const osName = (os: string): string => OS[os] ?? os;

/** `null` = running in a browser. */
export type BuildKind = 'official' | 'test' | 'browser';
export const buildKind = (b: BuildInfo | null): BuildKind => (!b ? 'browser' : b.debug ? 'test' : 'official');

/** The version as shown next to the installed one: a test build says so. */
export const versionLabel = (version: string, b: BuildInfo | null): string => (buildKind(b) === 'official' ? version : `${version} (${buildKind(b) === 'test' ? 'pruebas' : 'navegador'})`);

/** The lines of the "Acerca de" window. */
export function aboutLines(version: string, b: BuildInfo | null): string[] {
  const kind = buildKind(b);
  const lines = [`Lienzo ${version}`];
  if (kind === 'official') lines.push(`Versión oficial, instalada en ${osName(b!.os)}.`);
  else if (kind === 'test') lines.push(`Versión de pruebas (debug) en ${osName(b!.os)}: una compilación de desarrollo, no la oficial.`);
  else lines.push('Se está ejecutando en el navegador (modo desarrollo): no es una versión instalada.');
  if (b) lines.push(`Identificador de la app: ${b.identifier}`);
  if (kind === 'test' && b?.os === 'android') {
    lines.push('«Buscar actualizaciones» instala la versión oficial como otra app aparte (otro identificador y otra firma): esta de pruebas no se actualiza por sí sola. Puedes desinstalarla cuando ya uses la oficial.');
  }
  lines.push('', 'Editor de dibujo y manga con motor propio por teselas y compositor WebGL.');
  return lines;
}
