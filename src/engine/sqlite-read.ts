/**
 * A small, read-only reader for SQLite database files (the "main database file" format, documented publicly at
 * sqlite.org/fileformat2.html). It only needs what the `.clip` container carries: ordinary rowid tables whose
 * rows are read whole. Indexes, views, WITHOUT ROWID tables, journals and writing are not supported.
 *
 * Every offset and length comes from the file, so each one is checked before it is used: a damaged or hostile
 * database ends in an `Error` with a readable message, never in an endless loop or a huge allocation.
 */

export type SqlValue = null | number | bigint | string | Uint8Array;
export type SqlRow = Record<string, SqlValue>;

const ENCODINGS = { 1: 'utf-8', 2: 'utf-16le', 3: 'utf-16be' } as const;
/** No page chain is longer than this many pages (a 2 GB file at the smallest page size). */
const MAX_PAGES_VISITED = 4_000_000;

interface TableInfo {
  root: number;
  columns: string[];
  /** Index of the column that is an alias of the rowid (INTEGER PRIMARY KEY), or -1. */
  rowidColumn: number;
}

export class SqliteDb {
  private readonly view: DataView;
  private readonly pageSize: number;
  private readonly usable: number;
  private readonly pageCount: number;
  private readonly text: TextDecoder;
  private tableMap: Map<string, TableInfo> | null = null;

  constructor(private readonly bytes: Uint8Array) {
    if (bytes.length < 512 || new TextDecoder('latin1').decode(bytes.subarray(0, 15)) !== 'SQLite format 3') {
      throw new Error('No es una base de datos SQLite.');
    }
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const raw = this.view.getUint16(16);
    this.pageSize = raw === 1 ? 65536 : raw;
    if (this.pageSize < 512 || this.pageSize > 65536 || (this.pageSize & (this.pageSize - 1)) !== 0) {
      throw new Error('La base de datos tiene un tamaño de página no válido.');
    }
    this.usable = this.pageSize - bytes[20]!;
    if (this.usable < 480) throw new Error('La base de datos reserva demasiado espacio en cada página.');
    this.pageCount = Math.floor(bytes.length / this.pageSize);
    const enc = ENCODINGS[this.view.getUint32(56) as 1 | 2 | 3] ?? 'utf-8';
    this.text = new TextDecoder(enc);
  }

  /** Names of the tables, in the order the file lists them. */
  tables(): string[] {
    return [...this.map().keys()];
  }

  has(table: string): boolean {
    return this.map().has(table.toLowerCase());
  }

  columns(table: string): string[] {
    return this.info(table).columns;
  }

  /** Every row of `table`, each as an object keyed by column name. */
  rows(table: string): SqlRow[] {
    const t = this.info(table);
    const out: SqlRow[] = [];
    this.walkTable(t.root, (rowid, values) => {
      const row: SqlRow = {};
      for (let i = 0; i < t.columns.length; i++) {
        row[t.columns[i]!] = i === t.rowidColumn && values[i] === undefined ? rowid : (values[i] ?? null);
      }
      if (t.rowidColumn >= 0 && row[t.columns[t.rowidColumn]!] === null) row[t.columns[t.rowidColumn]!] = rowid;
      out.push(row);
    });
    return out;
  }

  private info(table: string): TableInfo {
    const t = this.map().get(table.toLowerCase());
    if (!t) throw new Error(`La base de datos no tiene la tabla «${table}».`);
    return t;
  }

  private map(): Map<string, TableInfo> {
    if (this.tableMap) return this.tableMap;
    const found = new Map<string, TableInfo>();
    // sqlite_master is the table whose b-tree starts at page 1: type, name, tbl_name, rootpage, sql.
    this.walkTable(1, (_rowid, v) => {
      if (v[0] !== 'table' || typeof v[1] !== 'string' || typeof v[3] !== 'number' || typeof v[4] !== 'string') return;
      const parsed = parseCreateTable(v[4]);
      if (parsed) found.set(v[1].toLowerCase(), { root: v[3], ...parsed });
    });
    this.tableMap = found;
    return found;
  }

