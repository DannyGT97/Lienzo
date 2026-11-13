/**
 * Draws the notices of `notify.ts`: a stack at the bottom of the screen, above the status bar, in the browser's top
 * layer (a popover) so it stays visible over the app's dialogs. Only the notices take pointer events; the rest of the
 * region lets touches through to the canvas. The notice centre lists what already faded.
 */
import { clearNudge, nudgeDialog } from '../ui/drag-dialog';
import { visibleNotices, type HistoryEntry, type Notice, type Notifier } from './notify';
import { candidateSpots, chooseSpot, nudgeFor, type Box, type Spot } from './notify-place';

const GAP = 8;
const SIDE = 12;

const SVG = (path: string, w = 2.5): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
const ICONS = {
  info: SVG('M12 11v6M12 7v.01'),
  success: SVG('M5 12.5l4.5 4.5L19 7.5', 2.8),
  warning: SVG('M12 6v8M12 18v.01'),
  error: SVG('M7 7l10 10M17 7L7 17', 2.8),
};

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const hasPopover = (e: HTMLElement): boolean => typeof e.showPopover === 'function';
function isOpen(e: HTMLElement): boolean {
  try {
    return hasPopover(e) ? e.matches(':popover-open') : !e.hidden;
  } catch {
    return false;
  }
}
function open(e: HTMLElement): void {
  e.hidden = false;
  if (hasPopover(e) && !isOpen(e)) e.showPopover();
}
function close(e: HTMLElement): void {
  if (hasPopover(e) && isOpen(e)) e.hidePopover();
  e.hidden = true;
}
/** Move a shown popover above everything opened since (a dialog that opened later would cover it). */
function raise(e: HTMLElement): void {
  if (!hasPopover(e) || !isOpen(e)) return;
  e.hidePopover();
  e.showPopover();
}

function ago(at: number, now = Date.now()): string {
  const s = Math.round((now - at) / 1000);
  return s < 5 ? 'ahora' : s < 60 ? `hace ${s} s` : `hace ${Math.round(s / 60)} min`;
}

interface Refs {
  bar?: HTMLElement;
  sub?: HTMLElement;
  pct?: HTMLElement;
}

export interface NoticeView {
  toggleCenter(): void;
  openCenter(): void;
  closeCenter(): void;
}

