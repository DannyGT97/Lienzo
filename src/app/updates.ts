/**
 * Looking for and installing a new version of Lienzo.
 *
 * The program works without a connection and never reaches the network by itself. This only runs when the person chooses
 * Ayuda ▸ Buscar actualizaciones, and it asks first. The network is never used from the web view (its security policy allows
 * none): the check and the download are done by the app's native side, from a fixed address on GitHub, and a package is
 * installed only when its signature is right (Windows: the Tauri updater; Android: `src-tauri/src/update.rs`).
 */
import { isApp, onAndroid } from './file-io';
import type { UpdatesWindow } from './updates-window';

/** What happens next after `install()`: Windows closes the app to install; Android opens the system installer, or its settings. */
export type InstallResult = 'closing' | 'installer' | 'permission';

export interface UpdateOffer {
  version: string;
  notes: string;
  install(): Promise<InstallResult>;
}

/** The newest version if it is newer than the one running, or null. Throws when it cannot be looked up (no connection…). */
export async function findUpdate(): Promise<UpdateOffer | null> {
  if (onAndroid()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const found = await invoke<{ version: string; notes: string } | null>('android_update_check');
    return found ? { version: found.version, notes: found.notes, install: async () => (await invoke<InstallResult>('android_update_install')) } : null;
  }
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body ?? '',
    install: async () => {
      await update.downloadAndInstall();
      return 'closing';
    },
  };
}

export async function currentVersion(): Promise<string> {
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}

/** Updates exist only in the installed app (Windows and Android), not in a browser. */
export const updatesAvailable = (): boolean => isApp();

export interface UpdatesDeps {
  available: () => boolean;
  version: () => Promise<string>;
  find: () => Promise<UpdateOffer | null>;
  /** One window that stays open and changes screens from the first question to the result. */
  window: () => UpdatesWindow;
  /** Called right before installing: the work in progress is written to the autosave. */
  beforeInstall: () => Promise<void>;
}

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Ask, look, offer, install. Nothing touches the network before the person has agreed. */
export async function checkForUpdates(d: UpdatesDeps): Promise<void> {
  const win = d.window();
  try {
    if (!d.available()) {
      await win.show({ kind: 'unavailable' });
      return;
    }
    const current = await d.version().catch(() => '');
    if ((await win.show({ kind: 'intro', current })) !== 'primary') return;

    let offer: UpdateOffer | null;
    void win.show({ kind: 'checking' });
    try {
      offer = await d.find();
    } catch (err) {
      await win.show({ kind: 'error', title: 'No se pudo comprobar', detail: `Puede que no haya conexión o que GitHub no responda.
(Detalle: ${reason(err)})` });
      return;
    }
    if (!offer) {
      await win.show({ kind: 'uptodate', current });
      return;
    }

    if ((await win.show({ kind: 'available', current, version: offer.version, notes: offer.notes })) !== 'primary') return;

    await d.beforeInstall().catch(() => undefined);
    void win.show({ kind: 'installing', version: offer.version });
    try {
      const next = await offer.install();
      if (next === 'permission') await win.show({ kind: 'permission' });
      else if (next === 'installer') await win.show({ kind: 'handoff' });
    } catch (err) {
      await win.show({ kind: 'error', title: 'No se pudo instalar', detail: `${reason(err)}.
Tu versión actual sigue como estaba.` });
    }
  } finally {
    win.close();
  }
}
