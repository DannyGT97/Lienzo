import './settings-boot'; // first: puts the saved settings back into localStorage before anything reads it
import {
  createBalloon,
  defaultTailStyle,
  defaultTailTip,
  withDefaultTail,
  hitBalloon,
  hitHandle,
  moveBalloon,
  pathBalloon,
  resizeBalloon,
  tailShapes,
  withShape,
  withTail,
  handlePoints,
  type Balloon,
  type BalloonShape,
  type Handle,
  type TailStyle,
} from '../engine/balloon';
import { smoothClosed, type Pt } from '../engine/geometry';
import { simplifyPath } from '../engine/rulers';
import { BLEND_MODES, type BlendMode } from '../engine/blend';
import type { GradientRepeat, GradientShape } from '../engine/gradient';
import { presetStops } from '../engine/gradient-presets';
import { averageBox } from '../engine/eyedropper';
import { correctionOf, DEFAULT_CORRECTION } from '../engine/stroke-correct';
import { DEFAULT_ANTIALIAS, Stroke, antialiasOf, defaultBrush, entryRampSamples, type BrushSettings, type PenStroke, type Rect } from '../engine/brush';
import { LiquifyStroke, type LiquifyMode } from '../engine/liquify';
import { SmudgeStroke } from '../engine/smudge';
import { CloneStroke } from '../engine/clone';
import { MultiStroke } from '../engine/multi-stroke';
import { flatten, flattenRegion, layerThumbnail, sampleDocument } from '../engine/composite';
import { DECODE_PIXEL_LIMIT, SNIFF_BYTES, decodePcx, decodePnm, decodeQoi, decodeTga, decodeTiff, sniffImage, type RawImage } from '../engine/image-decode';
import {
  activeLayer,
  addLayer,
  createDocument,
  documentPixels,
  findLayer,
  paintTarget,
  type Document,
  type Layer,
  type LayerKind,
} from '../engine/document';
import { History, applyLimits, combineCommands, limitsNotice, patchCommand, type Command } from '../engine/history';
import { addComp, applyComp, compMatches, recordComps, removeComp, renameComp, updateComp } from '../engine/layer-comps';
import { canMergeDown, canRasterize, captureStructure, copyLayers, mergeLayerDown, pasteLayers, type LayerClip, rasterizeLayer, recordStructure, samePropsList, structureCommand } from '../engine/layer-ops';
import { canFlattenFolder, flattenFolder } from '../engine/merge-ops';
import { fillMask } from '../engine/mask-ops';
import {
  addRectPanel,
  gridPanels,
  panelAt,
  removePanel,
  splitPanels,
} from '../engine/panels';
import { copyPixels, pasteClip, type Clip } from '../engine/clipboard';
import { encodeBmp, encodeTga, encodeTiff, flattenOverWhite } from '../engine/image-formats';
import { applyPageOp, type PageOp } from '../engine/page-ops';
import { Selection as PixelSelection, eraseSelection } from '../engine/selection';
import { isLienzo, loadLienzo, saveLienzo } from '../engine/lienzo-file';
import { exportFlatPsd, exportPsd, importPsd } from '../engine/psd';
import { importClip, looksLikeClip } from '../engine/clip-file';
import { canWriteClip, exportClip } from '../engine/clip-write';
import { loadSql } from './sql-loader';
import { exportOra, importOra, looksLikeOra, type OraCodecs } from '../engine/ora-file';
import { renderTone, type ToneShape } from '../engine/tone';
import { openDiagnostics } from './diagnostics';
import { ProcessMemoryProbe, formatBytes, memoryRows, memorySummary, type MemoryFigures } from './memory-info';
import { GLRenderer } from './gl-renderer';
import { clampSizeFine, stepSize } from './brush-size';
import { mountToolSliders } from './tool-sliders';
import { askNewDocument } from './new-doc';
import { alertDialog, choiceDialog, confirmDialog, promptDialog } from './ui-dialogs';
import { mountCommandBar } from '../ui/commandbar';
import { icon } from '../ui/icons';
import type { BrushPreset, LiveBinding } from '../ui/spec/tool-map';
import { mountToolPalettes, type ToolPaletteApi } from '../ui/tool-palettes';
import { SHORTCUT_ALIASES, bindShortcuts, commands, handleShortcut } from '../ui/commands';
import { mountMenuBar } from '../ui/menubar';
import { mountLeftExtraDock, mountRightDock } from '../ui/studio-palettes';
import { paramByKey, type NumberParam } from '../engine/brush-params';
import { valueField } from '../ui/value-field';
import { diffParams, parseStore, shownParams, snapshotParams, withOverrides, type OverrideStore, type ParamValues } from '../engine/brush-overrides';
import { PALETTE_TOOLS } from '../ui/spec/tool-map';
import { mountTimeline } from '../ui/timeline';
import { mountStatusBar, type StatusInfo, type TabInfo } from '../ui/statusbar';
import { mountScrollbars } from '../ui/canvas-scrollbars';
import { predictPoint, type PenSample } from '../engine/predict';
import { activeAfterClose } from './doc-tabs';
import { loadShown, saveShown } from '../ui/palette-visibility';
import { attachContextMenu } from '../ui/contextmenu';
import { mountRulers } from '../ui/rulers';
import { armStaticPalettes } from '../ui/collapsible';
import { createSelectionUi, isFillTool, isSelectionTool } from './selection-ui';
import { listAutosaves, newAutosaveKey, removeAutosave, startAutosave, trimAutosaves, type StoredAutosave } from './autosave';
import { hasUnsavedChanges, judgeCopy, planRestore, readSession, writeSession } from './session-state';
import { chooseSaveTarget, dialogReportsType, displayName, filePlatform, hasPicker, isApp, onAndroid, modifiedAt, openFile, openFiles, readFrom, readKnownFile, saveAs as saveAsOutside, saveTo, writeToTarget, type FileFilter, type FileRef, type PickedFile, type SaveTarget } from './file-io';
import { openUpdatesWindow } from './updates-window';
import { checkForUpdates, currentVersion, findUpdate, updatesAvailable } from './updates';
import { loadRecent, mergeRecent, relocateRecent, sameFile, storeRecent, withoutRecent, type RecentFile } from './recent-files';
import { createHome } from './library-ui';
import { encodePng } from '../engine/png-encode';
import { aboutLines, pageVersion, versionLabel, type BuildInfo } from './about';
import { libraryFs } from './library-fs';
import { createPreviewer, createThumbs, previewPng } from './library-preview';
import { joinRel, uniqueName } from './library';
import { createSaveFlow } from './save-flow';
import { createExitGuard, installExitHooks } from './exit-guard';
import { describeRecovery, type RecoveredWrite } from './write-recovery';
import { flushSettings } from './settings-store';
import { deniedNotice, failedNotice, savedNotice, type NoticeText, type SaveStep, type SavedResult } from './save-notice';
import { formatInfo, formatOfName, formatsFor, isLayered, type SaveFormat, type SaveKind } from './save-formats';
import { createFiltersUi } from './filters-ui';
import { createAdjustUi } from './adjust-ui';
import { createVectorUi, isVectorTool } from './vector-ui';
import { defaultAdjust } from '../engine/adjust';
import { createRulersUi, isRulerTool } from './rulers-ui';
import { createShapesUi, isShapeTool } from './shapes-ui';
import { createGuidesUi } from './guides-ui';
import type { Guides } from '../engine/guides';
import { docMatrix, docToScreen, isTurned, planeSize, screenDeltaToPlane, screenToDoc, screenToPlane, visibleOutline, type StageSize, type ViewState } from './view-geom';
import { createLayersUi } from './layers-ui';
import { createTransformUi, type TransformMode } from './transform-ui';
import { createCanvasResizeUi } from './canvas-resize-ui';
import { openCanvasProps } from './canvas-props-ui';
import { applyCanvasProps, applyResolution, type CanvasProps, type Resolution } from '../engine/canvas-props';
import { mountLayoutResizers } from '../ui/layout-resizers';
import { applyUiScale } from '../ui/ui-scale';
import { applyInitialTouchUi, setTouchUi, touchUi } from '../ui/touch-mode';
import { openColorSettings } from '../ui/color-settings';
import { createColorStores } from '../ui/palettes/color';
import { openLayerSettings, openPreferences, openShortcutSettings } from '../ui/dialogs';
import { openResolution } from './resolution-ui';
import { LEFT_EXTRA_GROUPS, PALETTE_SPECS, RIGHT_GROUPS } from '../ui/spec/palettes';
import type { RGB } from '../ui/color';
import { MENUS, dynamicMenus, type MenuEntry } from '../ui/spec/menus';
import { Profiler } from './profiler';
import { renderObjectsLayer } from './render-objects';
import { applyPressureCurve, loadPrefs, noticeMs, sanitizePrefs, savePrefs, type Prefs } from './prefs';
import { createNotifier, type BusyHandle } from './notify';
import { OPTION_CONTROLS, diffControls, parseControlStore, readControls, withControls, writeControls, type ControlElement, type ControlStore, type ControlValues } from './option-memory';
import { mountNoticeView } from './notify-view';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const input = (id: string): HTMLInputElement => $<HTMLInputElement>(id);
const select = (id: string): HTMLSelectElement => $<HTMLSelectElement>(id);

// ---- document ---------------------------------------------------------------
/** A4 at 300 dpi by default; any size works because pixels are stored in sparse tiles. */
function newDocument(width = 2480, height = 3508, dpi = 300, look: { paper?: [number, number, number] | null; guides?: Guides } = {}): Document {
  const d = createDocument(width, height, dpi);
  const paper = d.layers[0]!;
  paper.name = 'Papel';
  paper.kind = 'paper';
  paper.paperColor = look.paper ?? [255, 255, 255];
  // No paper: the layer stays (the page always has one at the bottom) but does not cover the transparency.
  if (look.paper === null) paper.visible = false;
  if (look.guides) d.guides = { v: [...look.guides.v], h: [...look.guides.h] };
  addLayer(d, 'Capa 1');
  return d;
}

/** The "Preferencias" values; read once at start and replaced when the dialog is accepted. */
let prefs: Prefs = (() => {
  try {
    return loadPrefs(localStorage);
  } catch {
    return sanitizePrefs(null); // storage blocked altogether: defaults for this session
  }
})();
const newHistory = (): History => new History(prefs.historySteps, prefs.undoMemoryMb * 1024 * 1024);
applyUiScale(prefs.uiScale);
// The touch layout is a saved choice (off on a desktop, on at first start on a phone or tablet), set before the UI is built.
applyInitialTouchUi();

let doc = newDocument();
let history = newHistory();
/** Name of the document and the file it lives in (none until it is saved or opened), and the history step that was saved. */
let docName = 'Sin título';
/** What tabs, the status bar and dialogs call the document: the real file name (with extension) once it has one. */
let docTitle = 'Sin título';
let docFile: FileRef | null = null;
/** The format the document is tied to (what "Guardar" writes) and what has already been warned about when saving it. */
let docFormat: SaveFormat = 'lienzo';
let warnedFormats = new Set<SaveFormat>();
let clipOverwriteOk = false;
/**
 * No document is open (the last tab was closed): nothing is drawn and only the commands that start a document, open
 * a file or set the application up are live. `doc` then holds a throwaway blank document so that the code that reads
 * it never meets a missing one; it is not in a tab, is never saved or autosaved, and the next document replaces it.
 */
let workspaceEmpty = false;
/** The home screen is shown over an open document (see `syncHome`). */
let homeOverlay = false;
const WORKSPACE_COMMANDS = /^(filenew|fileopen|filerecent|filehome|application|window|help)/;
let savedRevision = history.revision;

const stage = $('stage');
const canvas = $<HTMLCanvasElement>('canvas');
const overlay = $<HTMLCanvasElement>('overlay');
const octx = overlay.getContext('2d')!;
let renderer: GLRenderer;
try {
  renderer = new GLRenderer(canvas);
} catch (err) {
  stage.textContent = err instanceof Error ? err.message : String(err);
  throw err;
}

const profiler = new Profiler();
renderer.onFrame = (t, cpu, sync) => profiler.frame(t, cpu, sync);

const dpr = (): number => window.devicePixelRatio || 1;

/**
 * Where the stage was when the view was last placed on it (viewport pixels). Dragging a dock, folding one or resizing the
 * window changes the stage; the page must not change with it: same scale, same place on the screen.
 */
let lastStage: { left: number; top: number; w: number; h: number } | null = null;
/**
 * While the app starts its layout is still settling (docks, fonts, restored tabs), and the page is fitted to whatever the stage
 * is at that moment. From the first touch of the person, or a moment after start, the stage changing no longer fits it again.
 */
let stageSettled = false;
window.setTimeout(() => (stageSettled = true), 1500);
window.addEventListener('pointerdown', () => (stageSettled = true), { once: true, capture: true });

/** Match the GPU canvas and the overlay to the stage size (in device pixels). */
function resizeSurfaces(): void {
  const r = stage.getBoundingClientRect();
  const before = lastStage;
  lastStage = { left: r.left, top: r.top, w: r.width, h: r.height };
  overlay.width = Math.max(1, Math.round(r.width * dpr()));
  overlay.height = Math.max(1, Math.round(r.height * dpr()));
  // The overlay is as big as its bitmap (never stretched to the stage by CSS).
  overlay.style.width = `${r.width}px`;
  overlay.style.height = `${r.height}px`;
  // The page's canvas does not follow the stage at all: it is as big as the window and sits where the window's top left corner
  // is, so a dock being dragged never resizes or moves it (a canvas that changes while it is on screen is shown stretched, or
  // shifted, until its new picture arrives). The stage clips it; the page is drawn into the part of it that is the stage.
  const buffer = { w: Math.max(window.innerWidth, r.left + r.width), h: Math.max(window.innerHeight, r.top + r.height) };
  canvas.style.width = `${buffer.w}px`;
  canvas.style.height = `${buffer.h}px`;
  canvas.style.left = `${-r.left}px`;
  canvas.style.top = `${-r.top}px`;
  renderer.resize({ w: r.width, h: r.height, left: r.left, top: r.top }, buffer, dpr());
  if (r.width <= 0) drawOverlay();
  else if (!userView && !stageSettled) fitView();
  else if (before && before.w > 0 && before.h > 0 && (before.left !== r.left || before.top !== r.top || before.w !== r.width || before.h !== r.height)) keepPageInPlace(before);
  // Resizing a canvas empties it: draw both again now, before the next paint, not on a later frame.
  renderer.flush();
  drawOverlay();
  rulers?.redraw();
  scrollbars.update();
}

/**
 * The stage changed size or place: put the view back so that the page does not move on the screen and keeps its scale. The
 * page point that was under the old stage's middle is kept under the same spot of the screen; the turn and the zoom are
 * unchanged, so every other point stays put with it (a turned view spins about the stage's middle, which is what moved).
 */
function keepPageInPlace(before: { left: number; top: number; w: number; h: number }): void {
  const anchor = screenToDoc(view, { w: before.w, h: before.h }, before.w / 2, before.h / 2);
  const r = stage.getBoundingClientRect();
  const to = screenToPlane(view, { w: r.width, h: r.height }, before.left + before.w / 2 - r.left, before.top + before.h / 2 - r.top);
  view.x = to.x - anchor.x * view.scale;
  view.y = to.y - anchor.y * view.scale;
  applyView();
}
new ResizeObserver(resizeSurfaces).observe(stage);
window.addEventListener('resize', resizeSurfaces);

function attachDocument(): void {
  renderer.setDocument(doc);
}
attachDocument();

/** The extra palettes under the sub tool palette; set once the interface is mounted. */
let leftExtra: ReturnType<typeof mountLeftExtraDock> | undefined;
/** The palette dock on the right; set once the interface is mounted. */
let studio: ReturnType<typeof mountRightDock> | undefined;

/** Ask the GPU renderer to redraw (the dirty tiles upload themselves; the region is not needed). */
function render(region?: Rect | null): void {
  studio?.navigator.invalidate();
  scheduleThumbs();
  // A pixel change reports its region: the renderer recomposes just those tiles. Anything else
  // (layer settings, order, visibility) redraws the whole view.
  if (region) renderer.invalidateTiles();
  else renderer.invalidate();
}

const fullRect = (): Rect => ({ x: 0, y: 0, w: doc.width, h: doc.height });

/** Re-render a layer's cached pixels from its model (tone screen, panels, balloons). */
function refreshLayer(layer: Layer, rect: Rect = fullRect()): void {
  if (layer.kind === 'tone' && layer.tone && layer.source) {
    renderTone(layer.tone, doc.dpi, layer.source, layer.surface, rect);
  } else if (layer.kind === 'panels' || layer.kind === 'balloons') {
    renderObjectsLayer(layer, doc);
  }
  renderer.invalidateTiles(); // the changed tiles are found through the surfaces' dirty marks
  studio?.navigator.invalidate();
  scheduleThumbs();
}

const KIND_LABEL: Record<LayerKind, string> = { raster: '', tone: 'Tono', panels: 'Viñetas', balloons: 'Globos', paper: 'Papel', folder: '', adjust: 'Ajuste', vector: 'Vector' };
const KIND_NAME: Record<LayerKind, string> = { raster: 'Capa', tone: 'Tono', panels: 'Viñetas', balloons: 'Globos', paper: 'Papel', folder: 'Carpeta', adjust: 'Ajuste', vector: 'Vectorial' };

/** Everything the app tells the person goes through here; the duration follows Preferencias > Interfaz. */
const notify = createNotifier({ ms: () => noticeMs(prefs.noticeSpeed) });
/** A short plain notice (the old status line). */
const setStatus = (msg: string): void => {
  if (msg) notify.info(msg);
};

/** The topmost layer of `kind`, created on top of the stack if there is none. */
function ensureLayer(kind: LayerKind): Layer {
  const existing = findLayer(doc, kind);
  if (existing) {
    doc.activeId = existing.id;
    return existing;
  }
  const at = kind === 'tone' ? doc.layers.findIndex((l) => l.id === doc.activeId) + 1 : doc.layers.length;
  const layer = addLayer(doc, KIND_NAME[kind], at, kind);
  refreshUi();
  return layer;
}

// ---- view -------------------------------------------------------------------
const view: ViewState = { x: 40, y: 40, scale: 0.5, rot: 0, flip: false };
/** The stage's size in CSS pixels. */
function stageBox(): StageSize {
  const r = stage.getBoundingClientRect();
  return { w: r.width, h: r.height };
}
/** Errors seen this session (kept for tests and bug reports as `window.__errors`); the person sees them as notices. */
const errors: string[] = [];
let statusBar: ReturnType<typeof mountStatusBar> | undefined;
const isDirty = (): boolean => history.revision !== savedRevision;
/** The autosave entry of the open document (one per document, see `autosave.ts`). */
let autosaveKey = newAutosaveKey();
const statusInfo = (): StatusInfo => ({ zoom: view.scale, width: doc.width, height: doc.height, dpi: doc.dpi, memory: formatBytes(history.memory), title: docTitle, dirty: isDirty(), tabs: tabInfos(), empty: workspaceEmpty });
const updateStatusBar = (): void => statusBar?.update(statusInfo());
function reportError(msg: string): void {
  errors.push(msg);
  if (errors.length > 20) errors.shift();
  (window as unknown as { __errors: string[] }).__errors = errors;
  notify.error(msg);
}
window.addEventListener('error', (e) => reportError(e.message || String(e.error)));
window.addEventListener('unhandledrejection', (e) => reportError(String((e.reason as Error | undefined)?.message ?? e.reason)));

/** Set once the filter panel exists (the view can change before that, during start-up). */
let onViewChanged: (() => void) | null = null;

/**
 * The view changed. The page itself is told at once (it draws on the next frame); everything else that follows the view
 * (rulers, navigator, status bar, overlay) is redone once per frame, not once per pointer event: two fingers send an event
 * each, several times a frame, and redoing all of that for each one used up the frame on a tablet.
 * `interactive`: a gesture or the wheel is changing it (see `GLRenderer.setView`).
 */
let viewEffectsQueued = false;

/** The page's four corners on the stage. */
const pageCorners = (box: StageSize): Pt[] => [docToScreen(view, box, 0, 0), docToScreen(view, box, doc.width, 0), docToScreen(view, box, doc.width, doc.height), docToScreen(view, box, 0, doc.height)];

/** The page may be moved off the screen only until the middle of the stage meets its edge: it can't be lost from sight. */
function keepPageInReach(): void {
  const box = stageBox();
  if (workspaceEmpty || box.w <= 0 || box.h <= 0) return;
  // The page point under the middle of the stage must be on the page: if not, the nearest page point comes back under it.
  const mid = { x: box.w / 2, y: box.h / 2 };
  const under = screenToDoc(view, box, mid.x, mid.y);
  const nearest = { x: Math.min(doc.width, Math.max(0, under.x)), y: Math.min(doc.height, Math.max(0, under.y)) };
  if (nearest.x === under.x && nearest.y === under.y) return;
  const at = docToScreen(view, box, nearest.x, nearest.y);
  const moved = screenDeltaToPlane(view, box, mid.x - at.x, mid.y - at.y);
  view.x += moved.x;
  view.y += moved.y;
}

/** Scrollbars along the canvas; they move the view over the page (the geometry is in `ui/scroll-geom.ts`). */
const scrollbars = mountScrollbars({
  stage,
  box: stageBox,
  corners: () => pageCorners(stageBox()),
  pan: (dx, dy) => {
    const moved = screenDeltaToPlane(view, stageBox(), dx, dy);
    view.x += moved.x;
    view.y += moved.y;
    userView = true;
    applyView();
  },
});

function applyView(interactive = false): void {
  keepPageInReach();
  renderer.setView(view, interactive);
  if (viewEffectsQueued) return;
  viewEffectsQueued = true;
  requestAnimationFrame(() => {
    viewEffectsQueued = false;
    scrollbars.update();
    onViewChanged?.();
    studio?.navigator.viewChanged();
    rulers?.suppress(isTurned(view));
    rulers?.redraw();
    updateStatusBar();
    drawOverlay();
  });
}
/** True once the user pans or zooms; until then the page is re-fitted whenever the stage is resized. */
let userView = false;

function fitView(): void {
  userView = false;
  const ps = planeSize(view, stageBox());
  view.scale = Math.min((ps.w - 40) / doc.width, (ps.h - 40) / doc.height);
  view.x = (ps.w - doc.width * view.scale) / 2;
  view.y = (ps.h - doc.height * view.scale) / 2;
  applyView();
}
function toDoc(e: PointerEvent): Pt {
  const r = stage.getBoundingClientRect();
  return screenToDoc(view, { w: r.width, h: r.height }, e.clientX - r.left, e.clientY - r.top);
}
stage.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const { x: mx, y: my } = screenToPlane(view, { w: r.width, h: r.height }, e.clientX - r.left, e.clientY - r.top);
    const next = Math.min(16, Math.max(0.05, view.scale * Math.exp(-e.deltaY * 0.0015)));
    view.x = mx - ((mx - view.x) * next) / view.scale;
    view.y = my - ((my - view.y) * next) / view.scale;
    view.scale = next;
    userView = true;
    applyView(true);
  },
  { passive: false },
);

/** Sizes in the interface are tuned for 150 dpi; a denser page needs proportionally bigger defaults. */
const pageUnit = (): number => doc.dpi / 150;

function applyPageDefaults(): void {
  const k = pageUnit();
  const set = (id: string, base: number): void => {
    const el = input(id);
    el.value = String(Math.round(base * k));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // The page's own default size is not an edit of the sub tool; the sub tool is applied again on top of it.
  asApplied(() => setBrushSize(Math.round(12 * k)));
  reapplySubTool?.();
  set('pn-border', 5);
  set('pn-gutter', 24);
  set('pn-margin', 60);
  set('bp-size', 28);
  set('bp-border', 4);
}

// ---- tools ------------------------------------------------------------------
type Tool = 'brush' | 'erase' | 'tone' | 'panel' | 'split' | 'balloon' | 'text' | 'select' | 'hand' | 'zoomin' | 'zoomout' | 'pick' | 'selrect' | 'selellipse' | 'sellasso' | 'wand' | 'fill'
  | 'selpoly' | 'selmagnet' | 'selpen' | 'selerase' | 'selshrink' | 'enclose' | 'lassofill'
  | 'gradient' | 'figline' | 'figrect' | 'figellipse' | 'figpoly' | 'figpolygon' | 'blur' | 'smudge'
  | 'rulerline' | 'rulerpersp' | 'rulersym' | 'rulerguide' | 'rulercurve' | 'rulerfigure' | 'rulerpen' | 'rulerspecial' | 'liquify' | 'clone'
  | 'vcontrol' | 'vpinch' | 'vsimplify' | 'vwidth';
let tool: Tool = 'brush';
/** Copy stamp: the point the picture is copied from, and the fixed distance from the pen to it once a stroke has been started (aligned). */
let cloneSource: Pt | null = null;
let cloneOffset: Pt | null = null;
let selected: { kind: 'balloon' | 'panel'; id: number } | null = null;

/** The tool and sub tool palettes; set once they are mounted (after the controls they drive exist). */
let toolPalettes: ToolPaletteApi | null = null;

// The paint tools show their own outline (see drawOverlay), so the system cursor is hidden for them.
const CURSORS: Partial<Record<Tool, string>> = { clone: 'none', brush: 'none', erase: 'none', tone: 'none', hand: 'grab', zoomin: 'zoom-in', zoomout: 'zoom-out', pick: 'copy', selrect: 'crosshair', selellipse: 'crosshair', sellasso: 'crosshair', wand: 'crosshair', fill: 'crosshair', selpoly: 'crosshair', selmagnet: 'crosshair', selpen: 'crosshair', selerase: 'crosshair', selshrink: 'crosshair', enclose: 'crosshair', lassofill: 'crosshair', gradient: 'crosshair', figline: 'crosshair', figrect: 'crosshair', figellipse: 'crosshair', figpoly: 'crosshair', figpolygon: 'crosshair', blur: 'none', smudge: 'none', rulerline: 'crosshair', rulerpersp: 'crosshair', rulersym: 'crosshair', rulerguide: 'crosshair', rulercurve: 'crosshair', rulerfigure: 'crosshair', rulerpen: 'crosshair', rulerspecial: 'crosshair', liquify: 'none', vcontrol: 'crosshair', vpinch: 'crosshair', vsimplify: 'crosshair', vwidth: 'crosshair' };

/** With both the ring and the cross turned off nothing would mark the pointer, so the system cursor stays. */
function cursorFor(t: Tool): string {
  const c = CURSORS[t] ?? 'crosshair';
  return c === 'none' && !prefs.brushOutline && !prefs.brushCrosshair ? 'crosshair' : c;
}

/** The canvas cursor was set by a transformation session and must be put back when it ends. */
let transformCursor = false;

function setTool(next: Tool): void {
  if (transformUi?.active) transformUi.fix();
  selUi?.cancelPath();
  shapesUi?.cancelPath();
  rulersUi?.cancelPending();
  vectorUi?.deselect();
  balloonPath = [];
  balloonHover = null;
  tool = next;
  if (next === 'fill' || next === 'wand') selUi?.warmLook();
  else selUi?.stopWarm();
  canvas.style.cursor = cursorFor(next);
  if (next === 'tone' && activeLayer(doc).kind !== 'tone') ensureLayer('tone');
  if (next === 'panel' || next === 'split') ensureLayer('panels');
  if (next === 'balloon' || next === 'text') ensureLayer('balloons');
  toolPalettes?.syncTo(next);
  leftExtra?.refresh('tooldetail');
  cursor = null;
  refreshUi();
  drawOverlay();
}

// ---- brush settings ---------------------------------------------------------
const brush: BrushSettings = { ...defaultBrush, correction: DEFAULT_CORRECTION };

// Each sub tool keeps what the person changed on it. Only the differences from its preset are stored (so an untouched
// setting keeps following the preset); see engine/brush-overrides.ts.
const OVERRIDES_KEY = 'lienzo.subtoolOverrides.v1';
function loadOverrides(): OverrideStore {
  try {
    return parseStore(JSON.parse(localStorage.getItem(OVERRIDES_KEY) ?? 'null'));
  } catch {
    return {}; // unreadable or unavailable storage: every sub tool starts from its preset
  }
}
function saveOverrides(): void {
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
  } catch {
    // Not remembering the changes costs the person nothing but the memory.
  }
}
let overrides: OverrideStore = loadOverrides();
/** The sub tool whose preset the brush started from, and its settings right after the preset (per 150 dpi). */
let appliedSub: string | null = null;
let baseline: ParamValues = {};
/** True while a preset or stored changes are being applied: those are not edits by the person. */
let applying = false;
/** Applies the selected sub tool again (its preset and the settings saved for it) with the page's current unit. */
let reapplySubTool: (() => void) | null = null;

