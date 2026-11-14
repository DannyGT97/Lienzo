import { adjustLut, type AdjustLut } from '../engine/adjust';
import { BLEND_MODES, EPS, HARD_MIX_BIAS, TIE } from '../engine/blend';
import { layerTree, type TreeNode } from '../engine/layer-tree';
import { mipChain } from '../engine/mip';
import { alphaBounds, type TileBounds } from '../engine/tile-bounds';
import type { Document, Layer } from '../engine/document';
import { TILE, type TiledSurface } from '../engine/tiles';
import { planeSize } from './view-geom';

/** Page → screen mapping in CSS pixels: screen = page·scale + (x, y). */
/**
 * Where the page is. x, y and scale place it on the "plane" (the screen turned back to the page's orientation);
 * `rot` quarter turns clockwise and `flip` (a left-right mirror) then turn the plane into the screen.
 */
export interface View {
  x: number;
  y: number;
  scale: number;
  rot?: 0 | 1 | 2 | 3;
  flip?: boolean;
  /** Free turn in radians (clockwise) about the middle of the stage, after the quarter turns. */
  tilt?: number;
}

/** Levels of every tile texture: 256, 128, 64, 32 and 16 px, enough for a page shown down to about a sixteenth. */
const MIP_LEVELS = 5;
/** Milliseconds per frame spent building tile mip levels on the CPU (the first tile of a frame is built regardless). */
const MIP_BUDGET_MS = 4;
/** How long the view must stay still before a zoom in progress is composed sharp again. */
const SETTLE_MS = 140;
/** While a zoom keeps going, a sharp frame is composed at least this often, so what the resampled cache does not cover fills in. */
const PROXY_MAX_MS = 120;
/** ...and, when composing a whole page takes long, no more often than this many times what it takes (up to PROXY_WAIT_CAP_MS). */
const PROXY_COST_FACTOR = 4;
/**
 * A whole-page compose that shades more than this many page-fulls of pixels (all the layers' tiles added up) is dear: on a tablet
 * 22 of them took 130 ms. It is not repeated during a gesture while the whole-page picture backs it up. (The time itself can't be
 * read: the CPU only queues the work.)
 */
const DEAR_FILL = 8;
const PROXY_WAIT_CAP_MS = 1500;
/** How long nothing is drawn before the whole-page picture that backs up a zoom is made again. */
const THUMB_IDLE_MS = 400;
/** How long nothing is drawn before what lies under the painted layer is composed and kept. */
const BELOW_IDLE_MS = 250;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const VERT = `#version 300 es
in vec2 a_corner;
uniform vec2 u_origin;
uniform vec2 u_size;
uniform vec2 u_target;
out vec2 v_uv;
void main() {
  vec2 p = u_origin + a_corner * u_size;
  gl_Position = vec4(p.x / u_target.x * 2.0 - 1.0, 1.0 - p.y / u_target.y * 2.0, 0.0, 1.0);
  v_uv = a_corner;
}`;

/** Blend modes are numbered by their index in BLEND_MODES (see MODE below). */
const FRAG_LAYER = `#version 300 es
precision highp float;
#define TIE ${TIE.toExponential(1)}
#define EPS ${EPS.toExponential(1)}
#define HARD_MIX_BIAS ${HARD_MIX_BIAS}
precision highp int;
precision highp sampler2D;
uniform sampler2D u_tile;
uniform sampler2D u_back;
uniform sampler2D u_base;
uniform float u_opacity;
uniform int u_mode;
uniform bool u_clip;
uniform bool u_solid;
uniform bool u_screen;
uniform bool u_hasMask;
uniform sampler2D u_mask;
uniform vec3 u_color;
// A tonal correction being tried on this layer (see GLRenderer.setLayerPreview): its table is read for the layer's own colour.
uniform bool u_pv;
uniform bool u_pvLuma;
uniform sampler2D u_pvLut;
in vec2 v_uv;
out vec4 o;

int pvIdx(float v) { return int(floor(clamp(v, 0.0, 1.0) * 255.0 + 0.5)); }
vec3 previewLut(vec3 c) {
  if (u_pvLuma) return texelFetch(u_pvLut, ivec2(pvIdx(dot(clamp(c, 0.0, 1.0), vec3(0.299, 0.587, 0.114))), 0), 0).rgb;
  return vec3(texelFetch(u_pvLut, ivec2(pvIdx(c.r), 0), 0).r, texelFetch(u_pvLut, ivec2(pvIdx(c.g), 0), 0).g, texelFetch(u_pvLut, ivec2(pvIdx(c.b), 0), 0).b);
}

float lum(vec3 c) { return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b; }
vec3 clipColor(vec3 c) {
  float l = lum(c);
  float n = min(c.r, min(c.g, c.b));
  float x = max(c.r, max(c.g, c.b));
  if (n < 0.0) c = l + (c - l) * (l / (l - n));
  if (x > 1.0) c = l + (c - l) * ((1.0 - l) / (x - l));
  return c;
}
vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lum(c))); }
float sat(vec3 c) { return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }
vec3 setSat(vec3 c, float s) {
  float mn = min(c.r, min(c.g, c.b));
  float mx = max(c.r, max(c.g, c.b));
  if (mx > mn) return (c - mn) * (s / (mx - mn));
  return vec3(0.0);
}

float colorDodge(float cb, float cs) { return min(1.0, cb / max(1.0 - cs, EPS)); }
float colorBurn(float cb, float cs) { return 1.0 - min(1.0, (1.0 - cb) / max(cs, EPS)); }
float hardLight(float cb, float cs) { return cs <= 0.5 ? cb * 2.0 * cs : 1.0 - (1.0 - cb) * (1.0 - (2.0 * cs - 1.0)); }
float softLight(float cb, float cs) {
  if (cs <= 0.5) return cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb);
  float d = cb <= 0.25 ? ((16.0 * cb - 12.0) * cb + 4.0) * cb : sqrt(cb);
  return cb + (2.0 * cs - 1.0) * (d - cb);
}

float channel(int m, float cb, float cs) {
  if (m == 0) return cs;
  if (m == 1) return min(cb, cs);
  if (m == 2) return cb * cs;
  if (m == 3) return colorBurn(cb, cs);
  if (m == 4) return clamp(cb + cs - 1.0, 0.0, 1.0);
  if (m == 5) return clamp(cb - cs, 0.0, 1.0);
  if (m == 7) return max(cb, cs);
  if (m == 8) return cb + cs - cb * cs;
  if (m == 9) return colorDodge(cb, cs);
  if (m == 10) return colorDodge(cb, cs);
  if (m == 11) return clamp(cb + cs, 0.0, 1.0);
  if (m == 12) return cb + cs;
  if (m == 14) return hardLight(cs, cb);
  if (m == 15) return softLight(cb, cs);
  if (m == 16) return hardLight(cb, cs);
  if (m == 17) return cs <= 0.5 ? colorBurn(cb, 2.0 * cs) : colorDodge(cb, 2.0 * cs - 1.0);
  if (m == 18) return clamp(cb + 2.0 * cs - 1.0, 0.0, 1.0);
  if (m == 19) return cs <= 0.5 ? min(cb, 2.0 * cs) : max(cb, 2.0 * cs - 1.0);
  if (m == 20) return cb + cs - (cb < 0.5 ? HARD_MIX_BIAS : 0.0) >= 1.0 ? 1.0 : 0.0;
  if (m == 21) return abs(cb - cs);
  if (m == 22) return cb + cs - 2.0 * cb * cs;
  if (m == 27) return min(1.0, cb / (cs + EPS));
  return cs;
}

vec3 blendColor(int m, vec3 cb, vec3 cs) {
  if (m == 6) return lum(cs) < lum(cb) - TIE ? cs : cb;
  if (m == 13) return lum(cs) > lum(cb) + TIE ? cs : cb;
  if (m == 23) return setLum(setSat(cs, sat(cb)), lum(cb));
  if (m == 24) return setLum(setSat(cb, sat(cs)), lum(cb));
  if (m == 25) return setLum(cs, lum(cb));
  if (m == 26) return setLum(cb, lum(cs));
  return vec3(channel(m, cb.r, cs.r), channel(m, cb.g, cs.g), channel(m, cb.b, cs.b));
}

void main() {
  ivec2 fc = ivec2(gl_FragCoord.xy);
  vec4 s = u_screen ? texelFetch(u_tile, fc, 0) : (u_solid ? vec4(u_color, 1.0) : texture(u_tile, v_uv));
  if (u_pv && !u_screen && !u_solid) s.rgb = previewLut(s.rgb);
  vec4 back = texelFetch(u_back, fc, 0);
  float baseA = u_clip ? texelFetch(u_base, fc, 0).a : 1.0;
  float as = s.a * u_opacity * baseA * (u_hasMask ? texelFetch(u_mask, fc, 0).a : 1.0);
  if (as <= 0.0) { o = back; return; }
  float ab = back.a;
  vec3 cb = back.rgb;
  vec3 cs = s.rgb;
  float ar = as + ab * (1.0 - as);
  if (ab < 0.001) { o = vec4(cs, as); return; }
  if (u_mode == 0) { o = vec4(((1.0 - as) * ab * cb + as * cs) / ar, ar); return; }
  float wb = ab / ar;
  if (u_mode == 10) {
    vec3 g = vec3(colorDodge(cb.r, cs.r * as), colorDodge(cb.g, cs.g * as), colorDodge(cb.b, cs.b * as));
    o = vec4(mix(cs, g, wb), min(as + ab, 1.0));
    return;
  }
  vec3 bl = blendColor(u_mode, cb, cs);
  vec3 t = clamp(mix(cb, bl, as / ar), 0.0, 1.0);
  bool addAlpha = u_mode == 8 || u_mode == 9 || u_mode == 15 || u_mode == 16;
  o = vec4(mix(cs, t, wb), addAlpha ? min(as + ab, 1.0) : ar);
}`;

