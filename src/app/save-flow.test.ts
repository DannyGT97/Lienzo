import { describe, expect, it } from 'vitest';
import { WriteDeniedError, type FileRef, type SaveTarget } from './file-io';
import { createSaveFlow, type Association, type SaveFlowDeps } from './save-flow';
import type { SaveFailure, SavedResult } from './save-notice';
import type { SaveFormat, SaveKind } from './save-formats';

const ref = (name: string): FileRef => ({ kind: 'tauri', path: `C:/work/${name}`, name });

/** A document tied to Obra.psd, with every outside step recorded and the file writes under the test's control. */
function setup(over: { association?: Partial<Association>; chosen?: string | null; canClip?: boolean; reportsType?: boolean; asked?: SaveFormat | null } = {}) {
  const state: Association = { file: ref('Obra.psd'), format: 'psd', name: 'Obra', clipOverwriteOk: false, ...over.association };
  const log: string[] = [];
  const writes: { to: string; blob: Blob }[] = [];
  const asked: { kind: SaveKind; options: SaveFormat[] }[] = [];
  const filters: string[][] = [];
  const failures: string[] = [];
  const failureSteps: SaveFailure[] = [];
  const results: SavedResult[] = [];
  const denials: string[] = [];
  const working: (string | null)[] = [];
  let revision = 7;
  const saved: number[] = [];
  let release: (() => void) | null = null;
  let hold = false;
  let failWrite = false;
  let denyTied = false;
  let confirm = true;

  const written = async (): Promise<void> => {
    if (failWrite) throw new Error('disco lleno');
    if (hold) await new Promise<void>((r) => (release = r));
  };
  const deps: SaveFlowDeps = {
    association: () => ({ ...state }),
    associate: (next) => {
      log.push(`associate:${next.file?.name ?? 'null'}:${next.format}:${next.name}`);
      Object.assign(state, next);
    },
    revision: () => revision,
    markSaved: (r) => {
      saved.push(r);
      log.push(`markSaved:${r}`);
    },
    canWriteClip: () => over.canClip ?? true,
    baseName: () => state.name,
    dialogReportsType: () => over.reportsType ?? true,
    askFormat: async (kind, _preferred, options) => {
      asked.push({ kind, options });
      return over.asked ?? null;
    },
    confirmClipOverwrite: async () => confirm,
    chooseTarget: async (suggested, f): Promise<SaveTarget | null> => {
      filters.push(f.map((x) => x.extensions[0]!));
      const name = over.chosen === undefined ? suggested : over.chosen;
      return name === null ? null : { ref: ref(name) };
    },
    encode: async (kind, format) => {
      log.push(`encode:${kind}:${format}`);
      return { blob: new Blob([`${kind}/${format}`]), warnings: [] };
    },
    writeToRef: async (to, blob) => {
      if (denyTied) throw new WriteDeniedError(to.name, new Error('Permission Denial'));
      await written();
      writes.push({ to: to.name, blob });
      log.push(`write:${to.name}`);
    },
    writeToTarget: async (target, blob) => {
      await written();
      if (!('ref' in target)) throw new Error('the tests always pick a file');
      writes.push({ to: target.ref.name, blob });
      log.push(`write:${target.ref.name}`);
      return target.ref;
    },
    saved: (r) => {
      results.push(r);
      log.push(`saved:${r.step}:${r.format}`);
    },
    denied: (name) => denials.push(name),
    working: (step) => working.push(step),
    failed: (f) => {
      failures.push(f.message);
      failureSteps.push(f);
    },
  };
  return {
    flow: createSaveFlow(deps),
    state,
    log,
    writes,
    asked,
    filters,
    failures,
    failureSteps,
    results,
    denials,
    working,
    saved,
    setRevision: (n: number) => (revision = n),
    holdWrites: () => (hold = true),
    release: () => release?.(),
    failWrites: () => (failWrite = true),
    denyTiedWrites: () => (denyTied = true),
    declineConfirm: () => (confirm = false),
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('un guardado a la vez', () => {
  it('ignores Guardar while the file is being written, so it is written and reported once', async () => {
    const t = setup();
    t.holdWrites();
    const first = t.flow.save();
    await tick();
    await t.flow.save();
    await t.flow.saveAs();
    await t.flow.saveCopy();
    await t.flow.exportImage();
    t.release();
    await first;
    expect(t.writes.map((w) => w.to)).toEqual(['Obra.psd']);
    expect(t.results).toHaveLength(1);
    expect(t.working).toEqual(['save', null]);
  });

  it('takes the next save once the first ended, also after a failure', async () => {
    const t = setup();
    t.failWrites();
    await t.flow.save();
    await t.flow.save();
    expect(t.failures).toEqual(['disco lleno', 'disco lleno']);
    expect(t.working).toEqual(['save', null, 'save', null]);
  });

  it('shows the spinner only while writing, not while a dialog waits, and ends it when the write fails', async () => {
    const t = setup({ chosen: null });
    await t.flow.saveAs();
    expect(t.working).toEqual([]);
    const f = setup();
    f.failWrites();
    await f.flow.exportImage();
    expect(f.working).toEqual(['export', null]);
  });

  it('a refused overwrite ends the spinner before it asks where to save instead', async () => {
    const t = setup();
    t.denyTiedWrites();
    await t.flow.save();
    expect(t.working).toEqual(['save', null, 'saveAs', null]);
  });
});

describe('Guardar', () => {
  it('writes the file the document is tied to, in its format, and keeps the tie', async () => {
    const t = setup();
    await t.flow.save();
    expect(t.log).toEqual(['encode:document:psd', 'write:Obra.psd', 'markSaved:7', 'saved:save:psd']);
    expect(t.results[0]).toMatchObject({ step: 'save', format: 'psd', ref: ref('Obra.psd'), size: 'document/psd'.length, warnings: [] });
    expect(t.state).toMatchObject({ file: ref('Obra.psd'), format: 'psd', name: 'Obra' });
    expect(t.filters).toEqual([]); // no dialog
  });

  it('on Android writes the tied file without asking for a path or a format', async () => {
    const t = setup({ reportsType: false });
    await t.flow.save();
    expect(t.asked).toEqual([]);
    expect(t.filters).toEqual([]);
    expect(t.writes.map((w) => w.to)).toEqual(['Obra.psd']);
  });

  it('asks where to save when the tied file may not be written (an opened Android file), and ties the document to the new one', async () => {
    const t = setup({ chosen: 'Copia.psd' });
    t.denyTiedWrites();
    await t.flow.save();
    expect(t.failures).toEqual([]);
    expect(t.denials).toEqual(['Obra.psd']);
    expect(t.writes.map((w) => w.to)).toEqual(['Copia.psd']);
    expect(t.state.file?.name).toBe('Copia.psd');
    expect(t.saved).toEqual([7]);
  });

  it('writes nothing and keeps the tie when that fallback dialog is cancelled', async () => {
    const t = setup({ chosen: null });
    t.denyTiedWrites();
    await t.flow.save();
    expect(t.writes).toEqual([]);
    expect(t.state.file?.name).toBe('Obra.psd');
    expect(t.saved).toEqual([]);
  });

  it('on Android asks the format first when the document has no file yet', async () => {
    const t = setup({ reportsType: false, asked: 'ora', chosen: 'Nueva.ora', association: { file: null, format: 'lienzo', name: 'Sin título' } });
    await t.flow.save();
    expect(t.asked).toHaveLength(1);
    expect(t.state).toMatchObject({ file: ref('Nueva.ora'), format: 'ora' });
  });

  it('asks where when the document has no file yet, as "Guardar como…"', async () => {
    const t = setup({ association: { file: null, format: 'lienzo', name: 'Sin título' } });
    await t.flow.save();
    expect(t.filters).toHaveLength(1);
    expect(t.state.file?.name).toBe('Sin título.lienzo');
  });

  it('asks before overwriting the original .clip, and writes nothing when the person declines', async () => {
    const t = setup({ association: { file: ref('Pagina.clip'), format: 'clip', name: 'Pagina' } });
    t.declineConfirm();
    await t.flow.save();
    expect(t.writes).toEqual([]);
    expect(t.saved).toEqual([]);
  });

  it('marks as saved only the revision that was written, not edits made while writing', async () => {
    const t = setup();
    t.holdWrites();
    const pending = t.flow.save();
    await tick();
    t.setRevision(9); // the person kept drawing during the write
    t.release();
    await pending;
    expect(t.saved).toEqual([7]);
  });
});

describe('Guardar como…', () => {
  it('ties the document to the new file only after the write has completed', async () => {
    const t = setup({ chosen: 'Capitulo.ora' });
    t.holdWrites();
    const pending = t.flow.saveAs();
    await tick();
    // The dialog is answered and the file is being written: nothing changed yet.
    expect(t.log).toContain('encode:document:ora');
    expect(t.state).toMatchObject({ file: ref('Obra.psd'), format: 'psd', name: 'Obra' });
    expect(t.saved).toEqual([]);
    t.release();
    await pending;
    expect(t.state).toMatchObject({ file: ref('Capitulo.ora'), format: 'ora', name: 'Capitulo', clipOverwriteOk: true });
    expect(t.saved).toEqual([7]);
    expect(t.log.indexOf('write:Capitulo.ora')).toBeLessThan(t.log.findIndex((l) => l.startsWith('associate:')));
  });

  it('keeps the real file name for the tab, extension included', async () => {
    const t = setup({ chosen: 'Capitulo.ora' });
    await t.flow.saveAs();
    expect(t.state.title).toBe('Capitulo.ora');
    expect(t.state.name).toBe('Capitulo'); // the stem is still what suggested names are built from
  });

  it('keeps the old association when the write fails, and says so', async () => {
    const t = setup({ chosen: 'Capitulo.ora' });
    t.failWrites();
    await t.flow.saveAs();
    expect(t.state).toMatchObject({ file: ref('Obra.psd'), format: 'psd', name: 'Obra' });
    expect(t.saved).toEqual([]);
    expect(t.failures).toEqual(['disco lleno']);
    expect(t.failureSteps[0]!.step).toBe('saveAs');
    expect(t.failureSteps[0]!.saveAs).toBeUndefined(); // it already asks where
  });

  it('keeps the old association when the dialog is cancelled', async () => {
    const t = setup({ chosen: null });
    await t.flow.saveAs();
    expect(t.state.file).toEqual(ref('Obra.psd'));
    expect(t.log).toEqual([]);
  });

  it('offers only formats with layers and starts on the current one', async () => {
    const t = setup({ association: { file: ref('Obra.psb'), format: 'psb', name: 'Obra' } });
    await t.flow.saveAs();
    expect(t.filters[0]).toEqual(['psb', 'lienzo', 'clip', 'psd', 'ora']);
    for (const flat of ['png', 'jpg', 'webp', 'bmp', 'tif', 'tga']) expect(t.filters[0]).not.toContain(flat);
  });

  it('leaves out .clip for a document that was not opened from one', async () => {
    const t = setup({ canClip: false });
    await t.flow.saveAs();
    expect(t.filters[0]).not.toContain('clip');
  });

  it('refuses a flat picture name and writes nothing', async () => {
    const t = setup({ chosen: 'Obra.png' });
    await t.flow.saveAs();
    expect(t.writes).toEqual([]);
    expect(t.state.file).toEqual(ref('Obra.psd'));
    expect(t.failures[0]).toMatch(/Exportar imagen/);
  });

  it('asks for the type first where the dialog has no type list (Android), and only among layered ones', async () => {
    const t = setup({ reportsType: false, asked: 'lienzo', chosen: 'Obra.lienzo' });
    await t.flow.saveAs();
    expect(t.asked).toHaveLength(1);
    expect(t.asked[0]).toMatchObject({ kind: 'document' });
    expect(t.asked[0]!.options).toEqual(['lienzo', 'clip', 'psd', 'psb', 'ora']);
    expect(t.filters[0]).toEqual(['lienzo']); // the dialog is then fixed to the type that was asked
    expect(t.state.format).toBe('lienzo');
  });

  it('does nothing when the Android type question is dismissed', async () => {
    const t = setup({ reportsType: false, asked: null });
    await t.flow.saveAs();
    expect(t.filters).toEqual([]);
    expect(t.state.file).toEqual(ref('Obra.psd'));
  });
});

describe('Guardar copia…', () => {
  it('writes another file with layers and changes neither the document, its name, its file nor its unsaved state', async () => {
    const t = setup({ chosen: 'Copia.ora' });
    const before = JSON.stringify(t.state);
    await t.flow.saveCopy('ora');
    expect(t.writes.map((w) => w.to)).toEqual(['Copia.ora']);
    expect(await t.writes[0]!.blob.text()).toBe('document/ora');
    expect(JSON.stringify(t.state)).toBe(before);
    expect(t.log.some((l) => l.startsWith('associate'))).toBe(false);
    expect(t.saved).toEqual([]); // the document still has changes its own file does not
  });

  it('leaves the tab title alone', async () => {
    const t = setup({ chosen: 'Copia.ora', association: { title: 'Obra.psd' } });
    await t.flow.saveCopy('ora');
    expect(t.state.title).toBe('Obra.psd');
  });

  it('does not change the association when the copy fails', async () => {
    const t = setup({ chosen: 'Copia.psd' });
    t.failWrites();
    await t.flow.saveCopy('psd');
    expect(t.state).toMatchObject({ file: ref('Obra.psd'), name: 'Obra' });
    expect(t.failures).toEqual(['disco lleno']);
    expect(t.failureSteps.map((f) => f.step)).toEqual(['copy']);
  });

  it('fixes the type of the dialog to the menu entry that was used', async () => {
    const t = setup();
    await t.flow.saveCopy('psb');
    expect(t.filters[0]).toEqual(['psb']);
  });

  it('refuses a flat picture and a .clip that cannot be written', async () => {
    const flat = setup({ chosen: 'x.jpg' });
    await flat.flow.saveCopy();
    expect(flat.writes).toEqual([]);
    const clip = setup({ canClip: false });
    await clip.flow.saveCopy('clip');
    expect(clip.writes).toEqual([]);
    expect(clip.failures[0]).toMatch(/\.clip/);
  });
});

describe('Exportar imagen…', () => {
  it('encodes the merged picture and never ties or saves the document', async () => {
    const t = setup({ chosen: 'Obra.png' });
    const before = JSON.stringify(t.state);
    await t.flow.exportImage('png');
    expect(t.log).toContain('encode:image:png');
    expect(t.writes.map((w) => w.to)).toEqual(['Obra.png']);
    expect(JSON.stringify(t.state)).toBe(before);
    expect(t.saved).toEqual([]);
  });

  it('exports a PSD as an image: encoded as "image", not as the layered document', async () => {
    const t = setup({ chosen: 'Obra-plana.psd' });
    await t.flow.exportImage('psd');
    expect(t.log).toContain('encode:image:psd');
    expect(t.log).not.toContain('encode:document:psd');
    expect(t.state).toMatchObject({ file: ref('Obra.psd'), name: 'Obra' });
  });

  it('lists only picture formats, never the formats that exist to keep layers', async () => {
    const t = setup();
    await t.flow.exportImage();
    expect(t.filters[0]).toEqual(['png', 'psd', 'bmp', 'jpg', 'tif', 'tga', 'webp']);
    for (const doc of ['lienzo', 'clip', 'psb', 'ora']) expect(t.filters[0]).not.toContain(doc);
  });

  it('reports an exported picture as an export of the format chosen', async () => {
    const t = setup({ chosen: 'x.jpg' });
    await t.flow.exportImage('jpg');
    expect(t.results).toMatchObject([{ step: 'export', format: 'jpg', ref: ref('x.jpg') }]);
  });

  it('refuses a document name typed into the picture dialog', async () => {
    const t = setup({ chosen: 'Obra.clip' });
    await t.flow.exportImage();
    expect(t.writes).toEqual([]);
    expect(t.failures[0]).toMatch(/Guardar como/);
  });

  it('asks for the picture type first on Android, among picture types only', async () => {
    const t = setup({ reportsType: false, asked: 'jpg', chosen: 'Obra.jpg' });
    await t.flow.exportImage();
    expect(t.asked[0]!.kind).toBe('image');
    expect(t.asked[0]!.options).toEqual(['psd', 'bmp', 'jpg', 'png', 'tif', 'tga', 'webp']);
  });
});