/** Called after the person changes any brush setting, from wherever: records how the current sub tool now differs from its preset. */
function brushEdited(): void {
  if (applying) return;
  if (appliedSub !== null && toolPalettes?.current().subId === appliedSub) {
    const unit = pageUnit();
    const changed = diffParams(baseline, snapshotParams(brush, unit), unit);
    if (JSON.stringify(changed) !== JSON.stringify(overrides[appliedSub] ?? {})) {
      overrides = withOverrides(overrides, appliedSub, changed);
      saveOverrides();
    }
  }
  leftExtra?.refresh('tooldetail');
  refreshResetButton();
}

// The same for the option panel of the other sub tools (selection, fill, gradient, figure, ruler…): see app/option-memory.ts.
const OPTIONS_KEY = 'lienzo.subtoolOptions.v1';
function loadOptionStore(): ControlStore {
  try {
    return parseControlStore(JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? 'null'));
  } catch {
    return {}; // unreadable or unavailable storage: every sub tool starts from the factory values
  }
}
function saveOptionStore(): void {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(optionStore));
  } catch {
    // Not remembering the changes costs the person nothing but the memory.
  }
}
let optionStore: ControlStore = loadOptionStore();
const controlEl = (id: string): ControlElement | null => document.getElementById(id) as ControlElement | null;
/** The option controls as the page ships them, read once before any sub tool is chosen. */
const factoryControls: ControlValues = readControls(controlEl);
/** The sub tool the option controls belong to, and their values right after its binding (before the stored changes). */
let controlsSub: string | null = null;
let controlsBase: ControlValues = {};

/** Called after the person changes an option control: records how the current sub tool now differs from its factory values. */
function optionEdited(ev: Event): void {
  if (applying || controlsSub === null) return;
  const id = (ev.target as HTMLElement | null)?.id;
  if (!id || !OPTION_CONTROLS.includes(id)) return;
  const changed = diffControls(controlsBase, readControls(controlEl));
  if (JSON.stringify(changed) !== JSON.stringify(optionStore[controlsSub] ?? {})) {
    optionStore = withControls(optionStore, controlsSub, changed);
    saveOptionStore();
  }
  refreshResetButton();
}
/** Factory values first (the controls are shared by several sub tools), then the sub tool's own binding, then what was stored for it. */
function applyOptionControls(binding: LiveBinding, subId: string): void {
  writeControls(controlEl, factoryControls);
  if (binding.wandAllLayers !== undefined) writeControls(controlEl, { 'sel-all': binding.wandAllLayers });
  controlsSub = subId;
  controlsBase = readControls(controlEl);
  writeControls(controlEl, optionStore[subId] ?? {});
}
/** The "factory values" button of the properties palette: shown while the chosen sub tool differs from how it ships. */
function refreshResetButton(): void {
  const sub = toolPalettes?.current().subId;
  const changed = !!sub && (Object.keys(overrides[sub] ?? {}).length > 0 || Object.keys(optionStore[sub] ?? {}).length > 0);
  const button = $('subtool-reset') as HTMLButtonElement;
  button.hidden = !sub; // always there for any sub tool; it only works once something was changed
  button.disabled = !changed;
  button.title = changed ? 'Devuelve esta subherramienta a sus valores por defecto' : 'Esta subherramienta ya está con sus valores por defecto';
}
/** The name the person sees for a sub tool. */
function subToolName(subId: string): string {
  const cur = toolPalettes?.current();
  const sub = PALETTE_TOOLS.find((t) => t.id === cur?.toolId)?.groups.flatMap((g) => g.subtools).find((s) => s.id === subId);
  return sub?.es ?? subId;
}
/** The button asks first: one stray click must not throw away what the person tuned. */
async function askResetSubTool(): Promise<void> {
  const sub = toolPalettes?.current().subId;
  if (!sub) return;
  const ok = await confirmDialog(`¿Devolver «${subToolName(sub)}» a sus valores por defecto? Se perderán los cambios que hayas hecho en sus ajustes.`, 'Restaurar', 'Cancelar');
  if (ok && toolPalettes?.current().subId === sub) resetSubTool();
}
/** Put the chosen sub tool back to how it ships: its preset and its option panel. */
function resetSubTool(): void {
  const sub = toolPalettes?.current().subId;
  if (!sub) return;
  restoreSubTool();
  if (controlsSub === sub) {
    asApplied(() => writeControls(controlEl, controlsBase));
    optionStore = withControls(optionStore, sub, {});
    saveOptionStore();
  }
  leftExtra?.refresh('tooldetail');
  refreshResetButton();
}
$('tooloption-body').addEventListener('input', optionEdited);
$('tooloption-body').addEventListener('change', optionEdited);
$('subtool-reset').addEventListener('click', () => void askResetSubTool());
/** Run `fn` as a change that is not an edit by the person (a preset, restored settings), then show the result once. */
function asApplied(fn: () => void): void {
  applying = true;
  try {
    fn();
  } finally {
    applying = false;
  }
  leftExtra?.refresh('tooldetail');
}
function bindRange(id: string, label: string, set: (v: number) => void, fmt = (v: number) => `${v}`): void {
  const el = input(id);
  const out = $(label);
  const update = (): void => {
    const v = Number(el.value);
    set(v);
    out.textContent = fmt(v);
  };
  el.addEventListener('input', update);
  update();
}
// Brush size: one value field (slider, exact box, ▾ menu of usual sizes), the [ ] keys and the quick popup all drive one value.
let previewTimer = 0;
const sizeParam = paramByKey('size') as NumberParam;
const sizeField = valueField({
  scale: sizeParam,
  unit: sizeParam.unit,
  label: sizeParam.label,
  choices: sizeParam.choices,
  onChange: (px) => setBrushSize(px, true),
});
$('size-field').replaceWith(sizeField.el);
function setBrushSize(px: number, preview = false): void {
  brush.size = clampSizeFine(px);
  sizeField.setValue(brush.size);
  syncToolSliders();
  leftExtra?.refresh('brushsize');
  brushEdited();
  if (preview) showSizePreview();
}
bindRange('hardness', 'hardness-v', (v) => (brush.hardness = v / 100), (v) => `${v}%`);
bindRange('opacity', 'opacity-v', (v) => (brush.opacity = v / 100), (v) => `${v}%`);
// Round size/opacity readouts under the tool column: tapping one opens the quick slider popup.
let toolSliders: ReturnType<typeof mountToolSliders> | undefined;
function syncToolSliders(): void {
  toolSliders?.refresh();
}
toolSliders = mountToolSliders({
  getSize: () => brush.size,
  setSize: (px) => setBrushSize(px, true),
  getOpacity: () => Math.round(brush.opacity * 1000) / 10,
  setOpacity: (pct) => setSlider('opacity', pct),
});
input('opacity').addEventListener('input', syncToolSliders);
bindRange('stab', 'stab-v', (v) => (brush.stabilization = v / 100), (v) => `${v}`);
bindRange('pcurve', 'pcurve-v', (v) => (brush.pressureCurve = v / 100), (v) => (v / 100).toFixed(2));
bindRange('minsize', 'minsize-v', (v) => (brush.minSize = v / 100), (v) => `${v}%`);
bindRange('taperin', 'taperin-v', (v) => (brush.taperIn = v), (v) => (v ? `${v} px` : 'no'));
bindRange('taperout', 'taperout-v', (v) => (brush.taperOut = v), (v) => (v ? `${v} px` : 'no'));
bindRange('popacity', 'popacity-v', (v) => (brush.pressureOpacity = v / 100), (v) => (v ? `${v}%` : 'no'));
bindRange('nibthick', 'nibthick-v', (v) => (brush.nibThickness = v / 100), (v) => `${v}%`);
bindRange('nibangle', 'nibangle-v', (v) => (brush.nibAngle = v), (v) => `${v}°`);
bindRange('pflow', 'pflow-v', (v) => (brush.pressureFlow = v / 100), (v) => (v ? `${v}%` : 'no'));
bindRange('flow', 'flow-v', (v) => (brush.flow = v / 100), (v) => `${v}%`);
bindRange('grain', 'grain-v', (v) => (brush.grain = v / 100), (v) => (v ? `${v}%` : 'no'));
bindRange('grainscale', 'grainscale-v', (v) => (brush.grainScale = v), (v) => `${v} px`);
/**
 * The detail palette edits the brush through the same controls the flat panel uses, so there is one path from a value to
 * `brush` (and the readouts, the quick sliders and the presets stay in step). `id` is that control and `mult` converts
 * the palette's shown unit into the control's.
 */
const LEGACY_CONTROL: Record<string, { id: string; mult: number }> = {
  hardness: { id: 'hardness', mult: 1 },
  opacity: { id: 'opacity', mult: 1 },
  stabilization: { id: 'stab', mult: 1 },
  pressureOpacity: { id: 'popacity', mult: 1 },
  pressureFlow: { id: 'pflow', mult: 1 },
  pressureCurve: { id: 'pcurve', mult: 100 },
  minSize: { id: 'minsize', mult: 1 },
  taperIn: { id: 'taperin', mult: 1 },
  taperOut: { id: 'taperout', mult: 1 },
  nibThickness: { id: 'nibthick', mult: 1 },
  nibAngle: { id: 'nibangle', mult: 1 },
  flow: { id: 'flow', mult: 1 },
  grain: { id: 'grain', mult: 1 },
  grainScale: { id: 'grainscale', mult: 1 },
};
/** The anti-aliasing level of the brush, kept in step with the select of the flat panel. */
function setAntialias(level: number): void {
  brush.antialias = antialiasOf(level);
  select('antialias').value = String(brush.antialias);
}
/** The stroke correction level of the brush, kept in step with the select of the flat panel. */
function setCorrection(level: number): void {
  brush.correction = correctionOf(level);
  select('correction').value = String(brush.correction);
}
select('correction').addEventListener('change', () => {
  brush.correction = correctionOf(Number(select('correction').value));
  brushEdited();
});
select('antialias').addEventListener('change', () => {
  brush.antialias = antialiasOf(Number(select('antialias').value));
  brushEdited();
});
function setBrushParam(key: string, shown: number | boolean, preview = true): void {
  if (key === 'size' && typeof shown === 'number') return setBrushSize(shown, preview);
  if (key === 'pressureSize' && typeof shown === 'boolean') {
    const el = input('psize');
    el.checked = shown;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (typeof shown !== 'number') return;
  const p = paramByKey(key);
  if (key === 'antialias' && p?.kind === 'choice') {
    setAntialias(p.get(Object.assign({}, brush, p.set(shown))));
    brushEdited();
    return;
  }
  if (key === 'correction' && p?.kind === 'choice') {
    setCorrection(shown);
    brushEdited();
    return;
  }
  if (key === 'spacing' && p?.kind === 'number') {
    Object.assign(brush, p.set(shown));
    brushEdited();
    return;
  }
  const legacy = LEGACY_CONTROL[key];
  if (legacy) setSlider(legacy.id, Math.round(shown * legacy.mult * 10) / 10);
}

/** The sub tool the brush settings belong to, with the settings the person changed from its preset. */
function subToolState(): { name: string; modified: ReadonlySet<string> } | null {
  const cur = toolPalettes?.current();
  if (!cur || appliedSub === null || cur.subId !== appliedSub) return null;
  const sub = PALETTE_TOOLS.find((t) => t.id === cur.toolId)?.groups.flatMap((g) => g.subtools).find((s) => s.id === appliedSub);
  return { name: sub?.es ?? appliedSub, modified: new Set(Object.keys(overrides[appliedSub] ?? {})) };
}
/** Put one changed setting (or all of them) back to what the preset gives. */
function restoreSubTool(key?: string): void {
  const state = subToolState();
  if (!state || appliedSub === null) return;
  const sub = appliedSub;
  const original = shownParams(baseline, pageUnit());
  const keys = key === undefined ? [...state.modified] : state.modified.has(key) ? [key] : [];
  asApplied(() => {
    for (const k of keys) {
      const v = original[k];
      if (v !== undefined) setBrushParam(k, v, false);
    }
    const left = { ...(overrides[sub] ?? {}) };
    for (const k of keys) delete left[k];
    overrides = withOverrides(overrides, sub, left);
    saveOverrides();
  });
}
// A change made in the flat panel, a preset or a quick slider shows in the detail palette too.
$('tooloption-body').addEventListener('input', brushEdited);
$('tooloption-body').addEventListener('change', brushEdited);
const colorListeners: Array<(rgb: RGB, from?: string) => void> = [];
/** Change the drawing colour from anywhere (swatch, wheel, sliders, colour set) and tell the others. */
/** The "transparent colour" swatch: painting and filling take pixels away. Choosing any colour turns it off. */
let transparentColor = false;
function setTransparentColor(on: boolean): void {
  transparentColor = on;
  $('color-clear').classList.toggle('on', on);
  $('color-clear').setAttribute('aria-pressed', String(on));
  if (on) setStatus('Color transparente: pintar y rellenar borra. Elige un color para volver a pintar.');
}
// Two colours, as in Clip Studio: the main and the secondary one. One of them is selected and is the one drawn with
// (`brush.color` always holds its value); gradients, figures and filters use the main and the secondary as they are.
type ColorSlot = 'main' | 'sub';
let mainColor: RGB = [0, 0, 0];
let subColor: RGB = [255, 255, 255];
let activeSlot: ColorSlot = 'main';
const slotListeners: Record<ColorSlot, Array<(rgb: RGB, from?: string) => void>> = { main: [], sub: [] };
const slotValue = (slot: ColorSlot): RGB => (slot === 'main' ? mainColor : subColor);
function paintSwatches(): void {
  for (const slot of ['main', 'sub'] as const) {
    const el = $(slot === 'main' ? 'color-main' : 'color-sub');
    el.style.background = rgbToHex(slotValue(slot));
    el.classList.toggle('on', slot === activeSlot);
    el.setAttribute('aria-pressed', String(slot === activeSlot));
  }
}
/** Change one of the two colours; the drawing colour follows when it is the selected one. */
function setSlotColor(slot: ColorSlot, rgb: RGB, from?: string): void {
  const next: RGB = [rgb[0], rgb[1], rgb[2]];
  if (slot === 'main') mainColor = next;
  else subColor = next;
  if (slot === activeSlot) brush.color = [next[0], next[1], next[2]];
  paintSwatches();
  if (slot === activeSlot) for (const cb of colorListeners) cb(next, from);
  for (const cb of slotListeners[slot]) cb(next, from);
}
/** Change the colour being drawn with, from anywhere (wheel, sliders, colour set, eyedropper). */
function setBrushColor(rgb: RGB, from?: string): void {
  if (transparentColor && from !== 'swap') setTransparentColor(false);
  setSlotColor(activeSlot, rgb, from);
}
/** One click on a swatch: draw with that colour from now on. */
function selectSlot(slot: ColorSlot): void {
  if (slot === activeSlot) return;
  activeSlot = slot;
  brush.color = [...slotValue(slot)];
  paintSwatches();
  for (const cb of colorListeners) cb(slotValue(slot), 'slot');
}
function swapColors(): void {
  [mainColor, subColor] = [subColor, mainColor];
  brush.color = [...slotValue(activeSlot)];
  paintSwatches();
  for (const cb of colorListeners) cb(brush.color as RGB, 'swap');
  for (const slot of ['main', 'sub'] as const) for (const cb of slotListeners[slot]) cb(slotValue(slot), 'swap');
}
$('color-swap').addEventListener('click', swapColors);
$('color-clear').addEventListener('click', () => setTransparentColor(!transparentColor));
paintSwatches();
/** What the "Ajustes de color" window and the colour palettes share: the colour set and the history of used colours. */
const colorStores = createColorStores((cb) => {
  colorListeners.push(cb);
  slotListeners.main.push(cb);
  slotListeners.sub.push(cb);
});
/**
 * What the colour window's eyedropper sees on the drawing: the page as shown (every layer composited), which is
 * painted on the graphics card and cannot be read back like an ordinary canvas. Anywhere else the generic reading applies.
 */
function sampleDrawing(el: Element, clientX: number, clientY: number): readonly [number, number, number, number] | null | undefined {
  if (el !== canvas) return undefined;
  const r = stage.getBoundingClientRect();
  const p = screenToDoc(view, { w: r.width, h: r.height }, clientX - r.left, clientY - r.top);
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null; // off the page: the stage behind it
  const [red, green, blue, alpha] = sampleDocument(doc, x, y);
  return alpha <= 0 ? null : [red, green, blue, alpha / 255];
}
/** A click selects a colour and a second one on the same swatch opens "Ajustes de color" (a tap counts as a click too). */
let colorWindow = false;
function showColorSettings(slot: ColorSlot): void {
  if (colorWindow) return;
  colorWindow = true;
  selectSlot(slot);
  void openColorSettings(
    {
      get: () => [...slotValue(slot)] as RGB,
      set: (rgb, from) => (slot === activeSlot ? setBrushColor(rgb, from) : setSlotColor(slot, rgb, from)),
      sample: sampleDrawing,
    },
    colorStores,
    slot === 'main' ? 'Color principal' : 'Color secundario',
  ).finally(() => (colorWindow = false));
}
let lastSwatchClick: { slot: ColorSlot; t: number } | null = null;
for (const slot of ['main', 'sub'] as const) {
  $(slot === 'main' ? 'color-main' : 'color-sub').addEventListener('click', () => {
    const now = performance.now();
    if (lastSwatchClick?.slot === slot && now - lastSwatchClick.t < 400) {
      lastSwatchClick = null;
      showColorSettings(slot);
      return;
    }
    lastSwatchClick = { slot, t: now };
    selectSlot(slot);
  });
}
input('psize').addEventListener('change', (e) => {
  brush.pressureSize = (e.target as HTMLInputElement).checked ? 1 : 0;
});

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function rgbToHex(c: readonly number[]): string {
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

// ---- undoable edits of a layer's model (tone settings, panels, balloons) ------
const snap = (l: Layer): string => JSON.stringify({ tone: l.tone, panels: l.panels, balloons: l.balloons });

function restore(l: Layer, json: string): void {
  const m = JSON.parse(json) as Pick<Layer, 'tone' | 'panels' | 'balloons'>;
  if (m.tone) l.tone = m.tone;
  if (m.panels) l.panels = m.panels;
  if (m.balloons) l.balloons = m.balloons;
  refreshLayer(l);
}

let edit: { layer: Layer; before: string } | null = null;
function beginEdit(layer: Layer): void {
  edit ??= { layer, before: snap(layer) };
}
function endEdit(): void {
  if (!edit) return;
  const { layer, before } = edit;
  edit = null;
  const after = snap(layer);
  if (after === before) return;
  history.push({
    undo: () => restore(layer, before),
    redo: () => restore(layer, after),
    region: null,
    label: 'Edición de objetos',
  });
  refreshUi();
}
/** Apply a model change to a layer, repaint, and leave the undo step open for `endEdit`. */
function mutate(layer: Layer, change: () => void): void {
  if (layer.locked) {
    setStatus('La capa está bloqueada: desbloquéala para editarla.');
    return;
  }
  beginEdit(layer);
  change();
  refreshLayer(layer);
  drawOverlay();
}

const selectedBalloon = (): { layer: Layer; balloon: Balloon } | null => {
  if (selected?.kind !== 'balloon') return null;
  const layer = findLayer(doc, 'balloons');
  const balloon = layer?.balloons?.find((b) => b.id === selected!.id);
  return layer && balloon ? { layer, balloon } : null;
};
const selectedPanel = (): { layer: Layer; id: number } | null => {
  if (selected?.kind !== 'panel') return null;
  const layer = findLayer(doc, 'panels');
  return layer?.panels?.some((p) => p.id === selected!.id) ? { layer, id: selected.id } : null;
};

// ---- pointer interaction ------------------------------------------------------
type Drag =
  | { mode: 'create'; start: Pt; cur: Pt }
  | { mode: 'split'; start: Pt; cur: Pt }
  | { mode: 'move'; layer: Layer; orig: Balloon; start: Pt }
  | { mode: 'handle'; layer: Layer; orig: Balloon; handle: Handle }
  /** A freehand balloon outline being drawn. */
  | { mode: 'draw'; path: Pt[] }
  /** A tail being pulled out of a balloon. */
  | { mode: 'tail'; layer: Layer; orig: Balloon; start: Pt };

/** What the chosen balloon sub tool makes: the shape, how it is drawn (a box, clicked points, a freehand line, or a tail added to a balloon) and the tail style. */
let balloonMode: { shape: BalloonShape; draw: 'box' | 'points' | 'freehand' | 'tail'; tailStyle: TailStyle } = { shape: 'ellipse', draw: 'box', tailStyle: 'speech' };
/** The corners of a curved balloon being clicked out, and where the pointer is now. */
let balloonPath: Pt[] = [];
let balloonHover: Pt | null = null;

let stroke: { s: PenStroke; layer: Layer } | null = null;
/** Smoothed time one painted sample takes, and when the last one was painted (for load shedding). */
let paintCostMs = 0;
let lastPaintAt = 0;
const OVERLOAD_MS = 11;
/** Last pen/mouse position over the page, for the brush outline (null = hidden). */
let cursor: Pt | null = null;
let drag: Drag | null = null;
let panning: { x: number; y: number } | null = null;
let spaceDown = false;

// Pressure is meant to be 0..1, but some digitizers report other ranges: never let it exceed 1.
// The global pressure setting applies first (off = every stamp at full pressure; otherwise the chosen response curve).
const pressureOf = (e: PointerEvent): number => {
  if (e.pointerType !== 'pen' || !prefs.usePressure) return 1;
  const raw = Math.min(1, Math.max(0.01, Number.isFinite(e.pressure) ? e.pressure : 1));
  return Math.max(0.01, applyPressureCurve(raw, prefs.pressureCurve));
};
const nextBalloonId = (l: Layer): number => (l.balloons ?? []).reduce((m, b) => Math.max(m, b.id), 0) + 1;

// ---- touch: pinch to zoom/pan, two-finger tap = undo, three-finger tap = redo ----
interface Gesture {
  startDist: number;
  startMid: Pt; // relative to the stage
  startView: ViewState;
  /** Angle of the line between the fingers, and what it has turned since the gesture began (radians, clockwise). */
  lastAngle: number;
  turned: number;
  /** Set once the fingers have turned enough to mean a rotation (so a plain pinch never tilts the page); the part of the turn spent getting there is not applied. */
  rotating: boolean;
  rotOffset: number;
  t0: number;
  maxFingers: number;
  moved: boolean;
}
const touches = new Map<number, { x: number; y: number }>();
let gesture: Gesture | null = null;
let fingerDraws = prefs.fingerDraws;
let predict = true;
let sawPen = false;
let penDown = false;
let penUpAt = 0;
const PALM_GUARD_MS = 500;
/** How far the fingers must turn before a pinch also rotates the page, and how close to a quarter turn it snaps (radians). */
const GESTURE_TURN_LATCH = (8 * Math.PI) / 180;
const GESTURE_TURN_SNAP = (4 * Math.PI) / 180;

function touchPair(): { dist: number; angle: number; mid: Pt } | null {
  const v = [...touches.values()];
  if (v.length < 2) return null;
  const [a, b] = [v[0]!, v[1]!];
  const r = stage.getBoundingClientRect();
  return {
    dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    angle: Math.atan2(b.y - a.y, b.x - a.x),
    mid: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top },
  };
}

/** Throw away whatever a first finger had started (a stroke or an object drag). */
function cancelInProgress(): void {
  if (stroke) {
    const { s, layer } = stroke;
    stroke = null;
    profiler.strokeEnd();
    const r = s.cancel();
    if (r) {
      refreshLayer(layer, r);
      render(r);
    }
  }
  if (edit) {
    const { layer, before } = edit;
    edit = null;
    restore(layer, before);
    render();
  }
  vectorUi.up();
  drag = null;
  panning = null;
  selUi.abortDrag();
  drawOverlay();
}

function beginGesture(): void {
  const pair = touchPair();
  if (!pair) return;
  cancelInProgress();
  gesture = {
    startDist: pair.dist,
    startMid: pair.mid,
    startView: { ...view },
    lastAngle: pair.angle,
    turned: 0,
    rotating: false,
    rotOffset: 0,
    t0: performance.now(),
    maxFingers: touches.size,
    moved: false,
  };
}

/**
 * The fingers that steer the view changed (one of three lifted, say): the pair is another one now, with its own distance and
 * angle, which would read as a sudden zoom and turn. What the view is now becomes the new starting point of the gesture.
 */
function rebaseGesture(): void {
  const g = gesture;
  const pair = touchPair();
  if (!g || !pair) return;
  g.startDist = pair.dist;
  g.startMid = pair.mid;
  g.startView = { ...view };
  g.lastAngle = pair.angle;
  g.turned = 0;
  g.rotating = false;
  g.rotOffset = 0;
}

function updateGesture(): void {
  const g = gesture;
  const pair = touchPair();
  if (!g || !pair) return;
  g.maxFingers = Math.max(g.maxFingers, touches.size);
  // Three or more fingers are a tap for redo, not a way to move the page.
  if (touches.size > 2) return;
  const scale = Math.min(16, Math.max(0.05, (g.startView.scale * pair.dist) / g.startDist));
  // The fingers' line may cross the ±180° seam between two events: add up the shortest turns.
  let step = pair.angle - g.lastAngle;
  if (step > Math.PI) step -= 2 * Math.PI;
  else if (step < -Math.PI) step += 2 * Math.PI;
  g.lastAngle = pair.angle;
  g.turned += step;
  if (!g.rotating && Math.abs(g.turned) > GESTURE_TURN_LATCH) {
    g.rotating = true;
    g.rotOffset = Math.sign(g.turned) * GESTURE_TURN_LATCH;
  }
  // Keep the page point that was under the fingers' midpoint under the midpoint now, whatever the zoom and turn.
  const box = stageBox();
  const anchor = screenToDoc(g.startView, box, g.startMid.x, g.startMid.y);
  view.scale = scale;
  if (g.rotating) {
    g.moved = true;
    // Always measured from the view the gesture began with: `view.rot` moves to another quarter on the way.
    let total = g.startView.rot * (Math.PI / 2) + (g.startView.tilt ?? 0) + g.turned - g.rotOffset;
    // Close to the page's own quarter turns the page settles into them, so it is easy to come back to straight.
    const nearest = Math.round(total / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(total - nearest) < GESTURE_TURN_SNAP) total = nearest;
    setTurn(total);
  }
  const to = screenToPlane(view, box, pair.mid.x, pair.mid.y);
  userView = true;
  view.x = to.x - anchor.x * scale;
  view.y = to.y - anchor.y * scale;
  if (Math.hypot(pair.mid.x - g.startMid.x, pair.mid.y - g.startMid.y) > 12 || Math.abs(pair.dist - g.startDist) > 12) {
    g.moved = true;
  }
  applyView(true);
}

/** Returns true when the event belonged to a touch gesture and is fully handled. */
function touchUp(e: PointerEvent): boolean {
  if (e.pointerType !== 'touch') return false;
  const had = touches.delete(e.pointerId);
  if (!gesture) return !had; // an ignored (palm) touch
  if (touches.size >= 2) rebaseGesture();
  if (touches.size === 0) {
    const g = gesture;
    gesture = null;
    // While something is being edited with Apply / Cancel (a transformation, a filter, the canvas size…) a quick tap of two or
    // three fingers is not an undo: undoing would cancel it. Only its Cancel button, or Esc, ends it.
    const editing = transformUi.active || filtersUi.active || adjustUi.active || canvasResize.active;
    if (!editing && !g.moved && performance.now() - g.t0 < 350) {
      if (g.maxFingers === 2) undoRedo(false);
      else if (g.maxFingers >= 3) undoRedo(true);
    }
  }
  return true;
}

canvas.addEventListener('pointerleave', () => {
  if (cursor) {
    cursor = null;
    drawOverlay();
  }
});

canvas.addEventListener('pointerdown', (e) => {
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // The pointer may already be gone (cancelled touch); events still reach us.
  }
  closeDrawers();
  if (e.pointerType === 'pen') {
    penDown = true;
    if (!sawPen) {
      // A pen is in use: fingers navigate instead of drawing.
      sawPen = true;
      fingerDraws = false;
      input('finger-draws').checked = false;
    }
  }
  if (e.pointerType === 'touch') {
    // Palm rejection: ignore touches while the pen is down or just lifted.
    if (penDown || performance.now() - penUpAt < PALM_GUARD_MS) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture) {
      gesture.maxFingers = Math.max(gesture.maxFingers, touches.size);
      return;
    }
    if (touches.size >= 2) {
      beginGesture();
      return;
    }
    if (!fingerDraws) {
      panning = { x: e.clientX, y: e.clientY };
      return;
    }
  }
  if (e.button === 1 || spaceDown) {
    panning = { x: e.clientX, y: e.clientY };
    return;
  }
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  if (tool === 'hand') {
    panning = { x: e.clientX, y: e.clientY };
    return;
  }
  if (tool === 'zoomin' || tool === 'zoomout') {
    zoomAtClient(e.clientX, e.clientY, tool === 'zoomin' ? 1.5 : 1 / 1.5);
    return;
  }
  if (filtersUi.active) return; // the filter panel has the layer until it is applied or cancelled
  if (canvasResize.active) {
    // In the canvas-size mode only its handles take the pointer; nothing is drawn.
    if (canvasResize.down(toDoc(e))) canvas.setPointerCapture?.(e.pointerId);
    return;
  }
  const p = toDoc(e);
  if (tool === 'select' && guidesUi.grab(p, e)) return; // the Operation tool moves guides
  // Selections, transforms and objects snap to guides and the grid; brush strokes do not.
  const ps = guidesUi.snap(p);
  if (transformUi.active && transformUi.down(ps, e.shiftKey)) {
    canvas.setPointerCapture?.(e.pointerId);
    return;
  }
  // Alt + click picks a colour while drawing, as the eyedropper would.
  if (tool === 'pick' || (e.altKey && (tool === 'brush' || tool === 'erase'))) {
    picking = true;
    pickColor(p, e);
    return;
  }
  if (tool === 'fill') {
    selUi.fillAt(p);
    return;
  }
  if (isSelectionTool(tool) || isFillTool(tool)) {
    canvas.setPointerCapture?.(e.pointerId);
    selUi.down(tool, e, ps);
    return;
  }
  if (isShapeTool(tool)) {
    canvas.setPointerCapture?.(e.pointerId);
    shapesUi.down(tool, e, ps);
    return;
  }
  if (tool === 'rulerguide') {
    guidesUi.startNew(e.shiftKey ? 'v' : 'h', e); // the guide follows the pointer until it is let go
    return;
  }
  if (isRulerTool(tool)) {
    canvas.setPointerCapture?.(e.pointerId);
    rulersUi.down(tool, e, ps);
    return;
  }
  if (isVectorTool(tool)) {
    canvas.setPointerCapture?.(e.pointerId);
    vectorUi.down(tool, activeLayer(doc), p);
    return;
  }
  if (tool === 'clone' && e.altKey) {
    cloneSource = p;
    cloneOffset = null;
    setStatus('Sello de copia: origen fijado. Pinta para copiar desde ahí.');
    drawOverlay();
    return;
  }
  if (tool === 'brush' || tool === 'erase' || tool === 'tone' || tool === 'blur' || tool === 'smudge' || tool === 'liquify' || tool === 'clone') {
    startStroke(e, p);
  } else {
    objectDown(ps);
  }
});

