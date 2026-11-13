import { describe, expect, it } from 'vitest';
import type { FileRef } from './file-io';
import { mergeRecent, parseRecent, sameFile, withoutRecent, type RecentFile } from './recent-files';

const file = (path: string): FileRef => ({ kind: 'tauri', path, name: path.split('/').pop()! });
const item = (path: string): RecentFile => ({ ref: file(path), name: file(path).name });

describe('recent files', () => {
  it('puts the newest first and lists a file only once', async () => {
    const list = await mergeRecent([item('/a/one.lienzo'), item('/a/two.lienzo')], file('/a/two.lienzo'), sameFile);
    expect(list.map((r) => r.name)).toEqual(['two.lienzo', 'one.lienzo']);
  });

  it('keeps only the newest ones', async () => {
    let list: RecentFile[] = [];
    for (let n = 0; n < 15; n++) list = await mergeRecent(list, file(`/a/f${n}.lienzo`), sameFile, 10);
    expect(list).toHaveLength(10);
    expect(list[0]!.name).toBe('f14.lienzo');
    expect(list[9]!.name).toBe('f5.lienzo');
  });

  it('removes one file and leaves the rest in order', async () => {
    const list = await withoutRecent([item('/a/1'), item('/a/2'), item('/a/3')], file('/a/2'), sameFile);
    expect(list.map((r) => r.name)).toEqual(['1', '3']);
  });

  it('tells browser handles apart with the browser\'s own comparison', async () => {
    const handle = (same: boolean) => ({ getFile: () => Promise.resolve(new File([], 'x')), isSameEntry: () => Promise.resolve(same) }) as unknown as FileSystemFileHandle;
    expect(await sameFile({ kind: 'browser', handle: handle(true), name: 'x' }, { kind: 'browser', handle: handle(true), name: 'x' })).toBe(true);
    expect(await sameFile({ kind: 'browser', handle: handle(false), name: 'x' }, { kind: 'browser', handle: handle(false), name: 'x' })).toBe(false);
    expect(await sameFile(file('/a'), { kind: 'browser', handle: handle(true), name: 'a' })).toBe(false);
  });

  it('reads back only well-formed entries', () => {
    const good = { ref: { kind: 'tauri', path: '/a/x.lienzo', name: 'x.lienzo' }, name: 'x.lienzo' };
    expect(parseRecent([good, null, 7, { ref: { kind: 'tauri', name: 'no path' } }, { ref: { kind: 'browser', name: 'no handle' } }, { ref: { kind: 'other', name: 'x' } }])).toEqual([good]);
    expect(parseRecent('nope')).toEqual([]);
    expect(parseRecent(undefined)).toEqual([]);
  });
});
