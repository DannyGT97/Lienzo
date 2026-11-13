// Tablet / phone simulator: real Chrome with touch + coarse pointer emulation and real multi-touch input (CDP).
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PROFILES = {
  // CSS pixels; the real ROD2-W09 reports ~1280x800 at 60 Hz (estimate from docs/capturas, not measured).
  tablet: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 },
  'tablet-portrait': { viewport: { width: 800, height: 1280 }, deviceScaleFactor: 2 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
  desktop: { viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1, touch: false },
};
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const OUT = `${ROOT}.sim/`;
const URL_APP = process.env.LIENZO_URL ?? 'http://localhost:5173/';

async function serverUp() {
  try {
    return (await fetch(URL_APP)).ok;
  } catch {
    return false;
  }
}

/** Starts Vite if nothing answers on the dev port. Returns a stop function. */
export async function ensureServer() {
  if (await serverUp()) return () => {};
  const child = spawn('npm.cmd', ['run', 'dev', '--', '--port', '5173', '--strictPort'], { shell: true, stdio: 'ignore', cwd: ROOT });
  for (let i = 0; i < 60 && !(await serverUp()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await serverUp())) throw new Error('dev server did not start');
  return () => spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
}

export async function openApp(profileName = 'tablet') {
  const p = PROFILES[profileName];
  if (!p) throw new Error(`unknown profile ${profileName}; use ${Object.keys(PROFILES).join(', ')}`);
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const touch = p.touch !== false;
  const context = await browser.newContext({
    viewport: p.viewport,
    deviceScaleFactor: p.deviceScaleFactor,
    hasTouch: touch,
    isMobile: touch,
    locale: 'es-ES',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL_APP);
  await page.waitForFunction(() => window.__lienzo);
  const later = page.getByRole('button', { name: 'Ahora no' });
  if (await later.isVisible().catch(() => false)) await later.click();
  const cdp = await context.newCDPSession(page);
  return { browser, page, sim: new Sim(page, cdp, profileName, errors) };
}

export class Sim {
  constructor(page, cdp, name, errors) {
    this.page = page;
    this.cdp = cdp;
    this.name = name;
    this.errors = errors;
  }

  shot(label) {
    return this.page.screenshot({ path: `${OUT}${this.name}-${label}.png` });
  }

  /** What the app's CSS decided for this device. */
  media() {
    return this.page.evaluate(() => ({
      coarse: matchMedia('(pointer:coarse)').matches,
      hoverNone: matchMedia('(hover:none)').matches,
      drawer: matchMedia('(max-width:1000px)').matches,
      width: innerWidth,
      height: innerHeight,
    }));
  }

  /** Elements that stick out of a container sideways, e.g. text that spills out of a compact dock. */
  overflow(selector) {
    return this.page.evaluate((sel) => {
      const root = document.querySelector(sel);
      if (!root) return null;
      const rr = root.getBoundingClientRect();
      const out = [];
      root.querySelectorAll('*').forEach((e) => {
        const r = e.getBoundingClientRect();
        if (r.width && r.height && (r.right > rr.right + 1 || r.left < rr.left - 1)) {
          out.push(`${e.tagName.toLowerCase()}.${String(e.className?.baseVal ?? e.className)}`.slice(0, 60));
        }
      });
      return [...new Set(out)].slice(0, 15);
    }, selector);
  }

  view() {
    return this.page.evaluate(() => {
      const v = window.__lienzo.view;
      return { rot: v.rot, tilt: v.tilt ?? 0, scale: v.scale, x: v.x, y: v.y };
    });
  }

  touch(type, points) {
    return this.cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id, radiusX: 8, radiusY: 8, force: 0.5 })),
    });
  }

  async tap(x, y) {
    await this.touch('touchStart', [{ x, y }]);
    await this.touch('touchEnd', []);
  }

  /** Two fingers around (cx,cy) turning by `degrees` clockwise; `onStep` runs after each move (e.g. to sample the view). */
  async twist(cx, cy, degrees, { radius = 120, steps = 30, onStep } = {}) {
    const at = (deg) =>
      [0, 180].map((o) => {
        const a = ((deg + o) * Math.PI) / 180;
        return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
      });
    await this.touch('touchStart', at(0));
    for (let i = 1; i <= steps; i++) {
      await this.touch('touchMove', at((degrees * i) / steps));
      await this.page.waitForTimeout(16);
      if (onStep) await onStep(i);
    }
    await this.touch('touchEnd', []);
  }

  async pinch(cx, cy, from, to, { steps = 20 } = {}) {
    const at = (r) => [
      { x: cx - r, y: cy },
      { x: cx + r, y: cy },
    ];
    await this.touch('touchStart', at(from));
    for (let i = 1; i <= steps; i++) {
      await this.touch('touchMove', at(from + ((to - from) * i) / steps));
      await this.page.waitForTimeout(16);
    }
    await this.touch('touchEnd', []);
  }
}
