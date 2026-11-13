/**
 * Live profiler for pen strokes: records, while you draw, how steadily frames are
 * produced, how input events arrive, and where time goes. The aim is to tell apart
 * "the app hiccups" from "the pen sends few samples" from "the display runs faster
 * than the pen".
 */

const median = (v: number[]): number => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const pct = (v: number[], p: number): number => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
};
const r1 = (n: number): number => Math.round(n * 10) / 10;
const stat = (v: number[]): string => `mediana ${r1(median(v))}, p95 ${r1(pct(v, 0.95))}, máx ${r1(Math.max(0, ...v))}`;

export class Profiler {
  enabled = false;
  private active = false;
  private strokes = 0;
  private frameIntervals: number[] = [];
  private cpu: number[] = [];
  private gpu: number[] = [];
  private handler: number[] = [];
  private arrival: number[] = [];
  private perFrame: number[] = [];
  private eventsSinceFrame = 0;
  private lastFrame = 0;
  private lastEvent = 0;
  private samples = 0;
  private longTasks: number[] = [];
  private observer: PerformanceObserver | null = null;
  private displayMs = 0;

  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.reset();
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) this.longTasks.push(e.duration);
      });
      this.observer.observe({ entryTypes: ['longtask'] });
    } catch {
      this.observer = null; // not supported: the summary simply has no long-task line
    }
    this.measureDisplay();
  }

  stop(): void {
    this.enabled = false;
    this.active = false;
    this.observer?.disconnect();
    this.observer = null;
  }

  reset(): void {
    this.strokes = 0;
    this.frameIntervals = [];
    this.cpu = [];
    this.gpu = [];
    this.handler = [];
    this.arrival = [];
    this.perFrame = [];
    this.longTasks = [];
    this.samples = 0;
    this.eventsSinceFrame = 0;
    this.lastFrame = 0;
    this.lastEvent = 0;
  }

  /** Display refresh period, from plain animation frames with nothing else going on. */
  private measureDisplay(): void {
    const times: number[] = [];
    const tick = (t: number): void => {
      times.push(t);
      if (times.length < 45) requestAnimationFrame(tick);
      else {
        const d = times.slice(1).map((x, i) => x - times[i]!);
        this.displayMs = median(d);
      }
    };
    requestAnimationFrame(tick);
  }

  strokeStart(): void {
    if (!this.enabled) return;
    this.active = true;
    this.strokes++;
    this.lastFrame = 0;
    this.lastEvent = 0;
    this.eventsSinceFrame = 0;
  }

  strokeEnd(): void {
    this.active = false;
  }

  /** One pen/mouse sample handled; `ms` is the time the handler took. */
  event(ms: number, eventTime: number, count: number): void {
    if (!this.enabled || !this.active) return;
    this.handler.push(ms);
    this.samples += count;
    this.eventsSinceFrame++;
    if (this.lastEvent) this.arrival.push(eventTime - this.lastEvent);
    this.lastEvent = eventTime;
  }

  /** One rendered frame: `cpuMs` JS time of the draw, `syncMs` time until the GPU finished (when measured). */
  frame(start: number, cpuMs: number, syncMs?: number): void {
    if (!this.enabled || !this.active) return;
    if (this.lastFrame) {
      this.frameIntervals.push(start - this.lastFrame);
      this.perFrame.push(this.eventsSinceFrame);
    }
    this.eventsSinceFrame = 0;
    this.lastFrame = start;
    this.cpu.push(cpuMs);
    if (syncMs !== undefined) this.gpu.push(syncMs);
  }

  summary(): string {
    if (!this.enabled) return 'Perfil desactivado.';
    const lines: string[] = [];
    const hz = this.displayMs ? Math.round(1000 / this.displayMs) : 0;
    lines.push(`Pantalla: ${this.displayMs ? `${r1(this.displayMs)} ms ≈ ${hz} Hz` : 'midiendo…'}`);
    lines.push(`Trazos: ${this.strokes} · muestras: ${this.samples}`);
    if (!this.frameIntervals.length) {
      lines.push('Dibuja un trazo para ver los tiempos.');
      return lines.join('\n');
    }
    const med = median(this.frameIntervals);
    const slow = this.frameIntervals.filter((x) => x > med * 1.5).length;
    lines.push(`Intervalo entre fotogramas: ${stat(this.frameIntervals)} (≈ ${med ? Math.round(1000 / med) : 0} fps)`);
    lines.push(`Fotogramas ${Math.round(med * 1.5)} ms o más lentos: ${slow} de ${this.frameIntervals.length} (${Math.round((slow / this.frameIntervals.length) * 100)} %)`);
    const n = this.perFrame.length;
    const z = this.perFrame.filter((x) => x === 0).length;
    const one = this.perFrame.filter((x) => x === 1).length;
    lines.push(`Muestras nuevas por fotograma: 0 → ${Math.round((z / n) * 100)} %, 1 → ${Math.round((one / n) * 100)} %, 2 o más → ${Math.round(((n - z - one) / n) * 100)} %`);
    lines.push(`Llegada entre muestras (ms): ${stat(this.arrival)}`);
    lines.push(`Tiempo en el evento (CPU, ms): ${stat(this.handler)}`);
    lines.push(`Dibujo del fotograma (CPU, ms): ${stat(this.cpu)}`);
    if (this.gpu.length) lines.push(`Dibujo hasta que la GPU termina (ms): ${stat(this.gpu)}`);
    lines.push(`Tareas largas (>50 ms): ${this.longTasks.length}${this.longTasks.length ? `, la mayor ${r1(Math.max(...this.longTasks))} ms` : ''}`);
    return lines.join('\n');
  }
}