const selUi = createSelectionUi({
  doc: () => doc,
  view,
  overlay,
  history: () => history,
  render,
  refreshLayer,
  refreshUi,
  redrawOverlay: () => drawOverlay(),
  activeLayer: () => activeLayer(doc),
  color: () => brush.color,
  transparent: () => transparentColor,
  say: (msg) => setStatus(msg),
  screenToDoc: (sx, sy) => screenToDoc(view, stageBox(), sx, sy),
  brushRadius: () => Math.max(1, brush.size / 2),
  pathBar: (open) => {
    $('path-bar').hidden = !open;
  },
  options: () => ({
    mode: select('sel-mode').value as 'replace' | 'add' | 'subtract' | 'intersect',
    tolerance: Number(input('sel-tol').value),
    contiguous: input('sel-contig').checked,
    allLayers: input('sel-all').checked,
    grow: Number(input('sel-grow').value),
    gap: Number(input('sel-gap').value),
    reference: referenceOnly,
    antialias: input('sel-aa').checked,
  }),
});
const guidesUi = createGuidesUi({
  doc: () => doc,
  view,
  stage,
  toDoc: (clientX, clientY) => {
    const r = stage.getBoundingClientRect();
    return screenToDoc(view, { w: r.width, h: r.height }, clientX - r.left, clientY - r.top);
  },
  history: () => history,
  redraw: () => drawOverlay(),
  gridStep: () => gridStep(),
});
const filtersUi = createFiltersUi({
  doc: () => doc,
  history: () => history,
  layers: () => layersUi.targets(),
  selection: () => selUi.current,
  colors: () => ({ main: mainColor, sub: subColor }),
  render,
  setPreview: (tables) => renderer.setLayerPreview(tables),
  refreshLayer,
  refreshUi,
  say: (msg) => setStatus(msg),
  viewRect: () => {
    const box = stageBox();
    if (box.w < 1 || box.h < 1) return null;
    const pts = visibleOutline(view, box);
    const x0 = Math.floor(Math.min(...pts.map((p) => p.x)));
    const y0 = Math.floor(Math.min(...pts.map((p) => p.y)));
    const x1 = Math.ceil(Math.max(...pts.map((p) => p.x)));
    const y1 = Math.ceil(Math.max(...pts.map((p) => p.y)));
    const padX = Math.round((x1 - x0) * 0.1);
    const padY = Math.round((y1 - y0) * 0.1);
    const x = Math.max(0, x0 - padX);
    const y = Math.max(0, y0 - padY);
    return { x, y, w: Math.min(doc.width, x1 + padX) - x, h: Math.min(doc.height, y1 + padY) - y };
  },
  host: stage,
});
onViewChanged = () => {
  if (filtersUi.active) filtersUi.viewChanged();
};
const adjustUi = createAdjustUi({
  doc: () => doc,
  history: () => history,
  render: () => render(),
  refreshUi,
  host: stage,
});
const vectorUi = createVectorUi({
  doc: () => doc,
  view,
  history: () => history,
  options: () => ({
    strength: Number(input('vec-strength').value) / 100,
    reach: Number(input('vec-reach').value),
    thicker: select('vec-thick').value === 'up',
  }),
  brush: () => brush,
  changed: (layer, rect) => {
    refreshLayer(layer, rect);
    render(rect);
  },
  redraw: () => drawOverlay(),
  say: (msg) => setStatus(msg),
});
/** The gradient the tool lays down (set by the sub tool chosen). */
let gradientId = 'foreground-to-transparent';
/** The manga controls were switched on by a manga gradient (not by the person), so a plain gradient switches them off again. */
let mangaFromPreset = false;
const shapesUi = createShapesUi({
  doc: () => doc,
  view,
  history: () => history,
  activeLayer: () => activeLayer(doc),
  selection: () => selUi.current,
  brush: () => brush,
  colors: () => ({ main: mainColor, sub: subColor }),
  transparent: () => transparentColor,
  gradient: () => ({ id: gradientId, shape: select('grad-shape').value as GradientShape | 'auto', repeat: select('grad-repeat').value as GradientRepeat, dither: (document.getElementById('grad-dither') as HTMLInputElement).checked, halftone: input('grad-manga').checked ? { shape: select('grad-manga-shape').value as ToneShape, lpi: Number(input('grad-manga-lpi').value), angle: Number(input('grad-manga-angle').value) } : undefined }),
  fillShapes: () => input('fig-fill').checked,
  render,
  refreshLayer,
  refreshUi,
  redrawOverlay: () => drawOverlay(),
  say: (msg) => setStatus(msg),
  pathBar: (open) => {
    $('path-bar').hidden = !open;
  },
});
const rulersUi = createRulersUi({
  doc: () => doc,
  view,
  history: () => history,
  redraw: () => drawOverlay(),
  say: (msg) => setStatus(msg),
  snapOn: () => guidesUi.snapToGuides,
  options: () => ({
    perspPoints: Number(select('ruler-persp').value) as 1 | 2 | 3,
    figure: select('ruler-fig').value as 'ellipse' | 'rect',
    special: select('ruler-special').value as 'parallel' | 'radial' | 'concentric',
    count: Number(input('ruler-count').value),
    gap: Number(input('ruler-gap').value),
  }),
});
const transformUi = createTransformUi({
  doc: () => doc,
  view,
  history: () => history,
  layers: () => layersUi.targets(),
  selection: () => selUi.current,
  setSelection: (s, label) => selUi.replace(s, label),
  render,
  refreshLayer,
  refreshUi,
  redrawOverlay: () => drawOverlay(),
  setFloating: (f) => renderer.setFloating(f),
  floatChanged: () => renderer.floatingChanged(),
  say: (msg) => setStatus(msg),
  setActive: (on, mode, hint = '') => {
    $('transform-bar').hidden = !on;
    $('transform-hint').textContent = hint;
    document.querySelectorAll<HTMLElement>('[data-tmode]').forEach((b) => b.classList.toggle('on', on && b.dataset.tmode === mode));
    // The proportion lock only means something while scaling with the box.
    $('transform-lock').hidden = mode !== 'free';
    commands.notify();
  },
});
/** Zoom out, never in, so that the page and the window of the canvas-size mode are both on the stage. */
function showWindow(r: Rect): void {
  const x0 = Math.min(0, r.x);
  const y0 = Math.min(0, r.y);
  const w = Math.max(doc.width, r.x + r.w) - x0;
  const h = Math.max(doc.height, r.y + r.h) - y0;
  const ps = planeSize(view, stageBox());
  view.scale = Math.min(view.scale, (ps.w - 80) / w, (ps.h - 80) / h);
  view.x = (ps.w - w * view.scale) / 2 - x0 * view.scale;
  view.y = (ps.h - h * view.scale) / 2 - y0 * view.scale;
  userView = true;
  applyView();
}
const canvasResize = createCanvasResizeUi({
  doc: () => doc,
  scale: () => view.scale,
  redraw: () => drawOverlay(),
  showRect: showWindow,
  commit: (rect) => pageEdit({ kind: 'resize', rect }, 'Cambiar el tamaño del lienzo'),
  touch: touchUi,
});
const showProportionLock = (): void => {
  const lock = $('transform-lock');
  lock.classList.toggle('on', transformUi.proportionLocked);
  lock.setAttribute('aria-pressed', String(transformUi.proportionLocked));
  lock.textContent = transformUi.proportionLocked ? 'Proporción: fija' : 'Proporción: libre';
};
$('transform-lock').addEventListener('click', () => {
  transformUi.proportionLocked = !transformUi.proportionLocked;
  showProportionLock();
});
showProportionLock();
document.querySelectorAll<HTMLElement>('[data-tmode]').forEach((b) => b.addEventListener('click', () => transformUi.setMode(b.dataset.tmode as TransformMode)));
$('transform-apply').addEventListener('click', () => transformUi.fix());
$('transform-cancel').addEventListener('click', () => transformUi.cancel());
bindRange('sel-tol', 'sel-tol-v', () => undefined);
bindRange('sel-grow', 'sel-grow-v', () => undefined, (v) => `${v} px`);
bindRange('sel-gap', 'sel-gap-v', () => undefined, (v) => (v ? `${v} px` : 'no'));
$('path-close').addEventListener('click', () => (shapesUi.pathOpen ? shapesUi.closePath() : selUi.closePath()));
$('path-cancel').addEventListener('click', () => (shapesUi.pathOpen ? shapesUi.cancelPath() : selUi.cancelPath()));
/** "Selection for referred layers": the wand and the bucket look only at the layers marked as reference. */
let referenceOnly = false;
let picking = false;
let pickMode: 'display' | 'layer' = 'display';
/** Take the colour under the pointer (what is shown, or the active layer alone) as the main colour. */
function pickColor(p: Pt, e?: PointerEvent): void {
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
  const read = (px: number, py: number) => (pickMode === 'layer' ? activeLayer(doc).surface.pixel(px, py) : sampleDocument(doc, px, py));
  const sample = averageBox(read, x, y, Number(select('pick-size').value), doc.width, doc.height);
  if (!sample) return; // nothing there: keep the current colour
  const rgb: RGB = [Math.round(sample.rgb[0]), Math.round(sample.rgb[1]), Math.round(sample.rgb[2])];
  setBrushColor(rgb, 'pick');
  if (e) showPickChip(e, rgb);
}
/** A small swatch beside the pointer while the eyedropper is held, so the colour being taken can be seen. */
const pickChip = document.createElement('div');
pickChip.className = 'pick-chip';
pickChip.hidden = true;
document.body.append(pickChip);
function showPickChip(e: PointerEvent, rgb: RGB): void {
  pickChip.hidden = false;
  pickChip.style.background = rgbToHex(rgb);
  // Up and to the side of the finger or pen, where the hand does not cover it.
  // The chip grows and shrinks with the interface scale, so its distance from the pointer follows (56 px is its size at 100 %).
  const touch = e.pointerType !== 'mouse';
  const k = pickChip.offsetWidth / 56;
  pickChip.style.left = `${e.clientX + (touch ? -28 : 18) * k}px`;
  pickChip.style.top = `${e.clientY - (touch ? 80 : 40) * k}px`;
}

function startStroke(e: PointerEvent, p: Pt): void {
  const layer = activeLayer(doc);
  if (layer.kind === 'panels' || layer.kind === 'balloons') {
    setStatus('Esta capa es de viñetas/globos: elige una capa normal o de tono para pintar.');
    return;
  }
  if (!layer.visible) return;
  if (layer.kind === 'folder') {
    setStatus('Esta capa es una carpeta: elige una capa dentro de ella para pintar.');
    return;
  }
  if (layer.kind === 'adjust') {
    setStatus('Esta capa es de ajuste y no tiene píxeles: usa su máscara para limitar dónde actúa.');
    return;
  }
  if (layer.locked) {
    setStatus('La capa está bloqueada: desbloquéala para pintar.');
    return;
  }
  const onLines = layer.kind === 'vector' && !layersUi.editingMask;
  if (onLines && tool !== 'brush' && tool !== 'erase') {
    setStatus('Una capa vectorial solo admite pincel (traza una línea) y borrador (borra las líneas que toca); para el resto, rasteriza la capa.');
    return;
  }
  const blending = tool === 'blur' || tool === 'smudge';
  if ((blending || tool === 'clone') && layersUi.editingMask) {
    setStatus('Mezclar, desenfocar y copiar no funcionan sobre la máscara de capa.');
    return;
  }
  if (tool === 'clone') {
    if (!cloneSource) {
      setStatus('Sello de copia: Alt + clic en la zona que quieres copiar.');
      return;
    }
    cloneOffset ??= { x: cloneSource.x - p.x, y: cloneSource.y - p.y };
  }
  const target = paintTarget(layer, layersUi.editingMask);
  const make = (): PenStroke =>
    onLines
      ? tool === 'erase' ? vectorUi.erasing(layer) : vectorUi.drawing(layer)
      : tool === 'clone'
      ? new CloneStroke(target, brush, cloneOffset!, selUi.current ?? undefined)
      : tool === 'liquify'
      ? new LiquifyStroke(target, brush, select('liq-mode').value as LiquifyMode, selUi.current ?? undefined)
      : blending
      ? new SmudgeStroke(target, brush, tool === 'blur' ? 'blur' : 'finger', selUi.current ?? undefined)
      : new Stroke(target, { ...brush, erase: tool === 'erase' || transparentColor, stabilizationBySpeed: true, viewScale: view.scale, entryRamp: e.pointerType === 'pen' && prefs.usePressure ? entryRampSamples(brush.stabilization) : 0 }, selUi.current ?? undefined);
  // Rulers: the stroke may follow a line or a ray, and be repeated mirrored across symmetry axes.
  const rs = rulersUi.forStroke(p);
  const s: PenStroke = rs
    ? new MultiStroke([make(), ...(onLines ? [] : rs.mirrors).map(() => make())], [rs.follow, ...(onLines ? [] : rs.mirrors).map((m) => (q: Pt) => m(rs.follow(q)))])
    : make();
  stroke = { s, layer };
  penTrail = [];
  noteSample(e, p);
  paintCostMs = 0;
  lastPaintAt = 0;
  cursor = e.pointerType === 'mouse' && isPaintTool() ? p : null;
  predBox = null;
  drawOverlay(); // removes the hover outline before the partial clears of the prediction take over
  profiler.strokeStart();
  paintDirty(layer, s.addPoint(p.x, p.y, pressureOf(e)));
}

function paintDirty(layer: Layer, dirty: Rect | null): void {
  if (!dirty) return;
  if (layer.kind === 'tone') refreshLayer(layer, dirty);
  render(dirty);
}

function objectDown(p: Pt): void {
  const worksOn = findLayer(doc, tool === 'panel' || tool === 'split' ? 'panels' : 'balloons');
  if (worksOn?.locked) {
    setStatus('La capa está bloqueada: desbloquéala para editarla.');
    return;
  }
  const bl = findLayer(doc, 'balloons');
  const drawing = tool === 'balloon' ? balloonMode.draw : 'box';
  if (drawing === 'points' && balloonPath.length) {
    addBalloonPoint(p);
    return;
  }
  const sel = selectedBalloon();
  if (sel) {
    const h = hitHandle(sel.balloon, p, 10 / view.scale);
    // The tail tools pull a new tail out of the balloon, so its old tip is not a handle for them.
    if (h && !(drawing === 'tail' && h === 'tail')) {
      beginEdit(sel.layer);
      drag = { mode: 'handle', layer: sel.layer, orig: { ...sel.balloon }, handle: h };
      return;
    }
  }
  if (tool === 'select' || tool === 'balloon' || tool === 'text') {
    const hit = bl?.balloons ? hitBalloon(bl.balloons, p) : null;
    if (bl && hit) {
      selected = { kind: 'balloon', id: hit.id };
      doc.activeId = bl.id;
      beginEdit(bl);
      if (drawing === 'tail') {
        // The tail appears at once (a click is enough) and follows the pointer once it is dragged.
        const style = balloonMode.tailStyle;
        const tip = hit.tail ?? defaultTailTip(hit);
        mutate(bl, () => replaceBalloon(bl, withTail(hit, tip, style)));
        drag = { mode: 'tail', layer: bl, orig: hit, start: p };
      } else {
        drag = { mode: 'move', layer: bl, orig: hit, start: p };
      }
      refreshUi();
      drawOverlay();
      return;
    }
  }
  if (drawing === 'points') {
    addBalloonPoint(p);
    return;
  }
  if (drawing === 'freehand') {
    drag = { mode: 'draw', path: [p] };
    return;
  }
  if (tool === 'select') {
    const pl = findLayer(doc, 'panels');
    const panel = pl?.panels ? panelAt(pl.panels, p) : null;
    selected = panel ? { kind: 'panel', id: panel.id } : null;
    if (pl && panel) doc.activeId = pl.id;
    refreshUi();
    drawOverlay();
    return;
  }
  drag = { mode: tool === 'split' ? 'split' : 'create', start: p, cur: p };
}

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture) {
      updateGesture();
      return;
    }
  }
  if (panning) {
    userView = true;
    const moved = screenDeltaToPlane(view, stageBox(), e.clientX - panning.x, e.clientY - panning.y);
    view.x += moved.x;
    view.y += moved.y;
    panning = { x: e.clientX, y: e.clientY };
    applyView();
    return;
  }
  if (canvasResize.active) {
    canvasResize.move(toDoc(e));
    canvas.style.cursor = canvasResize.cursorAt(toDoc(e)) ?? 'default';
    return;
  }
  if (transformUi.active) {
    transformUi.move(guidesUi.snap(toDoc(e)), e.shiftKey);
    // The cursor says what dragging here does: resize (turned with the box), rotate, move, or place a point.
    canvas.style.cursor = transformUi.cursorAt(toDoc(e)) ?? cursorFor(tool);
    transformCursor = true;
  } else if (transformCursor) {
    canvas.style.cursor = cursorFor(tool);
    transformCursor = false;
  }
  if (picking) {
    pickColor(toDoc(e), e);
    return;
  }
  if (selUi.dragging) {
    selUi.move(guidesUi.snap(toDoc(e)));
    return;
  }
  if (shapesUi.dragging) {
    shapesUi.move(guidesUi.snap(toDoc(e)));
    return;
  }
  if (rulersUi.dragging) {
    rulersUi.move(guidesUi.snap(toDoc(e)));
    return;
  }
  if (vectorUi.dragging) {
    vectorUi.move(toDoc(e));
    return;
  }
  if (stroke) {
    const t0 = performance.now();
    const events = e.getCoalescedEvents?.() ?? [];
    const list = events.length ? events : [e];
    // A very large or soft brush can cost more than a frame per sample. Rather than fall behind
    // the pen, paint only as many samples as there is time for: the stroke stays smooth, just
    // updated less often, and still ends at the last real point.
    if (paintCostMs > OVERLOAD_MS && t0 - lastPaintAt < paintCostMs * 1.1) {
      const last = toDoc(list[list.length - 1]!);
      stroke.s.skipPoint(last.x, last.y, pressureOf(list[list.length - 1]!));
      return;
    }
    for (const ev of list) {
      const p = toDoc(ev);
      noteSample(ev, p);
      paintDirty(stroke.layer, stroke.s.addPoint(p.x, p.y, pressureOf(ev)));
    }
    if (showsRing(e)) {
      // The outline stays while painting (a ring, so what is being erased or painted shows through it).
      cursor = toDoc(e);
      drawOverlay();
    } else if (predict) drawPrediction(e);
    const cost = performance.now() - t0;
    paintCostMs = paintCostMs * 0.7 + cost * 0.3;
    lastPaintAt = t0;
    profiler.event(cost, e.timeStamp, list.length);
    return;
  }
  if (!drag && !panning && showsRing(e)) {
    cursor = toDoc(e); // hovering: follow the pointer with the brush outline
    drawOverlay();
    return;
  }
  if (!drag) {
    if (balloonPath.length) {
      balloonHover = toDoc(e);
      drawOverlay();
    }
    return;
  }
  const p = guidesUi.snap(toDoc(e));
  if (drag.mode === 'create' || drag.mode === 'split') {
    drag.cur = p;
  } else if (drag.mode === 'draw') {
    const last = drag.path[drag.path.length - 1]!;
    if (Math.hypot(p.x - last.x, p.y - last.y) >= 2 / view.scale) drag.path.push(p);
  } else if (drag.mode === 'tail') {
    const { orig, start, layer } = drag;
    if (Math.hypot(p.x - start.x, p.y - start.y) < 8 / view.scale) return; // still a click: keep the default tail
    const style = balloonMode.tailStyle;
    mutate(layer, () => replaceBalloon(layer, withTail(orig, p, style)));
    return;
  } else if (drag.mode === 'move') {
    const { orig, start, layer } = drag;
    mutate(layer, () => replaceBalloon(layer, moveBalloon(orig, p.x - start.x, p.y - start.y)));
    return;
  } else {
    const { orig, layer, handle } = drag;
    mutate(layer, () => replaceBalloon(layer, resizeBalloon(orig, handle, p)));
    return;
  }
  drawOverlay();
});

/**
 * Show where the pen is about to go, a frame ahead of the real input. It is only a
 * preview on the overlay (a plain round-capped line); the real stamps replace it on
 * the next event, so nothing predicted ever reaches the layer or the undo history.
 */
/** Show the brush outline at the middle of the stage for a moment, so a size change is visible. */
function showSizePreview(): void {
  const r = stage.getBoundingClientRect();
  cursor = screenToDoc(view, { w: r.width, h: r.height }, r.width / 2, r.height / 2);
  drawOverlay();
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    cursor = null;
    drawOverlay();
  }, 900);
}

const isPaintTool = (): boolean => tool === 'brush' || tool === 'erase' || tool === 'tone' || tool === 'blur' || tool === 'smudge' || tool === 'liquify' || tool === 'clone';

/**
 * Whether this pointer gets the brush outline. A mouse always does. A pen hovers over the very spot it is about to
 * paint, and a big ring there hides where a stroke will start, so painting tools show none for it; the eraser is the
 * exception, because nothing else shows what it will take away (the ring is the only reference for its reach).
 */
const showsRing = (e: PointerEvent): boolean => isPaintTool() && (e.pointerType === 'mouse' || tool === 'erase');

/** Page-space box of the last predicted segment, so only that part of the overlay is cleared. */
let predBox: { x0: number; y0: number; x1: number; y1: number } | null = null;

