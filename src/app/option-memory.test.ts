import { describe, expect, it } from 'vitest';
import { diffControls, parseControlStore, readControls, withControls, writeControls, type ControlElement } from './option-memory';

const fake = (init: Record<string, string | boolean>) => {
  const els: Record<string, ControlElement & { events: string[] }> = {};
  for (const [id, v] of Object.entries(init)) {
    els[id] = { type: typeof v === 'boolean' ? 'checkbox' : 'range', value: typeof v === 'string' ? v : '', checked: typeof v === 'boolean' ? v : undefined, events: [], dispatchEvent(e: Event) { this.events.push(e.type); return true; } };
  }
  return { els, find: (id: string) => els[id] ?? null };
};

describe('option memory', () => {
  it('stores only what differs from the base', () => {
    expect(diffControls({ 'sel-tol': '30', 'sel-all': false }, { 'sel-tol': '55', 'sel-all': false })).toEqual({ 'sel-tol': '55' });
  });
  it('drops unknown controls and wrong kinds when reading storage', () => {
    expect(parseControlStore({ a: { 'sel-tol': '9', nope: '1', 'sel-all': 3 }, b: { zzz: '1' }, c: 5 })).toEqual({ a: { 'sel-tol': '9' } });
    expect(parseControlStore(null)).toEqual({});
    expect(parseControlStore([1])).toEqual({});
  });
  it('replaces or removes one sub tool without touching the others', () => {
    const s = withControls({ a: { 'sel-tol': '1' }, b: { 'sel-tol': '2' } }, 'a', {});
    expect(s).toEqual({ b: { 'sel-tol': '2' } });
    expect(withControls(s, 'c', { 'sel-all': true })).toEqual({ b: { 'sel-tol': '2' }, c: { 'sel-all': true } });
  });
  it('reads and writes controls, notifying only real changes', () => {
    const { els, find } = fake({ 'sel-tol': '30', 'sel-all': false });
    expect(readControls(find)).toEqual({ 'sel-tol': '30', 'sel-all': false });
    writeControls(find, { 'sel-tol': '30', 'sel-all': true, 'grad-shape': 'x' });
    expect(els['sel-tol']!.events).toEqual([]);
    expect(els['sel-all']!.checked).toBe(true);
    expect(els['sel-all']!.events).toEqual(['input', 'change']);
  });
});
