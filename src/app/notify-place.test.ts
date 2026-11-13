import { describe, expect, it } from 'vitest';
import { candidateSpots, chooseSpot, nudgeFor, overlaps, type Box, type Spot } from './notify-place';

const box = (left: number, top: number, w: number, h: number): Box => ({ left, top, right: left + w, bottom: top + h });

describe('chooseSpot', () => {
  const boxes: Record<Spot, Box> = { br: box(600, 400, 300, 100), bl: box(0, 400, 300, 100), bc: box(300, 400, 300, 100), tc: box(300, 0, 300, 100) };
  const at = (s: Spot): Box => boxes[s];

  it('uses the first candidate when no dialog is in the way', () => {
    expect(chooseSpot(candidateSpots(false), at, [box(300, 100, 200, 200)])).toEqual({ spot: 'br', blocked: false });
  });
  it('flips to the other side when a dialog covers the first one', () => {
    expect(chooseSpot(candidateSpots(false), at, [box(650, 380, 200, 100)])).toEqual({ spot: 'bl', blocked: false });
    expect(chooseSpot(candidateSpots(true), at, [box(320, 380, 200, 100)])).toEqual({ spot: 'tc', blocked: false });
  });
  it('keeps the usual side and says it is blocked when both are covered', () => {
    expect(chooseSpot(candidateSpots(false), at, [box(0, 380, 900, 100)])).toEqual({ spot: 'br', blocked: true });
  });
});

describe('nudgeFor', () => {
  const area = { top: 0, bottom: 800 };
  it('does nothing when they do not overlap', () => {
    expect(nudgeFor(box(0, 100, 300, 200), box(0, 700, 300, 80), area)).toBe(0);
  });
  it('moves a dialog up just enough to clear notices at the bottom', () => {
    // dialog bottom 760, notices top 700: up by 60 + gap 8
    expect(nudgeFor(box(0, 500, 300, 260), box(0, 700, 300, 80), area)).toBe(-68);
  });
  it('moves a dialog down to clear notices at the top', () => {
    expect(nudgeFor(box(0, 20, 300, 260), box(0, 0, 300, 80), area)).toBe(68);
  });
  it('never takes the dialog out of the visible area', () => {
    // only 30 px of room above the dialog
    expect(nudgeFor(box(0, 30, 300, 740), box(0, 700, 300, 80), area)).toBe(-30);
  });
  it('overlaps is strict at the edges', () => {
    expect(overlaps(box(0, 0, 10, 10), box(10, 0, 10, 10))).toBe(false);
  });
});