function clearPrediction(): void {
  if (!predBox) return;
  octx.setTransform(1, 0, 0, 1, 0, 0);
  const k = dpr() * view.scale;
  const x = Math.floor((predBox.x0 * view.scale + view.x) * dpr()) - 2;
  const y = Math.floor((predBox.y0 * view.scale + view.y) * dpr()) - 2;
  octx.clearRect(x, y, Math.ceil((predBox.x1 - predBox.x0) * k) + 4, Math.ceil((predBox.y1 - predBox.y0) * k) + 4);
  predBox = null;
}

/** The last pen samples of the stroke being drawn (page coordinates, event times), for the prediction. */
let penTrail: PenSample[] = [];
const noteSample = (ev: PointerEvent, p: Pt): void => {
  penTrail.push({ t: ev.timeStamp, x: p.x, y: p.y });
  if (penTrail.length > 8) penTrail.shift();
};

/** How far ahead of the last sample the preview reaches (ms), in two steps: about what it takes a sample to reach the screen. */
const PREDICT_AHEAD_MS = [12, 24];

/**
 * The preview is a hard, solid, round line. Only a brush that paints like that can be previewed truthfully: for a soft,
 * grainy, see-through or flowing one (the airbrush) it would flash a hard line in front of the pen that the stroke then
 * does not have.
 */
const previewable = (): boolean => brush.hardness >= 0.8 && brush.opacity >= 1 && (brush.flow ?? 1) >= 1 && (brush.pressureFlow ?? 0) === 0 && (brush.grain ?? 0) === 0;

/**
 * Where the pen is about to go, drawn on the overlay: own prediction from the last samples (`engine/predict.ts`; on a recorded
 * tablet pen its error a frame ahead was half that of the browser's predicted points, with no overshoot). Never reaches the
 * layer or the undo history: the real stamps replace it on the next event.
 */
function drawPrediction(e: PointerEvent): void {
  clearPrediction();
  if (tool !== 'brush' || isTurned(view) || !previewable()) return;
  const here = toDoc(e);
  const ahead = PREDICT_AHEAD_MS.map((ms) => predictPoint(penTrail, ms));
  if (!ahead[0] || !ahead[1]) return;
  const k0 = dpr() * view.scale;
  octx.setTransform(k0, 0, 0, k0, view.x * dpr(), view.y * dpr());
  const [r, g, b] = brush.color;
  octx.save();
  octx.strokeStyle = `rgba(${r},${g},${b},${brush.opacity})`;
  octx.lineCap = 'round';
  octx.lineJoin = 'round';
  octx.lineWidth = Math.max(1, brush.size * (1 - brush.pressureSize * (1 - pressureOf(e))));
  octx.beginPath();
  octx.moveTo(here.x, here.y);
  octx.lineTo(ahead[0].x, ahead[0].y);
  octx.lineTo(ahead[1].x, ahead[1].y);
  octx.stroke();
  const w = octx.lineWidth;
  const xs = [here.x, ahead[0].x, ahead[1].x];
  const ys = [here.y, ahead[0].y, ahead[1].y];
  predBox = { x0: Math.min(...xs) - w, y0: Math.min(...ys) - w, x1: Math.max(...xs) + w, y1: Math.max(...ys) + w };
  octx.restore();
}

function replaceBalloon(layer: Layer, next: Balloon): void {
  layer.balloons = (layer.balloons ?? []).map((b) => (b.id === next.id ? next : b));
}

function endPointer(): void {
  panning = null;
  picking = false;
  pickChip.hidden = true;
  transformUi.up();
  canvasResize.up();
  selUi.up();
  shapesUi.up();
  rulersUi.up();
  vectorUi.up();
  if (stroke) {
    const { s, layer } = stroke;
    stroke = null;
    profiler.strokeEnd();
    penTrail = [];
    const patch = s.finish();
    if (patch) {
      history.push(patchCommand(doc, patch));
      refreshLayer(layer, patch.rect);
      render(patch.rect);
    }
    refreshUi();
    drawOverlay(); // clears any prediction preview and redraws the selection
  }
  if (drag) {
    const d = drag;
    drag = null;
    if (d.mode === 'create') finishCreate(d.start, d.cur);
    else if (d.mode === 'split') finishSplit(d.start, d.cur);
    else if (d.mode === 'draw') finishFreehand(d.path);
    else endEdit();
    refreshUi();
    drawOverlay();
  }
}
function onPointerEnd(e: PointerEvent): void {
  if (e.pointerType === 'pen') {
    penDown = false;
    penUpAt = performance.now();
  }
  if (touchUp(e)) return;
  endPointer();
}
canvas.addEventListener('pointerup', onPointerEnd);
canvas.addEventListener('pointercancel', onPointerEnd);

function finishCreate(a: Pt, b: Pt): void {
  const moved = Math.hypot(b.x - a.x, b.y - a.y) >= 10;
  if (tool === 'panel') {
    if (!moved) return;
    const layer = ensureLayer('panels');
    mutate(layer, () => {
      const before = layer.panels ?? [];
      layer.panels = addRectPanel(before, a, b, Number(input('pn-border').value));
      const added = layer.panels.find((p) => !before.some((q) => q.id === p.id));
      selected = added ? { kind: 'panel', id: added.id } : selected;
    });
    endEdit();
    return;
  }
  if (tool === 'balloon' || tool === 'text') {
    const layer = ensureLayer('balloons');
    const isText = tool === 'text';
    // A plain click drops a default-sized balloon centred on the point.
    const [from, to] = moved
      ? [a, b]
      : isText
        ? [{ x: a.x - 100 * pageUnit(), y: a.y - 30 * pageUnit() }, { x: a.x + 100 * pageUnit(), y: a.y + 30 * pageUnit() }]
        : [{ x: a.x - 90 * pageUnit(), y: a.y - 60 * pageUnit() }, { x: a.x + 90 * pageUnit(), y: a.y + 60 * pageUnit() }];
    // The shape comes from the chosen sub tool, never from the shape list (that one shows the selected balloon).
    const shape: BalloonShape = isText ? 'none' : balloonMode.shape;
    addBalloon(layer, createBalloon(nextBalloonId(layer), shape, from, to));
  }
}

/** Put a new balloon on the layer with the font, border and direction chosen in the panel, and select it. */
function addBalloon(layer: Layer, made: Balloon): void {
  mutate(layer, () => {
    // Every shape is born with its own tail (free text excepted); the tail subtools only choose which kind.
    const balloon: Balloon = withDefaultTail(
      {
        ...made,
        fontSize: Number(input('bp-size').value),
        fontFamily: select('bp-font').value,
        border: Number(input('bp-border').value),
        vertical: input('bp-vertical').checked,
      },
      balloonMode.draw === 'tail' ? balloonMode.tailStyle : defaultTailStyle(made.shape),
    );
    layer.balloons = [...(layer.balloons ?? []), balloon];
    selected = { kind: 'balloon', id: balloon.id };
  });
  endEdit();
  $<HTMLTextAreaElement>('bp-text').focus();
}

/** A click of a curved balloon: add a corner, or close the outline when the click is on the first corner or on the last one again. */
function addBalloonPoint(p: Pt): void {
  const first = balloonPath[0];
  const last = balloonPath[balloonPath.length - 1];
  if (first && balloonPath.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) < 12 / view.scale) {
    closeBalloonPath();
    return;
  }
  if (last && Math.hypot(p.x - last.x, p.y - last.y) < 4 / view.scale) {
    closeBalloonPath(); // a double click
    return;
  }
  balloonPath.push(p);
  balloonHover = p;
  setStatus('Pulsa los puntos del globo; cierra con Intro o en el primer punto.');
  drawOverlay();
}

function closeBalloonPath(): void {
  const pts = balloonPath;
  cancelBalloonPath();
  if (!pts.length) return;
  const layer = ensureLayer('balloons');
  const made = pathBalloon(nextBalloonId(layer), pts);
  if (!made) {
    setStatus('Hacen falta al menos 3 puntos que encierren un globo.');
    return;
  }
  addBalloon(layer, made);
}

function cancelBalloonPath(): void {
  balloonPath = [];
  balloonHover = null;
  drawOverlay();
}

function finishFreehand(path: Pt[]): void {
  const pts = simplifyPath(path, 8 / view.scale, 3 / view.scale);
  const layer = ensureLayer('balloons');
  const made = pathBalloon(nextBalloonId(layer), pts);
  if (!made) {
    setStatus('Dibuja una línea que rodee el globo.');
    return;
  }
  addBalloon(layer, made);
}

function finishSplit(a: Pt, b: Pt): void {
  const layer = findLayer(doc, 'panels');
  if (!layer?.panels || Math.hypot(b.x - a.x, b.y - a.y) < 10) return;
  const gutter = Number(input('pn-gutter').value);
  const cut = splitPanels(layer.panels, a, b, gutter);
  if (cut === layer.panels) {
    setStatus('La línea no atraviesa ninguna viñeta.');
    return;
  }
  mutate(layer, () => (layer.panels = cut));
  endEdit();
}

// ---- keyboard ---------------------------------------------------------------
const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox');

/** While a layer mask is being drawn on, "erase" and "fill" act on the mask: hide (0) or show (255) the selection. */
function maskFill(value: 0 | 255): boolean {
  const sel = selUi.current;
  if (!layersUi.editingMask || !sel) return false;
  if (activeLayer(doc).locked) {
    setStatus('La capa está bloqueada: desbloquéala para editar su máscara.');
    return true;
  }
  const cmd = fillMask(doc, doc.activeId, sel, value);
  if (cmd) history.push(cmd);
  render();
  refreshUi();
  return true;
}

function maskFillWith(sel: NonNullable<typeof selUi.current>, value: 0 | 255): void {
  if (activeLayer(doc).locked) {
    setStatus('La capa está bloqueada: desbloquéala para editar su máscara.');
    return;
  }
  const cmd = fillMask(doc, doc.activeId, sel, value);
  if (cmd) history.push(cmd);
  render();
  refreshUi();
}

function deleteSelected(): void {
  const b = selectedBalloon();
  const p = selectedPanel();
  if (b) {
    mutate(b.layer, () => (b.layer.balloons = (b.layer.balloons ?? []).filter((x) => x.id !== b.balloon.id)));
  } else if (p) {
    mutate(p.layer, () => (p.layer.panels = removePanel(p.layer.panels ?? [], p.id)));
  } else {
    if (selUi.hasSelection() && maskFill(0)) return;
    if (selUi.hasSelection() && selUi.eraseSelected()) return;
    return;
  }
  endEdit();
  selected = null;
  refreshUi();
  drawOverlay();
}

// A new balloon leaves the cursor in its text box, but until something is typed there the box has nothing of its own to
// undo: Ctrl+Z / Ctrl+Y then belong to the document (the balloon just placed).
let balloonTextTyped = false;
$('bp-text').addEventListener('focus', () => (balloonTextTyped = false));
$('bp-text').addEventListener('input', () => (balloonTextTyped = true));

window.addEventListener('keydown', (e) => {
  if (e.target === $('bp-text') && !balloonTextTyped && (e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' || e.code === 'KeyY')) {
    handleShortcut(e);
    return;
  }
  if (typing(e.target)) return;
  if (canvasResize.active && e.key === 'Escape') {
    e.preventDefault();
    canvasResize.close();
    return;
  }
  if (transformUi.active && (e.key === 'Enter' || e.key === 'Escape')) {
    e.preventDefault();
    if (e.key === 'Enter') transformUi.fix();
    else transformUi.cancel();
    return;
  }
  if (filtersUi.active && (e.key === 'Enter' || e.key === 'Escape')) {
    e.preventDefault();
    if (e.key === 'Enter') filtersUi.apply();
    else filtersUi.cancel();
    return;
  }
  if ((selUi.pathOpen || shapesUi.pathOpen) && (e.key === 'Enter' || e.key === 'Escape')) {
    e.preventDefault();
    const closing = e.key === 'Enter';
    if (selUi.pathOpen) (closing ? selUi.closePath() : selUi.cancelPath());
    else (closing ? shapesUi.closePath() : shapesUi.cancelPath());
    return;
  }
  if (balloonPath.length && (e.key === 'Enter' || e.key === 'Escape')) {
    e.preventDefault();
    if (e.key === 'Enter') closeBalloonPath();
    else cancelBalloonPath();
    return;
  }
  if (rulersUi.pending && (e.key === 'Enter' || e.key === 'Escape')) {
    e.preventDefault();
    if (e.key === 'Enter') rulersUi.finishPending();
    else rulersUi.cancelPending();
    return;
  }
  if (e.code === 'Space') spaceDown = true;
  if (handleShortcut(e)) return;
  if (workspaceEmpty) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteSelected();
  } else if (e.key === 'Escape') {
    selected = null;
    refreshUi();
    drawOverlay();
  } else {
    if (e.key === '[' || e.key === ']') {
      setBrushSize(stepSize(brush.size, e.key === ']' ? 1 : -1), true);
      return;
    }
    if ((e.key === 'x' || e.key === 'X') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      swapColors();
      return;
    }
    if (e.key.length === 1 && toolPalettes?.pressLetter(e.key)) return;
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') spaceDown = false;
});

// ---- undo / redo / export -----------------------------------------------------
/** The page itself changed (cropped, turned, flipped, or that was undone): everything sized to it starts over. */
function pageChanged(): void {
  selUi.reset();
  layersUi.setEditingMask(false);
  selected = null;
  attachDocument();
  for (const l of doc.layers) if (l.kind === 'tone' || l.kind === 'panels' || l.kind === 'balloons') refreshLayer(l);
  applyPageDefaults();
  fitView();
  refreshUi();
}

/** Run a change of the page itself and record it; says `none` when it turned out to change nothing. */
function pageStep(make: () => Command | null, none: string): boolean {
  if (transformUi.active) transformUi.fix();
  endEdit();
  const cmd = make();
  if (!cmd) {
    setStatus(none);
    return false;
  }
  history.push(cmd);
  pageChanged();
  return true;
}

function pageEdit(op: PageOp, label: string): boolean {
  const none = op.kind === 'crop' ? 'Selecciona una zona dentro del lienzo para recortar.' : op.kind === 'resize' ? 'El lienzo ya tiene ese tamaño.' : 'No se pudo cambiar el lienzo.';
  return pageStep(() => applyPageOp(doc, op, label), none);
}

function resolutionEdit(r: Resolution): boolean {
  return pageStep(() => applyResolution(doc, r, 'Cambiar la resolución de la imagen'), 'No cambió nada.');
}
function canvasPropsEdit(props: CanvasProps): boolean {
  return pageStep(() => applyCanvasProps(doc, props, 'Cambiar las propiedades del lienzo'), 'No cambió nada.');
}

function undoRedo(redo: boolean): void {
  canvasResize.close();
  if (transformUi.active) transformUi.cancel();
  if (filtersUi.active) filtersUi.cancel();
  if (adjustUi.active) adjustUi.close(true);
  selUi.abortDrag();
  endEdit();
  const cmd = redo ? history.redo() : history.undo();
  if (cmd?.pageChange) pageChanged();
  else if (cmd) render(cmd.region ?? undefined);
  if (selected && !selectedBalloon() && !selectedPanel()) selected = null;
  refreshUi();
  drawOverlay();
}

const OPEN_FILTERS: FileFilter[] = [
  { name: 'Documentos con capas (.lienzo, .clip, .psd, .psb, .ora)', extensions: ['lienzo', 'clip', 'psd', 'psb', 'ora'] },
  { name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'jfif', 'webp', 'avif', 'jxl', 'gif', 'bmp', 'ico', 'svg', 'tga', 'tif', 'tiff', 'pnm', 'pbm', 'pgm', 'ppm', 'pam', 'qoi', 'pcx'] },
];
/** Every picture the file chooser offers when importing (the browser's own plus the ones read by src/engine/image-decode.ts). */
const IMAGE_ACCEPT = 'image/*,.jfif,.avif,.jxl,.ico,.tga,.icb,.vda,.vst,.tif,.tiff,.pnm,.pbm,.pgm,.ppm,.pam,.qoi,.pcx,.psd,.svg,.lienzo,.ora,.clip';
/** The document name without any extension, to propose as the name of a file. */
const baseName = (): string => docName.replace(/\.[a-z0-9]{2,6}$/i, '') || 'Sin título';

type ImageFormat = 'png' | 'jpg' | 'webp' | 'bmp' | 'tga' | 'tif';
const CANVAS_TYPES: Partial<Record<ImageFormat, string>> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

/** The page as one flat picture (drafts and reference layers left out), encoded in `format`. */
async function renderFlat(format: ImageFormat): Promise<Blob> {
  const canvasFormat = format in CANVAS_TYPES;
  const limit = canvasFormat ? 120_000_000 : 60_000_000; // the other formats are built in one block of memory
  if (doc.width * doc.height > limit) {
    throw new Error(`El documento es demasiado grande para guardarlo como ${format.toUpperCase()} (más de ${limit / 1_000_000} megapíxeles).`);
  }
  // Flatten in horizontal bands so no temporary buffer is bigger than a few megabytes.
  const band = 256;
  if (!canvasFormat) {
    const all = new Uint8ClampedArray(doc.width * doc.height * 4);
    for (let y = 0; y < doc.height; y += band) {
      const h = Math.min(band, doc.height - y);
      all.set(flattenRegion(doc, { x: 0, y, w: doc.width, h }, { output: true }), y * doc.width * 4);
    }
    const bytes = format === 'bmp' ? encodeBmp(doc.width, doc.height, all) : format === 'tga' ? encodeTga(doc.width, doc.height, all) : encodeTiff(doc.width, doc.height, all, doc.dpi);
    return new Blob([bytes as BlobPart], { type: format === 'tif' ? 'image/tiff' : 'application/octet-stream' });
  }
  const c = document.createElement('canvas');
  c.width = doc.width;
  c.height = doc.height;
  const cctx = c.getContext('2d')!;
  for (let y = 0; y < doc.height; y += band) {
    const h = Math.min(band, doc.height - y);
    const px = flattenRegion(doc, { x: 0, y, w: doc.width, h }, { output: true });
    // JPEG has no transparency: the picture goes on white paper. PNG and WebP keep the alpha as it is.
    cctx.putImageData(new ImageData(format === 'jpg' ? flattenOverWhite(px) : px, doc.width, h), 0, y);
  }
  const picture = await new Promise<Blob | null>((done) => c.toBlob(done, CANVAS_TYPES[format], 0.92));
  if (!picture) throw new Error('No se pudo crear la imagen.');
  return picture;
}

/**
 * Ask for a new document and open it. With `folder` (a folder of the library, "" for the library itself) the document is
 * created there as a .lienzo file right away, so it is tied to that file and "Guardar" keeps writing to it.
 */
async function newDocumentFlow(folder: string | null = null): Promise<void> {
  const fs = folder === null ? null : libraryFs();
  const spec = await askNewDocument(fs ? NEW_FILE_FORMATS.map((id) => ({ id, label: `${formatInfo(id).label} (.${formatInfo(id).ext})` })) : undefined);
  if (!spec) return;
  try {
    const created = newDocument(spec.width, spec.height, spec.dpi, { paper: spec.paper, guides: spec.guides });
    if (fs && folder !== null) {
      const format = NEW_FILE_FORMATS.find((f) => f === spec.format) ?? 'lienzo';
      const stemName = spec.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/^\.+|\.+$/g, '') || 'Sin título';
      const fileName = uniqueName(`${stemName}.${formatInfo(format).ext}`, (await fs.list(folder)).map((e) => e.name));
      const ref: FileRef = { kind: 'library', rel: joinRel(folder, fileName), name: fileName };
      // The document opens tied to its file first (the encoders write the open document), then the empty file is written.
      await openDocument(created, spec.name, ref, { format, title: fileName });
      await fs.write(ref.rel, (await encodeAs('document', format)).blob);
      noteRecent(ref);
      setStatus(`Documento nuevo guardado en ${folder || 'la biblioteca'}: ${fileName}`);
      return;
    }
    await openDocument(created, spec.name, null);
    setStatus(`Documento nuevo: ${spec.width} × ${spec.height} px a ${spec.dpi} ppp`);
  } catch (err) {
    reportError(err instanceof Error ? err.message : String(err));
  }
}

/** The types a document made inside the library can be created as (a .clip cannot be made from nothing). */
const NEW_FILE_FORMATS: SaveFormat[] = ['lienzo', 'psd', 'psb', 'ora'];

