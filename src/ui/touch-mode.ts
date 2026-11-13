/**
 * Touch layout (bigger controls, drawers, tablet density). Own design: it is a choice kept in storage, not something
 * guessed from the pointer, because a Windows PC with a touch screen reports a coarse pointer and used to get the
 * phone layout without asking for it. With nothing stored, only a phone or tablet (Android, iOS/iPadOS) starts in it;
 * the Window menu switches it on or off and the choice is kept between runs.
 *
 * CSS keys off the `touch-ui` class on <html>; script reads `touchUi()` / `onTouchUi()`.
 */
export const TOUCH_UI_KEY = 'lienzo.touchUi';
const CLASS = 'touch-ui';

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;

/** True on a phone or tablet. iPadOS reports itself as a Mac, told apart by having touch points. */
export function isTouchPlatform(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator): boolean {
  if (/Android|iPhone|iPad|iPod/i.test(nav.userAgent)) return true;
  return /Macintosh/i.test(nav.userAgent) && nav.maxTouchPoints > 1;
}

/** What to start with: the stored choice if there is one, otherwise whether this is a touch device. */
export function initialTouchUi(storage: Reader | null, platformIsTouch: boolean): boolean {
  try {
    const saved = storage?.getItem(TOUCH_UI_KEY);
    if (saved === '1') return true;
    if (saved === '0') return false;
  } catch {
    // Storage blocked: fall back to the platform.
  }
  return platformIsTouch;
}

const listeners = new Set<(on: boolean) => void>();

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** Whether the touch layout is in force right now. */
export const touchUi = (): boolean => document.documentElement.classList.contains(CLASS);

/** Sets the class from the stored choice; call once before the interface is built. */
export function applyInitialTouchUi(): boolean {
  const on = initialTouchUi(storage(), isTouchPlatform());
  document.documentElement.classList.toggle(CLASS, on);
  return on;
}

/** Switches the layout and keeps the choice (an explicit 0/1, so "off" also survives on a tablet). */
export function setTouchUi(on: boolean, store: Writer | null = storage()): void {
  document.documentElement.classList.toggle(CLASS, on);
  try {
    store?.setItem(TOUCH_UI_KEY, on ? '1' : '0');
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
  for (const l of listeners) l(on);
}

/** Subscribe to layout switches; returns the unsubscribe function. */
export function onTouchUi(listener: (on: boolean) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
