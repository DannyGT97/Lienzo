import type { SqlJsStatic, SqlJsConfig } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

type Init = (config?: SqlJsConfig) => Promise<SqlJsStatic>;

let loading: Promise<SqlJsStatic> | null = null;

/**
 * The SQLite engine (sql.js, WebAssembly) that the `.clip` writer edits the layer database with. It is loaded the first
 * time a `.clip` is saved and kept; a failed load is not remembered, so the next try starts again.
 */
export function loadSql(): Promise<SqlJsStatic> {
  loading ??= import('sql.js')
    .then((mod) => {
      const init = ((mod as { default?: Init }).default ?? (mod as unknown as Init)) as Init;
      return init({ locateFile: () => wasmUrl });
    })
    .catch((err: unknown) => {
      loading = null;
      throw new Error(`No se pudo cargar el motor de base de datos para guardar el .clip: ${err instanceof Error ? err.message : String(err)}`);
    });
  return loading;
}