/** PNG through the browser's own codec, for the formats that carry one PNG per layer. */
const pngCodecs: OraCodecs = {
  // Not through a canvas: its toBlob waits for idle time, which a window that keeps drawing never has (see png-encode.ts).
  encodePng: (width, height, rgba) => encodePng(width, height, rgba),
  async decodePng(bytes) {
    return drawable(await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' })));
  },
};

/**
 * The document encoded in `format`, with the things that format could not keep. A "document" keeps the layers; an
 * "image" is the merged page (for a PSD that means a file with one merged layer, not the layered PSD).
 */
async function encodeAs(kind: SaveKind, format: SaveFormat): Promise<{ blob: Blob; warnings: string[] }> {
  if (kind === 'image') {
    if (format === 'psd' || format === 'psb') {
      const { value, warnings } = exportFlatPsd(doc, { large: format === 'psb' });
      return { blob: new Blob([value], { type: 'image/vnd.adobe.photoshop' }), warnings };
    }
    if (isLayered(format)) throw new Error(`«.${formatInfo(format).ext}» guarda capas: no es una imagen plana.`);
    return { blob: await renderFlat(format as ImageFormat), warnings: [] };
  }
  switch (format) {
    case 'lienzo':
      // The page is taken now: the picture is made when the tiles are written, and another tab may be showing by then.
      const page = doc;
      return { blob: await saveLienzo(page, { preview: () => previewPng(page) }), warnings: [] };
    case 'clip': {
      // Edits a copy of the .clip the document was opened from (see clip-write.ts).
      const { value, warnings } = await exportClip(doc, { ...pngCodecs, loadSql });
      return { blob: new Blob([value as BlobPart], { type: 'application/octet-stream' }), warnings };
    }
    case 'psd':
    case 'psb': {
      const { value, warnings } = exportPsd(doc, { large: format === 'psb' });
      return { blob: new Blob([value], { type: 'image/vnd.adobe.photoshop' }), warnings };
    }
    case 'ora': {
      const { value, warnings } = await exportOra(doc, pngCodecs);
      return { blob: new Blob([value as BlobPart], { type: 'image/openraster' }), warnings };
    }
    default:
      throw new Error(`«.${formatInfo(format).ext}» no guarda capas: usa «Exportar imagen…».`);
  }
}

const say = ({ level, title, spec }: NoticeText): void => void notify[level](title, spec);

const SAVING: Record<SaveStep, string> = { save: 'Guardando…', saveAs: 'Guardando…', copy: 'Guardando la copia…', export: 'Exportando la imagen…' };
let savingNotice: BusyHandle | null = null;

/** The file is being encoded and written: a spinner stays up until it ends (the save flow ignores another save meanwhile). */
function setSaving(step: SaveStep | null): void {
  savingNotice?.done();
  savingNotice = step ? notify.busy(SAVING[step]) : null;
}

/** A file was written: tell where it went, how big it is and what its format could not keep. */
function reportSaved(r: SavedResult): void {
  const clipNote = r.format === 'clip' && !warnedFormats.has('clip');
  warnedFormats.add(r.format);
  say(savedNotice(r, filePlatform(), { clipNote }));
}

/** Everything the document held is in a file now: its copy is rewritten as saved, so it is not offered back as something to recover. */
function markSaved(revision: number): void {
  savedRevision = revision;
  void autosave.flush();
  updateStatusBar();
}

/**
 * Remember which documents are open (and which one shows) so that the next start opens them again. Not while the
 * previous session is still being put back: the record must keep naming the tabs that have not been reopened yet.
 */
let restoringSession = true;
function persistSession(): void {
  if (restoringSession) return;
  if (workspaceEmpty) writeSession({ empty: true, tabs: [], active: null });
  else writeSession({ empty: false, tabs: sessions.map((s) => (s.id === activeSessionId ? autosaveKey : s.autosaveKey)), active: autosaveKey });
}

// ---- open documents (tabs) -----------------------------------------------------------------------
// The module variables above (doc, history, docName, ...) always describe the open document. Each other open
// document waits in its own session with the same fields, and a switch swaps them in and out.
interface DocSession {
  id: number;
  doc: Document;
  history: History;
  name: string;
  title: string;
  file: FileRef | null;
  format: SaveFormat;
  warned: Set<SaveFormat>;
  clipOk: boolean;
  saved: number;
  autosaveKey: string;
  view: ViewState;
  userView: boolean;
}
let sessionSerial = 0;
const captureSession = (id: number): DocSession => ({
  id, doc, history, name: docName, title: docTitle, file: docFile, format: docFormat, warned: warnedFormats, clipOk: clipOverwriteOk,
  saved: savedRevision, autosaveKey, view: { ...view }, userView,
});
/** Every open document in tab order. The entry of the open one is only refreshed when it is parked. */
const sessions: DocSession[] = [captureSession(++sessionSerial)];
let activeSessionId = sessions[0]!.id;
const sessionOf = (id: number): DocSession | undefined => sessions.find((s) => s.id === id);
const sessionDirty = (s: DocSession): boolean => s.history.revision !== s.saved;

function tabInfos(): TabInfo[] {
  return sessions.map((s) => {
    const live = s.id === activeSessionId;
    return { id: s.id, title: live ? docTitle : s.title, dirty: live ? isDirty() : sessionDirty(s), active: live };
  });
}

/** Keep the open document's fields in its session, so that another document can take the variables. */
function parkActive(): void {
  const at = sessions.findIndex((s) => s.id === activeSessionId);
  if (at >= 0) sessions[at] = captureSession(activeSessionId);
}

/** Take a parked session's document into the variables and show it. */
function loadSession(s: DocSession): void {
  hideHome();
  if (adjustUi.active) adjustUi.close(false);
  activeSessionId = s.id;
  doc = s.doc;
  history = s.history;
  docName = s.name;
  docTitle = s.title;
  docFile = s.file;
  docFormat = s.format;
  warnedFormats = s.warned;
  clipOverwriteOk = s.clipOk;
  savedRevision = s.saved;
  autosaveKey = s.autosaveKey;
  selUi.reset();
  layersUi.setEditingMask(false);
  selected = null;
  cloneSource = null;
  cloneOffset = null;
  attachDocument();
  Object.assign(view, s.view);
  userView = s.userView;
  if (userView) applyView();
  else fitView();
  refreshUi();
  persistSession();
}

/** Anything half done on the open document is settled, and its autosave copy written, before it is parked or left. */
async function settleOpenDocument(): Promise<void> {
  canvasResize.close();
  if (transformUi.active) transformUi.fix();
  if (adjustUi.active) adjustUi.close(false);
  // The copy is written (a big page takes seconds on a tablet), but a tab is never kept waiting for it for long: if the storage is
  // slow or stuck, the switch goes ahead and the copy lands when it can. Without this limit one slow copy froze every tab.
  await Promise.race([autosave.flush(), new Promise<void>((done) => window.setTimeout(done, 1500))]);
}

let switching = false;
async function switchTo(id: number): Promise<void> {
  if (id === activeSessionId || switching) return;
  const target = sessionOf(id);
  if (!target) return;
  switching = true;
  try {
    await settleOpenDocument();
    parkActive();
    loadSession(target);
  } finally {
    switching = false;
  }
}

/** A document nobody has touched: opening another file takes its place instead of adding a tab next to it. */
const isPristine = (): boolean => !docFile && !isDirty() && !history.canUndo && docName === 'Sin título';

/**
 * Make `next` the open document (a fresh history, nothing selected), saved in `file` when it came from there.
 * The autosave copy of the document it replaces is dropped (replacing it is the person's choice to let go of its
 * changes), except when `recoveredKey` says `next` is that very copy coming back: it then keeps writing to it.
 */
function useDocument(next: Document, name: string, file: FileRef | null, recoveredKey?: string, format: SaveFormat = 'lienzo', title?: string): void {
  hideHome();
  canvasResize.close();
  if (adjustUi.active) adjustUi.close(false);
  if (recoveredKey === undefined) {
    void removeAutosave(autosaveKey).catch(() => undefined);
    autosaveKey = newAutosaveKey();
  } else {
    autosaveKey = recoveredKey;
  }
  doc = next;
  history = newHistory();
  docName = name;
  docTitle = file?.name ?? title ?? name;
  docFile = file;
  docFormat = format;
  warnedFormats = new Set();
  clipOverwriteOk = false;
  savedRevision = history.revision;
  selUi.reset();
  layersUi.setEditingMask(false);
  selected = null;
  attachDocument();
  applyPageDefaults();
  fitView();
  refreshUi();
}

/**
 * Show `next` as the open document. By default it gets a tab of its own after the others (the open document waits in
 * its tab, changes and all); a document nobody has touched is replaced instead, and `replace` forces that for
 * "Revertir", which reads the same document again.
 */
async function openDocument(
  next: Document,
  name: string,
  file: FileRef | null,
  opts: { recoveredKey?: string; format?: SaveFormat; replace?: boolean; title?: string } = {},
): Promise<void> {
  if (workspaceEmpty) {
    // The first document after the last tab was closed: it gets the tab, nothing is parked.
    activeSessionId = ++sessionSerial;
    sessions.push(captureSession(activeSessionId));
    setWorkspaceEmpty(false);
  } else if (!opts.replace && !isPristine()) {
    await settleOpenDocument();
    parkActive();
    // The parked document keeps its autosave entry; the new one starts on a fresh key.
    autosaveKey = newAutosaveKey();
    activeSessionId = ++sessionSerial;
    sessions.push(captureSession(activeSessionId));
  }
  useDocument(next, name, file, opts.recoveredKey, opts.format ?? 'lienzo', opts.title);
  persistSession();
}

/** Close a document's tab, asking first what to do with changes that are not in a file. */
async function closeTab(id: number): Promise<void> {
  if (switching || !sessionOf(id)) return;
  const origin = activeSessionId;
  const entry = (): DocSession => sessionOf(id)!;
  const dirty = id === activeSessionId ? isDirty() : sessionDirty(entry());
  if (dirty) {
    // The question is asked first, about the tab that is closing, without leaving the open one: leaving it means writing its
    // autosave copy, which takes seconds on a big page, and "No guardar" or "Cancelar" never needed that.
    const title = id === activeSessionId ? docTitle : entry().title;
    const choice = await choiceDialog<'save' | 'drop' | 'cancel'>(
      `«${title}» tiene cambios sin guardar. ¿Quieres guardarlos antes de cerrarlo?`,
      [
        { label: 'Guardar', value: 'save', primary: true },
        { label: 'No guardar', value: 'drop' },
        { label: 'Cancelar', value: 'cancel' },
      ],
      'cancel',
    );
    if (choice === 'cancel' || !sessionOf(id)) return;
    if (choice === 'save') {
      // Saving works on the open document, so this one is brought up for it.
      await switchTo(id);
      if (activeSessionId !== id) return;
      await saveFlow.save();
      if (isDirty()) {
        if (origin !== id) await switchTo(origin);
        return;
      }
    }
  }
  if (!sessionOf(id)) return;
  // Back to the tab that was open when this one was asked to close; if this was the open one, the one beside it.
  const next = activeAfterClose(sessions.map((s) => s.id), id, origin);
  const closing = id === activeSessionId;
  const closedKey = closing ? autosaveKey : entry().autosaveKey;
  autosave.forget(closedKey);
  void removeAutosave(closedKey).catch(() => undefined);
  sessions.splice(sessions.findIndex((s) => s.id === id), 1);
  if (!closing) {
    persistSession();
    updateStatusBar(); // the tab strip is drawn from here
    return;
  }
  const target = next === null ? undefined : sessionOf(next);
  if (target) {
    loadSession(target);
    return;
  }
  // The last tab was closed: no canvas is shown until a document is created or opened.
  activeSessionId = 0;
  useDocument(newDocument(), 'Sin título', null);
  setWorkspaceEmpty(true);
}

/** Show or hide the canvas; with no document the welcome panel and the few live commands take its place. */
function setWorkspaceEmpty(empty: boolean): void {
  workspaceEmpty = empty;
  document.documentElement.classList.toggle('workspace-empty', empty);
  syncHome();
  updateStatusBar();
  persistSession();
}

/** The home screen shows over an open document (File ▸ Inicio): the editor waits behind it, with only the workspace commands live. */
function syncHome(): void {
  const shown = workspaceEmpty || homeOverlay;
  document.documentElement.classList.toggle('home-open', shown);
  commands.setGate(shown ? (id) => WORKSPACE_COMMANDS.test(id) : null);
  if (shown) home.show();
  else home.hide();
}
/** Go back from the home screen to the document that was open. */
function hideHome(): void {
  if (!homeOverlay) return;
  homeOverlay = false;
  syncHome();
}
async function showHome(): Promise<void> {
  if (!workspaceEmpty) {
    await settleOpenDocument();
    homeOverlay = true;
  }
  syncHome();
}

/**
 * The tab a save step began on. Encoding and writing a big page takes seconds and another tab can be shown meanwhile: what the step
 * then ties to the file and marks as saved is still the document it began with, not whichever one is open when it ends.
 */
let saveTab = -1;
/** The four ways to write the open document; see save-flow.ts. The variables below are the ones that tie it to a file. */
const saveFlow = createSaveFlow({
  association: () => {
    saveTab = activeSessionId;
    return { file: docFile, format: docFormat, name: docName, title: docTitle, clipOverwriteOk };
  },
  associate: (next) => {
    if (saveTab !== activeSessionId) {
      const parked = sessionOf(saveTab);
      if (parked) {
        parked.file = next.file;
        parked.format = next.format;
        parked.name = next.name;
        parked.title = next.file?.name ?? next.title ?? next.name;
        parked.clipOk = next.clipOverwriteOk;
        if (next.file) noteRecent(next.file);
        updateStatusBar();
      }
      return;
    }
    docFile = next.file;
    docFormat = next.format;
    docName = next.name;
    // The tab says the real file the document is tied to now; a plain download has no file, so it keeps its name.
    docTitle = next.file?.name ?? next.title ?? next.name;
    clipOverwriteOk = next.clipOverwriteOk;
    if (next.file) noteRecent(next.file);
  },
  revision: () => history.revision,
  markSaved: (revision) => {
    if (saveTab === activeSessionId) return markSaved(revision);
    const parked = sessionOf(saveTab);
    if (parked) parked.saved = revision;
    updateStatusBar();
  },
  canWriteClip: () => canWriteClip(doc),
  baseName,
  dialogReportsType,
  askFormat: askSaveFormat,
  confirmClipOverwrite: () =>
    confirmDialog(
      'Guardar sustituirá el archivo .clip original por la versión de Lienzo (capas añadidas, borradas, movidas y convertidas incluidas). Aún no se ha comprobado con todos los .clip: si quieres conservar el original usa «Guardar copia…» o «Guardar como…» con otro nombre. ¿Sobrescribir?',
      'Sobrescribir',
    ),
  chooseTarget: (suggested, filters) => (saveIntoLibrary ? chooseLibraryTarget(suggested) : chooseSaveTarget(suggested, filters)),
  encode: encodeAs,
  writeToRef: saveTo,
  writeToTarget,
  working: setSaving,
  saved: reportSaved,
  denied: (name) => say(deniedNotice(name)),
  failed: (f) => say(failedNotice(f)),
});

/** Ask which file type to save in (Android's dialog has none). Null when dismissed. */
function askSaveFormat(kind: SaveKind, preferred: SaveFormat, allowed: SaveFormat[]): Promise<SaveFormat | null> {
  const options = formatsFor(kind)
    .filter((f) => allowed.includes(f.id))
    .map((f) => ({ label: `${kind === 'image' ? (f.imageLabel ?? f.label) : f.label} (.${f.ext})`, value: f.id as SaveFormat | null, primary: f.id === preferred }));
  const message =
    kind === 'image'
      ? '¿En qué formato quieres exportar la imagen? Se guarda la página ya combinada, en una sola capa; el documento no cambia. JPEG y BMP ponen la transparencia sobre fondo blanco; PNG, WebP, TIFF y Targa la conservan.'
      : '¿En qué formato quieres guardar? Todos conservan las capas (Clip Studio y Photoshop pueden perder algún detalle y avisan). Para una imagen plana usa «Exportar imagen…».';
  return choiceDialog<SaveFormat | null>(message, options, null, true);
}

/** The document name without the extension of the format it was read from. */
const stem =(name: string): string => name.replace(/\.[a-z0-9]{2,6}$/i, '') || 'Sin título';

/**
 * Open a file as the current document: a .lienzo (kept tied to its file), or a PSD, OpenRaster, Clip Studio or plain
 * picture, which are imported (saving then asks for a .lienzo file). The format is told from the bytes, not the name.
 */
async function openBlob(blob: Blob, name: string, file: FileRef | null, replace = false): Promise<void> {
  let kind = 'documento';
  // Reading works on a copy and nothing of the open documents changes until the file is ready, so it can be cancelled until then.
  const op = notify.busy(`Abriendo «${name}»…`, { cancelable: true });
  try {
    if (await isLienzo(blob)) {
      const loaded = await loadLienzo(blob);
      if (op.signal.aborted) return op.cancelled();
      op.done();
      await openDocument(loaded, name.replace(/\.lienzo$/i, ''), file, { format: 'lienzo', replace, title: name });
      if (file) noteRecent(file);
      return;
    }
    const head = new Uint8Array(await blob.slice(0, SNIFF_BYTES).arrayBuffer());
    let imported: { value: Document; warnings: string[] } | null = null;
    /** Set for the formats that keep layers: saving writes back to the same file in the same format. */
    let layered: SaveFormat | null = null;
    if (looksLikeClip(head)) {
      kind = 'archivo de Clip Studio';
      imported = await importClip(new Uint8Array(await blob.arrayBuffer()), pngCodecs);
      layered = 'clip';
    } else if (looksLikeOra(head)) {
      kind = 'archivo OpenRaster';
      imported = await importOra(new Uint8Array(await blob.arrayBuffer()), pngCodecs);
      layered = 'ora';
    } else {
      const format = sniffImage(head, name);
      if (format === 'psd') {
        kind = head[5] === 2 ? 'PSB' : 'PSD';
        imported = importPsd(await blob.arrayBuffer());
        layered = head[5] === 2 ? 'psb' : 'psd';
      } else if (format !== 'unknown') {
        kind = 'imagen';
        const img = await decodeImageFile(new File([blob], name));
        const d = createDocument(img.width, img.height);
        d.layers[0]!.name = 'Imagen';
        d.layers[0]!.surface.writeRect({ x: 0, y: 0, w: img.width, h: img.height }, img.data);
        imported = { value: d, warnings: [] };
      } else {
        throw new Error(`«${name}» no es un formato que Lienzo pueda abrir.`);
      }
    }
    if (op.signal.aborted) return op.cancelled();
    op.done();
    await openDocument(imported.value, stem(name), layered ? file : null, { format: layered ?? 'lienzo', replace, title: name });
    if (file) noteRecent(file);
    if (imported.warnings.length) void alertDialog(imported.warnings.join('\n'), `${kind[0]!.toUpperCase()}${kind.slice(1)} abierto con avisos`);
  } catch (err) {
    op.done();
    void alertDialog(err instanceof Error ? err.message : String(err), `No se pudo abrir: ${kind}`);
  } finally {
    op.done();
  }
}

// ---- recent files ----------------------------------------------------------------------------------
let recent: RecentFile[] = [];
/** One change at a time, so two files opened close together do not overwrite each other's list. */
let recentWork: Promise<unknown> = loadRecent().then((list) => {
  recent = list;
});
const changeRecent = (next: (list: RecentFile[]) => Promise<RecentFile[]>): Promise<unknown> =>
  (recentWork = recentWork
    .then(async () => {
      recent = await next(recent);
      await storeRecent(recent);
    })
    .catch(() => undefined));
/** A file was opened or saved: it goes to the top of the list. */
const noteRecent = (ref: FileRef): void => void changeRecent((list) => mergeRecent(list, ref, sameFile));

dynamicMenus.set('recent', () => {
  if (!recent.length) return [{ id: 'filerecentnone', label: '(sin archivos recientes)' }];
  return [...recent.map((r, n): MenuEntry => ({ id: `filerecent${n}`, label: r.name })), { sep: true }, { id: 'filerecentclear', label: 'Borrar la lista' }];
});
for (let n = 0; n < 10; n++) commands.register(`filerecent${n}`, { run: () => openRecent(n), enabled: () => !!recent[n] });
commands.register('filerecentclear', { run: () => void changeRecent(async () => []), enabled: () => recent.length > 0 });

const openRecent = async (n: number): Promise<void> => void (recent[n] && (await openRef(recent[n]!.ref)));

/** Open a file the app knew before (a recent one, or one of the library); when it cannot be read the person may drop it from the list. */
async function openRef(ref: FileRef): Promise<void> {
  // A file that is already open in a tab is shown, not opened a second time.
  const tabs = [{ id: activeSessionId, file: docFile }, ...sessions.filter((s) => s.id !== activeSessionId).map((s) => ({ id: s.id, file: s.file }))];
  for (const t of tabs) {
    if (!t.file || !(await sameFile(t.file, ref))) continue;
    if (t.id !== activeSessionId) await switchTo(t.id);
    hideHome();
    return;
  }
  let blob: Blob;
  try {
    blob = await readKnownFile(ref);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    if (await confirmDialog(`No se pudo abrir «${ref.name}»: ${why}\n¿Quitarlo de la lista?`, 'Quitar')) await changeRecent((list) => withoutRecent(list, ref, sameFile));
    return;
  }
  await openBlob(blob, ref.name, ref);
}

async function openFlow(): Promise<void> {
  if (!hasPicker()) {
    psdInput.click();
    return;
  }
  try {
    const picked = await openFile(OPEN_FILTERS);
    if (picked) await openBlob(picked.blob, picked.name, picked.ref);
  } catch (err) {
    void alertDialog(err instanceof Error ? err.message : String(err), 'No se pudo abrir el archivo');
  }
}

// ---- home screen: the file explorer shown at start and from File ▸ Inicio ---------------------------------------
const pickOutside = async (): Promise<PickedFile[]> => {
  if (hasPicker()) return (await openFiles(OPEN_FILTERS)) ?? [];
  return new Promise((done) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.multiple = true;
    i.accept = IMAGE_ACCEPT;
    i.addEventListener('change', () => done([...(i.files ?? [])].map((f): PickedFile => async () => ({ blob: f, name: f.name }))));
    i.addEventListener('cancel', () => done([]));
    i.click();
  });
};

const home = createHome($('home'), {
  fs: libraryFs(),
  recent: () => recent,
  thumbs: createThumbs(createPreviewer({ decodeImage: decodeImageFile, codecs: pngCodecs })),
  open: openRef,
  newDocument: (folder) => void newDocumentFlow(folder),
  openOutside: () => void openFlow(),
  pickOutside,
  async exportOutside(blob, name) {
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    const done = await saveAsOutside(blob, name, [{ name: `Archivo .${ext}`, extensions: [ext] }]);
    if (!done.cancelled) setStatus(done.ref ? `«${name}» exportado.` : `«${name}» descargado.`);
  },
  readRef: readFrom,
  stampOf: modifiedAt,
  inUse: (rel) => [docFile, ...sessions.filter((s) => s.id !== activeSessionId).map((s) => s.file)].some((f) => f?.kind === 'library' && (f.rel === rel || f.rel.startsWith(`${rel}/`))),
  moved: async (from, to) => void (await changeRecent(async (list) => relocateRecent(list, from, to))),
  forgetRecent: async (ref) => void (await changeRecent((list) => withoutRecent(list, ref, sameFile))),
  canReturn: () => !workspaceEmpty,
  returned: hideHome,
});
commands.register('filehome', () => void showHome());

/** Save As, but into a folder of the library instead of through the system's dialog. */
let saveIntoLibrary = false;
async function chooseLibraryTarget(suggested: string): Promise<SaveTarget | null> {
  const folder = await home.chooseFolder('¿En qué carpeta de la biblioteca quieres guardar?');
  if (folder === null) return null;
  const rel = joinRel(folder, suggested);
  if ((await home.exists(rel)) && !(await confirmDialog(`Ya hay un archivo llamado «${suggested}» en esa carpeta. ¿Sustituirlo?`, 'Sustituir'))) return null;
  return { ref: { kind: 'library', rel, name: suggested } };
}
commands.register('filesavelibrary', {
  run: async () => {
    saveIntoLibrary = true;
    try {
      await saveFlow.saveAs();
    } finally {
      saveIntoLibrary = false;
    }
  },
  enabled: () => !!libraryFs(),
});

/** "Revertir": read the document again from its file, dropping every change since it was saved. */
async function revertFlow(): Promise<void> {
  const file = docFile;
  if (!file) return;
  if (isDirty() && !(await confirmDialog('Se perderán los cambios hechos desde la última vez que se guardó. ¿Revertir?', 'Revertir'))) return;
  try {
    await openBlob(await readFrom(file), file.name, file, true);
  } catch (err) {
    void alertDialog(err instanceof Error ? err.message : String(err), 'No se pudo revertir');
  }
}

const psdInput = input('psd-input');
psdInput.addEventListener('change', async () => {
  const file = psdInput.files?.[0];
  psdInput.value = '';
  if (!file) return;
  await openBlob(file, file.name, null);
});

// ---- tone controls ------------------------------------------------------------
function toneLayer(): Layer | null {
  const l = activeLayer(doc);
  return l.kind === 'tone' && l.tone ? l : null;
}
function bindTone(id: string, label: string | null, apply: (v: string) => void, fmt = (v: string) => v): void {
  const el = $<HTMLInputElement | HTMLSelectElement>(id);
  el.addEventListener('input', () => {
    const l = toneLayer();
    if (!l) return;
    mutate(l, () => apply(el.value));
    if (label) $(label).textContent = fmt(el.value);
  });
  el.addEventListener('change', endEdit);
}
const T = (): NonNullable<Layer['tone']> => toneLayer()!.tone!;
bindTone('tn-shape', null, (v) => (T().shape = v as ToneShape));
bindTone('tn-density', 'tn-density-v', (v) => (T().density = Number(v) / 100), (v) => `${v}%`);
bindTone('tn-lpi', 'tn-lpi-v', (v) => (T().lpi = Number(v)));
bindTone('tn-angle', 'tn-angle-v', (v) => (T().angle = Number(v)), (v) => `${v}°`);
bindTone('tn-color', null, (v) => (T().color = hexToRgb(v)));

// ---- panel controls -----------------------------------------------------------
bindRange('pn-border', 'pn-border-v', () => {}, (v) => `${v}px`);
bindRange('pn-gutter', 'pn-gutter-v', () => {}, (v) => `${v}px`);
bindRange('pn-margin', 'pn-margin-v', () => {}, (v) => `${v}px`);
input('pn-border').addEventListener('input', () => {
  const p = selectedPanel();
  if (!p) return;
  mutate(p.layer, () => {
    p.layer.panels = (p.layer.panels ?? []).map((x) => (x.id === p.id ? { ...x, border: Number(input('pn-border').value) } : x));
  });
});
input('pn-border').addEventListener('change', endEdit);
$('pn-grid').addEventListener('click', () => {
  const layer = ensureLayer('panels');
  mutate(layer, () => {
    layer.panels = gridPanels(
      layer.panels ?? [],
      { w: doc.width, h: doc.height },
      Math.max(1, Number(input('pn-rows').value)),
      Math.max(1, Number(input('pn-cols').value)),
      Number(input('pn-margin').value),
      Number(input('pn-gutter').value),
      Number(input('pn-border').value),
    );
  });
  endEdit();
});

// ---- balloon controls ---------------------------------------------------------
function bindBalloon(id: string, label: string | null, apply: (b: Balloon, el: HTMLInputElement) => Balloon): void {
  const el = input(id);
  el.addEventListener('input', () => {
    const sel = selectedBalloon();
    if (!sel) return;
    mutate(sel.layer, () => replaceBalloon(sel.layer, apply(sel.balloon, el)));
    if (label) $(label).textContent = el.value;
  });
  el.addEventListener('change', endEdit);
}
bindBalloon('bp-text', null, (b, el) => ({ ...b, text: el.value }));
bindBalloon('bp-shape', null, (b, el) => {
  const next = withShape(b, el.value as BalloonShape);
  // Free text has no tail; a shape chosen for it brings its own.
  return b.shape === 'none' && !b.tail ? withDefaultTail(next) : next;
});
bindBalloon('bp-font', null, (b, el) => ({ ...b, fontFamily: el.value }));
bindBalloon('bp-size', 'bp-size-v', (b, el) => ({ ...b, fontSize: Number(el.value) }));
bindBalloon('bp-border', 'bp-border-v', (b, el) => ({ ...b, border: Number(el.value) }));
bindBalloon('bp-vertical', null, (b, el) => ({ ...b, vertical: el.checked }));
bindBalloon('bp-tail', null, (b, el) => ({
  ...b,
  tail: el.checked ? (b.tail ?? defaultTailTip(b)) : null,
}));
bindBalloon('bp-tail-style', null, (b, el) => withTail(b, b.tail, el.value as TailStyle));

// ---- overlay ------------------------------------------------------------------
const ACCENT = '#2f7bff';
/** Clear the overlay and set it up to draw in page coordinates. */
function clearOverlay(): void {
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, overlay.width, overlay.height);
  const [a, b, c, d, e, f] = docMatrix(view, stageBox());
  const k = dpr();
  octx.setTransform(a * k, b * k, c * k, d * k, e * k, f * k);
}

let showGrid = false;
let rulers: ReturnType<typeof mountRulers> | undefined;

/** Grid every 10 mm of the page (doubled while it would be too dense on screen). */
function gridStep(): number {
  let step = (doc.dpi / 25.4) * 10;
  while (step * view.scale < 14) step *= 2;
  return step;
}

function drawGrid(): void {
  const s = view.scale;
  const step = gridStep();
  const x0 = 0;
  const y0 = 0;
  const x1 = doc.width;
  const y1 = doc.height;
  octx.save();
  octx.lineWidth = 1 / s;
  octx.strokeStyle = 'rgba(110, 150, 255, 0.35)';
  octx.beginPath();
  for (let x = x0; x <= x1; x += step) {
    octx.moveTo(x, Math.max(0, y0));
    octx.lineTo(x, y1);
  }
  for (let y = y0; y <= y1; y += step) {
    octx.moveTo(Math.max(0, x0), y);
    octx.lineTo(x1, y);
  }
  octx.stroke();
  octx.restore();
}

function drawOverlay(): void {
  clearOverlay();
  if (showGrid) drawGrid();
  guidesUi.draw(octx);
  rulersUi.drawOverlay(octx);
  if (isVectorTool(tool)) vectorUi.drawOverlay(octx);
  selUi.drawOverlay(octx);
  shapesUi.drawOverlay(octx);
  transformUi.drawOverlay(octx);
  canvasResize.drawOverlay(octx);
  const s = view.scale;
  octx.lineWidth = 1.5 / s;
  octx.strokeStyle = ACCENT;
  octx.fillStyle = '#fff';

  const sel = selectedBalloon();
  if (sel) {
    const b = sel.balloon;
    octx.setLineDash([6 / s, 4 / s]);
    octx.strokeRect(b.x, b.y, b.w, b.h);
    octx.setLineDash([]);
    for (const tail of tailShapes(b)) {
      octx.beginPath();
      tail.forEach((q, i) => (i ? octx.lineTo(q.x, q.y) : octx.moveTo(q.x, q.y)));
      octx.closePath();
      octx.stroke();
    }
    const r = 5 / s;
    for (const [name, q] of Object.entries(handlePoints(b)) as [Handle, Pt][]) {
      octx.beginPath();
      if (name === 'tail') octx.arc(q.x, q.y, r * 1.2, 0, Math.PI * 2);
      else octx.rect(q.x - r, q.y - r, r * 2, r * 2);
      octx.fill();
      octx.stroke();
    }
  }
  const sp = selectedPanel();
  if (sp) {
    const panel = sp.layer.panels?.find((x) => x.id === sp.id);
    if (panel) {
      octx.beginPath();
      panel.points.forEach((q, i) => (i ? octx.lineTo(q.x, q.y) : octx.moveTo(q.x, q.y)));
      octx.closePath();
      octx.stroke();
    }
  }
  const outline = drag?.mode === 'draw' ? drag.path : balloonPath.length ? (balloonHover ? [...balloonPath, balloonHover] : balloonPath) : null;
  if (outline && outline.length > 1) {
    // A curved balloon in the making: the smooth outline through the points so far, and the points themselves.
    octx.beginPath();
    const curve = drag?.mode === 'draw' || outline.length < 3 ? outline : smoothClosed(outline, 10);
    curve.forEach((q, i) => (i ? octx.lineTo(q.x, q.y) : octx.moveTo(q.x, q.y)));
    if (drag?.mode !== 'draw' && outline.length >= 3) octx.closePath();
    octx.stroke();
  }
  for (const q of balloonPath) {
    octx.beginPath();
    octx.arc(q.x, q.y, 4 / s, 0, Math.PI * 2);
    octx.fill();
    octx.stroke();
  }
  if (drag && (drag.mode === 'create' || drag.mode === 'split')) {
    octx.setLineDash([6 / s, 4 / s]);
    octx.beginPath();
    if (drag.mode === 'split') {
      octx.moveTo(drag.start.x, drag.start.y);
      octx.lineTo(drag.cur.x, drag.cur.y);
    } else {
      octx.rect(drag.start.x, drag.start.y, drag.cur.x - drag.start.x, drag.cur.y - drag.start.y);
    }
    octx.stroke();
    octx.setLineDash([]);
  }
  if (cursor && isPaintTool()) {
    // Brush outline at its real size: dark ring plus a light one so it shows on any colour.
    const r = brush.size / 2;
    octx.setLineDash([]);
    if (prefs.brushOutline) {
      octx.beginPath();
      octx.arc(cursor.x, cursor.y, Math.max(r, 0.5 / s), 0, Math.PI * 2);
      octx.strokeStyle = '#fff';
      octx.lineWidth = 3 / s;
      octx.stroke();
      octx.strokeStyle = '#000';
      octx.lineWidth = 1.2 / s;
      octx.stroke();
    }
    if (prefs.brushCrosshair) {
      // A small cross at the centre, a fixed 6 screen pixels per arm whatever the zoom.
      const a = 6 / s;
      octx.beginPath();
      octx.moveTo(cursor.x - a, cursor.y);
      octx.lineTo(cursor.x + a, cursor.y);
      octx.moveTo(cursor.x, cursor.y - a);
      octx.lineTo(cursor.x, cursor.y + a);
      octx.strokeStyle = '#fff';
      octx.lineWidth = 3 / s;
      octx.stroke();
      octx.strokeStyle = '#000';
      octx.lineWidth = 1.2 / s;
      octx.stroke();
    }
  }
  if (tool === 'clone' && cloneSource) {
    // Where the copy comes from: the fixed source until a stroke is started, then the point the pen is copying right now.
    const q = cloneOffset && cursor ? { x: cursor.x + cloneOffset.x, y: cursor.y + cloneOffset.y } : cloneSource;
    const a = 8 / s;
    octx.setLineDash([]);
    octx.beginPath();
    octx.moveTo(q.x - a, q.y);
    octx.lineTo(q.x + a, q.y);
    octx.moveTo(q.x, q.y - a);
    octx.lineTo(q.x, q.y + a);
    octx.arc(q.x, q.y, a * 0.6, 0, Math.PI * 2);
    octx.strokeStyle = '#fff';
    octx.lineWidth = 3 / s;
    octx.stroke();
    octx.strokeStyle = '#d02050';
    octx.lineWidth = 1.2 / s;
    octx.stroke();
  }
}

