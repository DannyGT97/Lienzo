/**
 * The one place where the app tells the person something ("Guardado", "No se pudo abrir", "Ampliando imagen…").
 * No DOM here: the view (`notify-view.ts`) draws what this keeps, so the rules can be tested on their own.
 *
 *  - info / success fade by themselves; the time comes from the preference "Duración de los avisos".
 *  - warning / error stay until closed, and the same one repeated is grouped (×N) instead of piling up.
 *  - busy: a notice for something that takes time. It appears only after a short delay (a quick operation never flashes
 *    it), stays at least a moment once it appeared, and lasts as long as the operation needs. When the operation ends
 *    it is replaced, in the same place, by its result, which then has the normal duration of its level.
 *  - Holding (a pointer over the notices) pauses every timer.
 */

export type NoticeLevel = 'info' | 'success' | 'warning' | 'error';

export interface NoticeAction {
  label: string;
  run: () => void;
  /** Keep the notice open after the action ran (default: it closes). */
  keep?: boolean;
}

export interface NoticeSpec {
  /** Lines under the title; the first one of a saved file is its path. */
  detail?: string | string[];
  /** Small grey line (size, hint). */
  meta?: string;
  actions?: NoticeAction[];
  /** Overrides the level's default: warnings and errors stay, the rest fade. */
  persist?: boolean;
}

export interface BusyState {
  /** 0..1, or null when the progress cannot be measured (a spinner is shown). */
  pct: number | null;
  sub?: string;
  hint?: string;
  cancelable: boolean;
  /** Cancel was asked and the operation is stopping. */
  cancelling: boolean;
  /** What «Cancelar» runs (only meaningful when `cancelable`). */
  cancel: () => void;
}

export interface Notice {
  id: number;
  level: NoticeLevel;
  title: string;
  detail: string[];
  meta?: string;
  actions: NoticeAction[];
  /** How many times the same warning/error was reported. */
  count: number;
  persist: boolean;
  busy?: BusyState;
}

export interface HistoryEntry {
  id: number;
  level: NoticeLevel;
  title: string;
  detail: string[];
  meta?: string;
  count: number;
  at: number;
}

export interface BusyOptions {
  /** Shows «Cancelar»; only for work on a copy that leaves nothing half done when aborted. */
  cancelable?: boolean;
  hint?: string;
  /** Called when Cancelar is pressed (the same moment `signal` aborts). */
  onCancel?: () => void;
}

export interface BusyHandle {
  /** Aborts when the person pressed Cancelar; long operations pass it down and stop at the next safe point. */
  readonly signal: AbortSignal;
  readonly finished: boolean;
  progress(pct: number | null, sub?: string): void;
  /** Ends the operation. With a result it replaces the busy notice; without, the notice just goes away. */
  done(level?: NoticeLevel, title?: string, spec?: NoticeSpec): void;
  /** The usual end of a cancelled operation. */
  cancelled(): void;
  cancel(): void;
}

export interface NotifierOptions {
  /** Base time of a plain notice, in ms (read each time, so changing the preference applies at once). */
  ms: () => number;
  busyDelayMs?: number;
  busyMinMs?: number;
  maxHistory?: number;
}

export const MAX_VISIBLE = 3;
export const BUSY_DELAY_MS = 400;
export const BUSY_MIN_MS = 600;
export const MAX_HISTORY = 30;

/** The notices to draw (the newest ones) and how many are left out. */
export function visibleNotices(list: readonly Notice[], max = MAX_VISIBLE): { shown: Notice[]; hidden: number } {
  const hidden = Math.max(0, list.length - max);
  return { shown: list.slice(hidden), hidden };
}

const lines = (d: string | string[] | undefined): string[] => (d === undefined ? [] : Array.isArray(d) ? [...d] : [d]);

interface Timer {
  handle: ReturnType<typeof setTimeout> | null;
  due: number;
  remaining: number;
}

