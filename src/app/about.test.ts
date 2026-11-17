import { describe, expect, it } from 'vitest';
import { aboutLines, buildKind, osName, versionLabel, type BuildInfo } from './about';

const official: BuildInfo = { debug: false, os: 'android', identifier: 'app.lienzo.studio' };
const test: BuildInfo = { debug: true, os: 'android', identifier: 'app.lienzo.studio.debug' };

describe('about', () => {
  it('tells the kinds of build apart', () => {
    expect(buildKind(official)).toBe('official');
    expect(buildKind(test)).toBe('test');
    expect(buildKind(null)).toBe('browser');
    expect(osName('windows')).toBe('Windows');
    expect(osName('plan9')).toBe('plan9');
  });

  it('marks the version of a build that is not the official one', () => {
    expect(versionLabel('0.1.2', official)).toBe('0.1.2');
    expect(versionLabel('0.1.2', test)).toBe('0.1.2 (pruebas)');
    expect(versionLabel('0.1.2', null)).toBe('0.1.2 (navegador)');
  });

  it('describes the installed app', () => {
    const o = aboutLines('0.1.2', official).join('\n');
    expect(o).toContain('Lienzo 0.1.2');
    expect(o).toContain('Versión oficial, instalada en Android');
    expect(o).toContain('app.lienzo.studio');
    expect(o).not.toContain('pruebas');
  });

  it('warns that a test build on Android is not updated by the updater', () => {
    const t = aboutLines('0.1.2', test).join('\n');
    expect(t).toContain('Versión de pruebas (debug) en Android');
    expect(t).toContain('app.lienzo.studio.debug');
    expect(t).toContain('otra app aparte');
    const desktop = aboutLines('0.1.2', { debug: true, os: 'windows', identifier: 'app.lienzo.studio' }).join('\n');
    expect(desktop).toContain('Versión de pruebas (debug) en Windows');
    expect(desktop).not.toContain('otra app aparte');
  });

  it('says so in a browser', () => {
    expect(aboutLines('0.1.2', null).join('\n')).toContain('navegador');
  });
});
