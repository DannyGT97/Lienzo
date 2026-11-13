import { describe, expect, it } from 'vitest';
import { parseSizes, splitPair } from './dock-resize';

describe('splitPair', () => {
  it('moves what one palette gains from the other, keeping the total', () => {
    expect(splitPair(200, 300, 50, 60, 400, 400)).toEqual({ a: 250, b: 250 });
    expect(splitPair(200, 300, -80, 60, 400, 400)).toEqual({ a: 120, b: 380 });
  });

  it('stops at the minimum on either side', () => {
    expect(splitPair(200, 300, -500, 60, 400, 600)).toEqual({ a: 60, b: 440 });
    expect(splitPair(200, 300, 500, 60, 600, 600)).toEqual({ a: 440, b: 60 });
  });

  it('never makes a palette taller than its content', () => {
    expect(splitPair(200, 300, 150, 60, 260, 400)).toEqual({ a: 260, b: 240 });
    expect(splitPair(200, 300, -150, 60, 400, 380)).toEqual({ a: 120, b: 380 });
  });

  it('gives each palette its own minimum', () => {
    // the one above needs 150, the one below 100
    expect(splitPair(300, 300, -400, 150, 600, 600, 100)).toEqual({ a: 150, b: 450 });
    expect(splitPair(300, 300, 400, 150, 600, 600, 100)).toEqual({ a: 500, b: 100 });
    expect(splitPair(300, null, -400, 150, 600)).toEqual({ a: 150, b: null });
  });

  it('with no explicit height below, only the one above changes', () => {
    expect(splitPair(200, null, 40, 60, 500)).toEqual({ a: 240, b: null });
    expect(splitPair(200, null, -400, 60, 500)).toEqual({ a: 60, b: null });
  });
});

describe('parseSizes', () => {
  it('keeps usable heights and drops the rest', () => {
    expect(parseSizes('{"a":120.4,"b":"x","c":5,"d":99999,"e":null}')).toEqual({ a: 120 });
    expect(parseSizes('nope')).toEqual({});
    expect(parseSizes(null)).toEqual({});
    expect(parseSizes('[1,2]')).toEqual({});
  });
});
