import { icon } from './icons';
import { touchUi } from './touch-mode';
import { DEFAULT_SUBTOOL, LIVE, PALETTE_TOOLS, isLive, toolHasLive, toolsForLetter, type LiveBinding, type SubToolEntry } from './spec/tool-map';
import type { ToolDef } from './spec/tools';
import { hasStrokePreview, previewFor, strokeSvg } from './stroke-preview';
import { buttonIconName, cardPreview, rowIconName } from './subtool-art';

/** Where the chosen sub tool of each tool is kept between sessions. */
export const LAST_SUBTOOLS_KEY = 'lienzo.lastSubtools.v1';

/** Read the stored choices (tool id -> sub tool id), dropping what no longer names a working sub tool of that tool. Never throws. */
export function parseLastSubtools(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [toolId, subId] of Object.entries(raw)) {
    const t = PALETTE_TOOLS.find((x) => x.id === toolId);
    if (t && typeof subId === 'string' && isLive(subId) && t.groups.some((g) => g.subtools.some((s) => s.id === subId))) out.set(toolId, subId);
  }
  return out;
}

export interface ToolPaletteHooks {
  toolColumn: HTMLElement;
  groupTabs: HTMLElement;
  subToolList: HTMLElement;
  /** Called whenever a (live) sub tool becomes current. */
  onSelect: (binding: LiveBinding, tool: ToolDef, subId: string) => void;
}

export interface ToolPaletteApi {
  select(toolId: string, subId?: string): void;
  /** Handle a tool shortcut letter: cycles through the live tools that use it. Returns true if handled. */
  pressLetter(letter: string): boolean;
  current(): { toolId: string; subId: string };
  /** Make the palette show the sub tool that drives the given engine tool (used when code switches tools). */
  syncTo(engineTool: string): void;
}

/**
 * Tool palette (a column of tool buttons) plus the sub tool palette (groups and the list of sub tools of the current tool).
 * Sub tools without an engine binding are listed but disabled.
 */
