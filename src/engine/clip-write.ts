import type { SqlJsStatic } from 'sql.js';
import { buildBlockSet, buildCsf, buildExta, deflateBlock, encodeBlock, headWithDatabaseOffset, parseAttribute, parseBlockSet, parseCsf, parseExta, withBlockSizes } from './clip-csf';
import { clipOriginOf, encodeBlockPixels, importClip, shapeOf, structureOf, tileHash, type ClipLayerOrigin } from './clip-file';
import { LayerRows, type TreeIds } from './clip-layers';
import { flattenRegion, thumbnail } from './composite';
import type { Document, Layer } from './document';
import { layerTree, type TreeNode } from './layer-tree';
import { TILE } from './tiles';

/**
 * Writer for `.clip` files: it does not build a file from scratch, it edits the one the document was read from.
 * Every chunk, table and row it does not need to change is kept exactly as it was (vector layers, text, masks,
 * thumbnails, settings, ...). What it rewrites:
 *   - the pixel blocks of the layers whose pixels changed (block records, status and checksum tables), and the
 *     `Offscreen.Attribute` block-size list that goes with them;
 *   - `ExternalChunk.Offset` of every external data chunk, the Head chunk's pointer to the database and the file size;
 *   - the name, opacity, visibility and clipping of layers, in their `Layer` rows;
 *   - the layer tree (`LayerFirstChildIndex` / `LayerNextIndex`) when layers were moved;
 *   - for layers added to the document: a copy of the rows of a layer the file already has (see clip-layers.ts);
 *   - for layers deleted from it: their rows and data chunks;
 *   - the file's preview picture.
 *
 * The SQLite database is edited with SQLite itself (sql.js), so it stays a valid database; it is loaded on demand.
 * The result is read back (integrity check, re-import of the layer tree) before it is returned.
 */
export interface ClipWriteCodecs {
  encodePng(width: number, height: number, rgba: Uint8ClampedArray): Promise<Uint8Array>;
  /** Load the SQLite engine (sql.js). */
  loadSql(): Promise<SqlJsStatic>;
}

export interface ClipWriteResult {
  value: Uint8Array;
  warnings: string[];
}

/** Whether `exportClip` has anything to work from. */
export const canWriteClip = (doc: Document): boolean => clipOriginOf(doc) !== undefined;

interface Entry {
  tag: string;
  payload: Uint8Array;
  /** External data id (CHNKExta only). */
  id?: string;
}

const keyOf = (id: string): Uint8Array => new TextEncoder().encode(id);