export function createNotifier(opts: NotifierOptions) {
  const busyDelay = opts.busyDelayMs ?? BUSY_DELAY_MS;
  const busyMin = opts.busyMinMs ?? BUSY_MIN_MS;
  const maxHistory = opts.maxHistory ?? MAX_HISTORY;
  let notices: Notice[] = [];
  let history: HistoryEntry[] = [];
  let unread = 0;
  let held = false;
  let nextId = 1;
  const timers = new Map<number, Timer>();
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const l of [...listeners]) l();
  };

  const lifetime = (n: Notice): number => (n.level === 'success' ? opts.ms() + 1000 : opts.ms());

  function disarm(id: number): void {
    const t = timers.get(id);
    if (t?.handle !== null && t) clearTimeout(t.handle!);
    timers.delete(id);
  }

  function start(id: number, t: Timer): void {
    t.due = Date.now() + t.remaining;
    t.handle = setTimeout(() => dismiss(id), t.remaining);
  }

  /** (Re)start the countdown of a notice that fades. */
  function arm(n: Notice): void {
    disarm(n.id);
    if (n.persist || n.busy) return;
    const t: Timer = { handle: null, due: 0, remaining: lifetime(n) };
    timers.set(n.id, t);
    if (!held) start(n.id, t);
  }

  function dismiss(id: number): void {
    disarm(id);
    const before = notices.length;
    notices = notices.filter((n) => n.id !== id);
    if (notices.length !== before) emit();
  }

  function record(n: Notice): void {
    history = [{ id: n.id, level: n.level, title: n.title, detail: n.detail, ...(n.meta ? { meta: n.meta } : {}), count: 1, at: Date.now() }, ...history].slice(0, maxHistory);
    unread++;
  }

  /** Show a notice; `at` puts it in a given place of the stack (a result takes the place of its busy notice). */
  function show(level: NoticeLevel, title: string, spec: NoticeSpec = {}, at?: number): number {
    const persist = spec.persist ?? (level === 'warning' || level === 'error');
    const same = notices.find((n) => !n.busy && n.level === level && n.title === title);
    if (same && (persist || level === 'warning' || level === 'error')) {
      // The same problem again: count it and show the latest details, instead of a second copy.
      same.count++;
      same.detail = lines(spec.detail);
      same.meta = spec.meta;
      same.actions = spec.actions ?? same.actions;
      const h = history.find((e) => e.id === same.id);
      if (h) {
        h.count = same.count;
        h.at = Date.now();
      }
      unread++;
      arm(same);
      emit();
      return same.id;
    }
    if (same) {
      // A repeated short notice only lasts longer.
      same.detail = lines(spec.detail);
      same.meta = spec.meta;
      same.actions = spec.actions ?? [];
      arm(same);
      emit();
      return same.id;
    }
    const n: Notice = { id: nextId++, level, title, detail: lines(spec.detail), ...(spec.meta ? { meta: spec.meta } : {}), actions: spec.actions ?? [], count: 1, persist };
    if (at === undefined || at >= notices.length) notices = [...notices, n];
    else notices = [...notices.slice(0, at), n, ...notices.slice(at)];
    record(n);
    arm(n);
    emit();
    return n.id;
  }

  function busy(text: string, o: BusyOptions = {}): BusyHandle {
    const controller = new AbortController();
    let finished = false;
    let shownAt = 0;
    let notice: Notice | null = null;
    const state: BusyState = { pct: null, cancelable: !!o.cancelable, cancelling: false, cancel: () => op.cancel(), ...(o.hint ? { hint: o.hint } : {}) };
    const timer = setTimeout(() => {
      if (finished) return;
      shownAt = Date.now();
      notice = { id: nextId++, level: 'info', title: text, detail: [], actions: [], count: 1, persist: true, busy: state };
      notices = [...notices, notice];
      emit();
    }, busyDelay);

    const op: BusyHandle = {
      signal: controller.signal,
      get finished() {
        return finished;
      },
      progress(pct, sub) {
        if (finished) return;
        state.pct = pct === null ? null : Math.min(1, Math.max(0, pct));
        if (sub !== undefined) state.sub = sub;
        if (notice) emit();
      },
      cancel() {
        if (finished || state.cancelling || !state.cancelable) return;
        state.cancelling = true;
        controller.abort();
        o.onCancel?.();
        if (notice) emit();
      },
      cancelled() {
        op.done('info', 'Cancelado', { detail: 'No se cambió nada.' });
      },
      done(level, title, spec) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        const shown = notice;
        const hasResult = level !== undefined && title !== undefined;
        if (!shown) {
          // It ended before anyone saw it: only the result, no flash.
          if (hasResult) show(level, title, spec);
          return;
        }
        const finish = (): void => {
          const at = notices.indexOf(shown);
          if (at >= 0) notices = notices.filter((n) => n !== shown);
          if (hasResult) show(level, title, spec, at >= 0 ? at : undefined);
          else emit();
        };
        const wait = Math.max(0, busyMin - (Date.now() - shownAt));
        if (wait === 0) finish();
        else setTimeout(finish, wait);
      },
    };
    return op;
  }

  return {
    info: (title: string, spec?: NoticeSpec): number => show('info', title, spec),
    success: (title: string, spec?: NoticeSpec): number => show('success', title, spec),
    warning: (title: string, spec?: NoticeSpec): number => show('warning', title, spec),
    error: (title: string, spec?: NoticeSpec): number => show('error', title, spec),
    busy,
    dismiss,
    /** Run the action of a notice; it closes the notice unless the action keeps it open. */
    activate(id: number, index: number): void {
      const n = notices.find((x) => x.id === id);
      const a = n?.actions[index];
      if (!n || !a) return;
      a.run();
      if (!a.keep) dismiss(id);
    },
    /** A pointer is over the notices: nothing fades while it stays there. */
    hold(on: boolean): void {
      if (on === held) return;
      held = on;
      for (const [id, t] of timers) {
        if (on) {
          if (t.handle !== null) clearTimeout(t.handle);
          t.handle = null;
          t.remaining = Math.max(0, t.due - Date.now());
        } else start(id, t);
      }
    },
    notices: (): readonly Notice[] => notices,
    history: (): readonly HistoryEntry[] => history,
    unread: (): number => unread,
    markRead(): void {
      if (!unread) return;
      unread = 0;
      emit();
    },
    clearHistory(): void {
      history = [];
      unread = 0;
      emit();
    },
    /** The worst level among notices that are still on screen (warning/error), for the bell. */
    worst: (): 'error' | 'warning' | null => (notices.some((n) => !n.busy && n.level === 'error') ? 'error' : notices.some((n) => !n.busy && n.level === 'warning') ? 'warning' : null),
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export type Notifier = ReturnType<typeof createNotifier>;
