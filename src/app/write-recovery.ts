/**
 * Android writes a document over its file in place, which a cut (battery, force close) can leave half written. Before every write
 * the native side keeps a whole copy of the new document, and when the app starts again it finishes any write that was cut
 * (`recover_interrupted_writes`, src-tauri/src/safe_write.rs). This tells the person what was found.
 */

export interface RecoveredWrite {
  target: string;
  ok: boolean;
  error?: string | null;
}

export interface RecoveryReport {
  /** Said as a passing notice: files that were completed. */
  done: string | null;
  /** Said as a message that stays until read: files that could not be completed yet, and what to do. */
  failed: string | null;
}

/** What to tell, given the names of the files (`nameOf` gives a readable name for an address). */
export function describeRecovery(list: readonly RecoveredWrite[], nameOf: (target: string) => string): RecoveryReport {
  const ok = list.filter((r) => r.ok).map((r) => `«${nameOf(r.target)}»`);
  const bad = list.filter((r) => !r.ok);
  const done = ok.length ? `Se completó el guardado que se interrumpió la última vez: ${ok.join(', ')}. El archivo está entero.` : null;
  const failed = bad.length
    ? `El guardado de ${bad.map((r) => `«${nameOf(r.target)}»`).join(', ')} se interrumpió y no se pudo completar${bad[0]?.error ? ` (${bad[0].error})` : ''}. ` +
      'Lienzo conserva una copia segura: abre el archivo y vuelve a guardar, o usa «Guardar como…».'
    : null;
  return { done, failed };
}