// ---- layers panel ---------------------------------------------------------------
const list = $<HTMLUListElement>('layer-list');
const blendSel = select('blend');
const BLEND_LABELS: Record<BlendMode, string> = {
  normal: 'Normal', darken: 'Oscurecer', multiply: 'Multiplicar', colorBurn: 'Subexponer color',
  linearBurn: 'Subexponer lineal', subtract: 'Restar', darkerColor: 'Color más oscuro', lighten: 'Aclarar',
  screen: 'Trama', colorDodge: 'Sobreexponer color', glowDodge: 'Sobreexponer (brillo)', add: 'Sumar',
  addGlow: 'Sumar (brillo)', lighterColor: 'Color más claro', overlay: 'Superponer', softLight: 'Luz suave',
  hardLight: 'Luz fuerte', vividLight: 'Luz intensa', linearLight: 'Luz lineal', pinLight: 'Luz focal',
  hardMix: 'Mezcla fuerte', difference: 'Diferencia', exclusion: 'Exclusión', hue: 'Tono',
  saturation: 'Saturación', color: 'Color', luminosity: 'Luminosidad', divide: 'Dividir',
};
for (const m of BLEND_MODES) blendSel.add(new Option(BLEND_LABELS[m], m));
const layersUi = createLayersUi({
  doc: () => doc,
  list,
  thumb: (layer) => thumbCanvas(layer),
  labels: BLEND_LABELS,
  kindLabel: KIND_LABEL,
  edit: (label, change, redraw) => layerEdit(label, change, redraw),
  push: (cmd) => {
    endEdit();
    if (cmd) history.push(cmd);
    selected = null;
    render();
    refreshUi();
    drawOverlay();
  },
  refresh: () => refreshUi(),
  rename: (layer) => (layer.kind === 'adjust' && adjustUi.open(layer) ? undefined : void renameLayer(layer)),
  selection: () => selUi.current,
  replaceSelection: (sel, label) => selUi.replace(sel, label),
});

async function renameLayer(layer: Layer): Promise<void> {
  const n = await promptDialog('Nombre de la capa', layer.name);
  if (n?.trim() && n.trim() !== layer.name) layerEdit('Cambiar nombre de capa', () => (layer.name = n.trim()), false);
}

/** Make a change from the layer palette undoable: it records the layer order and properties before and after. */
function layerEdit(label: string, change: () => void, redraw = true): void {
  endEdit();
  const cmd = recordStructure(doc, label, change);
  if (cmd) history.push(cmd);
  if (redraw) render();
  refreshUi();
}

function show(id: string, visible: boolean): void {
  $(id).hidden = !visible;
}

// Layer thumbnails: one small canvas per layer, redrawn shortly after the pixels change.
const thumbCanvases = new WeakMap<Layer, HTMLCanvasElement>();
function thumbCanvas(layer: Layer): HTMLCanvasElement {
  let c = thumbCanvases.get(layer);
  if (!c) {
    c = document.createElement('canvas');
    const k = 40 / Math.max(doc.width, doc.height);
    c.width = Math.max(1, Math.round(doc.width * k));
    c.height = Math.max(1, Math.round(doc.height * k));
    c.className = 'lthumb';
    thumbCanvases.set(layer, c);
    drawThumb(layer, c);
  }
  return c;
}
/** What each thumbnail was drawn from (the surface, its revision and the paper colour): it is drawn again only when that changes. */
const thumbDrawn = new WeakMap<Layer, { surface: Layer['surface']; revision: number; paper: string; kind: string }>();
function drawThumb(layer: Layer, c: HTMLCanvasElement): void {
  const was = thumbDrawn.get(layer);
  const paper = layer.paperColor?.join(',') ?? '';
  if (was && was.surface === layer.surface && was.revision === layer.surface.revision && was.paper === paper && was.kind === layer.kind) return;
  thumbDrawn.set(layer, { surface: layer.surface, revision: layer.surface.revision, paper, kind: layer.kind });
  const px = layerThumbnail(layer, doc.width, doc.height, c.width, c.height);
  c.getContext('2d')!.putImageData(new ImageData(px, c.width, c.height), 0, 0);
}
let thumbTimer = 0;
function scheduleThumbs(): void {
  clearTimeout(thumbTimer);
  thumbTimer = window.setTimeout(() => {
    if (!list.offsetParent) return;
    for (const layer of doc.layers) {
      const c = thumbCanvases.get(layer);
      if (c) drawThumb(layer, c);
    }
    layersUi.drawMaskThumbs();
  }, 300);
}

function refreshUi(): void {
  layersUi.renderList();
  if (tool === 'fill' || tool === 'wand') selUi?.warmLook(); // after an undo, a layer change…: compose the page the bucket looks at again

  const l = activeLayer(doc);
  blendSel.value = l.blend;
  input('lopacity').value = String(Math.round(l.opacity * 100));
  $('lopacity-v').textContent = `${Math.round(l.opacity * 100)}%`;
  input('clip').checked = l.clip;
  input('lock-alpha').checked = l.lockAlpha;
  $('lock-layer').classList.toggle('on', l.locked);
  $<HTMLButtonElement>('merge-layer').disabled = !canMergeTargets();
  $('role-draft').classList.toggle('on', l.role === 'draft');
  $('role-ref').classList.toggle('on', l.role === 'reference');
  $('mask-btn').classList.toggle('on', !!l.mask);
  $<HTMLButtonElement>('mask-btn').title = l.mask ? 'Máscara de capa: clic para dibujar en la máscara o en la capa' : 'Crear máscara de capa (dentro de la selección si la hay)';
  $<HTMLButtonElement>('del-layer').disabled = doc.layers.length <= 1;
  commands.notify();
  studio?.dock.refresh('history');
  studio?.dock.refresh('layercomp');
  studio?.dock.refresh('memoryinformation');
  statusBar?.update(statusInfo());

  const paints = tool === 'brush' || tool === 'erase' || tool === 'tone' || tool === 'blur' || tool === 'smudge' || tool === 'liquify' || tool === 'clone' || tool.startsWith('fig');
  show('sec-brush', paints);
  const tn = toneLayer();
  show('sec-tone', !!tn && (tool === 'tone' || l.kind === 'tone'));
  if (tn?.tone) {
    select('tn-shape').value = tn.tone.shape;
    input('tn-density').value = String(Math.round(tn.tone.density * 100));
    $('tn-density-v').textContent = `${Math.round(tn.tone.density * 100)}%`;
    input('tn-lpi').value = String(tn.tone.lpi);
    $('tn-lpi-v').textContent = String(tn.tone.lpi);
    input('tn-angle').value = String(tn.tone.angle);
    $('tn-angle-v').textContent = `${tn.tone.angle}°`;
    input('tn-color').value = rgbToHex(tn.tone.color);
  }
  const fills = tool === 'fill' || isFillTool(tool);
  const figures = tool.startsWith('fig');
  show('sec-shape', tool === 'gradient' || figures);
  $('grad-shape-row').hidden = tool !== 'gradient';
  $('grad-repeat-row').hidden = tool !== 'gradient';
  $('grad-dither-row').hidden = tool !== 'gradient';
  $('grad-manga-row').hidden = tool !== 'gradient';
  $('grad-manga-opts').hidden = tool !== 'gradient' || !input('grad-manga').checked;
  $('grad-manga-lpi-v').textContent = input('grad-manga-lpi').value;
  $('grad-manga-angle-v').textContent = input('grad-manga-angle').value;
  $('pick-size-row').hidden = tool !== 'pick';
  $('fig-fill-row').hidden = !(tool === 'figrect' || tool === 'figellipse' || tool === 'figpolygon');
  $('fig-size-row').hidden = !figures;
  show('sec-liquify', tool === 'liquify');
  const onVector = l.kind === 'vector' && (tool === 'brush' || tool === 'erase');
  show('sec-vector', isVectorTool(tool) || onVector);
  $('vec-strength-row').hidden = !(tool === 'vsimplify' || (tool === 'brush' && onVector));
  $('vec-reach-row').hidden = tool !== 'vpinch' && tool !== 'vwidth';
  $('vec-thick-row').hidden = tool !== 'vwidth';
  $('vec-strength-v').textContent = input('vec-strength').value;
  $('vec-reach-v').textContent = input('vec-reach').value;
  $('vec-hint').textContent =
    tool === 'vcontrol' ? 'Toca una línea para ver sus puntos de control y arrastra uno para curvarla.'
    : tool === 'vpinch' ? 'Arrastra sobre las líneas para acercar sus puntos al puntero.'
    : tool === 'vsimplify' ? 'Toca o arrastra sobre las líneas para suavizarlas y quitarles puntos.'
    : tool === 'vwidth' ? 'Arrastra sobre una línea para engrosarla o afinarla en ese tramo.'
    : tool === 'erase' ? 'El borrador quita las líneas enteras que toca.'
    : 'Al soltar, la línea se alisa y se le quitan puntos sobrantes. 0 la deja tal como se trazó.';
  show('sec-ruler', isRulerTool(tool));
  $('ruler-persp-row').hidden = tool !== 'rulerpersp';
  $('ruler-fig-row').hidden = tool !== 'rulerfigure';
  const special = tool === 'rulerspecial';
  $('ruler-special-row').hidden = !special;
  $('ruler-count-row').hidden = !special;
  $('ruler-gap-row').hidden = !special || select('ruler-special').value === 'radial';
  $('ruler-hint').textContent =
    tool === 'rulercurve' ? 'Dibuja la curva a mano alzada; se alisa al soltar.'
    : tool === 'rulerpen' ? 'Marca los puntos con clics; Intro o doble clic termina, Esc cancela.'
    : tool === 'rulerpersp' ? 'Marca los puntos de fuga con clics. Con 2 puntos la vertical sale sola, perpendicular al horizonte.'
    : tool === 'rulerfigure' ? 'Arrastra de esquina a esquina.'
    : special ? 'Arrastra: paralelas = línea base; radiales = centro y primera dirección; concéntricos = centro.'
    : 'Arrastra para crear. Alt + clic cerca de una regla la borra.';
  $('shape-title').textContent = tool === 'gradient' ? 'Degradado' : 'Figura';
  show('sec-select', isSelectionTool(tool) || fills);
  $('sel-wand').hidden = tool !== 'wand' && !fills && tool !== 'selmagnet';
  $('sel-grow-row').hidden = !fills;
  $('sel-aa-row').hidden = !fills;
  $('sel-gap-row').hidden = tool !== 'fill' && tool !== 'wand';
  $('sel-contig-row').hidden = tool !== 'fill' && tool !== 'wand';
  $('sel-mode-row').hidden = fills;
  $('sel-title').textContent = fills ? 'Relleno' : 'Selección';
  show('sec-panel', tool === 'panel' || tool === 'split' || selected?.kind === 'panel');
  const sp = selectedPanel();
  const panel = sp?.layer.panels?.find((x) => x.id === sp.id);
  if (panel) {
    input('pn-border').value = String(panel.border);
    $('pn-border-v').textContent = `${panel.border}px`;
  }
  const sb = selectedBalloon();
  show('sec-balloon', !!sb || tool === 'balloon' || tool === 'text');
  if (sb) {
    const b = sb.balloon;
    if (document.activeElement !== $('bp-text')) $<HTMLTextAreaElement>('bp-text').value = b.text;
    select('bp-shape').value = b.shape;
    select('bp-font').value = b.fontFamily;
    input('bp-size').value = String(b.fontSize);
    $('bp-size-v').textContent = String(b.fontSize);
    input('bp-border').value = String(b.border);
    $('bp-border-v').textContent = String(b.border);
    input('bp-vertical').checked = b.vertical;
    input('bp-tail').checked = !!b.tail;
    select('bp-tail-style').value = b.tailStyle ?? 'speech';
  }
}

blendSel.addEventListener('change', () => {
  const targets = layersUi.targets();
  layerEdit('Modo de mezcla', () => targets.forEach((l) => (l.blend = blendSel.value as BlendMode)));
});
// The opacity slider changes the page while it moves and becomes one history step when it is released.
let opacityStart: ReturnType<typeof captureStructure> | null = null;
input('lopacity').addEventListener('input', (e) => {
  opacityStart ??= captureStructure(doc);
  for (const l of layersUi.targets()) l.opacity = Number((e.target as HTMLInputElement).value) / 100;
  $('lopacity-v').textContent = `${Math.round(activeLayer(doc).opacity * 100)}%`;
  render();
});
input('lopacity').addEventListener('change', () => {
  if (opacityStart) {
    const after = captureStructure(doc);
    if (!samePropsList(opacityStart.props, after.props)) history.push(structureCommand(doc, 'Opacidad de capa', opacityStart, after));
  }
  opacityStart = null;
  refreshUi();
});
input('clip').addEventListener('change', (e) => {
  const on = (e.target as HTMLInputElement).checked;
  const targets = layersUi.targets();
  layerEdit('Ajustar a capa inferior', () => targets.forEach((l) => (l.clip = on)));
});
input('lock-alpha').addEventListener('change', (e) => {
  const on = (e.target as HTMLInputElement).checked;
  const targets = layersUi.targets();
  layerEdit('Bloquear transparencia', () => targets.forEach((l) => (l.lockAlpha = on)), false);
});
$('lock-layer').addEventListener('click', () => commands.run('layerlocklayer'));
$('ren-layer').addEventListener('click', () => void renameLayer(activeLayer(doc)));
$('add-layer').addEventListener('click', () => layerEdit('Nueva capa', () => void layersUi.addLayerAbove(`Capa ${doc.nextId}`), false));
$('add-folder').addEventListener('click', () => layersUi.addFolder());
$('role-draft').addEventListener('click', () => commands.run('layerchangedraftlayer'));
$('role-ref').addEventListener('click', () => commands.run('layerchangereferlayer'));
$('mask-btn').addEventListener('click', () => {
  const l = activeLayer(doc);
  if (!l.mask) {
    commands.run(selUi.hasSelection() ? 'layeroutmask' : 'layershowallmask');
    return;
  }
  layersUi.setEditingMask(!layersUi.editingMask);
  refreshUi();
});
$('del-layer').addEventListener('click', () => {
  if (doc.layers.length <= 1) return;
  selected = null;
  layersUi.deleteTargets();
  drawOverlay();
});
$('up-layer').addEventListener('click', () => layersUi.moveTargets(1));
$('down-layer').addEventListener('click', () => layersUi.moveTargets(-1));
$('dup-layer').addEventListener('click', () => layersUi.duplicateTargets());
/**
 * Merge down every target that can (the active layer when none is ticked): each ticked layer goes onto the one below
 * it, from the top down, so ticked neighbours end up as one. A layer that cannot merge keeps its own limits and is skipped.
 */
function mergeTargets(): Command | null {
  const steps: Command[] = [];
  for (const l of [...layersUi.targets()].sort((a, b) => doc.layers.indexOf(b) - doc.layers.indexOf(a))) {
    if (!doc.layers.includes(l)) continue; // already absorbed by an earlier step
    const cmd = l.kind === 'folder' ? flattenFolder(doc, l.id) : mergeLayerDown(doc, l.id);
    if (cmd) steps.push(cmd);
  }
  return combineCommands(steps.length > 1 ? 'Fusionar capas' : steps[0]?.label ?? 'Fusionar capa', steps);
}
const canMergeTargets = (): boolean => layersUi.targets().some((l) => canMergeDown(doc, l.id) || canFlattenFolder(doc, l.id));
$('merge-layer').addEventListener('click', () => {
  endEdit();
  const cmd = mergeTargets();
  if (!cmd) return;
  history.push(cmd);
  selected = null;
  render();
  refreshUi();
  drawOverlay();
});

// ---- adaptive layout: panels become drawers on small screens -------------------
function closeDrawers(): void {
  document.body.classList.remove('show-tools', 'show-layers');
}
for (const [btn, cls, other] of [
  ['toggle-tools', 'show-tools', 'show-layers'],
  ['toggle-layers', 'show-layers', 'show-tools'],
] as const) {
  $(btn).addEventListener('click', () => {
    document.body.classList.remove(other);
    document.body.classList.toggle(cls);
  });
}
input('predict').addEventListener('change', (e) => {
  predict = (e.target as HTMLInputElement).checked;
  drawOverlay();
});
input('finger-draws').addEventListener('change', (e) => {
  fingerDraws = (e.target as HTMLInputElement).checked;
});


// ---- live profiler panel ----------------------------------------------------------
const perfPanel = $('perf');
const perfText = $('perf-text');
let perfTimer = 0;
function setProfiling(on: boolean): void {
  perfPanel.hidden = !on;
  renderer.syncProfile = on;
  if (on) {
    profiler.start();
    perfTimer = window.setInterval(() => (perfText.textContent = profiler.summary()), 500);
  } else {
    profiler.stop();
    clearInterval(perfTimer);
  }
}
$('perf-reset').addEventListener('click', () => profiler.reset());
$('perf-close').addEventListener('click', () => setProfiling(false));
$('perf-copy').addEventListener('click', () => void navigator.clipboard?.writeText(profiler.summary()));

