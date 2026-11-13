import { describe, expect, it } from 'vitest';
import { CLIP_DB_BASE64 } from './clip-fixture';
import { SqliteDb, parseCreateTable } from './sqlite-read';

const db = (): Uint8Array => Uint8Array.from(atob(CLIP_DB_BASE64), (c) => c.charCodeAt(0));

describe('SqliteDb', () => {
  it('lists the tables and their columns', () => {
    const d = new SqliteDb(db());
    expect(d.tables()).toContain('layer');
    expect(d.has('Canvas')).toBe(true);
    expect(d.columns('Canvas')).toEqual(['MainId', 'CanvasWidth', 'CanvasHeight', 'CanvasResolution', 'CanvasRootFolder']);
  });

  it('reads rows with text, integers, reals, nulls and the rowid alias', () => {
    const d = new SqliteDb(db());
    expect(d.rows('Canvas')).toEqual([{ MainId: 1, CanvasWidth: 300, CanvasHeight: 260, CanvasResolution: 350, CanvasRootFolder: 1 }]);
    const layers = d.rows('Layer');
    expect(layers.map((r) => r.LayerName)).toEqual(['Raíz', 'Fondo', 'Grupo', 'Dentro']);
    expect(layers[1]!.MainId).toBe(2);
    expect(layers[1]!.LayerLayerMaskMipmap).toBeNull();
  });

  it('follows overflow pages for a value larger than a page', () => {
    const blob = new SqliteDb(db()).rows('CanvasPreview')[0]!.ImageData as Uint8Array;
    expect(blob.length).toBe(9000);
    for (let i = 0; i < blob.length; i++) if (blob[i] !== ((i * 7) & 255)) throw new Error(`byte ${i} differs`);
  });

  it('refuses files that are not SQLite and files cut short', () => {
    expect(() => new SqliteDb(new Uint8Array(2048))).toThrow(/SQLite/);
    const cut = db().subarray(0, 4096 * 3);
    expect(() => new SqliteDb(cut).rows('CanvasPreview')).toThrow();
    expect(() => new SqliteDb(db()).rows('Nope')).toThrow(/tabla/);
  });

  it('does not loop on a page that points to itself', () => {
    const bytes = db();
    const d = new SqliteDb(bytes);
    // Turn the root of the Layer table into an interior page whose only child is itself.
    const root = (() => {
      const m = d as unknown as { info(t: string): { root: number } };
      return m.info('Layer').root;
    })();
    const at = (root - 1) * 4096;
    bytes[at] = 0x05;
    bytes[at + 3] = 0;
    bytes[at + 4] = 0; // no cells
    new DataView(bytes.buffer).setUint32(at + 8, root); // right-most pointer: itself
    expect(() => d.rows('Layer')).toThrow(/ciclo|dañada/);
  });
});

describe('parseCreateTable', () => {
  it('finds column names through quoting, constraints and nested parentheses', () => {
    const p = parseCreateTable('CREATE TABLE t (id INTEGER PRIMARY KEY, "a b" TEXT, `c` REAL DEFAULT (1+2), [d] BLOB, PRIMARY KEY (id), UNIQUE (c, d))')!;
    expect(p.columns).toEqual(['id', 'a b', 'c', 'd']);
    expect(p.rowidColumn).toBe(0);
  });
});
