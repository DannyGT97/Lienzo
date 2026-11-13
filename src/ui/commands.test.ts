import { afterEach, describe, expect, it } from 'vitest';
import { commands } from './commands';

describe('command gate', () => {
  afterEach(() => commands.setGate(null));

  it('switches off every command the gate refuses, and only those', () => {
    commands.register('gate-a', () => undefined);
    commands.register('gate-b', { run: () => undefined, enabled: () => false });
    expect(commands.enabled('gate-a')).toBe(true);
    commands.setGate((id) => id !== 'gate-a');
    expect(commands.enabled('gate-a')).toBe(false);
    commands.setGate(null);
    expect(commands.enabled('gate-a')).toBe(true);
    expect(commands.enabled('gate-b')).toBe(false); // its own condition still applies
  });

  it('does not run a refused command', () => {
    let ran = 0;
    commands.register('gate-run', () => void ran++);
    commands.setGate(() => false);
    commands.run('gate-run');
    expect(ran).toBe(0);
    commands.setGate(null);
    commands.run('gate-run');
    expect(ran).toBe(1);
  });
});