  private page(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > this.pageCount) throw new Error(`La base de datos apunta a una página que no existe (${n}).`);
    return (n - 1) * this.pageSize;
  }

  /** Visit every row of a table b-tree in rowid order. */
  private walkTable(root: number, visit: (rowid: number, values: (SqlValue | undefined)[]) => void): void {
    const seen = new Set<number>();
    const walk = (pageNo: number, depth: number): void => {
      if (depth > 32 || seen.size > MAX_PAGES_VISITED) throw new Error('La base de datos está dañada (árbol demasiado profundo).');
      if (seen.has(pageNo)) throw new Error('La base de datos está dañada (páginas en ciclo).');
      seen.add(pageNo);
      const base = this.page(pageNo);
      const h = pageNo === 1 ? base + 100 : base; // page 1 starts with the 100-byte file header
      const type = this.bytes[h]!;
      const cells = this.view.getUint16(h + 3);
      if (type === 0x0d) {
        const ptrs = h + 8;
        for (let c = 0; c < cells; c++) {
          const cell = base + this.view.getUint16(ptrs + c * 2);
          this.leafCell(cell, base, visit);
        }
      } else if (type === 0x05) {
        const ptrs = h + 12;
        for (let c = 0; c < cells; c++) {
          const cell = base + this.view.getUint16(ptrs + c * 2);
          walk(this.view.getUint32(cell), depth + 1);
        }
        walk(this.view.getUint32(h + 8), depth + 1);
      } else {
        throw new Error('La base de datos tiene una página que no es de una tabla.');
      }
    };
    walk(root, 0);
  }

  private leafCell(cell: number, pageBase: number, visit: (rowid: number, values: (SqlValue | undefined)[]) => void): void {
    const [total, a] = this.varint(cell);
    const [rowid, b] = this.varint(cell + a);
    let at = cell + a + b;
    const maxLocal = this.usable - 35;
    let payload: Uint8Array;
    if (total <= maxLocal) {
      this.within(at, total, pageBase);
      payload = this.bytes.subarray(at, at + total);
    } else {
      const minLocal = Math.floor(((this.usable - 12) * 32) / 255) - 23;
      const k = minLocal + ((total - minLocal) % (this.usable - 4));
      const local = k <= maxLocal ? k : minLocal;
      if (total > this.bytes.length) throw new Error('La base de datos está dañada (una fila es más grande que el archivo).');
      payload = new Uint8Array(total);
      this.within(at, local + 4, pageBase);
      payload.set(this.bytes.subarray(at, at + local), 0);
      let got = local;
      let next = this.view.getUint32(at + local);
      const seen = new Set<number>();
      while (got < total) {
        if (next === 0 || seen.has(next)) throw new Error('La base de datos está dañada (cadena de desbordamiento).');
        seen.add(next);
        const p = this.page(next);
        at = p;
        const take = Math.min(this.usable - 4, total - got);
        payload.set(this.bytes.subarray(p + 4, p + 4 + take), got);
        got += take;
        next = this.view.getUint32(p);
      }
    }
    visit(rowid, this.record(payload));
  }

  private within(at: number, length: number, pageBase: number): void {
    if (at < pageBase || at + length > pageBase + this.pageSize) throw new Error('La base de datos está dañada (una celda se sale de su página).');
  }

  private varint(at: number): [number, number] {
    // 1 to 9 bytes, 7 bits each (the ninth byte contributes all 8). Values beyond 2^53 lose precision, which no field here needs.
    let v = 0;
    for (let i = 0; i < 8; i++) {
      const byte = this.bytes[at + i];
      if (byte === undefined) throw new Error('La base de datos está truncada.');
      v = v * 128 + (byte & 0x7f);
      if (byte < 0x80) return [v, i + 1];
    }
    const last = this.bytes[at + 8];
    if (last === undefined) throw new Error('La base de datos está truncada.');
    return [v * 256 + last, 9];
  }

  private record(p: Uint8Array): (SqlValue | undefined)[] {
    const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
    const readVarint = (at: number): [number, number] => {
      let v = 0;
      for (let i = 0; i < 8; i++) {
        const byte = p[at + i];
        if (byte === undefined) throw new Error('La base de datos está dañada (registro truncado).');
        v = v * 128 + (byte & 0x7f);
        if (byte < 0x80) return [v, i + 1];
      }
      const last = p[at + 8];
      if (last === undefined) throw new Error('La base de datos está dañada (registro truncado).');
      return [v * 256 + last, 9];
    };
    const [headerSize, hn] = readVarint(0);
    if (headerSize > p.length) throw new Error('La base de datos está dañada (cabecera de registro).');
    const types: number[] = [];
    for (let at = hn; at < headerSize; ) {
      const [t, n] = readVarint(at);
      types.push(t);
      at += n;
    }
    const out: (SqlValue | undefined)[] = [];
    let at = headerSize;
    const need = (n: number): void => {
      if (at + n > p.length) throw new Error('La base de datos está dañada (valor fuera del registro).');
    };
    for (const t of types) {
      if (t === 0) out.push(null);
      else if (t >= 1 && t <= 6) {
        const size = [0, 1, 2, 3, 4, 6, 8][t]!;
        need(size);
        out.push(readInt(dv, at, size));
        at += size;
      } else if (t === 7) {
        need(8);
        out.push(dv.getFloat64(at));
        at += 8;
      } else if (t === 8) out.push(0);
      else if (t === 9) out.push(1);
      else if (t >= 12) {
        const size = t % 2 === 0 ? (t - 12) / 2 : (t - 13) / 2;
        need(size);
        const slice = p.subarray(at, at + size);
        out.push(t % 2 === 0 ? slice.slice() : this.text.decode(slice));
        at += size;
      } else {
        throw new Error('La base de datos usa un tipo de valor desconocido.');
      }
    }
    return out;
  }
}

