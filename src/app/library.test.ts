import { describe, expect, it } from 'vitest';
import {
  baseRel,
  crumbs,
  dropFavourites,
  fileKind,
  arrange,
  followMove,
  formatSize,
  formatWhen,
  isInside,
  joinRel,
  nameClash,
  nameProblem,
  parentRel,
  parsePrefs,
  placeBeside,
  relocateOrder,
  toggleFavourite,
  uniqueName,
  visibleEntries,
  type LibEntry,
} from './library';

const file = (name: string, modified = 0, size = 0, rel = name): LibEntry => ({ name, rel, dir: false, size, modified });
const dir = (name: string): LibEntry => ({ name, rel: name, dir: true, size: 0, modified: 0 });

describe('file kinds', () => {
  it('tells the openable formats from the rest', () => {
    expect(fileKind('a.lienzo')).toBe('lienzo');
    expect(fileKind('a.PSD')).toBe('psd');
    expect(fileKind('a.psb')).toBe('psd');
    expect(fileKind('a.clip')).toBe('clip');
    expect(fileKind('a.ora')).toBe('ora');
    expect(fileKind('a.JPG')).toBe('image');
    expect(fileKind('notas.txt')).toBeNull();
    expect(fileKind('sin_extension')).toBeNull();
  });
});

describe('paths', () => {
  it('joins, splits and walks', () => {
    expect(joinRel('', 'a')).toBe('a');
    expect(joinRel('x/y', 'a')).toBe('x/y/a');
    expect(parentRel('x/y/a')).toBe('x/y');
    expect(parentRel('a')).toBe('');
    expect(baseRel('x/y/a.lienzo')).toBe('a.lienzo');
    expect(crumbs('x/y')).toEqual([
      { name: 'x', rel: 'x' },
      { name: 'y', rel: 'x/y' },
    ]);
    expect(crumbs('')).toEqual([]);
    expect(isInside('x/y', 'x')).toBe(true);
    expect(isInside('xy', 'x')).toBe(false);
    expect(isInside('x', 'x')).toBe(true);
  });
});

describe('nameProblem', () => {
  it('accepts ordinary names and refuses the ones some system cannot keep', () => {
    expect(nameProblem('Manga cap. 3')).toBeNull();
    expect(nameProblem('boceto_02.lienzo')).toBeNull();
    expect(nameProblem('')).not.toBeNull();
    expect(nameProblem('   ')).not.toBeNull();
    expect(nameProblem('a/b')).not.toBeNull();
    expect(nameProblem('a:b')).not.toBeNull();
    expect(nameProblem('..')).not.toBeNull();
    expect(nameProblem('.oculto')).not.toBeNull();
    expect(nameProblem('fin.')).not.toBeNull();
    expect(nameProblem('NUL')).not.toBeNull();
    expect(nameProblem('com1.txt')).not.toBeNull();
    expect(nameProblem('x'.repeat(121))).not.toBeNull();
  });
});

describe('nameClash', () => {
  it('counts another entry that differs only in case, but not the one being renamed', () => {
    // Android: "Foo" and "foo" are two documents, so renaming one to the other's name would replace it.
    expect(nameClash('foo.lienzo', ['Foo.lienzo', 'foo.lienzo'], 'Foo.lienzo')).toBe(true);
    expect(nameClash('FOO.lienzo', ['Foo.lienzo', 'foo.lienzo'], 'Foo.lienzo')).toBe(true);
    // Windows: only the entry itself is there, and a case-only rename is fine.
    expect(nameClash('foo.lienzo', ['Foo.lienzo', 'bar.lienzo'], 'Foo.lienzo')).toBe(false);
    expect(nameClash('bar.lienzo', ['Foo.lienzo', 'bar.lienzo'], 'Foo.lienzo')).toBe(true);
    expect(nameClash('new.lienzo', ['Foo.lienzo'])).toBe(false);
    expect(nameClash('FOO.lienzo', ['Foo.lienzo'])).toBe(true);
  });
});

describe('uniqueName', () => {
  it('keeps a free name and numbers a taken one', () => {
    expect(uniqueName('a.lienzo', ['b.lienzo'])).toBe('a.lienzo');
    expect(uniqueName('a.lienzo', ['A.LIENZO'])).toBe('a copia.lienzo');
    expect(uniqueName('a.lienzo', ['a.lienzo', 'a copia.lienzo'])).toBe('a copia 2.lienzo');
    expect(uniqueName('Manga', ['Manga'])).toBe('Manga copia');
    expect(uniqueName('v1.2', ['v1.2'])).toBe('v1 copia.2');
    expect(uniqueName('Manga cap. 3', ['Manga cap. 3'], false)).toBe('Manga cap. 3 copia');
  });
});

