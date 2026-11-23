/**
 * What the person is told when something throws. Two things the raw browser message did badly:
 *  - "Array buffer allocation failed" means the page ran out of memory (a tablet gives a web view far less than a computer): the
 *    person is told what happened and what to do, in words, instead of the engine's message;
 *  - the same error can repeat many times a second (a loop that keeps trying), and every repeat was a new notice on top of the last.
 */

/** Messages of the engine when the memory for a big block (a page, a layer, a buffer) could not be had. */
const OUT_OF_MEMORY = /array buffer allocation failed|invalid (typed )?array length|out of memory|allocation failed|cannot allocate|no se pudo reservar/i;

export const isOutOfMemory = (text: string): boolean => OUT_OF_MEMORY.test(text);

export const MEMORY_NOTICE =
  'Se ha acabado la memoria disponible. Tu trabajo sigue abierto. Cierra los documentos que no uses, baja «Memoria para deshacer» en Preferencias o trabaja con menos capas o una página más pequeña.';

/** How long a notice of each kind is not repeated. */
const QUIET_MS = { memory: 20_000, other: 3_000 } as const;

/** The words to show for a raw error text, and what kind it is. The "Uncaught RangeError:" the browser puts in front is dropped. */
export function describe(text: string): { kind: 'memory' | 'other'; message: string } {
  if (isOutOfMemory(text)) return { kind: 'memory', message: MEMORY_NOTICE };
  return { kind: 'other', message: text.replace(/^Uncaught (\w*Error: )?/, '') || text };
}

/**
 * A filter in front of the notices: returns what to show, or null when the same thing was shown a moment ago (the first one stays on
 * screen; saying it again helps no one). Memory errors are kept quiet longer, as they come in bursts.
 */
export function createNoticeFilter(now: () => number = Date.now): (text: string) => string | null {
  const last = new Map<string, number>();
  return (text) => {
    const { kind, message } = describe(text);
    const key = kind === 'memory' ? 'memory' : message;
    const at = now();
    const before = last.get(key);
    if (before !== undefined && at - before < QUIET_MS[kind]) return null;
    last.set(key, at);
    if (last.size > 50) last.delete(last.keys().next().value as string);
    return message;
  };
}