export function mountToolPalettes(h: ToolPaletteHooks): ToolPaletteApi {
  /** Where a tool starts when nothing was chosen on it yet: its default sub tool, else the first that works. */
  const firstLive = (t: ToolDef): { groupId: string; subId: string } | null => {
    const wanted = DEFAULT_SUBTOOL[t.id];
    if (wanted && isLive(wanted)) {
      const g = t.groups.find((x) => x.subtools.some((s) => s.id === wanted));
      if (g) return { groupId: g.id, subId: wanted };
    }
    for (const g of t.groups) for (const s of g.subtools) if (isLive(s.id)) return { groupId: g.id, subId: s.id };
    return null;
  };

  // Without a pointer to hover there are no tooltips: a touch screen names the tool that was just picked.
  let toast: HTMLDivElement | null = null;
  let toastTimer = 0;
  const announce = (name: string): void => {
    if (!touchUi() || performance.now() < 2500) return; // not for the tool chosen while the app starts
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'tool-toast';
      toast.setAttribute('role', 'status');
      document.body.append(toast);
    }
    toast.textContent = name;
    toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast?.classList.remove('on'), 1400);
  };

  // tool id -> last sub tool used; kept between sessions so a tool comes back on the sub tool it was left on
  const last = (() => {
    try {
      return parseLastSubtools(JSON.parse(localStorage.getItem(LAST_SUBTOOLS_KEY) ?? 'null'));
    } catch {
      return new Map<string, string>(); // unreadable or unavailable storage: every tool starts on its default
    }
  })();
  const remember = (tool: string, sub: string): void => {
    if (last.get(tool) === sub) return;
    last.set(tool, sub);
    try {
      localStorage.setItem(LAST_SUBTOOLS_KEY, JSON.stringify(Object.fromEntries(last)));
    } catch {
      // Not remembering costs the person nothing but the memory.
    }
  };
  let toolId = '';
  let groupId = '';
  let subId = '';

  const toolById = (id: string): ToolDef | undefined => PALETTE_TOOLS.find((t) => t.id === id);

  // ---- tool column
  const buttons = new Map<string, HTMLButtonElement>();
  const sepAfter = new Set(['move', 'auto-select', 'airbrush', 'eraser', 'blend', 'gradient', 'text', 'comic']);
  for (const t of PALETTE_TOOLS) {
    const b = document.createElement('button');
    b.className = 'tp-btn';
    b.title = `${t.es}${t.shortcut ? ` (${t.shortcut})` : ''}${toolHasLive(t) ? '' : ' – todavía no disponible'}`;
    b.setAttribute('aria-label', t.es);
    b.dataset.tool = t.id;
    b.disabled = !toolHasLive(t);
    b.addEventListener('click', () => api.select(t.id));
    buttons.set(t.id, b);
    h.toolColumn.append(b);
    if (sepAfter.has(t.id)) {
      const s = document.createElement('span');
      s.className = 'tp-sep';
      h.toolColumn.append(s);
    }
  }
  /** The button shows the drawing of the sub tool the tool is on (the remembered one before the tool is first used). */
  const paintButton = (t: ToolDef, sub: string | undefined): void => {
    const b = buttons.get(t.id);
    if (b) b.innerHTML = icon(buttonIconName(t.id, t.icon, sub ?? last.get(t.id) ?? firstLive(t)?.subId), 22);
  };
  for (const t of PALETTE_TOOLS) paintButton(t, undefined);

  // ---- sub tool palette
  function renderSubTools(): void {
    const t = toolById(toolId);
    h.groupTabs.replaceChildren();
    h.subToolList.replaceChildren();
    if (!t) return;
    h.groupTabs.hidden = t.groups.length < 2;
    for (const g of t.groups) {
      const b = document.createElement('button');
      b.className = 'st-group' + (g.id === groupId ? ' on' : '');
      b.textContent = g.es;
      b.addEventListener('click', () => {
        groupId = g.id;
        renderSubTools();
      });
      h.groupTabs.append(b);
    }
    const group = t.groups.find((g) => g.id === groupId) ?? t.groups[0]!;
    let section: string | undefined;
    for (const s of group.subtools) {
      // Lists that file their sub tools under headings (the gradient library) get a sticky heading with its count.
      const heading = (s as SubToolEntry).section;
      if (heading && heading !== section) {
        const head = document.createElement('li');
        head.className = 'st-section';
        head.innerHTML = `<span>${heading}</span><span class="st-count">${group.subtools.filter((x) => (x as SubToolEntry).section === heading).length}</span>`;
        h.subToolList.append(head);
      }
      section = heading;
      const li = document.createElement('li');
      const live = isLive(s.id);
      li.className = 'st-row' + (s.id === subId ? ' on' : '') + (live ? '' : ' planned');
      // Brush-like tools show a sample stroke (grid card); the rest keep a compact icon row.
      const preview = hasStrokePreview(t.id) ? strokeSvg(previewFor(t.id, s.id, LIVE[s.id]?.preset), s.id) : cardPreview(s.id);
      if (preview) li.classList.add('card');
      li.innerHTML = `${preview || icon(rowIconName(t.icon, s.id), 18)}<span class="st-name">${s.es}</span>`;
      li.title = live ? s.es : `${s.es} – todavía no disponible`;
      li.setAttribute('aria-disabled', String(!live));
      li.addEventListener('click', () => live && api.select(t.id, s.id));
      h.subToolList.append(li);
    }
  }

  function refreshButtons(): void {
    for (const [id, b] of buttons) b.classList.toggle('on', id === toolId);
  }

  const api: ToolPaletteApi = {
    select(id, sub) {
      const t = toolById(id);
      if (!t || !toolHasLive(t)) return;
      let chosen = sub ?? last.get(id);
      let g = t.groups.find((x) => x.subtools.some((s) => s.id === chosen));
      if (!chosen || !g || !isLive(chosen)) {
        const f = firstLive(t)!;
        chosen = f.subId;
        g = t.groups.find((x) => x.id === f.groupId)!;
      }
      toolId = id;
      groupId = g.id;
      subId = chosen;
      remember(id, chosen);
      paintButton(t, chosen);
      refreshButtons();
      renderSubTools();
      h.onSelect(LIVE[chosen]!, t, chosen);
      const subName = g.subtools.find((x) => x.id === chosen)?.es;
      announce(subName && subName !== t.es ? `${t.es} · ${subName}` : t.es);
    },

    pressLetter(letter) {
      const candidates = toolsForLetter(letter.toUpperCase());
      if (!candidates.length) return false;
      const i = candidates.findIndex((t) => t.id === toolId);
      api.select(candidates[(i + 1) % candidates.length]!.id);
      return true;
    },

    current: () => ({ toolId, subId }),

    syncTo(engineTool) {
      const cur = LIVE[subId];
      if (cur?.tool === engineTool) return;
      for (const t of PALETTE_TOOLS) {
        const fits = t.groups.flatMap((g) => g.subtools.filter((s) => LIVE[s.id]?.tool === engineTool).map((s) => ({ g, s })));
        if (!fits.length) continue;
        // Several sub tools can drive the same engine tool: keep the one this tool was left on.
        const keep = last.get(t.id);
        const pick = fits.find((f) => f.s.id === keep) ?? fits[0]!;
        toolId = t.id;
        groupId = pick.g.id;
        subId = pick.s.id;
        remember(t.id, pick.s.id);
        paintButton(t, pick.s.id);
        refreshButtons();
        renderSubTools();
        return;
      }
    },
  };

  return api;
}