export async function exportClip(doc: Document, codecs: ClipWriteCodecs): Promise<ClipWriteResult> {
  const origin = clipOriginOf(doc);
  if (!origin) throw new Error('Este documento no se abrió desde un archivo .clip: solo se pueden guardar como .clip los documentos que vienen de uno.');
  if (doc.width !== origin.width || doc.height !== origin.height) {
    throw new Error('El tamaño del lienzo cambió desde que se abrió el .clip; todavía no se puede guardar así. Guarda como .lienzo u .ora.');
  }
  const warnings: string[] = [];
  const entries: Entry[] = parseCsf(origin.bytes).map((c) => ({ tag: c.tag, payload: c.payload, ...(c.tag === 'CHNKExta' ? { id: parseExta(c.payload).id } : {}) }));
  const headEntry = entries.find((e) => e.tag === 'CHNKHead');
  const sqlEntry = entries.find((e) => e.tag === 'CHNKSQLi');
  if (!headEntry || !sqlEntry) throw new Error('El archivo .clip original no tiene la estructura esperada.');
  const headPayload = headEntry.payload;
  const extaOf = (id: string): Entry | undefined => entries.find((e) => e.id === id);
  const columns = Math.ceil(doc.width / TILE);
  const rowsN = Math.ceil(doc.height / TILE);

  const SQL = await codecs.loadSql();
  const db = new SQL.Database(sqlEntry.payload);
  try {
    const rows = new LayerRows(db);
    const enc = new TextEncoder();

    // --- what changed in the layer list ------------------------------------------------------------------------
    const kept = new Map<number, ClipLayerOrigin>();
    const added: Layer[] = [];
    for (const l of doc.layers) {
      const o = origin.layers.get(l.id);
      if (o && o.kind === l.kind) kept.set(l.id, o);
      else added.push(l);
    }
    const removed = [...origin.layers.entries()].filter(([id, o]) => kept.get(id) !== o).map(([, o]) => o);
    const mainOf = new Map<number, number>([...kept].map(([id, o]) => [id, o.mainId]));
    const rootId = Number(rows.rows('SELECT * FROM Canvas')[0]?.CanvasRootFolder ?? 0);
    const structural = added.length > 0 || removed.length > 0;
    let pixelsChanged = false;
    let propertiesChanged = structural;

    /** Compressed blocks for every cell of the grid of a layer (null = an empty block). */
    const encodeAll = async (layer: Layer, hashes?: Map<number, string>, previous?: ReturnType<typeof parseBlockSet>) => {
      const out: { record: Uint8Array; checksum: number; status: number }[] = [];
      let any = false;
      for (let i = 0; i < columns * rowsN; i++) {
        const tile = layer.surface.get(i % columns, Math.floor(i / columns));
        const now = tileHash(tile);
        const old = previous?.[i];
        if (old && hashes && now === (hashes.get(i) ?? 'empty')) {
          out.push({ record: old.record, checksum: old.checksum, status: old.status });
          continue;
        }
        if (now !== 'empty') any = true;
        const made = encodeBlock(i, now === 'empty' ? null : await deflateBlock(encodeBlockPixels(tile!)));
        out.push({ record: made.record, checksum: made.checksum, status: 1 });
      }
      return { blocks: out, any };
    };

    // --- layers deleted from the document: their rows and chunks go ---------------------------------------------
    for (const o of removed) {
      for (const id of rows.remove(o.mainId)) {
        const at = entries.findIndex((e) => e.id === id);
        if (at >= 0) entries.splice(at, 1);
        db.run('DELETE FROM ExternalChunk WHERE CAST(ExternalID AS BLOB) = ?', [keyOf(id)]);
      }
    }

    // --- layers added to the document (or converted to another kind): copies of rows the file already has --------
    const chunkRows: string[] = [];
    for (const l of added) {
      if (l.kind === 'paper') throw new Error(`La capa de papel "${l.name}" es nueva (o se convirtió) y todavía no se puede crear dentro de un .clip. Guarda como .lienzo u .ora.`);
      let encoded: Awaited<ReturnType<typeof encodeAll>> | null = null;
      if (l.kind === 'raster') encoded = await encodeAll(l);
      const made = rows.create(
        {
          name: l.name,
          folder: l.kind === 'folder',
          opacity: Math.round(l.opacity * 256),
          visible: l.visible,
          clip: l.clip,
          through: l.through,
          ...(encoded ? { sizes: encoded.blocks.map((b) => b.record.length) } : {}),
        },
        rootId,
      );
      mainOf.set(l.id, made.mainId);
      if (made.inferredFolder) warnings.push(`"${l.name}": el archivo no tenía ninguna otra carpeta; se creó a partir de la carpeta raíz y Clip Studio podría no aceptarla.`);
      if (encoded?.any && made.blockId) {
        entries.splice(entries.findIndex((e) => e.tag === 'CHNKSQLi'), 0, { tag: 'CHNKExta', id: made.blockId, payload: buildExta(made.blockId, buildBlockSet(encoded.blocks)) });
        chunkRows.push(made.blockId);
        pixelsChanged = true;
      }
      if (l.blend !== 'normal') warnings.push(`"${l.name}": el modo de mezcla ${l.blend} no se guardó en el .clip (la numeración de modos de Clip Studio aún no está verificada).`);
    }

    // --- pixels of layers that stay -------------------------------------------------------------------------------
    const sizesFor = new Map<string, number[]>();
    for (const l of doc.layers) {
      const o = kept.get(l.id);
      if (!o?.editable || !o.externalId || l.kind !== 'raster') continue;
      const entry = extaOf(o.externalId);
      let previous: ReturnType<typeof parseBlockSet> | undefined;
      if (entry) {
        previous = parseBlockSet(parseExta(entry.payload).data);
        if (previous.length !== o.columns * o.rows || previous.some((b, i) => b.index !== i)) {
          warnings.push(`"${l.name}": sus bloques no tienen la cuadrícula esperada; se dejó como estaba en el archivo.`);
          continue;
        }
      }
      const { blocks, any } = await encodeAll(l, o.hashes, previous);
      // Unchanged: every block is the stored one (or, with nothing stored, the layer is still empty).
      if (previous ? blocks.every((b, i) => b.record === previous![i]!.record) : !any) continue;
      pixelsChanged = true;
      const payload = buildExta(o.externalId, buildBlockSet(blocks));
      if (entry) entry.payload = payload;
      else {
        entries.splice(entries.findIndex((e) => e.tag === 'CHNKSQLi'), 0, { tag: 'CHNKExta', id: o.externalId, payload });
        chunkRows.push(o.externalId);
      }
      sizesFor.set(o.externalId, blocks.map((b) => b.record.length));
    }

    // --- rows of the layers that stay: only what the user changed --------------------------------------------------
    const upd = (col: string, value: number | string, mainId: number): void => {
      db.run(`UPDATE Layer SET ${col} = ? WHERE MainId = ?`, [value, mainId]);
    };
    for (const l of doc.layers) {
      const o = kept.get(l.id);
      if (!o) continue;
      if (l.name !== o.name) {
        upd('LayerName', l.name, o.mainId);
        propertiesChanged = true;
      }
      const opacity = Math.round(l.opacity * 256);
      if (opacity !== o.opacity) {
        upd('LayerOpacity', opacity, o.mainId);
        propertiesChanged = true;
      }
      if (l.visible !== ((o.visibility & 1) === 1)) {
        upd('LayerVisibility', l.visible ? o.visibility | 1 : o.visibility & ~1, o.mainId);
        propertiesChanged = true;
      }
      if (l.clip !== (o.clip !== 0)) {
        upd('LayerClip', l.clip ? 1 : 0, o.mainId);
        propertiesChanged = true;
      }
      if (l.blend !== 'normal') warnings.push(`"${l.name}": el modo de mezcla ${l.blend} no se guardó en el .clip (la numeración de modos de Clip Studio aún no está verificada); se conserva el que tenía el archivo.`);
    }

    // --- the layer tree ---------------------------------------------------------------------------------------------
    const ids = (nodes: readonly TreeNode[]): TreeIds[] =>
      nodes.map((n) => {
        const mainId = mainOf.get(n.layer.id);
        if (mainId === undefined) throw new Error('No se pudo asignar una capa del documento a una fila del archivo .clip.');
        return { mainId, children: ids(n.children) };
      });
    const forest = layerTree(doc.layers);
    if (structureOf(doc) !== origin.structure) {
      if (rootId <= 0) throw new Error('El archivo .clip original no indica cuál es su carpeta raíz; no se pueden guardar cambios en el orden de las capas.');
      rows.relink(rootId, ids(forest));
    }
    if (structural) {
      const active = mainOf.get(doc.activeId);
      if (active !== undefined && rows.columns('Canvas').includes('CanvasCurrentLayer')) db.run('UPDATE Canvas SET CanvasCurrentLayer = ?', [active]);
    }
    rows.saveCounters();

    // --- block-size lists of the offscreens whose blocks were rewritten -------------------------------------------------
    for (const [id, sizes] of sizesFor) {
      const get = db.prepare('SELECT Attribute FROM Offscreen WHERE CAST(BlockData AS BLOB) = ?');
      get.bind([enc.encode(id)]);
      const blobs: Uint8Array[] = [];
      while (get.step()) {
        const v = get.get()[0];
        if (v instanceof Uint8Array) blobs.push(v);
      }
      get.free();
      if (blobs.length === 0) throw new Error('No se encontró la descripción de los píxeles de una capa en el archivo original.');
      for (const blob of blobs) {
        const attr = parseAttribute(blob);
        if (!attr) throw new Error('La descripción de los píxeles de una capa tiene un formato que no se reconoce; no se guardó el archivo para no dañarlo.');
        db.run('UPDATE Offscreen SET Attribute = ? WHERE CAST(BlockData AS BLOB) = ? AND Attribute = ?', [withBlockSizes(blob, attr, sizes), enc.encode(id), blob]);
      }
    }

    // --- external data that had no row yet (a layer that was empty, or is new) ----------------------------------
    if (chunkRows.length) {
      const sample = db.exec('SELECT ExternalID FROM ExternalChunk LIMIT 1')[0]?.values[0]?.[0];
      const asBlob = sample instanceof Uint8Array;
      for (const id of chunkRows) db.run('INSERT INTO ExternalChunk (ExternalID, Offset) VALUES (?, 0)', [asBlob ? enc.encode(id) : id]);
    }

    // --- where the external data starts -----------------------------------------------------------------------------
    // The database chunk comes after all of the external data, so those starts do not depend on its own size.
    const { starts } = buildCsf(entries.map((e) => ({ tag: e.tag, payload: e.payload })));
    for (const [i, e] of entries.entries()) {
      if (e.id) db.run('UPDATE ExternalChunk SET Offset = ? WHERE CAST(ExternalID AS BLOB) = ?', [starts[i]!, enc.encode(e.id)]);
    }

    // --- the preview picture ------------------------------------------------------------------------------------------
    if (pixelsChanged || propertiesChanged) {
      const row = db.exec('SELECT ImageWidth, ImageHeight FROM CanvasPreview')[0]?.values[0];
      const w = Number(row?.[0] ?? doc.width);
      const h = Number(row?.[1] ?? doc.height);
      if (row && w > 0 && h > 0 && w * h <= 40_000_000) {
        const rgba = w === doc.width && h === doc.height ? flattenRegion(doc, { x: 0, y: 0, w, h }, { output: true }) : thumbnail(doc, w, h, { output: true });
        db.run('UPDATE CanvasPreview SET ImageData = ?', [await codecs.encodePng(w, h, rgba)]);
      } else {
        warnings.push('No se actualizó la imagen de vista previa del archivo.');
      }
    }

    const check = db.exec('PRAGMA integrity_check')[0]?.values[0]?.[0];
    if (check !== 'ok') throw new Error(`La base de datos resultante no es válida (${String(check)}); no se guardó el archivo.`);
    sqlEntry.payload = db.export();
  } finally {
    db.close();
  }

  // The Head chunk points at the database chunk; then read the whole file back.
  const probe = buildCsf(entries.map((e) => ({ tag: e.tag, payload: e.payload })));
  headEntry.payload = headWithDatabaseOffset(headPayload, probe.starts[entries.indexOf(sqlEntry)]!);
  const done = buildCsf(entries.map((e) => ({ tag: e.tag, payload: e.payload })));
  const back = parseCsf(done.bytes);
  if (back.length !== entries.length) throw new Error('El archivo .clip resultante no tiene la estructura esperada; no se guardó.');
  for (const [i, e] of entries.entries()) {
    if (e.id && parseExta(back[i]!.payload).id !== e.id) throw new Error('El archivo .clip resultante no es coherente; no se guardó.');
  }
  await verifyOffsets(done.bytes, done.starts, entries, codecs);
  const reread = await importClip(done.bytes, undefined, { pixels: false });
  if (shapeOf(reread.value) !== shapeOf(doc)) throw new Error('Al releer el .clip resultante, las capas no coinciden con las del documento; no se guardó el archivo para no dañarlo.');
  return { value: done.bytes, warnings };
}

