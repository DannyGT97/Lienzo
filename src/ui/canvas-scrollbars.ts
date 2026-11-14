import { shiftForThumbDrag, shiftForTrackClick, spanOf, thumbOf, type Span } from './scroll-geom';

export interface ScrollbarsDeps {
  /** The element the bars sit in (the canvas stage). */
  stage: HTMLElement;
  /** The stage's size in CSS pixels. */
  box: () => { w: number; h: number };
  /** The page's four corners on the stage (CSS pixels), whatever the view's turn. */
  corners: () => { x: number; y: number }[];
  /** Move the content on screen by this many pixels. */
  pan: (dx: number, dy: number) => void;
}

const MIN_THUMB = 28;
/** An arrow button moves the view this far (px); held down, it repeats. */
const STEP = 60;
const REPEAT_DELAY_MS = 350;
const REPEAT_MS = 45;

/** Vertical and horizontal scrollbars for the canvas, like the ones of a drawing program: they move the view over the page. */
export function mountScrollbars(d: ScrollbarsDeps): { update(): void } {
  const make = (axis: 'x' | 'y') => {
    const bar = document.createElement('div');
    bar.className = `scrollbar sb-${axis}`;
    bar.setAttribute('role', 'scrollbar');
    bar.setAttribute('aria-orientation', axis === 'x' ? 'horizontal' : 'vertical');
    const arrow = (end: boolean): HTMLElement => {
      const a = document.createElement('div');
      a.className = `sb-arrow ${end ? 'sb-end' : 'sb-start'}`;
      return a;
    };
    const start = arrow(false);
    const end = arrow(true);
    const track = document.createElement('div');
    track.className = 'sb-track';
    const thumb = document.createElement('div');
    thumb.className = 'sb-thumb';
    track.append(thumb);
    bar.append(start, track, end);
    d.stage.append(bar);
    return { axis, bar, track, thumb, start, end };
  };
  const bars = [make('y'), make('x')];

  const geometry = (axis: 'x' | 'y'): { page: Span; vp: number; track: number } => {
    const b = d.box();
    const pts = d.corners();
    const track = bars.find((s) => s.axis === axis)!.track;
    return { page: spanOf(pts.map((p) => p[axis])), vp: axis === 'x' ? b.w : b.h, track: axis === 'x' ? track.clientWidth : track.clientHeight };
  };
  const move = (axis: 'x' | 'y', shift: number): void => (axis === 'x' ? d.pan(shift, 0) : d.pan(0, shift));

  for (const { axis, bar, track, thumb, start, end } of bars) {
    /** The pointer's place and the thumb's when the drag began. */
    let drag: { from: number; pos: number } | null = null;
    const coord = (e: PointerEvent): number => (axis === 'x' ? e.clientX : e.clientY);
    const capture = (el: Element, e: PointerEvent): void => {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer that is already gone: nothing to follow */
      }
    };

    thumb.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      capture(thumb, e);
      const g = geometry(axis);
      drag = { from: coord(e), pos: thumbOf(g.page, g.vp, g.track, MIN_THUMB).pos };
      bar.classList.add('dragging');
    });
    thumb.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const g = geometry(axis);
      const now = thumbOf(g.page, g.vp, g.track, MIN_THUMB);
      // The thumb goes where the pointer is (within the track), however the view got there: only the difference is moved.
      const want = Math.min(g.track - now.size, Math.max(0, drag.pos + coord(e) - drag.from));
      const shift = shiftForThumbDrag(g.page, g.vp, g.track, MIN_THUMB, want - now.pos);
      if (shift) move(axis, shift);
    });
    const endDrag = (): void => {
      drag = null;
      bar.classList.remove('dragging');
    };
    thumb.addEventListener('pointerup', endDrag);
    thumb.addEventListener('pointercancel', endDrag);

    // A click on the track beside the thumb scrolls a page that way.
    track.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.target !== track) return;
      const r = thumb.getBoundingClientRect();
      move(axis, shiftForTrackClick(geometry(axis).vp, coord(e) > (axis === 'x' ? r.right : r.bottom)));
    });

    // The arrows at the ends scroll a little; held down they go on.
    for (const [btn, towardsEnd] of [[start, false], [end, true]] as const) {
      let timer = 0;
      const stop = (): void => {
        window.clearTimeout(timer);
        window.clearInterval(timer);
        btn.classList.remove('down');
      };
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        capture(btn, e);
        btn.classList.add('down');
        const step = (towardsEnd ? -1 : 1) * STEP;
        move(axis, step);
        timer = window.setTimeout(() => {
          timer = window.setInterval(() => move(axis, step), REPEAT_MS);
        }, REPEAT_DELAY_MS);
      });
      btn.addEventListener('pointerup', stop);
      btn.addEventListener('pointercancel', stop);
    }
  }

  return {
    update(): void {
      for (const { axis, bar, thumb } of bars) {
        const g = geometry(axis);
        const t = thumbOf(g.page, g.vp, g.track, MIN_THUMB);
        bar.classList.toggle('idle', !t.scrollable);
        thumb.style[axis === 'x' ? 'width' : 'height'] = `${t.size}px`;
        thumb.style[axis === 'x' ? 'left' : 'top'] = `${t.pos}px`;
      }
    },
  };
}
