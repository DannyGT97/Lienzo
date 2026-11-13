import { describe, expect, it } from 'vitest';
import { ProcessMemoryProbe, formatBytes, memoryRows, memorySummary, processMemorySupported, type MemoryFigures } from './memory-info';

const figures: MemoryFigures = {
  historySteps: 12,
  historyBytes: 3 * (1 << 20),
  documentBytes: 8 * (1 << 20),
  documentTiles: 32,
  openDocuments: 1,
  openDocumentsBytes: 8 * (1 << 20),
  gpuTextures: 4,
};

const labels = (rows: [string, string][]): string[] => rows.map(([l]) => l);
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('formatBytes', () => {
  it('picks KB, MB or GB', () => {
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * (1 << 20))).toBe('3.0 MB');
    expect(formatBytes(1.5 * (1 << 30))).toBe('1.5 GB');
  });
});

describe('memorySummary', () => {
  it('keeps history and document apart and never sums them', () => {
    const rows = memorySummary(figures, null);
    expect(rows).toEqual([
      ['Historial de deshacer', '3.0 MB'],
      ['Documento', '8.0 MB'],
    ]);
  });

  it('shows the application row only when the browser measured it', () => {
    expect(labels(memorySummary(figures, null))).not.toContain('Aplicación');
    expect(memorySummary(figures, 100 * (1 << 20))).toContainEqual(['Aplicación', '100.0 MB']);
  });

  it('adds the all-documents row only with several documents open', () => {
    expect(labels(memorySummary({ ...figures, openDocuments: 3, openDocumentsBytes: 20 * (1 << 20) }, null))).toContain('Todos los documentos');
    expect(labels(memorySummary(figures, null))).not.toContain('Todos los documentos');
  });
});

describe('memoryRows', () => {
  it('adds the step count and GPU textures around the summary', () => {
    expect(memoryRows(figures, null)).toEqual([
      ['Pasos de historial', '12'],
      ['Historial de deshacer', '3.0 MB'],
      ['Documento', '8.0 MB'],
      ['Texturas GPU', '4'],
    ]);
  });
});

describe('ProcessMemoryProbe', () => {
  const env = (measure?: () => Promise<{ bytes: number }>, isolated = true) => ({
    crossOriginIsolated: isolated,
    performance: measure ? { measureUserAgentSpecificMemory: measure } : {},
  });

  it('is unsupported without cross-origin isolation or the measuring function', () => {
    expect(processMemorySupported(env(async () => ({ bytes: 1 }), false))).toBe(false);
    expect(processMemorySupported(env(undefined))).toBe(false);
    const probe = new ProcessMemoryProbe(env(undefined));
    probe.poke();
    expect(probe.supported).toBe(false);
    expect(probe.value).toBeNull();
  });

  it('keeps the last real measurement and asks again only after the gap', async () => {
    let calls = 0;
    let t = 0;
    const probe = new ProcessMemoryProbe(env(async () => ({ bytes: 1000 * ++calls })), () => t, 30_000);
    probe.poke();
    probe.poke();
    await flush();
    expect(calls).toBe(1);
    expect(probe.value).toBe(1000);
    t = 10_000;
    probe.poke();
    await flush();
    expect(calls).toBe(1);
    t = 40_000;
    probe.poke();
    await flush();
    expect(calls).toBe(2);
    expect(probe.value).toBe(2000);
  });

  it('forgets the value when a measurement fails', async () => {
    let fail = false;
    let t = 0;
    const probe = new ProcessMemoryProbe(
      env(async () => {
        if (fail) throw new Error('denied');
        return { bytes: 5 };
      }),
      () => t,
      10,
    );
    probe.poke();
    await flush();
    expect(probe.value).toBe(5);
    fail = true;
    t = 100;
    probe.poke();
    await flush();
    expect(probe.value).toBeNull();
  });
});
