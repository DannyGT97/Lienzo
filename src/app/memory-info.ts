// What the app can honestly say about memory, kept apart by who owns it. Three different things are never added up
// or called "RAM": the undo history (counted from its steps), the document's pixel blocks (counted from its surfaces),
// and the whole process (only when the browser can measure it, otherwise the row is left out).

/** KB below 1 MB, MB below 1 GB, GB above. */
export function formatBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)} GB`;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

export interface MemoryFigures {
  historySteps: number;
  historyBytes: number;
  /** The open document's pixel blocks. */
  documentBytes: number;
  documentTiles: number;
  /** Every open document together. */
  openDocuments: number;
  openDocumentsBytes: number;
  gpuTextures: number;
}

/** The browser's whole-page measurement; only some browsers offer it, and only when the page is cross-origin isolated. */
type Measure = () => Promise<{ bytes: number }>;
interface Env {
  crossOriginIsolated?: boolean;
  performance?: { measureUserAgentSpecificMemory?: Measure };
}

export function processMemorySupported(env: Env = globalThis as unknown as Env): boolean {
  return env.crossOriginIsolated === true && typeof env.performance?.measureUserAgentSpecificMemory === 'function';
}

/** Process memory from a real measurement, asked at most once per `minGapMs`; the last answer is kept until the next one. */
export class ProcessMemoryProbe {
  private bytes: number | null = null;
  private lastAsk = -Infinity;
  private running = false;

  constructor(
    private readonly env: Env = globalThis as unknown as Env,
    private readonly now: () => number = () => Date.now(),
    private readonly minGapMs = 30_000,
  ) {}

  get supported(): boolean {
    return processMemorySupported(this.env);
  }

  /** The last measured size, or null when there is none (unsupported, not measured yet, or the measurement failed). */
  get value(): number | null {
    return this.supported ? this.bytes : null;
  }

  /** Starts a measurement when supported and not too recent; never throws. */
  poke(): void {
    if (!this.supported || this.running || this.now() - this.lastAsk < this.minGapMs) return;
    this.running = true;
    this.lastAsk = this.now();
    void this.env
      .performance!.measureUserAgentSpecificMemory!()
      .then((r) => {
        this.bytes = Number.isFinite(r.bytes) ? r.bytes : null;
      })
      .catch(() => {
        this.bytes = null;
      })
      .finally(() => {
        this.running = false;
      });
  }
}

/** Rows for the Memoria group of Preferences: what the user can act on, plain values only. The process row appears only when measured. */
export function memorySummary(f: MemoryFigures, processBytes: number | null): [string, string][] {
  const rows: [string, string][] = [
    ['Historial de deshacer', formatBytes(f.historyBytes)],
    ['Documento', formatBytes(f.documentBytes)],
  ];
  if (f.openDocuments > 1) rows.push(['Todos los documentos', formatBytes(f.openDocumentsBytes)]);
  if (processBytes !== null) rows.push(['Aplicación', formatBytes(processBytes)]);
  return rows;
}

/** Rows for the Information palette: the summary plus the step count and GPU textures. */
export function memoryRows(f: MemoryFigures, processBytes: number | null): [string, string][] {
  return [['Pasos de historial', String(f.historySteps)], ...memorySummary(f, processBytes), ['Texturas GPU', String(f.gpuTextures)]];
}