describe('visibleEntries', () => {
  const all = [file('b.psd', 5, 10), file('a.lienzo', 9, 30), file('c.png', 1, 20), file('nota.txt', 9), file('.oculto.lienzo', 9), dir('Fondos'), dir('Archivo')];

  it('puts folders first, then files newest first', () => {
    const v = visibleEntries(all, { type: 'all', query: '', sort: 'date' });
    expect(v.map((e) => e.name)).toEqual(['Archivo', 'Fondos', 'a.lienzo', 'b.psd', 'c.png']);
  });

  it('sorts by name and by size', () => {
    expect(visibleEntries(all, { type: 'all', query: '', sort: 'name' }).filter((e) => !e.dir).map((e) => e.name)).toEqual(['a.lienzo', 'b.psd', 'c.png']);
    expect(visibleEntries(all, { type: 'all', query: '', sort: 'size' }).filter((e) => !e.dir).map((e) => e.name)).toEqual(['a.lienzo', 'c.png', 'b.psd']);
  });

  it('filters by type (folders only show with "all") and by search', () => {
    expect(visibleEntries(all, { type: 'psd', query: '', sort: 'date' }).map((e) => e.name)).toEqual(['b.psd']);
    expect(visibleEntries(all, { type: 'image', query: '', sort: 'date' }).map((e) => e.name)).toEqual(['c.png']);
    expect(visibleEntries(all, { type: 'all', query: 'FON', sort: 'date' }).map((e) => e.name)).toEqual(['Fondos']);
  });

  it('orders numbered names naturally', () => {
    const v = visibleEntries([file('p10.lienzo'), file('p2.lienzo'), file('p1.lienzo')], { type: 'all', query: '', sort: 'name' });
    expect(v.map((e) => e.name)).toEqual(['p1.lienzo', 'p2.lienzo', 'p10.lienzo']);
  });
});

describe('formatting', () => {
  it('writes sizes', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(1536)).toBe('1,5 KB');
    expect(formatSize(2 * 1024 * 1024)).toBe('2 MB');
    expect(formatSize(150 * 1024 * 1024)).toBe('150 MB');
  });

  it('says when', () => {
    const now = new Date(2026, 10, 17, 15, 0).getTime();
    expect(formatWhen(0, now)).toBe('');
    expect(formatWhen(new Date(2026, 10, 17, 1, 0).getTime(), now)).toBe('hoy');
    expect(formatWhen(new Date(2026, 10, 16, 23, 0).getTime(), now)).toBe('ayer');
    expect(formatWhen(new Date(2026, 10, 12, 10, 0).getTime(), now)).toBe('hace 5 días');
    expect(formatWhen(new Date(2026, 5, 1).getTime(), now)).toMatch(/jun/);
  });
});

describe('favourites and prefs', () => {
  it('toggles, follows a move and drops what was deleted', () => {
    expect(toggleFavourite(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleFavourite(['a', 'b'], 'a')).toEqual(['b']);
    expect(followMove(['x/a', 'x', 'y'], 'x', 'z')).toEqual(['z/a', 'z', 'y']);
    expect(followMove(['xa'], 'x', 'z')).toEqual(['xa']);
    expect(dropFavourites(['x/a', 'x', 'xy'], 'x')).toEqual(['xy']);
  });

  it('reads stored prefs defensively', () => {
    expect(parsePrefs(null).place).toBe('recent');
    expect(parsePrefs('{no json').favourites).toEqual([]);
    expect(parsePrefs('{"favourites":["a",3,"a",""],"place":"Manga","view":"list","sort":"size","order":{"":["b","a","b",4],"x":"no"}}')).toEqual({ favourites: ['a'], order: { '': ['b', 'a'] }, place: 'Manga', view: 'list', sort: 'size' });
    expect(parsePrefs('{"view":"x","sort":"y"}')).toMatchObject({ view: 'grid', sort: 'date' });
  });
});

describe('folder order', () => {
  it('puts the saved order first and the rest alphabetically', () => {
    expect(arrange(['b', 'a', 'c'], undefined)).toEqual(['a', 'b', 'c']);
    expect(arrange(['b', 'a', 'c', 'd'], ['c', 'x', 'a', 'c'])).toEqual(['c', 'a', 'b', 'd']);
  });

  it('places a folder above or below another', () => {
    expect(placeBeside(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
    expect(placeBeside(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
    expect(placeBeside(['a', 'b'], 'z', 'q', 'before')).toEqual(['a', 'b', 'z']);
  });

  it('follows a rename, a move and a delete', () => {
    const order = { '': ['x', 'y'], x: ['p', 'q'], 'x/p': ['k'] };
    expect(relocateOrder(order, 'x', 'z')).toEqual({ '': ['z', 'y'], z: ['p', 'q'], 'z/p': ['k'] });
    expect(relocateOrder(order, 'x/p', 'y/p')).toEqual({ '': ['x', 'y'], x: ['q'], 'y/p': ['k'] });
    expect(relocateOrder(order, 'x', null)).toEqual({ '': ['y'] });
  });
});
