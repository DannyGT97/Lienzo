/**
 * The four ways to put a document in a file, kept apart because they do different things to the document:
 *  - Guardar      writes the file the document is tied to, in its own format; the tie stays;
 *  - Guardar como changes the working file: another document format (with layers), and only once the file is written
 *                 does the document become tied to it;
 *  - Guardar copia writes another document (with layers) and touches nothing of the open one: name, tie, unsaved changes;
 *  - Exportar imagen writes the finished page as one merged picture (flat formats, or a one-layer PSD); never a tie.
 * "Guardar" on a file the app may not write (Android lets an opened file be read, not overwritten) turns into
 * "Guardar como": nothing was written, so asking where to put it is all that is left to do.
 * Everything the app owns (dialogs, encoders, the variables of the open document) comes in through `SaveFlowDeps`, so
 * the order of those steps can be tested on its own.
 */
import { WriteDeniedError, type FileFilter, type FileRef, type SaveTarget } from './file-io';
import type { SaveFailure, SavedResult, SaveStep } from './save-notice';
import { chosenFormat, formatInfo, formatsFor, nameFor, saveFilters, type SaveFormat, type SaveKind } from './save-formats';

/** What ties the open document to a file. */
export interface Association {
  file: FileRef | null;
  /** Always a document format: it is what "Guardar" writes. */
  format: SaveFormat;
  /** The document's name, without extension. */
  name: string;
  /** What the tab shows when there is no file to take the name from. */
  title?: string;
  /** The person already agreed to overwrite the .clip behind the document (or just chose that file). */
  clipOverwriteOk: boolean;
}

export interface SaveFlowDeps {
  association(): Association;
  /** Tie the open document to a new place, after a write finished. */
  associate(next: Association): void;
  /** The state of the document the write is a copy of, so edits made while it was being written are not marked saved. */
  revision(): number;
  /** Everything up to `revision` is in a file now. */
  markSaved(revision: number): void;
  canWriteClip(): boolean;
  /** The name to propose, without extension. */
  baseName(): string;
  /** False where the save dialog has no type list and hides the final name (Android): the type is asked for first. */
  dialogReportsType(): boolean;
  askFormat(kind: SaveKind, preferred: SaveFormat, options: SaveFormat[]): Promise<SaveFormat | null>;
  confirmClipOverwrite(): Promise<boolean>;
  chooseTarget(suggested: string, filters: FileFilter[]): Promise<SaveTarget | null>;
  encode(kind: SaveKind, format: SaveFormat): Promise<{ blob: Blob; warnings: string[] }>;
  writeToRef(ref: FileRef, blob: Blob): Promise<void>;
  writeToTarget(target: SaveTarget, blob: Blob): Promise<FileRef | null>;
  /** A file was written: where, how big, and what its format could not keep. */
  saved(result: SavedResult): void;
  /** Nothing was written because the file behind the document cannot be overwritten; "Guardar como" follows. */
  denied(fileName: string): void;
  /** A step failed; the person can repeat it. */
  failed(failure: SaveFailure): void;
  /** The file is being prepared and written (`step`), or that ended (null). Not called while a dialog waits for the person. */
  working(step: SaveStep | null): void;
}