// ---- tool / sub tool palettes -----------------------------------------------------------
function setSlider(id: string, value: number): void {
  const el = input(id);
  el.value = String(value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function applyPreset(p: BrushPreset): void {
  if (p.size !== undefined) setBrushSize(Math.max(1, Math.round(p.size * pageUnit())));
  if (p.hardness !== undefined) setSlider('hardness', Math.round(p.hardness * 100));
  if (p.opacity !== undefined) setSlider('opacity', Math.round(p.opacity * 100));
  if (p.stabilization !== undefined) setSlider('stab', Math.round(p.stabilization * 100));
  brush.behind = !!p.behind;
  setAntialias(p.antialias ?? DEFAULT_ANTIALIAS);
  setCorrection(DEFAULT_CORRECTION);
  brush.spacing = defaultBrush.spacing; // no preset sets it: a stamp spacing chosen for the last brush does not follow
  // Character of the brush: what a preset does not mention goes back to plain.
  brush.pressureGraph = p.pressureGraph;
  setSlider('pcurve', Math.round((p.pressureCurve ?? 1) * 100));
  setSlider('minsize', Math.round((p.minSize ?? 0) * 100));
  setSlider('taperin', Math.min(400, Math.round((p.taperIn ?? 0) * pageUnit())));
  setSlider('taperout', Math.min(400, Math.round((p.taperOut ?? 0) * pageUnit())));
  setSlider('grain', Math.round((p.grain ?? 0) * 100));
  setSlider('grainscale', Math.max(1, Math.round((p.grainScale ?? 6) * pageUnit())));
  if (p.pressureSize !== undefined) {
    const el = input('psize');
    el.checked = p.pressureSize;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  setSlider('popacity', Math.round((p.pressureOpacity ?? 0) * 100));
  setSlider('nibthick', Math.round((p.nibThickness ?? 1) * 100));
  setSlider('nibangle', Math.round(p.nibAngle ?? 0));
  setSlider('flow', Math.round((p.flow ?? 1) * 100));
  setSlider('pflow', Math.round((p.pressureFlow ?? 0) * 100));
}
toolPalettes = mountToolPalettes({
  toolColumn: $('toolcol-tools'),
  groupTabs: $('subtool-groups'),
  subToolList: $('subtool-list'),
  onSelect: (binding, _tool, subId) => {
    // Preset first, then what the person changed on this sub tool before; both count as applied, not as edits.
    reapplySubTool = () =>
      asApplied(() => {
        appliedSub = null;
        applyOptionControls(binding, subId);
        if (!binding.preset) return;
        applyPreset(binding.preset);
        const unit = pageUnit();
        baseline = snapshotParams(brush, unit);
        appliedSub = subId;
        for (const [key, value] of Object.entries(shownParams(overrides[subId] ?? {}, unit))) setBrushParam(key, value, false);
      });
    reapplySubTool();
    refreshResetButton();
    if (binding.pick) pickMode = binding.pick;
    referenceOnly = !!binding.wandReference;
    if (binding.gradientId) {
      gradientId = binding.gradientId;
      // A manga gradient brings its screen: the manga controls take its values, and go back off when a plain gradient is chosen.
      const screen = presetStops(gradientId, [0, 0, 0], [255, 255, 255]).halftone;
      if (screen) {
        input('grad-manga').checked = true;
        select('grad-manga-shape').value = screen.shape;
        input('grad-manga-lpi').value = String(screen.lpi);
        input('grad-manga-angle').value = String(screen.angle);
        mangaFromPreset = true;
      } else if (mangaFromPreset) {
        input('grad-manga').checked = false;
        mangaFromPreset = false;
      }
      refreshUi();
    }
    if (binding.tool === 'balloon') {
      balloonMode = { shape: binding.balloonShape ?? 'ellipse', draw: binding.balloonDraw ?? 'box', tailStyle: binding.tailStyle ?? 'speech' };
    }
    setTool(binding.tool);
  },
});
toolPalettes.select('pen');
document.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => (el.innerHTML = icon(el.dataset.icon!, 14)));

// ---- commands: menu bar, command bar and keyboard shortcuts ------------------------------
function zoomAround(factor: number): void {
  const r = stage.getBoundingClientRect();
  zoomAtClient(r.left + r.width / 2, r.top + r.height / 2, factor);
}
function zoomAtClient(clientX: number, clientY: number, factor: number): void {
  const r = stage.getBoundingClientRect();
  const { x: mx, y: my } = screenToPlane(view, { w: r.width, h: r.height }, clientX - r.left, clientY - r.top);
  const next = Math.min(16, Math.max(0.02, view.scale * factor));
  view.x = mx - ((mx - view.x) * next) / view.scale;
  view.y = my - ((my - view.y) * next) / view.scale;
  view.scale = next;
  userView = true;
  applyView();
}
function zoomTo(scale: number): void {
  zoomAround(scale / view.scale);
}
const click = (id: string): (() => void) => () => $(id).click();
/** Switch a flag on every target layer (the ticked ones, or the active layer): all on when any is off, otherwise all off. */
const toggleTargets = (get: (l: Layer) => boolean, set: (l: Layer, on: boolean) => void): (() => void) => () => {
  const ls = layersUi.targets();
  const on = !ls.every(get);
  for (const l of ls) set(l, on);
  render();
  refreshUi();
};

commands.register('undo', { run: () => undoRedo(false), enabled: () => history.canUndo });
commands.register('redo', { run: () => undoRedo(true), enabled: () => history.canRedo });
commands.register('filenew', () => newDocumentFlow());
commands.register('fileopen', () => void openFlow());
commands.register('fileclose', () => void closeTab(activeSessionId));
commands.register('filesave', () => void saveFlow.save());
commands.register('filesaveas', () => void saveFlow.saveAs());
commands.register('filerevert', { run: () => void revertFlow(), enabled: () => docFile !== null });
// "Guardar copia": another document with layers, the open one untouched.
const COPIES: Record<string, SaveFormat> = {
  filesaveasproj: 'lienzo', filesaveasclip: 'clip', filesaveaspsd: 'psd', filesaveaspsb: 'psb', filesaveasora: 'ora',
};
for (const [id, format] of Object.entries(COPIES)) {
  commands.register(id, { run: () => void saveFlow.saveCopy(format), enabled: format === 'clip' ? () => canWriteClip(doc) : undefined });
}
// "Exportar imagen": the merged page as a picture (a PSD there has a single layer).
const EXPORTS: Record<string, SaveFormat> = {
  filesavemergeimagepng: 'png', filesavemergeimagejpg: 'jpg', filesavemergeimagewebp: 'webp', filesavemergeimagebmp: 'bmp',
  filesavemergeimagetga: 'tga', filesavemergeimagetif: 'tif', filesavemergeimagepsd: 'psd',
};
for (const [id, format] of Object.entries(EXPORTS)) commands.register(id, () => void saveFlow.exportImage(format));
layersUi.register();
commands.register('layernew', click('add-layer'));
commands.register('layerrasternew', click('add-layer'));
commands.register('layerdelete', { run: click('del-layer'), enabled: () => doc.layers.length > 1 });
commands.register('layercopy', click('dup-layer'));
for (const id of ['transformstretch', 'transformstretchonly', 'transformrotateonly', 'transformfree']) {
  commands.register(id, { run: () => void transformUi.start(), enabled: () => transformUi.canTransform() && !transformUi.active });
}
const WARP_COMMANDS: Record<string, TransformMode> = { transformtrapezoid: 'distort', transformparallelogram: 'skew', transformisopodtrapezoid: 'perspective', transformmesh: 'mesh' };
for (const [id, mode] of Object.entries(WARP_COMMANDS)) commands.register(id, { run: () => void transformUi.start(mode), enabled: () => transformUi.canTransform() });
commands.register('transformfix', { run: () => transformUi.fix(), enabled: () => transformUi.active });
commands.register('transformcancel', { run: () => transformUi.cancel(), enabled: () => transformUi.active });
commands.register('transformreversehorz', { run: () => void transformUi.quick('flipx'), enabled: () => transformUi.canTransform() && !transformUi.active });
commands.register('transformreversevert', { run: () => void transformUi.quick('flipy'), enabled: () => transformUi.canTransform() && !transformUi.active });
commands.register('editswapcolors', swapColors);
commands.register('layermergelowerlayer', { run: click('merge-layer'), enabled: () => layersUi.targets().some((l) => canMergeDown(doc, l.id)) });
commands.register('layerchangename', click('ren-layer'));
commands.register('layerorderup', click('up-layer'));
commands.register('layerorderdown', click('down-layer'));
commands.register('layerchangebelowclip', {
  run: toggleTargets((l) => l.clip, (l, on) => (l.clip = on)),
  checked: () => activeLayer(doc).clip,
});
commands.register('layerlockalpha', {
  run: () => {
    const targets = layersUi.targets();
    const on = !targets.every((l) => l.lockAlpha);
    layerEdit('Bloquear transparencia', () => targets.forEach((l) => (l.lockAlpha = on)), false);
  },
  checked: () => activeLayer(doc).lockAlpha,
});
commands.register('layerrasterize', {
  run: () => {
    endEdit();
    const steps: Command[] = [];
    for (const l of layersUi.targets()) {
      if (!canRasterize(l)) continue;
      refreshLayer(l); // the pixels must be the latest drawing of the objects before they become plain pixels
      const step = rasterizeLayer(l);
      if (step) steps.push(step);
    }
    const cmd = combineCommands('Rasterizar capa', steps);
    if (!cmd) return;
    selected = null;
    history.push(cmd);
    render();
    refreshUi();
    drawOverlay();
  },
  enabled: () => layersUi.targets().some(canRasterize),
});
commands.register('layerlocklayer', {
  run: () => layersUi.toggleLockTargets(),
  checked: () => activeLayer(doc).locked,
});
commands.register('layervisiblelayer', {
  run: toggleTargets((l) => l.visible, (l, on) => (l.visible = on)),
  checked: () => activeLayer(doc).visible,
});
const pixelSel = (): boolean => selUi.hasSelection() && (layersUi.editingMask || selUi.canEditPixels());
commands.register('clear', {
  run: deleteSelected,
  enabled: () => !!selectedBalloon() || !!selectedPanel() || pixelSel(),
});
commands.register('editclearoutofselectarea', {
  run: () => {
    const sel = selUi.current;
    if (layersUi.editingMask && sel) {
      const out = sel.clone();
      out.invert();
      maskFillWith(out, 0);
    } else void selUi.eraseOutsideSelection();
  },
  enabled: pixelSel,
});
commands.register('editpaint', {
  run: () => {
    // On a mask the main colour's lightness decides: light shows the selection, dark hides it.
    if (maskFill(brush.color[0] * 0.3 + brush.color[1] * 0.59 + brush.color[2] * 0.11 >= 128 ? 255 : 0)) return;
    void selUi.fillSelected();
  },
  enabled: pixelSel,
});
// ---- copy, cut and paste of pixels (the clipboard lives inside the app) ------------------------
let clipboard: Clip | null = null;
/** Whole layers (folders with their members) copied from the palette; shared by every tab like the pixel clipboard. */
let layerClip: LayerClip | null = null;
const readable = (): boolean => ['raster', 'tone', 'paper'].includes(activeLayer(doc).kind);
/** The layers to copy as layers: several ticked, or any folder, or a layer whose pixels alone are not the layer. Null: copy pixels. */
function wholeLayerIds(): number[] | null {
  const ls = layersUi.targets();
  const whole = ls.length > 1 || ls.some((l) => l.kind === 'folder' || !['raster', 'tone', 'paper'].includes(l.kind));
  return whole ? ls.map((l) => l.id) : null;
}
function copyLayersCmd(ids: number[]): boolean {
  const clip = copyLayers(doc, ids);
  if (!clip) {
    setStatus('No hay nada que copiar.');
    return false;
  }
  layerClip = clip;
  clipboard = null;
  commands.notify();
  setStatus(clip.layers.length > 1 ? `Copiadas ${clip.layers.length} capas` : 'Copiada 1 capa');
  return true;
}
function copyCmd(): boolean {
  const ids = wholeLayerIds();
  return ids ? copyLayersCmd(ids) : copyPixelsCmd();
}
function pasteLayersCmd(clip: LayerClip): void {
  if (transformUi.active) transformUi.fix();
  let outside = false;
  layerEdit('Pegar capas', () => {
    const made = pasteLayers(doc, clip);
    for (const l of made) if (l.kind === 'tone' || l.kind === 'panels' || l.kind === 'balloons') refreshLayer(l);
    layersUi.tickOnly(made.map((l) => l.id)); // everything pasted (folders and members) is the new selection
    outside = made.some((l) => l.overflow);
  });
  // As in Clip Studio, what falls beyond the page stays in the layer; Transformar brings it back.
  if (outside) setStatus('Parte queda fuera del lienzo. Con Transformar puedes moverla o reducirla.');
}
function copyPixelsCmd(): boolean {
  const layer = activeLayer(doc);
  const clip = copyPixels(layer.surface, selUi.current);
  if (!clip) {
    setStatus('No hay nada que copiar en esta capa.');
    return false;
  }
  clipboard = clip;
  layerClip = null;
  commands.notify();
  setStatus(`Copiado: ${clip.rect.w} × ${clip.rect.h} px`);
  return true;
}
function cutPixelsCmd(): void {
  if (!selUi.canEditPixels()) return;
  if (!copyPixelsCmd()) return;
  if (selUi.hasSelection()) {
    void selUi.eraseSelected();
    return;
  }
  const layer = activeLayer(doc);
  const patch = eraseSelection(paintTarget(layer).surface, layer.id, PixelSelection.rect(doc.width, doc.height, fullRect()));
  if (!patch) return;
  history.push(patchCommand(doc, patch, 'Cortar'));
  refreshLayer(layer, patch.rect);
  render(patch.rect);
  refreshUi();
}
/** Put pixels on a new layer above the active one (moved by dx, dy) and start moving them. */
function placeClip(clip: Clip, dx: number, dy: number, label: string, name: string): void {
  if (transformUi.active) transformUi.fix();
  layerEdit(label, () => {
    const layer = layersUi.addLayerAbove(name);
    pasteClip(layer.surface, clip, dx, dy);
    layer.surface.markAllDirty();
  });
  if (selUi.hasSelection()) selUi.deselect(); // the new pixels are moved as a whole
  void transformUi.start('free', activeLayer(doc)); // so they can be placed right away (only the new layer, whatever is ticked)
}

function pasteCmd(atView: boolean): void {
  if (layerClip) return void pasteLayersCmd(layerClip);
  const clip = clipboard;
  if (!clip) return;
  let dx = 0;
  let dy = 0;
  if (atView) {
    const r = stage.getBoundingClientRect();
    const mid = screenToDoc(view, { w: r.width, h: r.height }, r.width / 2, r.height / 2);
    dx = mid.x - (clip.rect.x + clip.rect.w / 2);
    dy = mid.y - (clip.rect.y + clip.rect.h / 2);
  }
  placeClip(clip, dx, dy, 'Pegar', 'Pegado');
}

// ---- import a picture as a new layer ---------------------------------------------------------
/** Decode any picture file to straight RGBA pixels: own decoders for what a browser cannot read. */
async function decodeImageFile(file: File): Promise<RawImage> {
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  const format = sniffImage(head, file.name);
  switch (format) {
    case 'tga':
      return decodeTga(new Uint8Array(await file.arrayBuffer()));
    case 'tiff':
      return decodeTiff(new Uint8Array(await file.arrayBuffer()));
    case 'pnm':
      return decodePnm(new Uint8Array(await file.arrayBuffer()));
    case 'qoi':
      return decodeQoi(new Uint8Array(await file.arrayBuffer()));
    case 'pcx':
      return decodePcx(new Uint8Array(await file.arrayBuffer()));
    case 'psd': {
      const { value } = importPsd(await file.arrayBuffer());
      return { width: value.width, height: value.height, data: flatten(value) };
    }
    case 'unknown':
      if (await isLienzo(file)) {
        const d = await loadLienzo(file);
        return { width: d.width, height: d.height, data: flatten(d) };
      }
      // Layered files the picker accepts: they come in as one flattened layer, like a PSD or a .lienzo.
      if (looksLikeClip(head)) {
        const { value } = await importClip(new Uint8Array(await file.arrayBuffer()), pngCodecs);
        return { width: value.width, height: value.height, data: flatten(value) };
      }
      if (looksLikeOra(head)) {
        const { value } = await importOra(new Uint8Array(await file.arrayBuffer()), pngCodecs);
        return { width: value.width, height: value.height, data: flatten(value) };
      }
      throw new Error(`«${file.name}» no es un formato de imagen conocido.`);
    case 'svg':
      return drawable(await svgImage(file));
    default:
      try {
        return drawable(await createImageBitmap(file));
      } catch {
        throw new Error(`No se pudo leer «${file.name}»: el archivo está dañado o su formato no es compatible.`);
      }
  }
}

async function svgImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error(`No se pudo leer «${file.name}»: el SVG no es válido.`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Read the pixels of something the browser can draw (an SVG without a size gets 1024 px wide). */
function drawable(src: ImageBitmap | HTMLImageElement): RawImage {
  const sw = src instanceof HTMLImageElement ? src.naturalWidth || 1024 : src.width;
  const sh = src instanceof HTMLImageElement ? src.naturalHeight || Math.round(sw * 0.75) : src.height;
  if (sw * sh > DECODE_PIXEL_LIMIT) throw new Error('La imagen es demasiado grande para importarla.');
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(src, 0, 0, sw, sh);
  if (src instanceof ImageBitmap) src.close();
  return { width: sw, height: sh, data: g.getImageData(0, 0, sw, sh).data };
}

/** A picture bigger than the page is brought down to fit it; a smaller one keeps its size. */
function fitToPage(img: RawImage): RawImage {
  const k = Math.min(1, doc.width / img.width, doc.height / img.height);
  if (k === 1) return img;
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const from = document.createElement('canvas');
  from.width = img.width;
  from.height = img.height;
  from.getContext('2d')!.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  const to = document.createElement('canvas');
  to.width = w;
  to.height = h;
  const g = to.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(from, 0, 0, w, h);
  return { width: w, height: h, data: g.getImageData(0, 0, w, h).data };
}

/**
 * Put picture files on one new layer each. `at` is the page point the pictures are centred on
 * (the middle of the page when absent); every file that fails is reported once, at the end.
 */
async function importImageFiles(files: readonly File[], at?: { x: number; y: number }): Promise<void> {
  if (workspaceEmpty) {
    // With no document open a picture becomes the document, not a layer of one.
    for (const file of files) await openBlob(file, file.name, null);
    return;
  }
  const failures: string[] = [];
  let placed = 0;
  // Each picture is its own step, so stopping leaves the ones already placed whole; a single picture has nothing to stop.
  const op = notify.busy(files.length > 1 ? 'Importando imágenes…' : 'Importando imagen…', { cancelable: files.length > 1 });
  let stopped = false;
  try {
    for (const [i, file] of files.entries()) {
      if (op.signal.aborted) {
        stopped = true;
        break;
      }
      op.progress(i / files.length, `${i + 1} de ${files.length}`);
      try {
        const img = fitToPage(await decodeImageFile(file));
        const cx = at?.x ?? doc.width / 2;
        const cy = at?.y ?? doc.height / 2;
        const rect = { x: Math.round(cx - img.width / 2), y: Math.round(cy - img.height / 2), w: img.width, h: img.height };
        placeClip({ rect, pixels: img.data }, 0, 0, 'Importar imagen', file.name.replace(/\.[^.]+$/, '') || 'Imagen');
        placed++;
        // Each picture is applied before the next arrives, so the last one stays ready to move.
        if (placed < files.length && transformUi.active) transformUi.fix();
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err));
      }
    }
  } finally {
    // The notice ends with the work, whatever happened: left open it would spin for ever over a picture already placed.
    if (stopped) op.done('info', 'Importación detenida', { detail: `Se colocaron ${placed} de ${files.length}.` });
    else op.done();
  }
  if (failures.length) void alertDialog(failures.join('\n'), 'No se pudo importar la imagen');
}

const imageInput = document.createElement('input');
imageInput.type = 'file';
imageInput.accept = IMAGE_ACCEPT;
imageInput.multiple = true;
imageInput.hidden = true;
document.body.append(imageInput);
imageInput.addEventListener('change', () => {
  const files = [...(imageInput.files ?? [])];
  imageInput.value = '';
  if (files.length) void importImageFiles(files);
});
commands.register('fileimportimage', () => imageInput.click());

// ---- drag pictures onto the page ---------------------------------------------------------------
const dropHint = document.createElement('div');
dropHint.id = 'drop-hint';
dropHint.hidden = true;
dropHint.textContent = 'Suelta las imágenes para ponerlas en capas nuevas';
document.body.append(dropHint);
let dragDepth = 0;
const carriesFiles = (e: DragEvent): boolean => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!carriesFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  dropHint.hidden = false;
});
window.addEventListener('dragover', (e) => {
  if (!carriesFiles(e)) return;
  e.preventDefault(); // without this the browser would open the file instead of dropping it
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (e) => {
  if (!carriesFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropHint.hidden = true;
});
window.addEventListener('drop', (e) => {
  if (!carriesFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropHint.hidden = true;
  const files = [...(e.dataTransfer?.files ?? [])];
  if (!files.length) return;
  // Dropped on the canvas the pictures centre where they were let go; elsewhere on the page's middle.
  const r = stage.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  const at = inside ? screenToDoc(view, { w: r.width, h: r.height }, e.clientX - r.left, e.clientY - r.top) : undefined;
  void importImageFiles(files, at);
});
commands.register('copy', { run: () => void copyCmd(), enabled: () => wholeLayerIds() !== null || readable() });
commands.register('cut', { run: cutPixelsCmd, enabled: () => selUi.canEditPixels() });
commands.register('paste', { run: () => pasteCmd(false), enabled: () => clipboard !== null || layerClip !== null });
commands.register('editpasteatshownposition', { run: () => pasteCmd(true), enabled: () => clipboard !== null || layerClip !== null });
commands.register('pagechangecanvassizetoselectarea', {
  run: () => {
    const b = selUi.current?.bounds();
    if (b) pageEdit({ kind: 'crop', rect: b }, 'Recortar el lienzo a la selección');
  },
  enabled: () => selUi.hasSelection(),
});
commands.register('pagerotatecanvasclockwise90', () => void pageEdit({ kind: 'rotate', turns: 1 }, 'Girar el lienzo 90° a la derecha'));
commands.register('pagerotatecanvascounterclockwise90', () => void pageEdit({ kind: 'rotate', turns: 3 }, 'Girar el lienzo 90° a la izquierda'));
commands.register('pagerotatecanvas180', () => void pageEdit({ kind: 'rotate', turns: 2 }, 'Girar el lienzo 180°'));
commands.register('pagereversecanvashorizontal', () => void pageEdit({ kind: 'flip', axis: 'h' }, 'Voltear el lienzo horizontalmente'));
commands.register('pagereversecanvasvertical', () => void pageEdit({ kind: 'flip', axis: 'v' }, 'Voltear el lienzo verticalmente'));
// ---- filters ---------------------------------------------------------------------------------
const FILTER_COMMANDS: Record<string, string> = {
  filterinvert: 'invert',
  filterbrightnessandcontrast: 'brightness',
  filterhsv: 'hsv',
  filterposterize: 'posterize',
  filterposterizeeffect: 'posterize',
  filterlevel: 'levels',
  filtercolorbalance: 'balance',
  filterbinarization: 'binarize',
  filtergradientmap: 'gradientmap',
  editbrightnesstoalpha: 'brightnessalpha',
  filtergaussianblur: 'gaussian',
  filtermotionblur: 'motion',
  filtersharpen: 'sharpen',
  filterunsharpmask: 'sharpen',
  filterpixelate: 'pixelate',
  filtertonecurve: 'tonecurve',
  filterradialblur: 'radialblur',
  filterlensblur: 'lensblur',
  filtercrystallize: 'crystallize',
  filterglow: 'glow',
  filterdropshadow: 'dropshadow',
  filterwave: 'wave',
  filtercolormatch: 'colormatch',
};
for (const [command, id] of Object.entries(FILTER_COMMANDS)) {
  commands.register(command, {
    run: () => {
      if (transformUi.active) transformUi.fix();
      filtersUi.start(id);
    },
    enabled: () => !filtersUi.active && filtersUi.canStart(),
  });
}
commands.register('layervectornew', () => {
  if (transformUi.active) transformUi.fix();
  if (adjustUi.active) adjustUi.close(true);
  layerEdit('Nueva capa vectorial', () => {
    layersUi.addLayerAbove('Vectorial', 'vector');
  });
});
for (const id of ['vec-strength', 'vec-reach']) $(id).addEventListener('input', () => refreshUi());
// ---- adjustment layers (own design: a correction applied to everything below the layer) ----
const ADJUST_COMMANDS: Record<string, [string, string]> = {
  layeradjustmentbrightnessandcontrastnew: ['brightness', 'Brillo/contraste'],
  layeradjustmentposterizenew: ['posterize', 'Posterizar'],
  layeradjustmentinvertnew: ['invert', 'Invertir'],
  layeradjustmentlevelnew: ['levels', 'Niveles'],
  layeradjustmenttonecurvenew: ['tonecurve', 'Curva de tonos'],
  layeradjustmentcolorbalancenew: ['balance', 'Balance de color'],
  layeradjustmentbinarizationnew: ['binarize', 'Binarización'],
  layeradjustmentgradientmapnew: ['gradientmap', 'Mapa de degradado'],
};
for (const [command, [filter, name]] of Object.entries(ADJUST_COMMANDS)) {
  commands.register(command, () => {
    if (transformUi.active) transformUi.fix();
    if (filtersUi.active) filtersUi.cancel();
    if (adjustUi.active) adjustUi.close(true);
    let made: Layer | null = null;
    layerEdit(`Nueva capa de corrección: ${name}`, () => {
      made = layersUi.addLayerAbove(name, 'adjust');
      made.adjust = defaultAdjust(filter, { main: mainColor, sub: subColor });
    });
    if (made) adjustUi.open(made);
  });
}
commands.register('layeradjustmenthsvnew', () => setStatus('Tono/saturación/luminosidad no está disponible como capa de corrección: mezcla los canales y no cabe en una tabla. Úsalo como filtro (Filtro ▸ Tono/saturación).'));
commands.register('selectcolor', async () => {
  const v = await promptDialog('Seleccionar los píxeles parecidos al color principal. Tolerancia (0 a 255)', '32');
  const n = Number(v?.replace(',', '.'));
  if (v === null || !Number.isFinite(n)) return;
  selUi.selectColor(brush.color, Math.min(255, Math.max(0, Math.round(n))));
});
commands.register('editclearhistory', {
  run: async () => {
    if (!(await confirmDialog('Se olvidarán todos los pasos para deshacer. ¿Continuar?', 'Borrar historial'))) return;
    history = newHistory();
    refreshUi();
  },
  enabled: () => history.canUndo || history.canRedo,
});
select('ruler-special').addEventListener('change', () => refreshUi());
for (const id of ['grad-manga', 'grad-manga-shape', 'grad-manga-lpi', 'grad-manga-angle']) {
  $(id).addEventListener('input', () => {
    if (id === 'grad-manga') mangaFromPreset = false; // the person chose it now
    refreshUi();
  });
}
commands.register('layerdeleteruler', { run: () => rulersUi.clear(), enabled: () => rulersUi.any });
commands.register('selectall', () => selUi.selectAll());
commands.register('selectdeselect', { run: () => selUi.deselect(), enabled: () => selUi.hasSelection() });
commands.register('selectreselect', () => selUi.reselect());
commands.register('selectinvert', { run: () => selUi.invert(), enabled: () => selUi.hasSelection() });
commands.register('selectshow', { run: () => selUi.toggleOutline(), checked: () => selUi.outlineVisible() });
const askPixels = async (title: string, def: string): Promise<number | null> => {
  const v = await promptDialog(title, def);
  const n = Number(v?.replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= 500 ? Math.round(n) : null;
};
commands.register('selectexpand', {
  run: async () => {
    const n = await askPixels('Expandir la selección (píxeles)', '4');
    if (n) selUi.grow(n);
  },
  enabled: () => selUi.hasSelection(),
});
commands.register('selectreduce', {
  run: async () => {
    const n = await askPixels('Contraer la selección (píxeles)', '4');
    if (n) selUi.grow(-n);
  },
  enabled: () => selUi.hasSelection(),
});
commands.register('selectblur', {
  run: async () => {
    const n = await askPixels('Desenfocar el borde (píxeles)', '4');
    if (n) selUi.feather(n);
  },
  enabled: () => selUi.hasSelection(),
});
/** Change how the page is turned on screen, keeping what is at the middle of the stage in the middle. */
function turnView(change: () => void): void {
  const box = stageBox();
  const middle = screenToDoc(view, box, box.w / 2, box.h / 2);
  change();
  const ps = planeSize(view, box);
  view.x = ps.w / 2 - middle.x * view.scale;
  view.y = ps.h / 2 - middle.y * view.scale;
  userView = true;
  applyView();
}
const quarter = (n: number): 0 | 1 | 2 | 3 => ((((n % 4) + 4) % 4) as 0 | 1 | 2 | 3);
/**
 * Turn the page to `total` radians clockwise from upright. Whole quarter turns go to `rot`, so a page that is only
 * turned by quarters never needs the larger plane a free turn does; the rest goes to `tilt`.
 */
function setTurn(total: number): void {
  const q = Math.round(total / (Math.PI / 2));
  const rest = total - q * (Math.PI / 2);
  view.rot = quarter(q);
  view.tilt = Math.abs(rest) < 1e-6 ? undefined : rest;
}
const turnTo = (rot: 0 | 1 | 2 | 3): void =>
  turnView(() => {
    view.rot = rot;
    view.tilt = undefined;
  });
commands.register('viewrotate0', () => turnTo(0));
commands.register('viewrotate90', () => turnTo(1));
commands.register('viewrotate180', () => turnTo(2));
commands.register('viewrotate270', () => turnTo(3));
commands.register('viewrotateright', () => turnView(() => (view.rot = quarter(view.rot + 1))));
commands.register('viewrotateleft', () => turnView(() => (view.rot = quarter(view.rot - 1))));
// A mirror across the screen's vertical axis turns the quarter turns around and toggles the plane's own mirror.
commands.register('viewreversehorz', () =>
  turnView(() => {
    view.rot = quarter(-view.rot);
    view.tilt = view.tilt ? -view.tilt : undefined;
    view.flip = !view.flip;
  }),
);
commands.register('viewreversevert', () =>
  turnView(() => {
    view.rot = quarter(-view.rot + 2);
    view.tilt = view.tilt ? -view.tilt : undefined;
    view.flip = !view.flip;
  }),
);
commands.register('viewangleandreversereset', () =>
  turnView(() => {
    view.rot = 0;
    view.tilt = undefined;
    view.flip = false;
  }),
);
commands.register('viewzoomin', () => zoomAround(1.25));
commands.register('viewzoomout', () => zoomAround(0.8));
commands.register('viewpixelsize', () => zoomTo(1));
commands.register('view200percentsize', () => zoomTo(2));
for (const id of ['viewwholesize', 'viewfitting', 'viewreset']) commands.register(id, fitView);
commands.register('applicationpreference', {
  run: async () => {
    const edited = await openPreferences({ ...prefs }, memorySummary(memoryFigures(), processMemory.value));
    if (!edited) return;
    prefs = sanitizePrefs(edited);
    const saved = savePrefs(localStorage, prefs);
    // Every open document keeps its own history (the open one's parked entry may be stale, so it is listed too).
    const pruned = applyLimits([history, ...sessions.map((s) => s.history)], prefs.historySteps, prefs.undoMemoryMb * 1024 * 1024);
    applyUiScale(prefs.uiScale);
    // The toolbar checkbox is a per-session switch; the preference sets where it starts, so mirror it now too.
    fingerDraws = prefs.fingerDraws;
    input('finger-draws').checked = fingerDraws;
    canvas.style.cursor = cursorFor(tool);
    refreshUi();
    drawOverlay();
    const notice = [limitsNotice(pruned), saved ? null : 'No se pudieron guardar las preferencias: valdrán solo hasta cerrar la aplicación.'].filter(Boolean).join(' ');
    if (notice) setStatus(notice);
  },
});
commands.register('applicationshortcutsetting', () => void openShortcutSettings());
// Only when the person chooses it, and after asking: the program never goes looking for updates on its own.
commands.register('helpupdates', () =>
  checkForUpdates({
    available: updatesAvailable,
    version: async () => {
      const { version, build } = await buildDetails();
      return versionLabel(version, build);
    },
    find: findUpdate,
    window: openUpdatesWindow,
    beforeInstall: async () => {
      await autosave.flush();
      await flushSettings(); // the installer closes the app at once: the settings file must be up to date by then
    },
  }),
);
commands.register('pagechangecanvassize', () => {
  if (transformUi.active) transformUi.fix();
  if (filtersUi.active) filtersUi.cancel();
  endEdit();
  canvasResize.open();
  showWindow({ x: 0, y: 0, w: doc.width, h: doc.height });
});
commands.register('editcanvassetting', () => {
  canvasResize.close();
  openCanvasProps({ doc: () => doc, commit: canvasPropsEdit });
});
commands.register('pagechangeresolution', () => {
  canvasResize.close();
  openResolution({ doc: () => doc, commit: resolutionEdit });
});
commands.register('layerdetailsettings', () => {
  const l = activeLayer(doc);
  void openLayerSettings({ name: l.name, kind: KIND_NAME[l.kind], blend: l.blend, opacity: l.opacity, clip: l.clip, lockAlpha: l.lockAlpha });
});
commands.register('helpperformance', openDiagnostics);
commands.register('helpprofile', { run: () => setProfiling(perfPanel.hidden), checked: () => !perfPanel.hidden });
/** The kind of build (official or test) and the version, as the native side knows them; null in a browser. */
async function buildDetails(): Promise<{ version: string; build: BuildInfo | null }> {
  if (!updatesAvailable()) return { version: pageVersion(), build: null };
  const { invoke } = await import('@tauri-apps/api/core');
  const [version, build] = await Promise.all([currentVersion(), invoke<BuildInfo>('build_info').catch(() => null)]);
  return { version, build };
}
commands.register('applicationabout', async () => {
  const { version, build } = await buildDetails();
  await alertDialog(aboutLines(version, build).join('\n'), 'Acerca de Lienzo');
});

// Shortcuts shown in the menus (plus their aliases) work for every live command.
const collect = (items: MenuEntry[]): void => {
  for (const e of items) {
    if ('sep' in e) continue;
    if ('items' in e) collect(e.items);
    else if (e.shortcut) bindShortcuts(e.id, [e.shortcut, ...(SHORTCUT_ALIASES[e.id] ?? [])]);
  }
};
for (const m of MENUS) collect(m.items);

// ---- right dock: navigator, colour, history, information, layers -------------------------------
const processMemory = new ProcessMemoryProbe();
/** Memory figures kept apart by owner: this document's history, its pixel blocks, every open document, the process. */
function memoryFigures(): MemoryFigures {
  processMemory.poke();
  const here = documentPixels(doc);
  let openBytes = here.bytes;
  for (const s of sessions) if (s.id !== activeSessionId) openBytes += documentPixels(s.doc).bytes;
  return { historySteps: history.undoLabels().length, historyBytes: history.memory, documentBytes: here.bytes, documentTiles: here.tiles, openDocuments: sessions.length, openDocumentsBytes: openBytes, gpuTextures: renderer.textureCount };
}
const memoryInfo = (): [string, string][] => memoryRows(memoryFigures(), processMemory.value);
// Launcher strip: a button per palette of the right dock, lit while it is shown.
const stripButtons = new Map<string, HTMLButtonElement>();
for (const id of RIGHT_GROUPS.flat()) {
  const spec = PALETTE_SPECS[id];
  if (!spec) continue;
  const b = document.createElement('button');
  b.className = 'ps-btn';
  b.type = 'button';
  b.title = spec.title;
  b.setAttribute('aria-label', spec.title);
  b.innerHTML = icon(spec.icon, 15);
  b.addEventListener('click', () => studio?.dock.toggle(id));
  $('palette-strip').append(b);
  stripButtons.set(id, b);
}
const syncStrip = (): void => stripButtons.forEach((b, id) => b.classList.toggle('on', studio?.dock.isVisible(id) ?? false));
// Which palettes are shown is kept between runs (the strip buttons and the Window menu both change it).
commands.register('windowtouchlayout', { run: () => setTouchUi(!touchUi()), checked: () => touchUi() });
const savedShown = (() => {
  try {
    return loadShown(localStorage, new Set(RIGHT_GROUPS.flat()), new Set(LEFT_EXTRA_GROUPS.flat()));
  } catch {
    return null; // storage blocked altogether: the defaults
  }
})();
function persistShown(): void {
  if (!studio || !leftExtra) return;
  const shown = (ids: string[], dock: { isVisible(id: string): boolean }): string[] => ids.filter((id) => dock.isVisible(id));
  try {
    saveShown(localStorage, { right: shown(RIGHT_GROUPS.flat(), studio.dock), left: shown(LEFT_EXTRA_GROUPS.flat(), leftExtra) });
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
}
studio = mountRightDock(
  $('dock-right'),
  {
    navigator: {
      doc: () => doc,
      view: () => view,
      stageSize: () => {
        const r = stage.getBoundingClientRect();
        return { w: r.width, h: r.height };
      },
      setZoom: zoomTo,
      centerOn: (x, y) => {
        const ps = planeSize(view, stageBox());
        view.x = ps.w / 2 - x * view.scale;
        view.y = ps.h / 2 - y * view.scale;
        userView = true;
        applyView();
      },
      visibleOutline: () => visibleOutline(view, stageBox()),
      orientation: () => ({ rot: view.rot, flip: view.flip, tilt: view.tilt }),
      rotateTo: (degrees) =>
        turnView(() => {
          setTurn((degrees * Math.PI) / 180);
        }),
      flipHorizontal: () => commands.run('viewreversehorz'),
      resetOrientation: () => commands.run('viewangleandreversereset'),
      fit: fitView,
      actualSize: () => zoomTo(1),
    },
    color: {
      get: () => [brush.color[0], brush.color[1], brush.color[2]],
      set: setBrushColor,
      subscribe: (cb) => colorListeners.push(cb),
    },
    colorStores,
    history: {
      labels: () => ({ undo: history.undoLabels(), redo: history.redoLabels() }),
      jump: (delta) => {
        for (let i = 0; i < Math.abs(delta); i++) undoRedo(delta > 0);
      },
    },
    info: () => [
      ['Documento', `${doc.width} × ${doc.height} px`],
      ['Resolución', `${doc.dpi} ppp`],
      ['Capas', String(doc.layers.length)],
      ...memoryInfo(),
    ],
    comps: {
      list: () => doc.comps.map((c) => ({ id: c.id, name: c.name, current: compMatches(doc, c) })),
      add: () => {
        const cmd = recordComps(doc, 'Nueva composición de capa', () => void addComp(doc, `Composición ${doc.nextCompId}`));
        if (cmd) history.push(cmd);
        refreshUi();
      },
      update: (id) => {
        const cmd = recordComps(doc, 'Actualizar composición de capa', () => void updateComp(doc, id));
        if (cmd) history.push(cmd);
        refreshUi();
      },
      remove: (id) => {
        const cmd = recordComps(doc, 'Borrar composición de capa', () => void removeComp(doc, id));
        if (cmd) history.push(cmd);
        refreshUi();
      },
      apply: (id) => layerEdit('Aplicar composición de capa', () => void applyComp(doc, id)),
      rename: (id) => {
        const comp = doc.comps.find((c) => c.id === id);
        if (!comp) return;
        void promptDialog('Nombre de la composición', comp.name).then((name) => {
          if (name === null || !name.trim()) return;
          const cmd = recordComps(doc, 'Renombrar composición de capa', () => void renameComp(doc, id, name.trim()));
          if (cmd) history.push(cmd);
          refreshUi();
        });
      },
    },
    adopt: { layerorder: 'pal-layer', property: 'pal-layerprop' },
  },
  () => {
    commands.notify();
    syncStrip();
    persistShown();
  },
  savedShown?.right,
);
syncStrip();
for (const id of RIGHT_GROUPS.flat()) {
  const spec = PALETTE_SPECS[id];
  if (!spec?.command || commands.has(spec.command)) continue;
  commands.register(spec.command, {
    run: () => studio!.dock.toggle(id),
    checked: () => studio!.dock.isVisible(id),
  });
}
leftExtra = mountLeftExtraDock(
  $('dock-left-extra'),
  { size: () => brush.size, setSize: (px) => setBrushSize(px, true), detail: { tool: () => tool, settings: () => brush, set: (key, shown) => setBrushParam(key, shown), subTool: subToolState, restore: (key) => (key === undefined ? void askResetSubTool() : restoreSubTool(key)) } },
  () => {
    commands.notify();
    persistShown();
    syncDetailButton();
  },
  savedShown?.left,
);
for (const id of LEFT_EXTRA_GROUPS.flat()) {
  const spec = PALETTE_SPECS[id];
  if (!spec?.command || commands.has(spec.command)) continue;
  commands.register(spec.command, { run: () => leftExtra!.toggle(id), checked: () => leftExtra!.isVisible(id) });
}
// The gear in the sub tool palette's header opens the same detail palette as the Window menu.
const detailButton = $('subtool-detail-btn');
const syncDetailButton = (): void => {
  const on = leftExtra!.isVisible('tooldetail');
  detailButton.classList.toggle('on', on);
  detailButton.setAttribute('aria-pressed', String(on));
};
detailButton.addEventListener('click', () => {
  leftExtra!.toggle('tooldetail');
  syncDetailButton();
});
syncDetailButton();
statusBar = mountStatusBar($('doctabs'), $('statusbar'), {
  zoomIn: () => zoomAround(1.25),
  zoomOut: () => zoomAround(0.8),
  fit: fitView,
  newDocument: () => void newDocumentFlow(),
  selectTab: (id) => void switchTo(id),
  closeTab: (id) => void closeTab(id),
  toggleNotices: () => noticeView.toggleCenter(),
});
const noticeView = mountNoticeView(notify);
/** The bell shows how many notices were not read yet and is tinted by the worst one still on screen. */
const syncBell = (): void => statusBar?.setNotices(notify.unread(), notify.worst());
notify.subscribe(syncBell);
syncBell();
let pointerFrame = 0;
canvas.addEventListener('pointermove', (e) => {
  if (pointerFrame) return;
  pointerFrame = requestAnimationFrame(() => {
    pointerFrame = 0;
    const p = toDoc(e);
    statusBar?.setPointer(p.x, p.y);
  });
});
updateStatusBar();
// Right click (or long press with a pen button) on the canvas and on a layer.
// A long press of a pen or finger also raises "contextmenu" on Android; it must never interrupt drawing, so only a mouse opens it.
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
attachContextMenu(canvas, (e) =>
  (e as PointerEvent).pointerType && (e as PointerEvent).pointerType !== 'mouse'
    ? null
    : ['undo', 'redo', '-', 'clear', '-', 'viewzoomin', 'viewzoomout', 'viewfitting', 'viewpixelsize', '-', 'editcanvassetting'],
);
attachContextMenu(
  list,
  (e) => (e.target instanceof Element && e.target.closest('li') ? [
    'layerrasternew', 'layerfoldernew', 'layerfoldernewandinsert', 'layercopy', 'layerdelete', '-',
    'layervisiblelayer', 'layerlockalpha', 'layerchangebelowclip', 'layerchangedraftlayer', 'layerchangereferlayer', '-',
    'layeroutmask', 'layerinmask', 'layerapplymask', 'layerdeletemask', 'layervisiblemask', '-',
    'layerorderup', 'layerorderdown', '-', 'layerchangename', 'layerdetailsettings',
  ] : null),
  (e) => {
    const li = (e.target as Element).closest('li');
    if (li && !li.classList.contains('active')) (li as HTMLElement).click();
  },
);
rulers = mountRulers(stage, { view: () => view, onGuide: (axis, e) => guidesUi.startNew(axis, e) });
commands.register('viewsnapruler', { run: () => guidesUi.toggleSnapGuides(), checked: () => guidesUi.snapToGuides });
commands.register('viewsnapgrid', { run: () => guidesUi.toggleSnapGrid(), checked: () => guidesUi.snapToGrid });
commands.register('viewclearguides', { run: () => guidesUi.clear(), enabled: () => guidesUi.any });
commands.register('viewrulerbar', { run: () => rulers!.toggle(), checked: () => rulers!.isVisible() });
commands.register('viewgrid', {
  run: () => {
    showGrid = !showGrid;
    drawOverlay();
  },
  checked: () => showGrid,
});
// The command bar now lives above the canvas, so what the side docks must clear is just the title and menu rows.
const appbar = $('appbar');
const syncAppbarHeight = (): void => document.documentElement.style.setProperty('--appbar-h', `${Math.round(appbar.getBoundingClientRect().height)}px`);
new ResizeObserver(syncAppbarHeight).observe(appbar);
window.addEventListener('resize', syncAppbarHeight); // a new interface scale changes the bar's height on screen
syncAppbarHeight();
armStaticPalettes();
// Show or hide the tool, sub tool and tool property palettes from the Window menu (kept for the session and across restarts).
const HIDDEN_KEY = 'lienzo.palettes.hidden';
const hiddenTools = new Set<string>((() => {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
})());
const toolPaletteEls: Record<string, HTMLElement> = { tool: $('toolcol'), subtool: $('pal-subtool'), tooloption: $('pal-tooloption') };
const foldBtn = $('fold-subdock');
const foldToolsBtn = $('fold-toolcol');
const showToolsBtn = $('show-toolcol');
/** Whether the sub tool column was open when the whole dock was folded away, so showing it again restores that. */
let subdockWasOpen = false;
const applyToolPaletteVisibility = (): void => {
  for (const [id, el] of Object.entries(toolPaletteEls)) el.hidden = hiddenTools.has(id);
  const collapsed = hiddenTools.has('subtool') && hiddenTools.has('tooloption');
  $('subdock').hidden = collapsed;
  // With the sub tool column hidden the dock shrinks to the tool strip (the CSS sizes it), like the « » fold of the reference program.
  document.body.classList.toggle('subdock-collapsed', collapsed);
  document.body.classList.toggle('leftdock-empty', collapsed && hiddenTools.has('tool'));
  foldToolsBtn.innerHTML = icon('fold-left', 16);
  showToolsBtn.innerHTML = icon('fold-right', 16);
  foldBtn.innerHTML = icon(collapsed ? 'fold-right' : 'fold-left', 16);
  foldBtn.title = collapsed ? 'Mostrar subherramientas y propiedades' : 'Ocultar subherramientas y propiedades';
  foldBtn.setAttribute('aria-label', foldBtn.title);
  foldBtn.setAttribute('aria-pressed', String(collapsed));
};
// The palette column on the right folds to a thin strip, like the left one.
const RIGHT_KEY = 'lienzo.rightdock.collapsed';
const rightFold = $('fold-rightdock');
let rightCollapsed = (() => {
  try {
    return localStorage.getItem(RIGHT_KEY) === '1';
  } catch {
    return false;
  }
})();
let savedDockRight: string | null = null;
const applyRightDock = (): void => {
  const root = document.documentElement;
  if (rightCollapsed && !document.body.classList.contains('rightdock-collapsed')) {
    savedDockRight = root.style.getPropertyValue('--dock-right');
    document.body.classList.add('rightdock-collapsed');
    root.style.setProperty('--dock-right', '34px');
  } else if (!rightCollapsed && document.body.classList.contains('rightdock-collapsed')) {
    document.body.classList.remove('rightdock-collapsed');
    if (savedDockRight) root.style.setProperty('--dock-right', savedDockRight);
    else root.style.removeProperty('--dock-right');
  }
  rightFold.innerHTML = icon(rightCollapsed ? 'fold-left' : 'fold-right', 16);
  rightFold.title = rightCollapsed ? 'Mostrar las paletas' : 'Ocultar las paletas';
  rightFold.setAttribute('aria-label', rightFold.title);
  rightFold.setAttribute('aria-pressed', String(rightCollapsed));
  rightFold.hidden = false;
  window.setTimeout(() => resizeSurfaces(), 0);
};
rightFold.addEventListener('click', () => {
  rightCollapsed = !rightCollapsed;
  try {
    localStorage.setItem(RIGHT_KEY, rightCollapsed ? '1' : '0');
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
  applyRightDock();
});
applyRightDock();

const saveHiddenTools = (): void => {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hiddenTools]));
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
};
foldToolsBtn.addEventListener('click', () => {
  subdockWasOpen = !(hiddenTools.has('subtool') && hiddenTools.has('tooloption'));
  for (const id of ['tool', 'subtool', 'tooloption']) hiddenTools.add(id);
  saveHiddenTools();
  applyToolPaletteVisibility();
  commands.notify();
});
showToolsBtn.addEventListener('click', () => {
  hiddenTools.delete('tool');
  if (subdockWasOpen) for (const id of ['subtool', 'tooloption']) hiddenTools.delete(id);
  subdockWasOpen = false;
  saveHiddenTools();
  applyToolPaletteVisibility();
  commands.notify();
});
foldBtn.addEventListener('click', () => {
  const collapsed = hiddenTools.has('subtool') && hiddenTools.has('tooloption');
  for (const id of ['subtool', 'tooloption']) {
    if (collapsed) hiddenTools.delete(id);
    else hiddenTools.add(id);
  }
  saveHiddenTools();
  applyToolPaletteVisibility();
  commands.notify();
});
for (const id of Object.keys(toolPaletteEls)) {
  commands.register(PALETTE_SPECS[id]!.command, {
    run: () => {
      if (hiddenTools.has(id)) hiddenTools.delete(id);
      else hiddenTools.add(id);
      saveHiddenTools();
      applyToolPaletteVisibility();
    },
    checked: () => !hiddenTools.has(id),
  });
}
applyToolPaletteVisibility();
const timeline = mountTimeline($('timeline'));
timeline.onChange(() => {
  commands.notify();
  resizeSurfaces();
});
commands.register(PALETTE_SPECS.timeline!.command, { run: timeline.toggle, checked: timeline.isVisible });
document.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => (el.innerHTML = icon(el.dataset.icon!, 14)));

const menubar = mountMenuBar($('menubar'));
commands.register('applicationtilingmenu', () => menubar.openAll());
mountCommandBar($('commandbar'));
mountLayoutResizers();

// Debug hook for tests in the browser pane.
(window as unknown as { __lienzo: unknown }).__lienzo = {
  get doc() {
    return doc;
  },
  get selected() {
    return selected;
  },
  get requestExit() {
    return exitGuard.requestExit;
  },
  setTool,
  brush,
  setBrushSize,
  refreshUi,
  render,
  /** For measuring on a device (scripts/device-tests): saves the open document as a file would, and says how long it took. */
  async timeSave(withPreview = true): Promise<{ ms: number; bytes: number }> {
    const t0 = performance.now();
    const blob = await saveLienzo(doc, withPreview ? { preview: () => previewPng(doc) } : {});
    return { ms: Math.round(performance.now() - t0), bytes: blob.size };
  },
  applyView,
  resizeSurfaces,
  layersUi,
  filtersUi,
  renderer,
  view,
  transformUi,
  toDoc,
};

refreshUi();
// ---- autosave and recovery --------------------------------------------------------------------
const historySerial = new WeakMap<History, number>();
let serials = 0;
const serialOf = (h: History): number => {
  const known = historySerial.get(h);
  if (known !== undefined) return known;
  historySerial.set(h, ++serials);
  return serials;
};
const autosave = startAutosave({
  save: () => saveLienzo(doc),
  // Saving, renaming or saving elsewhere changes what the copy says (unsaved or not, which file), so they change the stamp too.
  stamp: () => `${serialOf(history)}:${history.revision}:${isDirty() ? 1 : 0}:${docName}:${docFile?.name ?? ''}`,
  busy: () => !!stroke || transformUi.active || selUi.dragging,
  // Every open document that is not a blank nobody touched keeps a copy, so that the next start can open the same tabs.
  keep: () => !workspaceEmpty && !isPristine(),
  dirty: () => isDirty(),
  key: () => autosaveKey,
  describe: () => ({ name: docName, file: docFile }),
  onError: (msg) => setStatus(`No se pudo autoguardar: ${msg}`),
  everyMs: () => (prefs.autosave ? prefs.autosaveMinutes * 60_000 : null),
});
void restoreSession();

// ---- leaving the program -----------------------------------------------------------------------------
// Whatever the way out (the window's close button, Android's back button, closing the page), changes that are in no file are asked
// about first, even though the autosave holds a copy.
const unsavedTabs = (): { id: number; title: string }[] =>
  sessions.flatMap((s) => (s.id === activeSessionId ? (isDirty() ? [{ id: s.id, title: docTitle }] : []) : sessionDirty(s) ? [{ id: s.id, title: s.title }] : []));
const exitGuard = createExitGuard({
  unsaved: () => unsavedTabs().map((t) => t.title),
  ask: (message, saveLabel) =>
    choiceDialog<'save' | 'discard' | 'cancel'>(
      message,
      [
        { label: saveLabel, value: 'save', primary: true },
        { label: 'Salir sin guardar', value: 'discard' },
        { label: 'Cancelar', value: 'cancel' },
      ],
      'cancel',
    ),
  saveAll: async () => {
    for (const { id } of unsavedTabs()) {
      await switchTo(id);
      if (activeSessionId !== id) return false;
      await saveFlow.save();
      if (isDirty()) return false; // the person cancelled the save or it failed (they were told)
    }
    return unsavedTabs().length === 0;
  },
  discard: async () => {
    const keys = unsavedTabs().map((t) => (t.id === activeSessionId ? autosaveKey : sessionOf(t.id)!.autosaveKey));
    for (const key of keys) autosave.forget(key);
    await Promise.all(keys.map((key) => removeAutosave(key).catch(() => undefined)));
  },
  quit: async () => {
    await flushSettings().catch(() => undefined);
    if (!isApp()) return; // a browser page is left by the person (the request only comes from beforeunload there)
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('quit_app');
  },
});
void installExitHooks(
  {
    requestExit: exitGuard.requestExit,
    hasUnsaved: () => unsavedTabs().length > 0,
    closeOverlay: () => {
      // a menu or a palette open on top: back closes it first (Escape is what closes them)
      const open = document.querySelector('.menu-panel');
      if (open) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return !!open;
    },
  },
  { app: isApp(), android: onAndroid() },
);

// Android writes a document over its file in place; a write that was cut (battery, force close) is finished now from the copy kept before it began.
if (isApp() && onAndroid()) {
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke<RecoveredWrite[]>('recover_interrupted_writes'))
    .then(async (list) => {
      if (!list.length) return;
      const names = new Map(await Promise.all(list.map(async (r) => [r.target, await displayName(r.target).catch(() => r.target)] as const)));
      const report = describeRecovery(list, (t) => names.get(t) ?? t);
      if (report.done) notify.info(report.done);
      if (report.failed) void alertDialog(report.failed, 'Un guardado quedó a medias');
    })
    .catch(() => undefined);
}
// Should finding out take far too long, the cover is not left in the way.
window.setTimeout(() => document.getElementById('boot')?.remove(), 15_000);

/**
 * Open a stored copy as a tab again, tied to its file when it has one. The copy keeps being written to the same entry.
 * A copy with unsaved changes comes back unsaved; "Guardar" then writes the recovered work to the file it belongs to.
 * A .clip cannot be written from a copy (it has lost the original it edits), so that one is tied to nothing; neither is
 * a copy whose file changed after it was made (`detach`): saving it would overwrite the newer file.
 * A copy that cannot be read is dropped only when it holds nothing the file lacks; one with unsaved changes stays
 * stored, since those changes exist nowhere else and the person is the one to discard them.
 */
async function reopenCopy(key: string, entry: StoredAutosave['entry'], detach = false): Promise<boolean> {
  try {
    const { file, format } = copyTie(entry, detach);
    await openDocument(await loadLienzo(entry.blob), entry.name ?? 'Recuperado', file, { recoveredKey: key, format });
    savedRevision = entry.unsaved === false ? history.revision : -1;
    updateStatusBar();
    return true;
  } catch (err) {
    await copyUnreadable(key, entry, err);
    return false;
  }
}

/** The file a stored copy is tied to when it comes back, and the format "Guardar" then writes (see `reopenCopy`). */
function copyTie(entry: StoredAutosave['entry'], detach: boolean): { file: FileRef | null; format: SaveFormat } {
  const recoveredAs = entry.file ? formatOfName(entry.file.name) : null;
  const file = !detach && entry.file && recoveredAs !== 'clip' && (recoveredAs === null || isLayered(recoveredAs)) ? entry.file : null;
  return { file, format: file ? (recoveredAs ?? 'lienzo') : 'lienzo' };
}

/** An unreadable copy must never stop the app from starting; it is dropped only when it holds nothing the file lacks. */
async function copyUnreadable(key: string, entry: StoredAutosave['entry'], err: unknown): Promise<void> {
  const unique = hasUnsavedChanges({ key, entry });
  if (!unique) await removeAutosave(key).catch(() => undefined);
  setStatus(
    `No se pudo recuperar «${entry.name ?? 'un documento'}»: ${err instanceof Error ? err.message : String(err)}` +
      (unique ? ' La copia sigue guardada; se te ofrecerá de nuevo al abrir Lienzo.' : ''),
  );
}

/**
 * Put back every tab at once. The copies are read side by side, and the tabs are made without being shown one after the
 * other: only the one that was showing is loaded into the editor, so the others do not each get their turn on the screen
 * (nor settle, save and fit the previous one) while the app starts.
 */
async function reopenCopies(copies: StoredAutosave[], showKey: string | null): Promise<void> {
  const read = await Promise.all(
    copies.map(async (s) => {
      try {
        return { s, doc: await loadLienzo(s.entry.blob) };
      } catch (err) {
        await copyUnreadable(s.key, s.entry, err);
        return null;
      }
    }),
  );
  const made: DocSession[] = [];
  for (const r of read) {
    if (!r) continue;
    const { key, entry } = r.s;
    const { file, format } = copyTie(entry, false);
    const name = entry.name ?? 'Recuperado';
    const h = newHistory();
    made.push({
      id: ++sessionSerial, doc: r.doc, history: h, name, title: file?.name ?? name, file, format, warned: new Set(), clipOk: false,
      saved: entry.unsaved === false ? h.revision : -1, autosaveKey: key, view: { ...view }, userView: false,
    });
  }
  if (!made.length) return;
  if (isPristine()) {
    // The blank document the app starts with gives way to the first tab, as it does when a file is opened.
    void removeAutosave(autosaveKey).catch(() => undefined);
    const at = sessions.findIndex((s) => s.id === activeSessionId);
    if (at >= 0) sessions.splice(at, 1);
  } else {
    await settleOpenDocument();
    parkActive();
  }
  sessions.push(...made);
  loadSession(made.find((s) => s.autosaveKey === showKey) ?? made[0]!);
  updateStatusBar();
}

/**
 * At start, put back what was open when the app was left: the same tabs in the same order with the same one showing,
 * or no document at all if none was open (and the welcome panel, not a blank canvas, in that case). A document whose
 * file was changed after its copy was made is not put back as a tab (saving it would overwrite the newer file): a
 * saved copy is dropped and the person told; one with unsaved changes is kept and offered, to open tied to no file.
 * Copies with unsaved changes that no tab owns are offered as before.
 */
async function restoreSession(): Promise<void> {
  try {
    const record = readSession();
    const stored = await trimAutosaves(await listAutosaves(), new Set(record?.tabs ?? []));
    const current: typeof stored = [];
    const behind: string[] = [];
    const diverged: StoredAutosave[] = [];
    for (const s of stored) {
      const verdict = judgeCopy(s, s.entry.file ? await modifiedAt(s.entry.file) : null);
      if (verdict === 'current') current.push(s);
      else if (verdict === 'diverged') diverged.push(s);
      else {
        await removeAutosave(s.key).catch(() => undefined);
        if (record?.tabs.includes(s.key)) behind.push(s.entry.name ?? s.entry.file?.name ?? 'un documento');
      }
    }
    const plan = planRestore(record, current);
    for (const s of plan.stale) await removeAutosave(s.key).catch(() => undefined);
    await reopenCopies(plan.open, plan.active);
    if (plan.emptyStart || (plan.open.length === 0 && isPristine())) {
      // The throwaway blank document the app starts with is not a tab.
      sessions.length = 0;
      activeSessionId = 0;
      setWorkspaceEmpty(true);
    }
    if (behind.length) setStatus(`${behind.map((n) => `«${n}»`).join(', ')} cambió fuera de Lienzo y no se reabrió. Ábrelo de nuevo desde el archivo.`);
    restoringSession = false;
    persistSession();
    document.getElementById('boot')?.remove();
    await offerRecovery([...diverged, ...plan.orphans], new Set(diverged.map((s) => s.key)));
  } catch (err) {
    setStatus(`No se pudo restaurar la sesión: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    restoringSession = false;
    persistSession();
    document.getElementById('boot')?.remove();
  }
}

/**
 * Offer back the documents whose unsaved changes were left in the autosave and that no tab owns. For each the person
 * picks "Recuperar", "Descartar" (deleted for good) or "Ahora no" (kept for the next start).
 */
async function offerRecovery(offered: StoredAutosave[], outdated: ReadonlySet<string> = new Set()): Promise<void> {
  try {
    for (let i = 0; i < offered.length; i++) {
      const { key, entry } = offered[i]!;
      const more = offered.length - i - 1;
      const what = entry.name ? `«${entry.name}»` : 'un documento';
      const late = outdated.has(key); // its file changed after the copy: it comes back tied to nothing
      const where = late
        ? `«${entry.file?.name ?? 'su archivo'}» cambió después y no se tocará: se abrirá sin archivo, guárdalo con «Guardar como».`
        : entry.file
          ? `Pertenece a «${entry.file.name}», que no tiene estos cambios.`
          : 'Nunca se guardó en un archivo.';
      const message =
        `Hay cambios sin guardar de ${what} (autoguardado del ${new Date(entry.savedAt).toLocaleString('es')}). ${where}` +
        (more > 0 ? ` Hay ${more} documento${more > 1 ? 's' : ''} más por revisar.` : '');
      const choice = await choiceDialog<'open' | 'drop' | 'later'>(
        message,
        [
          { label: 'Recuperar', value: 'open', primary: true },
          { label: 'Descartar', value: 'drop' },
          { label: 'Ahora no', value: 'later' },
        ],
        'later',
      );
      if (choice === 'later') return;
      if (choice === 'drop') {
        await removeAutosave(key).catch(() => undefined);
        continue;
      }
      if (!(await reopenCopy(key, entry, late))) continue;
      setStatus(docFile ? `Recuperado «${docTitle}». Guardar escribirá en ${docFile.name}.` : 'Autoguardado recuperado. Guárdalo en un archivo con «Guardar como».');
      return; // the others stay for the next start
    }
  } catch (err) {
    setStatus(`No se pudo revisar el autoguardado: ${err instanceof Error ? err.message : String(err)}`);
  }
}
applyPageDefaults();
updateStatusBar();
requestAnimationFrame(() => {
  resizeSurfaces();
  fitView();
});
