import type { Database } from 'sql.js';
import { parseAttribute, withBlockSizes } from './clip-csf';

/**
 * Row-level edits of the layer tables of a `.clip` database, for the layers Lienzo adds, deletes or moves. Nothing is
 * invented from scratch: a new layer is a copy of the rows of a layer the file already has (its mipmap chain, its
 * offscreens, its thumbnail record), given new ids, a new UUID and its own pixel data. What a `.clip` file expects of such rows
 * is described in clip-csf.ts; that Clip Studio accepts the copies is not guaranteed.
 *
 * Table counters: every table's `MainId` is allocated from `ElemScheme.MaxIndex` (deleted ids are never reused), and
 * `_PW_ID` (AUTOINCREMENT) is left to SQLite.
 */
type Val = number | string | Uint8Array | null;
type Row = Record<string, Val>;

const q = (s: string): string => `"${s.replace(/"/g, '""')}"`;
const int = (v: Val | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0);
const textOf = (v: Val | undefined): string | null => (typeof v === 'string' ? v : v instanceof Uint8Array ? new TextDecoder().decode(v) : null);
const hex = (bytes: number): string => {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return [...raw].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** A fresh id for external data, in the form CSP writes. */
export const newExternalId = (): string => `extrnlid${hex(16).toUpperCase()}`;
/** A fresh layer UUID in the shape CSP writes (10-4-4-4-14 hex digits). */
export const newLayerUuid = (): string => {
  const h = hex(16);
  return `${h.slice(0, 10)}-${h.slice(10, 14)}-${h.slice(14, 18)}-${h.slice(18, 22)}-${h.slice(22, 32)}${hex(2)}`;
};

/** Tables that hold the per-layer chain; anything else keyed by `LayerId` is unknown territory. */
const CHAIN_TABLES = ['Mipmap', 'MipmapInfo', 'Offscreen', 'LayerThumbnail'];
/** The size of the record of an empty block, in the `BlockSize` list of an offscreen. */
export const EMPTY_BLOCK_RECORD = 104;

interface Chain {
  mipmaps: Row[];
  infos: Row[];
  offscreens: Row[];
  thumbs: Row[];
}

export interface NewLayerSpec {
  name: string;
  folder: boolean;
  /** 0..256 */
  opacity: number;
  visible: boolean;
  clip: boolean;
  /** Folders: members composite straight onto what is below. */
  through: boolean;
  /** Pixel layers: the byte length of every block record of the full-size image (see `Offscreen.Attribute`). */
  sizes?: readonly number[];
}

export interface NewLayerRows {
  mainId: number;
  /** The external data id the full-size pixels must be stored under (pixel layers). */
  blockId: string | null;
  /** The folder row was built from the document's root folder, which is not confirmed. */
  inferredFolder: boolean;
}

export interface TreeIds {
  mainId: number;
  children: TreeIds[];
}

export class LayerRows {
  private readonly counters = new Map<string, number>();
  private readonly columnCache = new Map<string, string[]>();

  constructor(private readonly db: Database) {}

  has(table: string): boolean {
    return this.columns(table).length > 0;
  }

  columns(table: string): string[] {
    let cols = this.columnCache.get(table);
    if (!cols) {
      cols = this.rows(`PRAGMA table_info(${q(table)})`).map((r) => String(r.name));
      this.columnCache.set(table, cols);
    }
    return cols;
  }

  rows(sql: string, params: Val[] = []): Row[] {
    const st = this.db.prepare(sql);
    try {
      st.bind(params);
      const out: Row[] = [];
      while (st.step()) out.push(st.getAsObject() as Row);
      return out;
    } finally {
      st.free();
    }
  }

  private insert(table: string, row: Row): void {
    const cols = Object.keys(row).filter((c) => c !== '_PW_ID');
    this.db.run(`INSERT INTO ${q(table)} (${cols.map(q).join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => row[c]!));
  }

  /** The next free `MainId` of a table (never one that was ever handed out). */
  private alloc(table: string): number {
    let at = this.counters.get(table);
    if (at === undefined) {
      const max = int(this.rows(`SELECT MAX(MainId) AS m FROM ${q(table)}`)[0]?.m);
      const scheme = this.has('ElemScheme') ? int(this.rows('SELECT MaxIndex AS m FROM ElemScheme WHERE TableName = ?', [table])[0]?.m) : 0;
      at = Math.max(max, scheme);
    }
    at += 1;
    this.counters.set(table, at);
    return at;
  }

  /** Write the allocated counters back to `ElemScheme`. */
  saveCounters(): void {
    if (!this.has('ElemScheme')) return;
    for (const [table, value] of this.counters) this.db.run('UPDATE ElemScheme SET MaxIndex = ? WHERE TableName = ? AND MaxIndex < ?', [value, table, value]);
  }

  private layerRow(mainId: number): Row | undefined {
    return this.rows('SELECT * FROM Layer WHERE MainId = ?', [mainId])[0];
  }

  private chain(layer: Row, which: 'render' | 'mask'): Chain {
    const out: Chain = { mipmaps: [], infos: [], offscreens: [], thumbs: [] };
    const mipId = int(layer[which === 'render' ? 'LayerRenderMipmap' : 'LayerLayerMaskMipmap']);
    const thumbId = int(layer[which === 'render' ? 'LayerRenderThumbnail' : 'LayerLayerMaskThumbnail']);
    const mip = mipId > 0 && this.has('Mipmap') ? this.rows('SELECT * FROM Mipmap WHERE MainId = ?', [mipId])[0] : undefined;
    if (mip) {
      out.mipmaps.push(mip);
      const seen = new Set<number>();
      for (let at = int(mip.BaseMipmapInfo); at > 0 && !seen.has(at) && seen.size < 64; ) {
        seen.add(at);
        const info = this.rows('SELECT * FROM MipmapInfo WHERE MainId = ?', [at])[0];
        if (!info) break;
        out.infos.push(info);
        at = int(info.NextIndex);
      }
    }
    const thumb = thumbId > 0 && this.has('LayerThumbnail') ? this.rows('SELECT * FROM LayerThumbnail WHERE MainId = ?', [thumbId])[0] : undefined;
    if (thumb) out.thumbs.push(thumb);
    const offIds = new Set<number>([...out.infos.map((i) => int(i.Offscreen)), ...out.thumbs.map((t) => int(t.ThumbnailOffscreen))].filter((n) => n > 0));
    for (const id of offIds) {
      const off = this.rows('SELECT * FROM Offscreen WHERE MainId = ?', [id])[0];
      if (off) out.offscreens.push(off);
    }
    return out;
  }

  /** Whether a layer's rows can serve as the model of a new layer: a complete render chain, no mask, nothing unknown. */
  private suitable(layer: Row): Chain | null {
    if (int(layer.LayerLayerMaskMipmap) > 0) return null;
    const c = this.chain(layer, 'render');
    // A folder may have no pixel chain at all (then its copy has none either); a pixel layer must have a complete one.
    const bare = int(layer.LayerFolder) !== 0 && int(layer.LayerRenderMipmap) === 0 && int(layer.LayerRenderThumbnail) === 0;
    if (!bare && (!c.mipmaps.length || !c.infos.length || c.offscreens.length < c.infos.length)) return null;
    const mainId = int(layer.MainId);
    for (const t of this.rows("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => String(r.name))) {
      if (CHAIN_TABLES.includes(t) || t === 'Layer' || !this.columns(t).includes('LayerId')) continue;
      if (this.rows(`SELECT 1 AS x FROM ${q(t)} WHERE LayerId = ? LIMIT 1`, [mainId]).length) return null;
    }
    return c;
  }

  /** A layer to copy for a new pixel layer or folder. */
  private template(folder: boolean, rootId: number): { layer: Row; chain: Chain; inferred: boolean } | null {
    const all = this.rows('SELECT * FROM Layer ORDER BY MainId');
    for (const layer of all) {
      const isFolder = int(layer.LayerFolder) !== 0;
      if (isFolder !== folder || int(layer.MainId) === rootId) continue;
      if (!folder && int(layer.LayerType) !== 1) continue;
      const chain = this.suitable(layer);
      if (chain) return { layer, chain, inferred: false };
    }
    if (folder) {
      const root = all.find((l) => int(l.MainId) === rootId);
      const chain = root ? this.suitable(root) : null;
      if (root && chain) return { layer: root, chain, inferred: true };
    }
    return null;
  }

  /** Add the rows of a new layer, copied from one the file already has. Its place in the tree is set by `relink`. */
  create(spec: NewLayerSpec, rootId: number): NewLayerRows {
    const model = this.template(spec.folder, rootId);
    if (!model) {
      throw new Error(
        spec.folder
          ? 'El .clip no tiene ninguna carpeta (ni la raíz) con la estructura completa para copiar; no se pueden guardar carpetas nuevas en él.'
          : 'El .clip no tiene ninguna capa de píxeles completa que sirva de modelo; no se pueden guardar capas nuevas en él.',
      );
    }
    const { layer: base, chain, inferred } = model;
    const mainId = this.alloc('Layer');
    const mip = chain.mipmaps[0];
    const hasLayerId = (t: string): boolean => this.columns(t).includes('LayerId');
    const newMip = mip ? this.alloc('Mipmap') : 0;
    const infoIds = new Map<number, number>(chain.infos.map((i) => [int(i.MainId), this.alloc('MipmapInfo')]));
    const offIds = new Map<number, number>(chain.offscreens.map((o) => [int(o.MainId), this.alloc('Offscreen')]));
    const thumb = chain.thumbs[0];
    const newThumb = thumb ? this.alloc('LayerThumbnail') : 0;

    // The full-size image: the 100 % scale (else the first level).
    const full = chain.infos.find((i) => Number(i.ThisScale) === 100) ?? chain.infos[0];
    const fullOffscreenId = int(full?.Offscreen);
    let blockId: string | null = null;

    if (mip) this.insert('Mipmap', { ...mip, MainId: newMip, ...(hasLayerId('Mipmap') ? { LayerId: mainId } : {}), BaseMipmapInfo: infoIds.get(int(mip.BaseMipmapInfo)) ?? 0 });
    for (const info of chain.infos) {
      this.insert('MipmapInfo', {
        ...info,
        MainId: infoIds.get(int(info.MainId))!,
        ...(hasLayerId('MipmapInfo') ? { LayerId: mainId } : {}),
        Offscreen: offIds.get(int(info.Offscreen)) ?? 0,
        NextIndex: infoIds.get(int(info.NextIndex)) ?? 0,
      });
    }
    for (const off of chain.offscreens) {
      const oldId = int(off.MainId);
      const id = newExternalId();
      let attribute = off.Attribute;
      if (oldId === fullOffscreenId && spec.sizes && attribute instanceof Uint8Array) {
        const parsed = parseAttribute(attribute);
        if (!parsed || parsed.sizesCount !== spec.sizes.length) throw new Error('La capa que sirve de modelo tiene una cuadrícula de bloques distinta a la del lienzo; no se pueden guardar capas nuevas en este .clip.');
        attribute = withBlockSizes(attribute, parsed, spec.sizes);
      }
      if (oldId === fullOffscreenId) blockId = id;
      this.insert('Offscreen', {
        ...off,
        MainId: offIds.get(oldId)!,
        ...(hasLayerId('Offscreen') ? { LayerId: mainId } : {}),
        Attribute: attribute ?? null,
        BlockData: off.BlockData instanceof Uint8Array ? new TextEncoder().encode(id) : id,
      });
    }
    if (thumb) {
      this.insert('LayerThumbnail', {
        ...thumb,
        MainId: newThumb,
        ...(hasLayerId('LayerThumbnail') ? { LayerId: mainId } : {}),
        ThumbnailOffscreen: offIds.get(int(thumb.ThumbnailOffscreen)) ?? 0,
      });
    }

    const row: Row = { ...base, MainId: mainId };
    const set = (col: string, value: Val): void => {
      if (col in row) row[col] = value;
    };
    set('LayerName', spec.name);
    set('LayerUuid', newLayerUuid());
    set('LayerOpacity', spec.opacity);
    set('LayerVisibility', spec.visible ? 1 : 0);
    set('LayerClip', spec.clip ? 1 : 0);
    set('LayerSelect', 0);
    set('LayerNextIndex', 0);
    set('LayerFirstChildIndex', 0);
    set('LayerRenderMipmap', newMip);
    set('LayerRenderThumbnail', newThumb);
    if (spec.folder) {
      set('LayerFolder', 1);
      set('LayerComposite', spec.through ? 30 : 0);
      set('LayerFolderThrough', spec.through ? 1 : 0);
      if (inferred) {
        set('LayerType', 0);
        set('LayerMasking', 0);
      }
    } else {
      set('LayerComposite', 0);
    }
    this.insert('Layer', row);
    return { mainId, blockId: spec.folder ? null : blockId, inferredFolder: spec.folder && inferred };
  }

  /** Remove a layer's rows (its chain, thumbnail and mask included). Returns the external data ids that went with it. */
  remove(mainId: number): string[] {
    const layer = this.layerRow(mainId);
    if (!layer) return [];
    const parts = [this.chain(layer, 'render'), this.chain(layer, 'mask')];
    const ids = (pick: (c: Chain) => Row[]): number[] => parts.flatMap((c) => pick(c).map((r) => int(r.MainId))).filter((n) => n > 0);
    const offscreens = ids((c) => c.offscreens);
    const byLayer = (t: string): boolean => this.has(t) && this.columns(t).includes('LayerId');
    const external: string[] = [];
    const note = (v: Val | undefined): void => {
      const id = textOf(v);
      if (id) external.push(id);
    };
    if (this.has('Offscreen')) {
      for (const r of this.rows(`SELECT BlockData FROM Offscreen WHERE MainId IN (${offscreens.join(',') || '-1'})${byLayer('Offscreen') ? ' OR LayerId = ?' : ''}`, byLayer('Offscreen') ? [mainId] : [])) note(r.BlockData);
    }
    if (this.has('ExternalTableAndColumnName')) {
      for (const r of this.rows('SELECT TableName, ColumnName FROM ExternalTableAndColumnName')) {
        const t = String(r.TableName);
        const c = String(r.ColumnName);
        if (t === 'Offscreen' || !byLayer(t) || !this.columns(t).includes(c)) continue;
        for (const x of this.rows(`SELECT ${q(c)} AS v FROM ${q(t)} WHERE LayerId = ?`, [mainId])) note(x.v);
      }
    }
    const drop = (table: string, rows: number[]): void => {
      if (!this.has(table)) return;
      const where = [`MainId IN (${rows.join(',') || '-1'})`];
      const params: Val[] = [];
      if (byLayer(table)) {
        where.push('LayerId = ?');
        params.push(mainId);
      }
      this.db.run(`DELETE FROM ${q(table)} WHERE ${where.join(' OR ')}`, params);
    };
    drop('Offscreen', offscreens);
    drop('MipmapInfo', ids((c) => c.infos));
    drop('Mipmap', ids((c) => c.mipmaps));
    drop('LayerThumbnail', ids((c) => c.thumbs));
    for (const t of this.rows("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => String(r.name))) {
      if (CHAIN_TABLES.includes(t) || t === 'Layer' || !byLayer(t)) continue;
      this.db.run(`DELETE FROM ${q(t)} WHERE LayerId = ?`, [mainId]);
    }
    this.db.run('DELETE FROM Layer WHERE MainId = ?', [mainId]);
    return external;
  }

  /** Make the file's layer tree the given one: the root's first child, every folder's first child and every `LayerNextIndex`. */
  relink(rootId: number, forest: readonly TreeIds[]): void {
    const current = new Map<number, { next: number; first: number }>();
    for (const r of this.rows('SELECT MainId, LayerNextIndex, LayerFirstChildIndex FROM Layer')) current.set(int(r.MainId), { next: int(r.LayerNextIndex), first: int(r.LayerFirstChildIndex) });
    const setNext = (id: number, value: number): void => {
      if (current.get(id)?.next !== value) this.db.run('UPDATE Layer SET LayerNextIndex = ? WHERE MainId = ?', [value, id]);
    };
    const setFirst = (id: number, value: number): void => {
      if (current.get(id)?.first !== value) this.db.run('UPDATE Layer SET LayerFirstChildIndex = ? WHERE MainId = ?', [value, id]);
    };
    const walk = (parent: number, list: readonly TreeIds[]): void => {
      setFirst(parent, list[0]?.mainId ?? 0);
      list.forEach((node, i) => {
        setNext(node.mainId, list[i + 1]?.mainId ?? 0);
        if (node.children.length || current.get(node.mainId)?.first) walk(node.mainId, node.children);
      });
    };
    walk(rootId, forest);
  }
}