const KIND_HELP: Record<SaveKind, string> = {
  document: 'Elige un formato con capas; para una imagen plana usa «Exportar imagen…».',
  image: 'Elige un formato de imagen; para conservar las capas usa «Guardar como…» o «Guardar copia…».',
};

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createSaveFlow(deps: SaveFlowDeps) {
  /**
   * One step at a time: while a file is being chosen or written, another Guardar (a second click, Ctrl+S again) would
   * write the same file twice or open a second dialog, and tell the person twice. It is ignored until the first ends.
   */
  let running = false;
  const alone = <A extends unknown[]>(step: (...args: A) => Promise<void>) => async (...args: A): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await step(...args);
    } finally {
      running = false;
    }
  };

  /** The part that takes time and cannot be interrupted: encoding and writing. */
  async function writing<T>(step: SaveStep, run: () => Promise<T>): Promise<T> {
    deps.working(step);
    try {
      return await run();
    } finally {
      deps.working(null);
    }
  }

  const stemOf = (name: string): string => name.replace(/\.[a-z0-9]+$/i, '');

  /** Ask where, then which format that is, refusing a name whose extension belongs to the other family. */
  async function pick(kind: SaveKind, preferred: SaveFormat, fixed: SaveFormat | null): Promise<{ target: SaveTarget; format: SaveFormat; name: string } | null> {
    const allowed = (id: SaveFormat): boolean => kind === 'image' || id !== 'clip' || deps.canWriteClip();
    let chosen = fixed;
    if (!chosen && !deps.dialogReportsType()) {
      const options = formatsFor(kind).map((f) => f.id).filter(allowed);
      chosen = await deps.askFormat(kind, preferred, options);
      if (!chosen) return null;
    }
    const filters = chosen ? saveFilters(chosen, () => false, kind) : saveFilters(preferred, allowed, kind);
    const target = await deps.chooseTarget(nameFor(deps.baseName(), chosen ?? preferred), filters);
    if (!target) return null;
    const name = 'download' in target ? target.download : target.ref.name;
    const format = chosen ?? chosenFormat(name, preferred);
    if (!formatsFor(kind).some((f) => f.id === format)) {
      throw new Error(`«.${formatInfo(format).ext}» no es un formato válido aquí. ${KIND_HELP[kind]}`);
    }
    if (format === 'clip' && !deps.canWriteClip()) throw new Error('Este documento no se abrió desde un .clip, así que no se puede guardar como .clip.');
    return { target, format, name };
  }

  /** Guardar: the file the document is tied to, in its own format. Without a file it is "Guardar como…". */
  async function saveStep(): Promise<void> {
    try {
      const a = deps.association();
      if (!a.file) return await saveAsStep();
      const revision = deps.revision();
      if (a.format === 'clip' && !a.clipOverwriteOk) {
        const ok = await deps.confirmClipOverwrite();
        if (!ok) return;
        deps.associate({ ...a, clipOverwriteOk: true });
      }
      const file = a.file;
      const written = await writing('save', async () => {
        const encoded = await deps.encode('document', a.format);
        try {
          await deps.writeToRef(file, encoded.blob);
        } catch (err) {
          if (!(err instanceof WriteDeniedError)) throw err;
          return null;
        }
        return encoded;
      });
      if (!written) {
        deps.denied(file.name);
        return await saveAsStep();
      }
      const { blob, warnings } = written;
      deps.markSaved(revision);
      deps.saved({ step: 'save', format: a.format, name: a.file.name, ref: a.file, size: blob.size, warnings });
    } catch (err) {
      deps.failed({ step: 'save', message: reason(err), retry: () => void save(), saveAs: () => void saveAs() });
    }
  }

  /** Guardar como…: change the working file. The document is tied to the new file only after it was written. */
  async function saveAsStep(only?: SaveFormat): Promise<void> {
    try {
      const a = deps.association();
      const revision = deps.revision();
      const picked = await pick('document', only ?? a.format, only ?? null);
      if (!picked) return;
      const { blob, warnings, ref } = await writing('saveAs', async () => {
        const encoded = await deps.encode('document', picked.format);
        return { ...encoded, ref: await deps.writeToTarget(picked.target, encoded.blob) };
      });
      // Written: from here on the document belongs to this file (a plain download has no file to belong to).
      deps.associate({ file: ref, format: picked.format, name: ref ? stemOf(ref.name) || a.name : a.name, title: picked.name, clipOverwriteOk: true });
      deps.markSaved(revision);
      deps.saved({ step: 'saveAs', format: picked.format, name: picked.name, ref, size: blob.size, warnings });
    } catch (err) {
      deps.failed({ step: 'saveAs', message: reason(err), retry: () => void saveAs(only) });
    }
  }

  /** Guardar copia…: another document with layers; the open one keeps its name, its file and its unsaved state. */
  async function saveCopyStep(only?: SaveFormat): Promise<void> {
    try {
      const picked = await pick('document', only ?? deps.association().format, only ?? null);
      if (!picked) return;
      const { blob, warnings, ref } = await writing('copy', async () => {
        const encoded = await deps.encode('document', picked.format);
        return { ...encoded, ref: await deps.writeToTarget(picked.target, encoded.blob) };
      });
      deps.saved({ step: 'copy', format: picked.format, name: picked.name, ref, size: blob.size, warnings });
    } catch (err) {
      deps.failed({ step: 'copy', message: reason(err), retry: () => void saveCopy(only) });
    }
  }

  /** Exportar imagen…: the merged page as a picture. The document is not saved by it and is not tied to the file. */
  async function exportStep(only?: SaveFormat): Promise<void> {
    try {
      const picked = await pick('image', only ?? 'png', only ?? null);
      if (!picked) return;
      const { blob, warnings, ref } = await writing('export', async () => {
        const encoded = await deps.encode('image', picked.format);
        return { ...encoded, ref: await deps.writeToTarget(picked.target, encoded.blob) };
      });
      deps.saved({ step: 'export', format: picked.format, name: picked.name, ref, size: blob.size, warnings });
    } catch (err) {
      deps.failed({ step: 'export', message: reason(err), retry: () => void exportImage(only) });
    }
  }

  const save = alone(saveStep);
  const saveAs = alone(saveAsStep);
  const saveCopy = alone(saveCopyStep);
  const exportImage = alone(exportStep);
  return { save, saveAs, saveCopy, exportImage };
}