/** Every `ExternalChunk.Offset` must be where its chunk really starts in the final bytes. */
async function verifyOffsets(bytes: Uint8Array, starts: number[], entries: Entry[], codecs: ClipWriteCodecs): Promise<void> {
  const parsed = parseCsf(bytes);
  const sql = parsed.find((c) => c.tag === 'CHNKSQLi');
  if (!sql) throw new Error('El archivo .clip resultante no tiene base de datos; no se guardó.');
  const SQL = await codecs.loadSql();
  const db = new SQL.Database(sql.payload);
  try {
    const want = new Map<string, number>();
    entries.forEach((e, i) => {
      if (e.id) want.set(e.id, starts[i]!);
    });
    const got = db.exec('SELECT ExternalID, Offset FROM ExternalChunk')[0]?.values ?? [];
    const seen = new Set<string>();
    for (const [rawId, offset] of got) {
      const id = typeof rawId === 'string' ? rawId : new TextDecoder().decode(rawId as Uint8Array);
      seen.add(id);
      if (want.get(id) !== Number(offset)) throw new Error('Los desplazamientos de los datos externos del .clip resultante no son coherentes; no se guardó.');
    }
    for (const id of want.keys()) if (!seen.has(id)) throw new Error('Un bloque de datos del .clip resultante no tiene su registro en la base de datos; no se guardó.');
  } finally {
    db.close();
  }
}
