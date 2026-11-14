// A small Chrome DevTools Protocol client, and the way to reach the app on each target.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Connect to the page at `http://127.0.0.1:<port>`; `ev(expr)` runs JavaScript in it and returns the value. */
export async function connect(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = list.find((t) => t.type === 'page' && /tauri|localhost|lienzo/i.test(t.url + t.title)) ?? list.find((t) => t.type === 'page');
  if (!page) throw new Error(`No hay ninguna página en el puerto ${port}: ${JSON.stringify(list)}`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    }
  };
  const call = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const ev = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 1_800_000 });
    const ex = r.result?.exceptionDetails;
    if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
    return r.result?.result?.value;
  };
  return { ev, call, title: page.title, url: page.url, close: () => ws.close() };
}

function adbPath() {
  const sdk = process.env.ANDROID_HOME ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
  const exe = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  return existsSync(exe) ? exe : 'adb';
}

/**
 * The port the app's debug page can be reached on.
 *  - tablet: forwards the WebView's debug socket of the installed debug app (only `pidof` and `forward` are run on the device).
 *  - desktop: the WebView2 / Chrome remote debugging port (start the app with `--remote-debugging-port=9222`, or set
 *    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" before launching the installed app).
 */
export function reach(target, opts = {}) {
  if (target === 'desktop') return opts.port ?? 9222;
  if (target !== 'tablet') throw new Error(`Destino desconocido: ${target} (usa tablet o desktop)`);
  const adb = adbPath();
  const pkg = opts.package ?? 'app.lienzo.studio.debug';
  const devArgs = opts.device ? ['-s', opts.device] : [];
  const pid = execFileSync(adb, [...devArgs, 'shell', 'pidof', pkg]).toString().trim();
  if (!pid) throw new Error(`La app ${pkg} no está abierta en la tableta.`);
  const port = opts.port ?? 9333;
  execFileSync(adb, [...devArgs, 'forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid.split(/\s+/)[0]}`]);
  return port;
}
