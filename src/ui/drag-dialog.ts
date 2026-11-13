/**
 * Make a dialog movable by its header, with a finger, a pen or the mouse. The dialog starts centred (the style sheet's
 * business); the first drag pins it where it is and from then on it follows the pointer, always kept inside the visible
 * area so the header can be grabbed again. The header is the only grip: fields, selects, buttons and the dialog's own
 * scrolling never start a drag. Dialogs are zoomed by the interface scale, so positions are given in the dialog's own
 * (unscaled) units.
 */

export interface DialogDrag {
  /** Bring a pinned dialog back inside the visible area (after the window or the dialog changed size). */
  keepInside(): void;
  /** Centre it again (the style sheet's own placement). */
  reset(): void;
}

/** The visible area in screen pixels: what is left of the window when a keyboard or a zoom takes some of it. */
function visibleArea(): { x: number; y: number; w: number; h: number } {
  const v = window.visualViewport;
  return v ? { x: v.offsetLeft, y: v.offsetTop, w: v.width, h: v.height } : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Screen pixels per CSS pixel of a zoomed dialog (the interface scale). */
function zoomOf(dlg: HTMLElement): number {
  const w = dlg.offsetWidth;
  return w > 0 ? dlg.getBoundingClientRect().width / w || 1 : 1;
}

/**
 * Move a dialog out of the way of the notices by `dy` screen pixels, without touching where the person put it:
 * the shift is a separate `translate`, so clearing it brings the dialog back exactly.
 */
export function nudgeDialog(dlg: HTMLElement, dy: number): void {
  if (dy === 0) return clearNudge(dlg);
  dlg.dataset.nudge = String(dy);
  dlg.style.translate = `0 ${dy / zoomOf(dlg)}px`;
}

export function clearNudge(dlg: HTMLElement): void {
  delete dlg.dataset.nudge;
  dlg.style.translate = '';
}

/** How far the dialog is shifted by the notices now, in screen pixels (0 when it is where the person left it). */
export const nudgeOf = (dlg: HTMLElement): number => Number(dlg.dataset.nudge) || 0;

export function makeDraggable(dlg: HTMLDialogElement, grip: HTMLElement): DialogDrag {
  grip.classList.add('dlg-grip');
  let pinned = false;
  let drag: { id: number; px: number; py: number; left: number; top: number } | null = null;

  /** Screen pixels per CSS pixel of the dialog (the interface scale). */
  const scale = (): number => {
    const w = dlg.offsetWidth;
    return w > 0 ? dlg.getBoundingClientRect().width / w : 1;
  };

  function place(left: number, top: number): void {
    const area = visibleArea();
    const r = dlg.getBoundingClientRect();
    const s = scale() || 1;
    const x = clamp(left, area.x, area.x + area.w - r.width);
    const y = clamp(top, area.y, area.y + area.h - r.height);
    if (!pinned) {
      pinned = true;
      dlg.style.position = 'fixed';
      dlg.style.inset = 'auto';
      dlg.style.margin = '0';
    }
    dlg.style.left = `${x / s}px`;
    dlg.style.top = `${y / s}px`;
  }

  grip.addEventListener('pointerdown', (e) => {
    if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // Taking hold of a dialog that the notices had shifted: it stays where it is on screen, and from here on it is the
    // person's position (the shift ends instead of fighting the finger).
    const r = dlg.getBoundingClientRect();
    clearNudge(dlg);
    dlg.dataset.dragging = '1';
    drag = { id: e.pointerId, px: e.clientX, py: e.clientY, left: r.left, top: r.top };
    grip.setPointerCapture(e.pointerId);
    e.preventDefault(); // no text selection, no focus change while dragging
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    place(drag.left + e.clientX - drag.px, drag.top + e.clientY - drag.py);
  });
  const end = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    delete dlg.dataset.dragging;
    if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId);
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);

  const keepInside = (): void => {
    if (!pinned || !dlg.isConnected || !dlg.open) return; // a closed dialog has no size to keep inside
    const r = dlg.getBoundingClientRect();
    place(r.left, r.top - nudgeOf(dlg)); // the position the person chose, without the notices' shift
  };
  const onResize = (): void => {
    if (!dlg.isConnected) {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      return;
    }
    keepInside();
  };
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);

  return {
    keepInside,
    reset() {
      pinned = false;
      dlg.style.position = dlg.style.inset = dlg.style.margin = dlg.style.left = dlg.style.top = '';
    },
  };
}