export function mountNoticeView(n: Notifier): NoticeView {
  const host = h('section', 'notices');
  host.id = 'notices';
  host.setAttribute('role', 'region');
  host.setAttribute('aria-label', 'Avisos');
  host.setAttribute('popover', 'manual');
  host.hidden = true;
  const more = h('button', 'notices-more');
  more.type = 'button';
  more.hidden = true;
  host.append(more);

  const center = h('section', 'notice-center');
  center.id = 'notice-center';
  center.setAttribute('popover', 'manual');
  center.setAttribute('aria-label', 'Historial de avisos');
  center.hidden = true;
  const head = h('div', 'nc-head');
  const clear = h('button', '', 'Borrar');
  const shut = h('button', '', 'Cerrar');
  clear.type = shut.type = 'button';
  head.append(h('b', '', 'Avisos'), clear, shut);
  const list = h('div', 'nc-list');
  center.append(head, list);
  document.body.append(host, center);

  const els = new Map<number, HTMLElement>();
  const sigs = new Map<number, string>();
  const refs = new WeakMap<HTMLElement, Refs>();

  // ---- drawing --------------------------------------------------------------------------------------------

  const signature = (x: Notice): string =>
    JSON.stringify([x.level, x.title, x.detail, x.meta, x.count, x.actions.map((a) => a.label), x.busy && [x.busy.cancelable, x.busy.cancelling, x.busy.hint, x.busy.pct === null, x.busy.sub === undefined]]);

  function fill(el: HTMLElement, x: Notice): void {
    const kind = x.busy ? 'busy' : x.level;
    el.className = `notice n-${kind}${el.classList.contains('in') ? ' in' : ''}`;
    el.setAttribute('role', x.level === 'warning' || x.level === 'error' ? 'alert' : 'status');
    const ico = h('div', 'n-ico');
    if (x.busy) ico.append(h('div', 'n-spin'));
    else ico.innerHTML = ICONS[x.level];
    const body = h('div', 'n-body');
    const title = h('div', 'n-title', x.title);
    if (x.count > 1) title.append(h('span', 'n-count', `×${x.count}`));
    body.append(title);
    for (const line of x.detail) body.append(h('div', 'n-detail', line));
    if (x.meta) body.append(h('div', 'n-meta', x.meta));
    const r: Refs = {};
    if (x.busy) {
      if (x.busy.pct !== null) {
        const bar = h('div', 'n-bar');
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '100');
        r.bar = h('i');
        bar.append(r.bar);
        body.append(bar);
      }
      if (x.busy.pct !== null || x.busy.hint || x.busy.sub !== undefined) {
        const sub = h('div', 'n-sub');
        r.sub = h('span');
        sub.append(r.sub);
        if (x.busy.pct !== null) {
          r.pct = h('span');
          sub.append(r.pct);
        }
        body.append(sub);
      }
    }
    const acts = h('div', 'n-actions');
    x.actions.forEach((a, i) => {
      const b = h('button', '', a.label);
      b.type = 'button';
      b.addEventListener('click', () => n.activate(x.id, i));
      acts.append(b);
    });
    if (x.busy?.cancelable) {
      const b = h('button', '', x.busy.cancelling ? 'Cancelando…' : 'Cancelar');
      b.type = 'button';
      b.disabled = x.busy.cancelling;
      b.addEventListener('click', () => x.busy!.cancel());
      acts.append(b);
    }
    if (acts.children.length) body.append(acts);
    el.replaceChildren(ico, body);
    if (!x.busy) {
      const b = h('button', 'n-x', '×');
      b.type = 'button';
      b.setAttribute('aria-label', 'Cerrar aviso');
      b.addEventListener('click', () => n.dismiss(x.id));
      el.append(b);
    } else el.append(h('span'));
    refs.set(el, r);
  }

  function progress(el: HTMLElement, x: Notice): void {
    const r = refs.get(el);
    if (!r || !x.busy) return;
    const pct = x.busy.pct === null ? null : Math.round(x.busy.pct * 100);
    if (r.bar && pct !== null) {
      r.bar.style.width = `${pct}%`;
      r.bar.parentElement!.setAttribute('aria-valuenow', String(pct));
    }
    if (r.sub) r.sub.textContent = x.busy.sub ?? x.busy.hint ?? '';
    if (r.pct && pct !== null) r.pct.textContent = `${pct} %`;
  }

  function render(): void {
    const { shown, hidden } = visibleNotices(n.notices());
    const keep = new Set(shown.map((x) => x.id));
    for (const [id, el] of els) {
      if (keep.has(id)) continue;
      el.remove();
      els.delete(id);
      sigs.delete(id);
    }
    const order: HTMLElement[] = [more];
    for (const x of shown) {
      let el = els.get(x.id);
      if (!el) {
        el = h('div', 'notice in');
        el.addEventListener('animationend', () => el!.classList.remove('in'), { once: true });
        els.set(x.id, el);
      }
      const sig = signature(x);
      if (sigs.get(x.id) !== sig) {
        fill(el, x);
        sigs.set(x.id, sig);
      }
      progress(el, x);
      order.push(el);
    }
    order.forEach((e, i) => {
      if (host.children[i] !== e) host.insertBefore(e, host.children[i] ?? null);
    });
    more.hidden = hidden === 0;
    more.textContent = `+${hidden} más · ver avisos`;
    if (shown.length) open(host);
    else {
      close(host);
      n.hold(false); // a notice closed under the pointer sends no "leave"
    }
    if (isOpen(center)) renderCenter();
    schedule();
  }

  // ---- placement ------------------------------------------------------------------------------------------

  const isTouch = (): boolean => document.documentElement.classList.contains('touch-ui') || window.matchMedia('(max-width: 700px)').matches;

  function area(): Box {
    const v = window.visualViewport;
    return v ? { left: v.offsetLeft, top: v.offsetTop, right: v.offsetLeft + v.width, bottom: v.offsetTop + v.height } : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  }

  /** Screen pixels per CSS pixel of the region (the interface scale zooms it like the dialogs). */
  const zoom = (): number => (host.offsetWidth > 0 ? host.getBoundingClientRect().width / host.offsetWidth || 1 : 1);

  /** The bottom edge for notices: above the status bar, and above the keyboard (the visible area ends there). */
  function bottomEdge(a: Box): number {
    const bar = document.getElementById('statusbar');
    const top = bar && bar.offsetHeight > 0 ? bar.getBoundingClientRect().top : Infinity;
    return Math.min(top, a.bottom) - GAP;
  }
  function topEdge(a: Box): number {
    const bar = document.getElementById('appbar');
    const bottom = bar && bar.offsetHeight > 0 ? bar.getBoundingClientRect().bottom : -Infinity;
    return Math.max(bottom, a.top) + GAP;
  }

  function applySpot(el: HTMLElement, spot: Spot): void {
    const a = area();
    const k = zoom();
    const s = el.style;
    s.left = s.right = s.top = s.bottom = 'auto';
    s.transform = '';
    if (spot === 'tc') s.top = `${topEdge(a) / k}px`;
    else s.bottom = `${(window.innerHeight - bottomEdge(a)) / k}px`;
    if (spot === 'br') s.right = `${(window.innerWidth - a.right + SIDE) / k}px`;
    else if (spot === 'bl') s.left = `${(a.left + SIDE) / k}px`;
    else {
      s.left = `${((a.left + a.right) / 2) / k}px`;
      s.transform = 'translateX(-50%)';
    }
    el.dataset.spot = spot;
  }

  const rectOf = (e: Element): Box => {
    const r = e.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  };

  const openDialogs = (): HTMLDialogElement[] => [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')];

  function layout(): void {
    const dialogs = openDialogs();
    for (const d of dialogs) if (!d.dataset.dragging) clearNudge(d);
    if (isOpen(center)) applySpot(center, isTouch() ? 'bc' : 'br');
    if (!isOpen(host)) return;
    const choice = chooseSpot(candidateSpots(isTouch()), (spot) => (applySpot(host, spot), rectOf(host)), dialogs.map(rectOf));
    applySpot(host, choice.spot);
    // Both sides are covered: a notice with buttons needs the person's finger, so the dialog steps aside until it closes.
    if (!choice.blocked || !n.notices().some((x) => x.actions.length || x.busy?.cancelable)) return;
    const notices = rectOf(host);
    const a = area();
    for (const d of dialogs) {
      if (d.dataset.dragging) continue;
      nudgeDialog(d, nudgeFor(rectOf(d), notices, { top: topEdge(a) - GAP, bottom: bottomEdge(a) + GAP }));
    }
  }

  let frame = 0;
  function schedule(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      layout();
    });
  }

  // ---- notice centre --------------------------------------------------------------------------------------

  function renderCenter(): void {
    const items: readonly HistoryEntry[] = n.history();
    list.replaceChildren(
      ...(items.length
        ? items.map((e) => {
            const row = h('div', 'nc-row');
            const dot = h('i');
            dot.className = `nc-dot n-${e.level}`;
            const text = h('div');
            const title = h('div', 'nc-title', e.title);
            if (e.count > 1) title.append(h('span', 'n-count', `×${e.count}`));
            text.append(title);
            for (const d of e.detail) text.append(h('div', 'nc-detail', d));
            if (e.meta) text.append(h('div', 'nc-detail', e.meta));
            row.append(dot, text, h('time', '', ago(e.at)));
            return row;
          })
        : [h('div', 'nc-empty', 'Sin avisos todavía.')]),
    );
    n.markRead();
  }
  let centerTimer = 0;
  const api: NoticeView = {
    openCenter() {
      open(center);
      renderCenter();
      layout();
      clearInterval(centerTimer);
      centerTimer = window.setInterval(renderCenter, 5000);
    },
    closeCenter() {
      close(center);
      clearInterval(centerTimer);
    },
    toggleCenter() {
      if (isOpen(center)) api.closeCenter();
      else api.openCenter();
    },
  };
  more.addEventListener('click', api.openCenter);
  shut.addEventListener('click', api.closeCenter);
  clear.addEventListener('click', () => {
    n.clearHistory();
    renderCenter();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen(center)) api.closeCenter();
  });

  // ---- wiring ---------------------------------------------------------------------------------------------

  host.addEventListener('pointerenter', () => n.hold(true));
  host.addEventListener('pointerleave', () => n.hold(false));
  host.addEventListener('focusin', () => n.hold(true));
  host.addEventListener('focusout', () => n.hold(false));
  n.subscribe(render);
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  window.addEventListener('pointerup', schedule); // a dialog just dragged may have moved onto, or off, the notices
  // A dialog added to the page covers the top layer below it; bring the notices back above.
  new MutationObserver((muts) => {
    if (muts.some((m) => m.target instanceof HTMLDialogElement && m.target.open)) {
      raise(host);
      raise(center);
    }
    schedule();
  }).observe(document.body, { attributes: true, attributeFilter: ['open'], subtree: true });
  new MutationObserver(schedule).observe(document.body, { childList: true });
  render();
  return api;
}