/** Writes only the alpha of a layer (used as the base of clipping masks). */
const FRAG_BASE = `#version 300 es
precision highp float;
uniform sampler2D u_tile;
uniform sampler2D u_mask;
uniform bool u_solid;
uniform bool u_screen;
uniform bool u_hasMask;
in vec2 v_uv;
out vec4 o;
void main() {
  ivec2 fc = ivec2(gl_FragCoord.xy);
  float a = u_screen ? texelFetch(u_tile, fc, 0).a : (u_solid ? 1.0 : texture(u_tile, v_uv).a);
  if (u_hasMask) a *= texelFetch(u_mask, fc, 0).a;
  o = vec4(0.0, 0.0, 0.0, a);
}`;

/**
 * An adjustment layer: the backdrop's colour goes through the look-up table (see engine/adjust) by opacity × mask × clip.
 * The table is 256 texels of RGBA8 holding the red, green and blue entries.
 */
const FRAG_ADJUST = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D u_back;
uniform sampler2D u_base;
uniform sampler2D u_mask;
uniform sampler2D u_lut;
uniform float u_opacity;
uniform bool u_clip;
uniform bool u_hasMask;
uniform bool u_luma;
out vec4 o;
int idx(float v) { return int(floor(clamp(v, 0.0, 1.0) * 255.0 + 0.5)); }
void main() {
  ivec2 fc = ivec2(gl_FragCoord.xy);
  vec4 back = texelFetch(u_back, fc, 0);
  float k = u_opacity * (u_clip ? texelFetch(u_base, fc, 0).a : 1.0) * (u_hasMask ? texelFetch(u_mask, fc, 0).a : 1.0);
  if (k <= 0.0 || back.a <= 0.0) { o = back; return; }
  vec3 adj;
  if (u_luma) {
    int i = idx(dot(clamp(back.rgb, 0.0, 1.0), vec3(0.299, 0.587, 0.114)));
    adj = texelFetch(u_lut, ivec2(i, 0), 0).rgb;
  } else {
    adj = vec3(texelFetch(u_lut, ivec2(idx(back.r), 0), 0).r, texelFetch(u_lut, ivec2(idx(back.g), 0), 0).g, texelFetch(u_lut, ivec2(idx(back.b), 0), 0).b);
  }
  o = vec4(mix(back.rgb, adj, k), back.a);
}`;

const FRAG_COPY = `#version 300 es
precision highp float;
uniform sampler2D u_img;
out vec4 o;
void main() { o = texelFetch(u_img, ivec2(gl_FragCoord.xy), 0); }`;

/** Shows the composite over a checkerboard inside the page and the stage colour outside it. */
const FRAG_PRESENT = `#version 300 es
precision highp float;
uniform sampler2D u_img;
uniform vec4 u_doc;
uniform vec2 u_target;
uniform vec2 u_plane;
uniform int u_rot;
uniform int u_flip;
uniform vec2 u_tilt;
uniform float u_cell;
// Where the stage sits in the canvas (device pixels from its bottom left corner): the canvas is as big as the window and never resized.
uniform vec2 u_vp;
// A composite made at another scale: x is the ratio of its scale to the shown one, yz where the page's origin moves to, w is 1 when it applies.
uniform vec4 u_proxy;
// The whole page composed to fit the plane, for what the cache did not reach: x is the ratio of its scale to the shown one, yz where the page's origin moves to, w is 1 when it can be used.
uniform vec4 u_thumb;
uniform sampler2D u_thumbImg;
out vec4 o;
void main() {
  // The screen pixel, and the pixel of the plane (the composite) that lands on it.
  vec2 fc = gl_FragCoord.xy - u_vp;
  ivec2 s = ivec2(int(fc.x), int(u_target.y - fc.y));
  int cw = int(u_plane.x);
  int ch = int(u_plane.y);
  if (u_tilt.x != 1.0 || u_tilt.y != 0.0) {
    // Undo the free turn about the middle of the screen (u_tilt is cos, sin).
    vec2 d = vec2(s) + 0.5 - u_target * 0.5;
    vec2 r = vec2(d.x * u_tilt.x + d.y * u_tilt.y, -d.x * u_tilt.y + d.y * u_tilt.x) + u_plane * 0.5;
    if (r.x < 0.0 || r.y < 0.0 || r.x >= u_plane.x || r.y >= u_plane.y) {
      o = vec4(0.114, 0.114, 0.125, 1.0);
      return;
    }
    s = ivec2(floor(r));
  }
  int u;
  int v;
  if (u_rot == 0) { u = s.x; v = s.y; }
  else if (u_rot == 1) { u = s.y; v = ch - 1 - s.x; }
  else if (u_rot == 2) { u = cw - 1 - s.x; v = ch - 1 - s.y; }
  else { u = cw - 1 - s.y; v = s.x; }
  if (u_flip == 1) u = cw - 1 - u;
  vec2 p = vec2(float(u) + 0.5, float(v) + 0.5);
  if (p.x < u_doc.x || p.y < u_doc.y || p.x >= u_doc.z || p.y >= u_doc.w) {
    o = vec4(0.114, 0.114, 0.125, 1.0);
    return;
  }
  vec4 c;
  if (u_proxy.w > 0.5) {
    vec2 q = p * u_proxy.x + u_proxy.yz;
    if (q.x < 0.0 || q.y < 0.0 || q.x >= u_plane.x || q.y >= u_plane.y) {
      vec2 t = p * u_thumb.x + u_thumb.yz;
      if (u_thumb.w < 0.5 || t.x < 0.0 || t.y < 0.0 || t.x >= u_plane.x || t.y >= u_plane.y) {
        o = vec4(0.114, 0.114, 0.125, 1.0);
        return;
      }
      c = texture(u_thumbImg, vec2(t.x, u_plane.y - t.y) / u_plane);
    } else {
      c = texture(u_img, vec2(q.x, u_plane.y - q.y) / u_plane);
    }
  } else {
    c = texelFetch(u_img, ivec2(u, ch - 1 - v), 0);
  }
  float chk = mod(floor(p.x / u_cell) + floor(p.y / u_cell), 2.0);
  vec3 bg = mix(vec3(1.0), vec3(0.8), chk);
  o = vec4(c.rgb * c.a + bg * (1.0 - c.a), 1.0);
}`;

interface Program {
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
}

/** The pair of targets a list of layers ping-pongs between; `src` always holds the result so far. */
interface PassState {
  src: Target;
  dst: Target;
  /**
   * Where `dst` differs from `src` (screen pixels, top left origin): only what the pass before this one drew. null: anywhere (the
   * pair was just set up, or the last pass drew over the whole plane). A pass copies just this region, not the whole page.
   */
  stale: Rect[] | null;
}

/** What a composing pass needs to know about the view. */
interface ViewPass {
  doc: Document;
  W: number;
  H: number;
  m: { ox: number; oy: number; s: number };
  rect: { x: number; y: number; w: number; h: number } | null;
  gy: number;
  sampler: WebGLSampler;
  /** Visible tiles of the page. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Pixels lifted off layers and moved about by a tool (the transform). They stay in the layers' places in the stack, so
 * clipping, blend modes, opacity and masks treat them as the layer's own pixels; the tool only paints them.
 */
export interface Floating {
  /** The layers whose lifted pixels are floating; each one's own tiles hold only what stayed behind. */
  readonly layers: readonly number[];
  /** Paint one layer's floating pixels on a canvas of the plane (device pixels). `m` maps page pixels to it. */
  paint(layerId: number, ctx: CanvasRenderingContext2D, m: { ox: number; oy: number; s: number }): void;
}

export class GLRenderer {
  private gl!: WebGL2RenderingContext;
  private doc: Document | null = null;
  private programs!: { layer: Program; base: Program; copy: Program; present: Program; adjust: Program };
  private quad!: WebGLBuffer;
  private vao!: WebGLVertexArrayObject;
  private nearest!: WebGLSampler;
  /** Trilinear sampling over the tile mip levels, for a page shown smaller than it is. */
  private mip!: WebGLSampler;
  /** Plain bilinear sampling of the first level: how a tile whose smaller levels are not ready yet is shown (see `ensureMips`). */
  private linear!: WebGLSampler;
  /** Tile textures whose smaller levels match their pixels. */
  private mipFresh = new WeakSet<WebGLTexture>();
  /**
   * While one layer is being painted, what lies below it is composed once and kept (`below`): each frame of the stroke then draws
   * only that layer and the ones above, not all of them. `belowKey` says what it was made for; any change to a layer below, to
   * the view or to the stack throws it away. Only for a plain stack (no folders, the painted layer not clipped).
   */
  private below: Target | null = null;
  private belowKey = '';
  private belowValid = false;
  private belowTimer = 0;
  /** Layers (ids) whose pixels or mask were uploaded since the last frame's check. */
  private dirtyLayers = new Set<number>();
  private bounds = new WeakMap<WebGLTexture, TileBounds | null>();
  /** Tiles drawn without their smaller levels because this frame's time for building them ran out; built on the next frame. */
  private mipLate = new Map<WebGLTexture, { map: Map<number, WebGLTexture>; surface: TiledSurface; key: number }>();
  /** When this frame's time for building smaller levels ends, and how many tiles it built so far. */
  private mipDeadline = 0;
  private mipDone = 0;
  /** Tonal corrections being tried on layers: the table each one applies to its own colour, and the texture holding it. */
  private previews = new Map<number, { lut: AdjustLut; tex: WebGLTexture }>();
  private dummy!: WebGLTexture;
  private targets: Target[] = [];
  private baseTarget: Target | null = null;
  /** Mask of the layer being drawn, in screen space (value in alpha). */
  private maskTarget: Target | null = null;
  /** Targets for the members of folders, by nesting depth. */
  private groupTargets: [Target, Target][] = [];
  private baseSaves: Target[] = [];
  /** The last full composite; frames present it, and only changed tiles are recomposed into it. */
  private cache: Target | null = null;
  private cacheValid = false;
  /** Where the page's origin was when the cache was composed (device pixels); a pan moves the cache by the difference. */
  private cacheOx = 0;
  private cacheOy = 0;
  /** The page scale the cache was composed at. */
  private cacheScale = 0;
  private cacheRot = 0;
  private cacheFlip = false;
  /**
   * While a pinch or wheel zoom is going on the cache is shown resampled instead of being composed again every frame
   * (composing is a pass per layer over a plane up to 2.3× the screen, far more than a tablet's GPU does in a frame);
   * `settle` composes it again, sharp, once the view stops changing.
   */
  private proxy = false;
  /** The whole page composed to fit the plane (sharp enough to look right, small enough to be cheap): what a zoom shows where the cache did not reach. */
  private thumb: Target | null = null;
  private thumbValid = false;
  private thumb_ = { scale: 0, ox: 0, oy: 0, rot: 0, flip: false, w: 0, h: 0 };
  private thumbTimer = 0;
  /** Composing the whole-page picture: tiles whose smaller levels are not ready are drawn plainly, not remembered for later. */
  private quietMips = false;
  /** When the cache was last composed. */
  private composedAt = 0;
  private composeMs = 0;
  /** Pixels shaded by the layer passes since it was last reset, and what the last whole-page compose came to in page-fulls. */
  private fill = 0;
  private lastFill = 0;
  private fullStart = 0;
  private settleTimer = 0;
  /** Spare target the cache is slid into during a pan (same size as the cache). */
  private shiftTarget: Target | null = null;
  private fullDirty = true;
  /** Page rectangle changed since the last frame, from the surfaces' dirty tiles. */
  private dirtyDoc: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private outTarget: Target | null = null;
  private tw = 0;
  private th = 0;
  private floatFormat = true;
  private float32 = false;
  private tfmt = '';
  /** layer id → tile key → texture */
  /** The look-up table of each adjustment layer, with the settings it was made from. */
  private adjustLuts = new Map<number, { key: string; tex: WebGLTexture; luma: boolean }>();
  private textures = new Map<number, Map<number, WebGLTexture>>();
  /** layer id → tile key → texture of the layer's mask */
  private maskTextures = new Map<number, Map<number, WebGLTexture>>();
  /** Spare tile textures: allocating one stalls the driver, so freed ones are reused. */
  private pool: WebGLTexture[] = [];
  /** Floating pixels (see `Floating`): what the tool paints for each layer, as a screen-space image. */
  private floating: Floating | null = null;
  private floatTargets = new Map<number, Target>();
  private floatCanvas: HTMLCanvasElement | null = null;
  private frame = 0;
  private view: View = { x: 0, y: 0, scale: 1 };
  private dpr = 1;
  /** The stage: its size and where it is in the window (CSS pixels). The canvas behind it is bigger and fixed. */
  private stage = { w: 1, h: 1, left: 0, top: 0 };
  lost = false;
  /** Optional frame timing callback (used by the profiler); `syncProfile` also waits for the GPU. */
  onFrame: ((start: number, cpuMs: number, syncMs?: number) => void) | null = null;
  syncProfile = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.init();
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.init();
      this.lost = false;
      this.reset();
      this.invalidate();
    });
  }

  private init(): void {
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      desynchronized: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 no está disponible en este dispositivo.');
    this.gl = gl;
    this.floatFormat = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this.programs = {
      layer: this.program(VERT, FRAG_LAYER, ['u_origin', 'u_size', 'u_target', 'u_tile', 'u_back', 'u_base', 'u_opacity', 'u_mode', 'u_clip', 'u_solid', 'u_color', 'u_screen', 'u_hasMask', 'u_mask', 'u_pv', 'u_pvLuma', 'u_pvLut']),
      base: this.program(VERT, FRAG_BASE, ['u_origin', 'u_size', 'u_target', 'u_tile', 'u_solid', 'u_screen', 'u_hasMask', 'u_mask']),
      adjust: this.program(VERT, FRAG_ADJUST, ['u_origin', 'u_size', 'u_target', 'u_back', 'u_base', 'u_mask', 'u_lut', 'u_opacity', 'u_clip', 'u_hasMask', 'u_luma']),
      copy: this.program(VERT, FRAG_COPY, ['u_origin', 'u_size', 'u_target', 'u_img']),
      present: this.program(VERT, FRAG_PRESENT, ['u_origin', 'u_size', 'u_target', 'u_img', 'u_doc', 'u_cell', 'u_plane', 'u_rot', 'u_flip', 'u_tilt', 'u_proxy', 'u_vp', 'u_thumb', 'u_thumbImg']),
    };
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const loc = gl.getAttribLocation(this.programs.layer.prog, 'a_corner');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.nearest = this.sampler(gl.NEAREST);
    this.mip = this.sampler(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR);
    this.linear = this.sampler(gl.LINEAR);
    this.dummy = this.tileTexture();
    this.targets = [];
    this.baseTarget = null;
    this.maskTarget = null;
    this.groupTargets = [];
    this.baseSaves = [];
    this.outTarget = null;
    this.cache = null;
    this.shiftTarget = null;
    this.cacheValid = false;
    this.tw = this.th = 0;
  }

  private program(vs: string, fs: string, uniforms: string[]): Program {
    const gl = this.gl;
    const compile = (type: number, src: string): WebGLShader => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`Shader: ${gl.getShaderInfoLog(sh)}`);
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(prog, 0, 'a_corner');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Programa: ${gl.getProgramInfoLog(prog)}`);
    const u: Program['u'] = {};
    for (const n of uniforms) u[n] = gl.getUniformLocation(prog, n);
    return { prog, u };
  }

  private sampler(min: number, mag: number = min): WebGLSampler {
    const gl = this.gl;
    const s = gl.createSampler()!;
    gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, min);
    gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, mag);
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return s;
  }

  private tileTexture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, MIP_LEVELS, gl.RGBA8, TILE, TILE);
    return t;
  }

  private makeTarget(w: number, h: number, float: boolean): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const fmt = !float ? gl.RGBA8 : this.float32 ? gl.RGBA32F : gl.RGBA16F;
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo };
  }

  private freeTarget(t: Target | null): void {
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  private ensureTargets(w: number, h: number): void {
    const fmt = this.float32 ? 'f32' : 'f16';
    if (w === this.tw && h === this.th && this.targets.length && fmt === this.tfmt) return;
    this.tfmt = fmt;
    for (const t of this.targets) this.freeTarget(t);
    this.freeTarget(this.baseTarget);
    this.freeTarget(this.maskTarget);
    // Members of a folder at the top level are composed at depth 1, so the slot for depth 0 stays empty.
    for (const pair of this.groupTargets) {
      if (!pair) continue;
      this.freeTarget(pair[0]);
      this.freeTarget(pair[1]);
    }
    for (const t of this.baseSaves) this.freeTarget(t);
    this.groupTargets = [];
    this.baseSaves = [];
    this.freeTarget(this.outTarget);
    this.freeTarget(this.cache);
    this.freeTarget(this.below);
    this.below = null;
    this.belowValid = false;
    this.freeTarget(this.thumb);
    this.thumb = null;
    this.thumbValid = false;
    this.freeTarget(this.shiftTarget);
    this.shiftTarget = null;
    this.dropFloating();
    this.targets = [this.makeTarget(w, h, this.floatFormat), this.makeTarget(w, h, this.floatFormat)];
    this.cache = this.makeTarget(w, h, this.floatFormat);
    this.cacheValid = false;
    this.baseTarget = this.makeTarget(w, h, false);
    this.maskTarget = this.makeTarget(w, h, false);
    this.outTarget = this.makeTarget(w, h, false);
    this.tw = w;
    this.th = h;
  }

  /** Drop every GPU copy; tiles are uploaded again on the next frame. */
  private reset(): void {
    this.floatTargets.clear();
    this.textures.clear();
    this.maskTextures.clear();
    this.pool = [];
    if (this.doc) {
      for (const l of this.doc.layers) {
        l.surface.markAllDirty();
        l.mask?.surface.markAllDirty();
      }
    }
  }

  /** Start, change or end the floating pixels. Call `floatingChanged` after each change to what `paint` draws. */
  setFloating(f: Floating | null): void {
    this.floating = f;
    if (!f) this.dropFloating();
    this.invalidate();
  }

  floatingChanged(): void {
    this.invalidate();
  }

  private dropFloating(): void {
    for (const t of this.floatTargets.values()) this.freeTarget(t);
    this.floatTargets.clear();
    this.floatCanvas = null;
  }

  /** Paint the floating pixels of every layer and upload them as images the size of the plane. */
  private uploadFloating(W: number, H: number, m: { ox: number; oy: number; s: number }): void {
    const f = this.floating;
    if (!f) return;
    const gl = this.gl;
    let cv = this.floatCanvas;
    if (!cv || cv.width !== W || cv.height !== H) {
      cv = this.floatCanvas = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
    }
    const ctx = cv.getContext('2d')!;
    for (const [id, t] of this.floatTargets) {
      if (f.layers.includes(id)) continue;
      this.freeTarget(t);
      this.floatTargets.delete(id);
    }
    for (const id of f.layers) {
      let t = this.floatTargets.get(id);
      if (!t) this.floatTargets.set(id, (t = this.makeTarget(W, H, false)));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      f.paint(id, ctx, m);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    }
  }

  setDocument(doc: Document): void {
    if (this.doc) this.dropTextures();
    this.doc = doc;
    this.reset();
    this.invalidate();
  }

  private dropTextures(): void {
    for (const m of this.textures.values()) for (const t of m.values()) this.gl.deleteTexture(t);
    this.textures.clear();
    for (const m of this.maskTextures.values()) for (const t of m.values()) this.gl.deleteTexture(t);
    this.maskTextures.clear();
    for (const a of this.adjustLuts.values()) this.gl.deleteTexture(a.tex);
    this.adjustLuts.clear();
    for (const t of this.pool) this.gl.deleteTexture(t);
    this.pool = [];
  }

  /**
   * The stage (where the page is shown) and the canvas buffer, in CSS pixels, and the device pixel ratio. The buffer is as big as
   * the window and does not change when the stage does (a dock being dragged): the page is drawn into the part of it that is the
   * stage. A canvas that changes size while it is on screen is shown stretched until its new picture arrives.
   */
  resize(stage: { w: number; h: number; left: number; top: number }, buffer: { w: number; h: number }, dpr: number): void {
    this.dpr = dpr;
    this.stage = { ...stage };
    const w = Math.max(1, Math.round(buffer.w * dpr));
    const h = Math.max(1, Math.round(buffer.h * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.invalidate();
  }

  /** Size in device pixels of the plane the composite is held on (see `planeSize`). */
  private planePixels(): { W: number; H: number } {
    const dpr = this.dpr;
    const ps = planeSize({ rot: this.view.rot ?? 0, tilt: this.view.tilt }, { w: this.stage.w, h: this.stage.h });
    return { W: Math.max(1, Math.round(ps.w * dpr)), H: Math.max(1, Math.round(ps.h * dpr)) };
  }

  /**
   * `interactive`: the view is being changed by a gesture or the wheel, so a change of scale is shown by resampling what is
   * already composed (and composed sharp once the view settles) instead of composing every layer again for every event.
   */
  setView(v: View, interactive = false): void {
    const old = this.view;
    this.view = { ...v };
    // A pan alone does not change what is composed, only where it sits: the frame slides the cache (see `draw`). Nor does
    // turning freely: the plane is the same square whatever the angle, and the present pass turns it. Only turning from or
    // to straight changes the plane.
    const panOnly = v.scale === old.scale && (v.rot ?? 0) === (old.rot ?? 0) && !!v.flip === !!old.flip && !!v.tilt === !!old.tilt;
    if (panOnly && this.cacheValid) {
      this.schedule();
      return;
    }
    const { W, H } = this.planePixels();
    if (interactive && this.cacheValid && !this.fullDirty && (v.rot ?? 0) === this.cacheRot && !!v.flip === this.cacheFlip && W === this.tw && H === this.th) {
      this.proxy = true;
      window.clearTimeout(this.settleTimer);
      this.settleTimer = window.setTimeout(() => this.settle(), SETTLE_MS);
      // A zoom that goes on for seconds never settles, and the resampled cache leaves bare what it did not cover (zooming out)
      // or looks soft (zooming in): every so often one real frame is composed.
      // The wait grows with what a real frame costs: a page of many layers took most of every gesture to compose that often. When
      // a real frame is dear and the whole-page picture is there to fill what the cache does not cover, none is composed until
      // the gesture settles (on a tablet, 38 full-size layers took 130 ms a frame).
      const t = this.thumb_;
      const backed = this.thumbValid && !!this.thumb && t.rot === (v.rot ?? 0) && t.flip === !!v.flip && t.w === W && t.h === H;
      const wait = Math.min(PROXY_WAIT_CAP_MS, Math.max(PROXY_MAX_MS, this.composeMs * PROXY_COST_FACTOR));
      if (!(backed && this.lastFill > DEAR_FILL) && performance.now() - this.composedAt >= wait) this.fullDirty = true;
      this.schedule();
      return;
    }
    this.invalidateView();
  }

  /** The view stopped changing: compose it sharp. */
  private settle(): void {
    this.proxy = false;
    this.invalidateView();
  }

  /** Compose the whole page to fit the plane, when nothing has been drawn for a moment, to back up a zoom (see `thumb`). */
  private buildThumb(): void {
    const doc = this.doc;
    if (!doc || this.lost || this.floating || this.thumbValid || !this.cacheValid || this.proxy) return;
    const { W, H } = this.planePixels();
    if (W !== this.tw || H !== this.th) return;
    const gl = this.gl;
    if (!this.thumb) this.thumb = this.makeTarget(W, H, this.floatFormat);
    const s = Math.min((W - 8) / doc.width, (H - 8) / doc.height);
    const m = { ox: Math.round((W - doc.width * s) / 2), oy: Math.round((H - doc.height * s) / 2), s };
    this.mipDeadline = performance.now() + MIP_BUDGET_MS;
    this.mipDone = 0;
    this.quietMips = true;
    const final = this.compose(doc, W, H, m, null);
    this.quietMips = false;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, final.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.thumb.fbo);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.thumb_ = { scale: s, ox: m.ox, oy: m.oy, rot: this.view.rot ?? 0, flip: !!this.view.flip, w: W, h: H };
    this.thumbValid = true;
  }

  /**
   * Show a tonal correction on layers without touching their pixels: each layer's own colour goes through the table while it is
   * drawn (so it is on the whole page at once, at any zoom, and costs one table look-up per pixel). null ends it.
   */
  setLayerPreview(tables: ReadonlyMap<number, AdjustLut> | null): void {
    const gl = this.gl;
    for (const id of [...this.previews.keys()]) {
      if (tables?.has(id)) continue;
      gl.deleteTexture(this.previews.get(id)!.tex);
      this.previews.delete(id);
    }
    for (const [id, lut] of tables ?? []) {
      let entry = this.previews.get(id);
      if (!entry) {
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 256, 1);
        entry = { lut, tex };
        this.previews.set(id, entry);
      }
      entry.lut = lut;
      const px = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i++) {
        px[i * 4] = lut.table[i]!;
        px[i * 4 + 1] = lut.table[256 + i]!;
        px[i * 4 + 2] = lut.table[512 + i]!;
        px[i * 4 + 3] = 255;
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, entry.tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    this.invalidate();
  }

  /** Redraw everything on the next animation frame (view, layer settings, document changes). */
  invalidate(): void {
    this.thumbValid = false;
    this.invalidateView();
  }

  /** The view changed: the page is drawn again, but nothing it is made of did, so the whole-page picture is still good. */
  private invalidateView(): void {
    this.belowValid = false;
    this.fullDirty = true;
    this.schedule();
  }

  /** Redraw only what changed: pixel edits are found through the surfaces' dirty tiles. */
  invalidateTiles(): void {
    this.schedule();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.lost) return;
      const t0 = performance.now();
      if (this.fullStart) {
        const period = t0 - this.fullStart;
        if (period <= 1000) this.composeMs = Math.max(this.composeMs, period);
        this.fullStart = 0;
      }
      this.draw();
      if (!this.onFrame) return;
      const cpu = performance.now() - t0;
      let sync: number | undefined;
      if (this.syncProfile) {
        // Reading one pixel back makes the CPU wait for the GPU, so the elapsed time is the whole frame cost.
        this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, new Uint8Array(4));
        sync = performance.now() - t0;
      }
      this.onFrame(t0, cpu, sync);
    });
  }

  // ---- uploads -------------------------------------------------------------
  private sync(): void {
    const doc = this.doc;
    if (!doc) return;
    const alive = new Set<number>();
    const aliveMasks = new Set<number>();
    for (const layer of doc.layers) {
      alive.add(layer.id);
      this.uploadDirty(this.textures, layer.id, layer.surface);
      if (layer.mask) {
        aliveMasks.add(layer.id);
        this.uploadDirty(this.maskTextures, layer.id, layer.mask.surface);
      }
    }
    for (const [store, ids] of [[this.textures, alive], [this.maskTextures, aliveMasks]] as const) {
      for (const [id, map] of store) {
        if (ids.has(id)) continue;
        for (const t of map.values()) this.release(t);
        store.delete(id);
        this.fullDirty = true;
      }
    }
  }

  /** Upload the tiles of a surface that changed since the last frame (and drop the textures of removed ones). */
  private uploadDirty(store: Map<number, Map<number, WebGLTexture>>, id: number, surface: TiledSurface): void {
    const gl = this.gl;
    let map = store.get(id);
    if (!map) store.set(id, (map = new Map()));
    const keys = surface.takeDirty();
    if (keys.length) this.dirtyLayers.add(id);
    for (const key of keys) {
      this.thumbValid = false;
      this.markDirty(surface.tx(key) * TILE, surface.ty(key) * TILE);
      const tile = surface.getByKey(key);
      let tex = map.get(key);
      if (!tile) {
        if (tex) {
          this.release(tex);
          map.delete(key);
        }
        continue;
      }
      if (!tex) {
        tex = this.pool.pop() ?? this.tileTexture();
        map.set(key, tex);
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TILE, TILE, gl.RGBA, gl.UNSIGNED_BYTE, tile);
      this.mipFresh.delete(tex);
      this.bounds.delete(tex);
    }
  }

  private markDirty(x: number, y: number): void {
    const d = this.dirtyDoc;
    if (!d) this.dirtyDoc = { x0: x, y0: y, x1: x + TILE, y1: y + TILE };
    else {
      d.x0 = Math.min(d.x0, x);
      d.y0 = Math.min(d.y0, y);
      d.x1 = Math.max(d.x1, x + TILE);
      d.y1 = Math.max(d.y1, y + TILE);
    }
  }

  private release(tex: WebGLTexture): void {
    if (this.pool.length < 96) this.pool.push(tex);
    else this.gl.deleteTexture(tex);
  }

  // ---- drawing -------------------------------------------------------------
  private draw(): void {
    const doc = this.doc;
    if (!doc) return;
    const gl = this.gl;
    const rot = this.view.rot ?? 0;
    // The page is composed on the plane, which is the screen turned back to the page's orientation.
    const { W, H } = this.planePixels();
    this.ensureTargets(W, H);
    this.sync();
    if (this.belowValid && this.dirtyLayers.size) {
      // Pixels of a layer under the one being painted changed (an undo, a tool on another layer): what was kept is out of date.
      const active = doc.layers.findIndex((l) => l.id === doc.activeId);
      for (const id of this.dirtyLayers) {
        const i = doc.layers.findIndex((l) => l.id === id);
        if (i < 0 || i < active) {
          this.belowValid = false;
          break;
        }
      }
    }
    this.dirtyLayers.clear();
    this.mipDeadline = performance.now() + MIP_BUDGET_MS;
    this.mipDone = 0;
    if (!this.proxy) this.catchUpMips(); // while a zoom is shown resampled nothing is composed, so nothing needs the levels
    const sc = this.view.scale * this.dpr;
    // The page is composed on whole device pixels: a pan then moves the composite by a whole number of pixels, so what is
    // already composed can slide instead of being drawn again. The overlays use the exact view, up to half a pixel apart.
    const m = { ox: Math.round(this.view.x * this.dpr), oy: Math.round(this.view.y * this.dpr), s: sc };

    // Work out what has to be recomposed: everything, the strips a pan uncovered, or the screen area of the changed tiles.
    // Floating pixels move about freely, so nothing already composed can be reused while they are there.
    // A zoom in progress shows the cache resampled, as long as nothing else needs composing.
    if (this.proxy && sc !== this.cacheScale && this.cacheValid && !this.fullDirty && !this.dirtyDoc && !this.floating) {
      this.present(m, sc, true);
      return;
    }
    let full = this.fullDirty || !this.cacheValid || !!this.floating || sc !== this.cacheScale;
    this.fullDirty = false;
    this.uploadFloating(W, H, m);
    const rects: Rect[] = [];
    if (!full && (m.ox !== this.cacheOx || m.oy !== this.cacheOy)) {
      const dx = m.ox - this.cacheOx;
      const dy = m.oy - this.cacheOy;
      if (this.dirtyDoc || Math.abs(dx) >= W || Math.abs(dy) >= H) full = true;
      else rects.push(...this.slideCache(W, H, dx, dy));
    }
    if (full) {
      rects.length = 0;
      rects.push({ x: 0, y: 0, w: W, h: H });
    } else if (this.dirtyDoc) {
      const d = this.dirtyDoc;
      const x0 = Math.max(0, Math.floor(m.ox + d.x0 * sc) - 2);
      const y0 = Math.max(0, Math.floor(m.oy + d.y0 * sc) - 2);
      const x1 = Math.min(W, Math.ceil(m.ox + d.x1 * sc) + 2);
      const y1 = Math.min(H, Math.ceil(m.oy + d.y1 * sc) + 2);
      if (x1 > x0 && y1 > y0) rects.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    this.dirtyDoc = null;

    const composeStart = performance.now();
    this.fill = 0;
    for (const rect of rects) {
      const final = this.compose(doc, W, H, m, full ? null : rect);
      const gy = H - rect.y - rect.h; // GL rows start at the bottom
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, final.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.cache!.fbo);
      gl.blitFramebuffer(rect.x, gy, rect.x + rect.w, gy + rect.h, rect.x, gy, rect.x + rect.w, gy + rect.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      this.cacheValid = true;
    }
    this.cacheOx = m.ox;
    this.cacheOy = m.oy;
    this.cacheScale = sc;
    this.composedAt = performance.now();
    // How long a whole page takes to compose, so a gesture does not spend most of its time doing it: the calls' own time here, and
    // (see `schedule`) the time until the next frame starts, which also holds the GPU's work that the calls only queued.
    if (full) {
      this.lastFill = this.fill / (W * H);
      this.composeMs = this.composedAt - composeStart;
      this.fullStart = composeStart;
    }
    this.cacheRot = rot;
    this.cacheFlip = !!this.view.flip;
    this.present(m, sc, false);
    // Tiles shown without their smaller levels get them on the next frame, and are composed again then.
    if (this.mipLate.size) this.schedule();
    if (!this.thumbValid) {
      window.clearTimeout(this.thumbTimer);
      this.thumbTimer = window.setTimeout(() => this.buildThumb(), THUMB_IDLE_MS);
    }
    if (!this.belowValid && this.belowSplit(doc) >= 0) {
      window.clearTimeout(this.belowTimer);
      this.belowTimer = window.setTimeout(() => this.buildBelow(), BELOW_IDLE_MS);
    }
  }

  /** Put the cache on the screen: turned and flipped as the view says, over the page's checkerboard. `proxy`: it was composed at another scale. */
  private present(m: { ox: number; oy: number; s: number }, sc: number, proxy: boolean): void {
    const doc = this.doc!;
    const gl = this.gl;
    const SW = Math.max(1, Math.round(this.stage.w * this.dpr));
    const SH = Math.max(1, Math.round(this.stage.h * this.dpr));
    // GL rows start at the bottom of the canvas; the stage's top edge is `stage.top` below the top of the window.
    const vx = Math.round(this.stage.left * this.dpr);
    const vy = this.canvas.height - Math.round(this.stage.top * this.dpr) - SH;
    const { W, H } = this.planePixels();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(vx, vy, SW, SH);
    const p = this.programs.present;
    gl.useProgram(p.prog);
    gl.uniform2f(p.u.u_origin!, 0, 0);
    gl.uniform2f(p.u.u_size!, SW, SH);
    gl.uniform2f(p.u.u_target!, SW, SH);
    gl.uniform2f(p.u.u_vp!, vx, vy);
    gl.uniform2f(p.u.u_plane!, W, H);
    gl.uniform1i(p.u.u_rot!, this.view.rot ?? 0);
    gl.uniform1i(p.u.u_flip!, this.view.flip ? 1 : 0);
    const tilt = this.view.tilt ?? 0;
    gl.uniform2f(p.u.u_tilt!, Math.cos(tilt), Math.sin(tilt));
    gl.uniform4f(p.u.u_doc!, m.ox, m.oy, m.ox + doc.width * sc, m.oy + doc.height * sc);
    gl.uniform1f(p.u.u_cell!, 16 * this.dpr);
    // What was composed at scale s0 with the page's origin at o0, shown at scale s with the origin at o: a plane point p is the page
    // point (p - o) / s, which sits at (p - o) · s0 / s + o0 in the cache.
    const k = proxy ? this.cacheScale / sc : 1;
    gl.uniform4f(p.u.u_proxy!, k, this.cacheOx - m.ox * k, this.cacheOy - m.oy * k, proxy ? 1 : 0);
    this.bindTexture(1, this.cache!.tex, proxy ? this.linear : this.nearest);
    gl.uniform1i(p.u.u_img!, 1);
    // Where the cache has nothing (zooming out, or panning past it) the whole-page picture is shown, softer but there.
    const t = this.thumb_;
    const thumbOk = proxy && this.thumbValid && !!this.thumb && t.rot === (this.view.rot ?? 0) && t.flip === !!this.view.flip && t.w === W && t.h === H;
    const k2 = thumbOk ? t.scale / sc : 1;
    gl.uniform4f(p.u.u_thumb!, k2, t.ox - m.ox * k2, t.oy - m.oy * k2, thumbOk ? 1 : 0);
    this.bindTexture(6, thumbOk ? this.thumb!.tex : this.dummy, this.linear);
    gl.uniform1i(p.u.u_thumbImg!, 6);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Move the composite held in the cache by (dx, dy) device pixels (a pan) and say which strips of it were uncovered and still
   * have to be composed. Own design: the cache cannot be copied onto itself, so it is copied into a spare target of the same
   * size and the two swap places.
   */
  private slideCache(W: number, H: number, dx: number, dy: number): Rect[] {
    const gl = this.gl;
    if (!this.shiftTarget) this.shiftTarget = this.makeTarget(W, H, this.floatFormat);
    const sx = Math.max(0, -dx);
    const sy = Math.max(0, -dy);
    const sw = W - Math.abs(dx);
    const sh = H - Math.abs(dy);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.cache!.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.shiftTarget.fbo);
    // GL rows start at the bottom, so a rectangle of the plane (y down) is flipped.
    gl.blitFramebuffer(sx, H - sy - sh, sx + sw, H - sy, sx + dx, H - (sy + dy) - sh, sx + dx + sw, H - (sy + dy), gl.COLOR_BUFFER_BIT, gl.NEAREST);
    [this.cache, this.shiftTarget] = [this.shiftTarget, this.cache];
    const strips: Rect[] = [];
    if (dx !== 0) strips.push({ x: dx > 0 ? 0 : W + dx, y: 0, w: Math.abs(dx), h: H });
    if (dy !== 0) strips.push({ x: dx > 0 ? dx : 0, y: dy > 0 ? 0 : H + dy, w: W - Math.abs(dx), h: Math.abs(dy) });
    return strips;
  }

  private bindTexture(unit: number, tex: WebGLTexture, sampler: WebGLSampler): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.bindSampler(unit, sampler);
  }

  /** Compose what lies under the painted layer over the whole plane and keep it (see `below`). Done when nothing else is going on. */
  private buildBelow(): void {
    const doc = this.doc;
    if (!doc || this.lost || this.floating || this.proxy || !this.cacheValid) return;
    const split = this.belowSplit(doc);
    if (split < 0) return;
    const { W, H } = this.planePixels();
    if (W !== this.tw || H !== this.th) return;
    const gl = this.gl;
    const m = { ox: Math.round(this.view.x * this.dpr), oy: Math.round(this.view.y * this.dpr), s: this.view.scale * this.dpr };
    const key = this.belowKeyFor(doc, W, H, m);
    if (this.belowValid && this.belowKey === key) return;
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);
    gl.disable(gl.SCISSOR_TEST);
    const [a0, b0] = this.targets as [Target, Target];
    const st: PassState = { src: a0, dst: b0, stale: null };
    this.clearTarget(st.src, W, H);
    this.mipDeadline = performance.now() + MIP_BUDGET_MS;
    this.mipDone = 0;
    this.composeNodes(layerTree(doc.layers).slice(0, split), st, 0, {
      doc,
      W,
      H,
      m,
      rect: null,
      gy: 0,
      sampler: m.s >= 1 ? this.nearest : this.mip,
      x0: Math.max(0, Math.floor(-m.ox / m.s / TILE)),
      y0: Math.max(0, Math.floor(-m.oy / m.s / TILE)),
      x1: Math.min(Math.ceil(doc.width / TILE) - 1, Math.floor((W - m.ox) / m.s / TILE)),
      y1: Math.min(Math.ceil(doc.height / TILE) - 1, Math.floor((H - m.oy) / m.s / TILE)),
    });
    this.below ??= this.makeTarget(W, H, this.floatFormat);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, st.src.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.below.fbo);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.belowKey = key;
    // Tiles drawn without their smaller levels get them on the next frame (`catchUpMips`) and the picture is made again then.
    this.belowValid = this.mipLate.size === 0;
    if (!this.belowValid) this.schedule();
  }

  /**
   * Where the stack splits for the cache of what lies under the painted layer: the painted layer's index, or -1 when the cache does
   * not apply (a folder anywhere, the painted layer clipped or not a pixel layer, or too few layers under it to be worth it).
   */
  private belowSplit(doc: Document): number {
    if (this.floating || doc.layers.length < 5) return -1;
    let at = -1;
    for (let i = 0; i < doc.layers.length; i++) {
      const l = doc.layers[i]!;
      if (l.kind === 'folder' || l.parent !== null) return -1;
      if (l.id === doc.activeId) at = i;
    }
    if (at < 3) return -1;
    const a = doc.layers[at]!;
    return a.kind === 'raster' && !a.clip ? at : -1;
  }

  /** What the kept picture of the layers under the painted one is valid for. */
  private belowKeyFor(doc: Document, W: number, H: number, m: { ox: number; oy: number; s: number }): string {
    return `${doc.activeId}|${W}x${H}|${m.ox},${m.oy},${m.s}|${this.view.rot ?? 0}|${this.view.flip ? 1 : 0}|${doc.layers.length}`;
  }

  /**
   * Composite all layers into an offscreen target and return it. With `rect` (device pixels, top-left
   * origin) only that area is recomposed: every pass is scissored to it and only the tiles that
   * touch it are drawn.
   */
  private compose(
    doc: Document,
    W: number,
    H: number,
    m: { ox: number; oy: number; s: number },
    rect: { x: number; y: number; w: number; h: number } | null = null,
  ): Target {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);
    const gy = rect ? H - rect.y - rect.h : 0;
    if (rect) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(rect.x, gy, rect.w, rect.h);
    } else {
      gl.disable(gl.SCISSOR_TEST);
    }
    const [a0, b0] = this.targets as [Target, Target];
    const st: PassState = { src: a0, dst: b0, stale: null };
    // Visible part of the page, in tiles.
    const make = (r: { x: number; y: number; w: number; h: number } | null): ViewPass => ({
      doc,
      W,
      H,
      m,
      rect: r,
      gy: r ? H - r.y - r.h : 0,
      sampler: m.s >= 1 ? this.nearest : this.mip,
      x0: Math.max(0, Math.floor(-m.ox / m.s / TILE)),
      y0: Math.max(0, Math.floor(-m.oy / m.s / TILE)),
      x1: Math.min(Math.ceil(doc.width / TILE) - 1, Math.floor((W - m.ox) / m.s / TILE)),
      y1: Math.min(Math.ceil(doc.height / TILE) - 1, Math.floor((H - m.oy) / m.s / TILE)),
    });
    const nodes = layerTree(doc.layers);
    const split = rect ? this.belowSplit(doc) : -1;
    if (split >= 0 && this.belowValid && this.below && this.belowKey === this.belowKeyFor(doc, W, H, m)) {
      // The layers under the painted one are kept: start from them in the area being redrawn and draw only the rest.
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.below.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, st.src.fbo);
      gl.blitFramebuffer(rect!.x, gy, rect!.x + rect!.w, gy + rect!.h, rect!.x, gy, rect!.x + rect!.w, gy + rect!.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      this.composeNodes(nodes.slice(split), st, 0, make(rect));
    } else {
      this.clearTarget(st.src, W, H);
      this.composeNodes(nodes, st, 0, make(rect));
    }
    gl.disable(gl.SCISSOR_TEST);
    return st.src;
  }

  private clearTarget(t: Target, W: number, H: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Targets for the members of a folder `depth` levels down; each folder is composed in its own pair. */
  private groupPair(depth: number, W: number, H: number): PassState {
    let p = this.groupTargets[depth];
    if (!p) p = this.groupTargets[depth] = [this.makeTarget(W, H, this.floatFormat), this.makeTarget(W, H, this.floatFormat)];
    return { src: p[0], dst: p[1], stale: null };
  }

  /**
   * Composite a list of layers (bottom to top) over `st.src`, ping-ponging between the two targets of `st`.
   * Folders are composed into a separate image first, unless they are plain pass-through folders.
   */
  private composeNodes(nodes: readonly TreeNode[], st: PassState, depth: number, v: ViewPass): void {
    const gl = this.gl;
    const { W, H } = v;
    this.clearBase(W, H); // a clipped layer with no base layer beneath it must see alpha 0
    for (let i = 0; i < nodes.length; i++) {
      const layer = nodes[i]!.layer;
      if (layer.kind === 'adjust') {
        // No pixels and no part in clipping: it only changes what is below (like the CPU compositor does).
        this.passAdjust(layer, st, v);
        continue;
      }
      const next = nodes[i + 1]?.layer;
      const needsBase = !layer.clip && !!next?.clip;
      const folder = layer.kind === 'folder';
      if (!layer.visible) {
        // A hidden base shows nothing, so the layers clipped to it show nothing either (their base alpha is 0).
        if (!layer.clip) this.clearBase(W, H);
        continue;
      }
      const maskState = layer.mask && layer.mask.enabled ? this.renderMask(layer, v) : 'none';

      if (folder) {
        if (layer.through && !layer.clip && !needsBase && maskState === 'none' && layer.opacity >= 1) {
          this.composeNodes(nodes[i]!.children, st, depth, v);
          this.clearBase(W, H);
          gl.bindFramebuffer(gl.FRAMEBUFFER, st.src.fbo);
          continue;
        }
        // Members first, into a pair of their own (and without disturbing the base of this level).
        const saved = layer.clip ? this.saveBase(depth, W, H) : null;
        const inner = this.groupPair(depth + 1, W, H);
        this.clearTarget(inner.src, W, H);
        this.composeNodes(nodes[i]!.children, inner, depth + 1, v);
        if (saved) this.restoreBase(saved, W, H);
        if (layer.mask && layer.mask.enabled) this.renderMask(layer, v); // the members' own masks overwrote it
        if (needsBase) this.drawBaseScreen(inner.src, maskState === 'active', W, H);
        if (maskState === 'hidden') continue;
        this.passLayer(layer, st, v, { screen: inner.src, mask: maskState === 'active' });
        continue;
      }

      const floatImg = this.floatTargets.get(layer.id);
      if (floatImg) {
        // What stayed behind and what floats are one image of the layer, which then goes through the layer's own settings.
        const inner = this.groupPair(depth + 1, W, H);
        this.clearTarget(inner.src, W, H);
        const plain = { ...layer, opacity: 1, blend: 'normal', clip: false } as Layer;
        const rest = this.visibleTiles(this.textures.get(layer.id), layer.surface, false, v);
        if (rest.length) this.passLayer(plain, inner, v, { tiles: rest, mask: false });
        this.passLayer(plain, inner, v, { screen: floatImg, mask: false });
        if (maskState === 'hidden') {
          if (needsBase) this.clearBase(W, H);
          continue;
        }
        if (needsBase) this.drawBaseScreen(inner.src, maskState === 'active', W, H);
        this.passLayer(layer, st, v, { screen: inner.src, mask: maskState === 'active' });
        continue;
      }

      const tiles = this.visibleTiles(this.textures.get(layer.id), layer.surface, layer.kind === 'paper', v);
      const paper = layer.kind === 'paper';
      if ((tiles.length === 0 && !paper) || maskState === 'hidden') {
        if (needsBase) this.clearBase(W, H);
        continue;
      }
      if (needsBase) this.drawBase(layer, tiles, paper, maskState === 'active', v);
      this.passLayer(layer, st, v, { tiles, paper, mask: maskState === 'active' });
    }
  }

  /** Draw one layer (its tiles, a solid page, or an already composed folder image) over `st.src`, then swap. */
  private passLayer(
    layer: Layer,
    st: PassState,
    v: ViewPass,
    what: { tiles?: number[]; paper?: boolean; screen?: Target; mask: boolean },
  ): void {
    const gl = this.gl;
    const { W, H, rect, gy, doc, m, sampler } = v;
    // Bring the other target up to date with the backdrop, then draw this layer over it reading the original.
    this.copyBackdrop(st, v);
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.dst.fbo);
    gl.viewport(0, 0, W, H);

    const p = this.programs.layer;
    gl.useProgram(p.prog);
    gl.uniform2f(p.u.u_target!, W, H);
    gl.uniform1f(p.u.u_opacity!, layer.opacity);
    gl.uniform1i(p.u.u_mode!, BLEND_MODES.indexOf(layer.blend));
    gl.uniform1i(p.u.u_clip!, layer.clip ? 1 : 0);
    gl.uniform1i(p.u.u_solid!, what.paper ? 1 : 0);
    gl.uniform1i(p.u.u_screen!, what.screen ? 1 : 0);
    gl.uniform1i(p.u.u_hasMask!, what.mask ? 1 : 0);
    const c = layer.paperColor ?? [255, 255, 255];
    gl.uniform3f(p.u.u_color!, c[0] / 255, c[1] / 255, c[2] / 255);
    this.bindTexture(1, st.src.tex, this.nearest);
    gl.uniform1i(p.u.u_back!, 1);
    this.bindTexture(2, this.baseTarget!.tex, this.nearest);
    gl.uniform1i(p.u.u_base!, 2);
    this.bindTexture(3, this.maskTarget!.tex, this.nearest);
    gl.uniform1i(p.u.u_mask!, 3);
    gl.uniform1i(p.u.u_tile!, 0);
    const pv = what.tiles ? this.previews.get(layer.id) : undefined;
    gl.uniform1i(p.u.u_pv!, pv ? 1 : 0);
    gl.uniform1i(p.u.u_pvLuma!, pv?.lut.mode === 'luma' ? 1 : 0);
    this.bindTexture(5, pv ? pv.tex : this.dummy, this.nearest);
    gl.uniform1i(p.u.u_pvLut!, 5);
    if (what.screen) {
      this.bindTexture(0, what.screen.tex, this.nearest);
      gl.uniform2f(p.u.u_origin!, 0, 0);
      gl.uniform2f(p.u.u_size!, W, H);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this.fill += W * H;
    } else {
      this.drawTiles(p, this.textures.get(layer.id), layer.surface, what.tiles ?? [], !!what.paper, doc, m, sampler, rect ? undefined : H);
    }
    [st.src, st.dst] = [st.dst, st.src];
    // The target that was the backdrop now differs from the new one only where this layer was drawn.
    st.stale = what.tiles && !what.paper ? this.tileRuns(layer.surface, what.tiles, m) : null;
  }

  /** `dst` := `src` over the region where they differ (see `PassState.stale`), within the area being composed. */
  private copyBackdrop(st: PassState, v: ViewPass): void {
    const gl = this.gl;
    const { W, H, rect, gy } = v;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, st.src.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, st.dst.fbo);
    if (!st.stale) {
      if (rect) gl.blitFramebuffer(rect.x, gy, rect.x + rect.w, gy + rect.h, rect.x, gy, rect.x + rect.w, gy + rect.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      else gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      return;
    }
    for (const r of st.stale) {
      // A little wider than the tiles: the edges of a scaled tile can reach a pixel beyond its exact bounds.
      let x0 = Math.max(0, Math.floor(r.x) - 2);
      let x1 = Math.min(W, Math.ceil(r.x + r.w) + 2);
      let y0 = Math.max(0, Math.floor(r.y) - 2);
      let y1 = Math.min(H, Math.ceil(r.y + r.h) + 2);
      if (rect) {
        x0 = Math.max(x0, rect.x);
        x1 = Math.min(x1, rect.x + rect.w);
        y0 = Math.max(y0, rect.y);
        y1 = Math.min(y1, rect.y + rect.h);
      }
      if (x1 <= x0 || y1 <= y0) continue;
      gl.blitFramebuffer(x0, H - y1, x1, H - y0, x0, H - y1, x1, H - y0, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
  }

  /** The screen area the tiles cover, as runs of neighbouring tiles of a row (the tiles come in row order). */
  private tileRuns(surface: TiledSurface, keys: number[], m: { ox: number; oy: number; s: number }): Rect[] {
    const size = TILE * m.s;
    const runs: Rect[] = [];
    let tx0 = 0;
    let tx1 = -2;
    let ty = 0;
    const flush = (): void => {
      if (tx1 >= tx0) runs.push({ x: m.ox + tx0 * size, y: m.oy + ty * size, w: (tx1 - tx0 + 1) * size, h: size });
    };
    for (const key of keys) {
      const x = surface.tx(key);
      const y = surface.ty(key);
      if (y === ty && x === tx1 + 1) {
        tx1 = x;
        continue;
      }
      flush();
      tx0 = tx1 = x;
      ty = y;
    }
    flush();
    return runs;
  }

  /** The table texture of an adjustment layer, rebuilt when its settings change. */
  private adjustTexture(layer: Layer): { tex: WebGLTexture; luma: boolean } | null {
    const a = layer.adjust;
    if (!a) return null;
    const key = JSON.stringify(a);
    const have = this.adjustLuts.get(layer.id);
    if (have && have.key === key) return have;
    const lut = adjustLut(a);
    if (!lut) return null;
    const gl = this.gl;
    const px = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      px[i * 4] = lut.table[i]!;
      px[i * 4 + 1] = lut.table[256 + i]!;
      px[i * 4 + 2] = lut.table[512 + i]!;
      px[i * 4 + 3] = 255;
    }
    const tex = have?.tex ?? gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (!have) gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 256, 1);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const entry = { key, tex, luma: lut.mode === 'luma' };
    this.adjustLuts.set(layer.id, entry);
    return entry;
  }

  /** Apply an adjustment layer to the backdrop `st.src`, then swap. */
  private passAdjust(layer: Layer, st: PassState, v: ViewPass): void {
    if (!layer.visible) return;
    const maskState = layer.mask && layer.mask.enabled ? this.renderMask(layer, v) : 'none';
    if (maskState === 'hidden') return;
    const lut = this.adjustTexture(layer);
    if (!lut) return;
    const gl = this.gl;
    const { W, H } = v;
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.dst.fbo);
    gl.viewport(0, 0, W, H);
    const p = this.programs.adjust;
    gl.useProgram(p.prog);
    gl.uniform2f(p.u.u_origin!, 0, 0);
    gl.uniform2f(p.u.u_size!, W, H);
    gl.uniform2f(p.u.u_target!, W, H);
    gl.uniform1f(p.u.u_opacity!, layer.opacity);
    gl.uniform1i(p.u.u_clip!, layer.clip ? 1 : 0);
    gl.uniform1i(p.u.u_hasMask!, maskState === 'active' ? 1 : 0);
    gl.uniform1i(p.u.u_luma!, lut.luma ? 1 : 0);
    this.bindTexture(1, st.src.tex, this.nearest);
    gl.uniform1i(p.u.u_back!, 1);
    this.bindTexture(2, this.baseTarget!.tex, this.nearest);
    gl.uniform1i(p.u.u_base!, 2);
    this.bindTexture(3, this.maskTarget!.tex, this.nearest);
    gl.uniform1i(p.u.u_mask!, 3);
    this.bindTexture(4, lut.tex, this.nearest);
    gl.uniform1i(p.u.u_lut!, 4);
    // Scissored to the area being redrawn like every other pass.
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [st.src, st.dst] = [st.dst, st.src];
    st.stale = null;
  }

  /**
   * Draw the layer's mask into the mask target (screen space, value in alpha). Returns 'none' when the mask
   * changes nothing in view, 'hidden' when it hides the whole layer there, 'active' otherwise.
   */
  private renderMask(layer: Layer, v: ViewPass): 'none' | 'hidden' | 'active' {
    const mask = layer.mask!;
    const tiles = this.visibleTiles(this.maskTextures.get(layer.id), mask.surface, false, v);
    if (tiles.length === 0) return mask.base === 255 ? 'none' : 'hidden';
    const gl = this.gl;
    const { W, H, doc, m, sampler } = v;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskTarget!.fbo);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, mask.base / 255);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const p = this.programs.base;
    gl.useProgram(p.prog);
    gl.uniform2f(p.u.u_target!, W, H);
    gl.uniform1i(p.u.u_solid!, 0);
    gl.uniform1i(p.u.u_screen!, 0);
    gl.uniform1i(p.u.u_hasMask!, 0);
    gl.uniform1i(p.u.u_tile!, 0);
    // The mask target must not also be a texture this pass could sample (a sampler left pointing at it is a feedback loop).
    gl.uniform1i(p.u.u_mask!, 0);
    this.drawTiles(p, this.maskTextures.get(layer.id), mask.surface, tiles, false, doc, m, sampler);
    return 'active';
  }

  /** Keep a copy of the base target while a clipped folder composes its members. */
  private saveBase(depth: number, W: number, H: number): Target {
    const gl = this.gl;
    const t = (this.baseSaves[depth] ??= this.makeTarget(W, H, false));
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.baseTarget!.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.fbo);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    return t;
  }

  private restoreBase(t: Target, W: number, H: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.baseTarget!.fbo);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  }

  /** Alpha of a composed folder image into the base target, for the clipping layers that follow it. */
  private drawBaseScreen(img: Target, masked: boolean, W: number, H: number): void {
    const gl = this.gl;
    this.clearBase(W, H);
    const p = this.programs.base;
    gl.useProgram(p.prog);
    gl.uniform2f(p.u.u_target!, W, H);
    gl.uniform1i(p.u.u_solid!, 0);
    gl.uniform1i(p.u.u_screen!, 1);
    gl.uniform1i(p.u.u_hasMask!, masked ? 1 : 0);
    gl.uniform1i(p.u.u_tile!, 0);
    this.bindTexture(3, this.maskTarget!.tex, this.nearest);
    gl.uniform1i(p.u.u_mask!, 3);
    this.bindTexture(0, img.tex, this.nearest);
    gl.uniform2f(p.u.u_origin!, 0, 0);
    gl.uniform2f(p.u.u_size!, W, H);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private visibleTiles(map: Map<number, WebGLTexture> | undefined, s: TiledSurface, skip: boolean, v: ViewPass): number[] {
    if (!map || skip) return [];
    const { x0, y0, x1, y1, rect, m } = v;
    const size = TILE * m.s;
    const out: number[] = [];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const key = s.key(tx, ty);
        if (!map.has(key)) continue;
        if (rect) {
          const ox = m.ox + tx * size;
          const oy = m.oy + ty * size;
          if (ox >= rect.x + rect.w || ox + size <= rect.x || oy >= rect.y + rect.h || oy + size <= rect.y) continue;
        }
        out.push(key);
      }
    }
    return out;
  }

  private clearBase(W: number, H: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.baseTarget!.fbo);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Alpha of a layer into the base target, for the clipping layers that follow it. */
  private drawBase(layer: Layer, tiles: number[], paper: boolean, masked: boolean, v: ViewPass): void {
    const gl = this.gl;
    const { W, H, doc, m, sampler } = v;
    this.clearBase(W, H);
    const p = this.programs.base;
    gl.useProgram(p.prog);
    gl.uniform2f(p.u.u_target!, W, H);
    gl.uniform1i(p.u.u_solid!, paper ? 1 : 0);
    gl.uniform1i(p.u.u_screen!, 0);
    gl.uniform1i(p.u.u_hasMask!, masked ? 1 : 0);
    gl.uniform1i(p.u.u_tile!, 0);
    this.bindTexture(3, this.maskTarget!.tex, this.nearest);
    gl.uniform1i(p.u.u_mask!, 3);
    this.drawTiles(p, this.textures.get(layer.id), layer.surface, tiles, paper, doc, m, sampler);
  }

  /**
   * Fill the smaller levels of a tile's texture from its pixels, once per change, so a page zoomed out is averaged instead of
   * sampled at isolated points (hair lines flickered and broke up). Own design; see `engine/mip.ts`.
   */
  private buildMips(tex: WebGLTexture, data: ArrayLike<number>): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const levels = mipChain(data, TILE, MIP_LEVELS);
    for (let l = 0; l < levels.length; l++) {
      const s = TILE >> (l + 1);
      gl.texSubImage2D(gl.TEXTURE_2D, l + 1, 0, 0, s, s, gl.RGBA, gl.UNSIGNED_BYTE, levels[l]!);
    }
    this.mipFresh.add(tex);
  }

  /**
   * Whether the tile's smaller levels are ready to draw with, building them when there is time. Building them is CPU work
   * on the main thread for every tile a stroke touches, and on a tablet a stroke across a big page touches several tiles per
   * frame, so only a few milliseconds per frame go to it. The first tile of a frame is always built (so it always makes
   * progress); the rest are drawn with plain bilinear sampling of the first level, which at half size or more is the very same
   * average, and are built on the following frames (`catchUpMips`).
   */
  private ensureMips(tex: WebGLTexture, data: ArrayLike<number> | undefined, map: Map<number, WebGLTexture>, surface: TiledSurface, key: number): boolean {
    if (!data || this.mipFresh.has(tex)) return true;
    if (this.mipDone > 0 && performance.now() >= this.mipDeadline) {
      if (!this.quietMips) this.mipLate.set(tex, { map, surface, key });
      return false;
    }
    this.buildMips(tex, data);
    this.mipDone++;
    return true;
  }

  /** Build the smaller levels of the tiles that were drawn without them, and mark their place to be composed again. */
  private catchUpMips(): void {
    if (!this.mipLate.size) return;
    const late = [...this.mipLate];
    this.mipLate.clear();
    for (const [tex, e] of late) {
      const data = e.surface.getByKey(e.key);
      if (e.map.get(e.key) !== tex || !data) continue; // the tile is gone, or its texture now belongs to another
      if (!this.mipFresh.has(tex)) {
        if (this.mipDone > 0 && performance.now() >= this.mipDeadline) {
          this.mipLate.set(tex, e);
          continue;
        }
        this.buildMips(tex, data);
        this.mipDone++;
      }
      this.markDirty(e.surface.tx(e.key) * TILE, e.surface.ty(e.key) * TILE);
    }
  }

  private drawTiles(
    p: Program,
    map: Map<number, WebGLTexture> | undefined,
    surface: TiledSurface,
    tiles: number[],
    paper: boolean,
    doc: Document,
    m: { ox: number; oy: number; s: number },
    sampler: WebGLSampler,
    /** Plane height, when the part of each tile that has pixels is the only part to shade (a whole-page compose; see `tileBounds`). */
    cullH?: number,
  ): void {
    const gl = this.gl;
    if (paper) {
      this.bindTexture(0, this.dummy, this.nearest);
      gl.uniform2f(p.u.u_origin!, m.ox, m.oy);
      gl.uniform2f(p.u.u_size!, doc.width * m.s, doc.height * m.s);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this.fill += doc.width * m.s * doc.height * m.s;
      return;
    }
    const size = TILE * m.s;
    gl.uniform2f(p.u.u_size!, size, size);
    const mips = sampler === this.mip;
    // A transparent pixel leaves the backdrop as it is, so only the box that holds the tile's pixels is shaded (the scissor
    // keeps the rest of the quad from running the shader), widened by what the sampling filters can spread.
    const pad = m.s < 1 ? 1 << MIP_LEVELS : 2;
    if (cullH !== undefined) gl.enable(gl.SCISSOR_TEST);
    for (const key of tiles) {
      const tex = map!.get(key)!;
      const ox = m.ox + surface.tx(key) * size;
      const oy = m.oy + surface.ty(key) * size;
      if (cullH !== undefined) {
        const b = this.tileBounds(tex, surface.getByKey(key));
        if (!b) continue;
        const x0 = Math.max(Math.floor(ox + (b.x0 - pad) * m.s), Math.floor(ox));
        const x1 = Math.min(Math.ceil(ox + (b.x1 + pad) * m.s), Math.ceil(ox + size));
        const y0 = Math.max(Math.floor(oy + (b.y0 - pad) * m.s), Math.floor(oy));
        const y1 = Math.min(Math.ceil(oy + (b.y1 + pad) * m.s), Math.ceil(oy + size));
        if (x1 <= x0 || y1 <= y0) continue;
        gl.scissor(x0, cullH - y1, x1 - x0, y1 - y0);
        this.fill += (x1 - x0) * (y1 - y0);
      } else {
        this.fill += size * size;
      }
      this.bindTexture(0, tex, mips && !this.ensureMips(tex, surface.getByKey(key), map!, surface, key) ? this.linear : sampler);
      gl.uniform2f(p.u.u_origin!, ox, oy);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    if (cullH !== undefined) gl.disable(gl.SCISSOR_TEST);
  }

  /** Where the tile has visible pixels (null: none), kept until the texture is uploaded again. Unknown until a whole-page compose asks. */
  private tileBounds(tex: WebGLTexture, data: Uint8ClampedArray | undefined): TileBounds | null {
    if (!data) return null;
    let b = this.bounds.get(tex);
    if (b === undefined) {
      b = alphaBounds(data, TILE);
      this.bounds.set(tex, b);
    }
    return b;
  }

  /**
   * Render a page rectangle at 1:1 into an RGBA8 buffer, straight alpha and no
   * checkerboard: what the CPU compositor produces, for comparing the two.
   */
  snapshot(rect: { x: number; y: number; w: number; h: number }): Uint8Array {
    const doc = this.doc!;
    const gl = this.gl;
    const savedW = this.tw;
    const savedH = this.th;
    // Full 32-bit precision for exact comparison with the CPU compositor, when the GPU allows it.
    const wide = !!gl.getExtension('EXT_color_buffer_float');
    this.float32 = wide;
    this.ensureTargets(rect.w, rect.h);
    this.sync();
    const final = this.compose(doc, rect.w, rect.h, { ox: -rect.x, oy: -rect.y, s: 1 });
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.outTarget!.fbo);
    gl.viewport(0, 0, rect.w, rect.h);
    const p = this.programs.copy;
    gl.useProgram(p.prog);
    gl.uniform2f(p.u.u_origin!, 0, 0);
    gl.uniform2f(p.u.u_size!, rect.w, rect.h);
    gl.uniform2f(p.u.u_target!, rect.w, rect.h);
    this.bindTexture(1, final.tex, this.nearest);
    gl.uniform1i(p.u.u_img!, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const raw = new Uint8Array(rect.w * rect.h * 4);
    gl.readPixels(0, 0, rect.w, rect.h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    // GL rows run bottom to top; the engine's run top to bottom.
    const out = new Uint8Array(raw.length);
    for (let y = 0; y < rect.h; y++) out.set(raw.subarray((rect.h - 1 - y) * rect.w * 4, (rect.h - y) * rect.w * 4), y * rect.w * 4);
    this.float32 = false;
    if (savedW) this.ensureTargets(savedW, savedH);
    this.invalidate();
    return out;
  }

  /** Draw now instead of waiting for the next animation frame (tests and diagnostics). */
  flush(): void {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.draw();
  }

  /** The composite currently held for display, as device-pixel RGBA8 (straight alpha, top row first). */
  readDisplay(): { width: number; height: number; data: Uint8Array } {
    const gl = this.gl;
    // The composite is held on the plane (see draw).
    const { W, H } = this.planePixels();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.outTarget!.fbo);
    gl.viewport(0, 0, W, H);
    const p = this.programs.copy;
    gl.useProgram(p.prog);
    gl.uniform2f(p.u.u_origin!, 0, 0);
    gl.uniform2f(p.u.u_size!, W, H);
    gl.uniform2f(p.u.u_target!, W, H);
    this.bindTexture(1, this.cache!.tex, this.nearest);
    gl.uniform1i(p.u.u_img!, 1);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const raw = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const data = new Uint8Array(raw.length);
    for (let y = 0; y < H; y++) data.set(raw.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    return { width: W, height: H, data };
  }

  /** Number of tile textures alive on the GPU (for diagnostics). */
  get textureCount(): number {
    let n = 0;
    for (const m of this.textures.values()) n += m.size;
    return n;
  }
}