function readInt(dv: DataView, at: number, size: number): number | bigint {
  switch (size) {
    case 1:
      return dv.getInt8(at);
    case 2:
      return dv.getInt16(at);
    case 3: {
      const v = (dv.getUint8(at) << 16) | (dv.getUint8(at + 1) << 8) | dv.getUint8(at + 2);
      return v >= 0x800000 ? v - 0x1000000 : v;
    }
    case 4:
      return dv.getInt32(at);
    case 6: {
      const hi = dv.getInt16(at);
      return hi * 0x1_0000_0000 + dv.getUint32(at + 2);
    }
    default: {
      const v = dv.getBigInt64(at);
      return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
    }
  }
}

/** The column names of a `CREATE TABLE` statement, and which one (if any) is the rowid. */
export function parseCreateTable(sql: string): { columns: string[]; rowidColumn: number } | null {
  const open = sql.indexOf('(');
  const close = sql.lastIndexOf(')');
  if (open < 0 || close < open) return null;
  const defs: string[] = [];
  let depth = 0;
  let quote = '';
  let start = open + 1;
  for (let i = open + 1; i < close; i++) {
    const ch = sql[i]!;
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '[') quote = ']';
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      defs.push(sql.slice(start, i));
      start = i + 1;
    }
  }
  defs.push(sql.slice(start, close));
  const columns: string[] = [];
  let rowidColumn = -1;
  for (const raw of defs) {
    const def = raw.trim();
    if (/^(primary|unique|check|foreign|constraint)\b/i.test(def)) continue;
    const m = /^(?:"((?:[^"]|"")*)"|`([^`]*)`|\[([^\]]*)\]|'([^']*)'|([^\s(]+))/.exec(def);
    if (!m) continue;
    const name = (m[1]?.replace(/""/g, '"') ?? m[2] ?? m[3] ?? m[4] ?? m[5])!;
    if (/\binteger\s+primary\s+key\b/i.test(def)) rowidColumn = columns.length;
    columns.push(name);
  }
  return columns.length ? { columns, rowidColumn } : null;
}
