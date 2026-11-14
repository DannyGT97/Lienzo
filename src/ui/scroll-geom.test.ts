import { describe, expect, it } from 'vitest';
import { shiftForThumbDrag, shiftForTrackClick, spanOf, startRange, thumbOf } from './scroll-geom';

describe('scroll geometry', () => {
  const vp = 800;

  it('lets the viewport start half a viewport beyond each page edge', () => {
    expect(startRange({ lo: 100, hi: 500 }, vp)).toEqual({ lo: -300, hi: 100 });
  });

  it('puts the thumb at the start/end when the page edges are at the limits', () => {
    const page = { lo: 400, hi: 1000 }; // start range lo = 0
    expect(thumbOf(page, vp, 600, 24).pos).toBeCloseTo(0);
    const end = thumbOf({ lo: -200, hi: 400 }, vp, 600, 24); // start range hi = -200+... t = 1
    expect(end.pos + end.size).toBeCloseTo(600);
  });

  it('sizes the thumb by the visible share and honours the minimum', () => {
    const t = thumbOf({ lo: 0, hi: 800 }, vp, 800, 24); // range 800, extent 1600 -> half
    expect(t.size).toBeCloseTo(400);
    expect(thumbOf({ lo: 0, hi: 1_000_000 }, vp, 800, 24).size).toBe(24);
  });

  it('reports nothing to scroll without a track or a page', () => {
    expect(thumbOf({ lo: 0, hi: 0 }, vp, 800, 24).scrollable).toBe(false);
    expect(thumbOf({ lo: 0, hi: 500 }, vp, 0, 24).scrollable).toBe(false);
  });

  it('turns a thumb drag into the opposite content movement over the whole range', () => {
    const page = { lo: 0, hi: 2000 }; // range 2000
    const t = thumbOf(page, vp, 800, 24);
    const free = 800 - t.size;
    expect(shiftForThumbDrag(page, vp, 800, 24, free)).toBeCloseTo(-2000);
    expect(shiftForThumbDrag(page, vp, 800, 24, -free / 2)).toBeCloseTo(1000);
  });

  it('pages towards the click', () => {
    expect(shiftForTrackClick(vp, true)).toBeCloseTo(-720);
    expect(shiftForTrackClick(vp, false)).toBeCloseTo(720);
  });

  it('takes the extremes of the corners, whatever their order', () => {
    expect(spanOf([30, -10, 80, 5])).toEqual({ lo: -10, hi: 80 });
  });
});
