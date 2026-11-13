/**
 * Command registry. Every menu entry and command-bar button refers to a command id; a command is "live" when something
 * has registered a handler for it, and everything else is shown disabled. Implementing a feature later means registering
 * its handler here, with no change to the menus.
 */

export interface CommandHandler {
  run: () => void | Promise<void>;
  /** Extra condition (e.g. "there is something to undo"). Defaults to enabled. */
  enabled?: () => boolean;
  /** For toggles: current state, shown as a check mark. */
  checked?: () => boolean;
}

const handlers = new Map<string, CommandHandler>();
const listeners = new Set<() => void>();
let commandGate: ((id: string) => boolean) | null = null;

export const commands = {
  register(id: string, handler: CommandHandler | (() => void | Promise<void>)): void {
    handlers.set(id, typeof handler === 'function' ? { run: handler } : handler);
  },

  has(id: string): boolean {
    return handlers.has(id);
  },

  /** A condition every command must also meet (for example "there is an open document"); null lifts it. */
  setGate(gate: ((id: string) => boolean) | null): void {
    commandGate = gate;
    commands.notify();
  },

  enabled(id: string): boolean {
    const h = handlers.get(id);
    return !!h && (!commandGate || commandGate(id)) && (h.enabled ? h.enabled() : true);
  },

  /** undefined when the command is not a toggle. */
  checked(id: string): boolean | undefined {
    return handlers.get(id)?.checked?.();
  },

  run(id: string): void {
    const h = handlers.get(id);
    if (!h || !commands.enabled(id)) return;
    void h.run();
    commands.notify();
  },

  /** Subscribe to state changes (buttons re-read enabled/checked). */
  onChange(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },

  notify(): void {
    for (const cb of listeners) cb();
  },

  /** How many commands have a handler (for the progress report in the docs). */
  count(): number {
    return handlers.size;
  },
};

// ---- keyboard shortcuts ---------------------------------------------------------------------

export interface KeySpec {
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

const KEY_CODES: Record<string, string> = {
  supr: 'Delete',
  delete: 'Delete',
  tab: 'Tab',
  retroceso: 'Backspace',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '-': 'Minus',
  '+': 'Equal',
  '=': 'Equal',
  '^': 'Equal',
  '@': 'Digit2',
  ',': 'Comma',
  '.': 'Period',
  "'": 'Quote',
};

/** Parse a display string such as "Mayús+Ctrl+S", "Ctrl++" or "F1". Returns null if it cannot be mapped. */
export function parseShortcut(text: string): KeySpec | null {
  let rest = text.trim();
  const spec: KeySpec = { code: '', ctrl: false, shift: false, alt: false };
  for (;;) {
    const m = /^(Ctrl|Mayús|Alt)\+(?=.)/.exec(rest);
    if (!m) break;
    if (m[1] === 'Ctrl') spec.ctrl = true;
    else if (m[1] === 'Mayús') spec.shift = true;
    else spec.alt = true;
    rest = rest.slice(m[0].length);
  }
  const key = rest.toLowerCase();
  if (/^f\d{1,2}$/.test(key)) spec.code = key.toUpperCase();
  else if (/^[a-z]$/.test(key)) spec.code = `Key${key.toUpperCase()}`;
  else if (/^[0-9]$/.test(key)) spec.code = `Digit${key}`;
  else if (KEY_CODES[key]) spec.code = KEY_CODES[key]!;
  else return null;
  return spec;
}

export function matchesShortcut(e: KeyboardEvent, s: KeySpec): boolean {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl !== s.ctrl || e.altKey !== s.alt) return false;
  // "+" is often reached with Shift on the main row; accept either state for Equal.
  if (s.code !== 'Equal' && e.shiftKey !== s.shift) return false;
  return e.code === s.code || (s.code === 'Equal' && e.code === 'NumpadAdd') || (s.code === 'Minus' && e.code === 'NumpadSubtract');
}

/** Alternative shortcuts for commands (several per command). */
export const SHORTCUT_ALIASES: Record<string, string[]> = {
  redo: ['Mayús+Ctrl+Z'],
  clear: ['Retroceso'],
  viewzoomin: ['Ctrl+='],
  selectinvert: ['Mayús+Ctrl+I'],
};

const bound = new Map<string, KeySpec[]>();

/** Declare the shortcuts of a command so that the global key handler can run it. */
export function bindShortcuts(id: string, shortcuts: string[]): void {
  const specs = shortcuts.map(parseShortcut).filter((s): s is KeySpec => !!s);
  if (specs.length) bound.set(id, specs);
}

/** Run the command whose shortcut matches the key event, if it is live. Returns true when handled. */
export function handleShortcut(e: KeyboardEvent): boolean {
  for (const [id, specs] of bound) {
    if (!commands.has(id) || !commands.enabled(id)) continue;
    if (specs.some((s) => matchesShortcut(e, s))) {
      e.preventDefault();
      commands.run(id);
      return true;
    }
  }
  return false;
}
