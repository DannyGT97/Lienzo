/**
 * Looking for and installing a new version of Lienzo.
 *
 * The program works without a connection and never reaches the network by itself. This only runs when the person chooses
 * Ayuda ▸ Buscar actualizaciones, and it asks first. The network is never used from the web view (its security policy allows
 * none): the check and the download are done by the app's native side, from a fixed address on GitHub, and a package is
 * installed only when its signature is right (Windows: the Tauri updater; Android: `src-tauri/src/update.rs`).
 */
import { isApp, onAndroid } from './file-io';

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
  confirm: (message: string, okLabel: string) => Promise<boolean>;
  alert: (message: string, title: string) => Promise<unknown> | void;
  busy: (text: string) => { done: () => void };
  say: (text: string) => void;
  /** Called right before installing: the work in progress is written to the autosave. */
  beforeInstall: () => Promise<void>;
}

const TITLE = 'Actualizaciones';
const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Ask, look, offer, install. Nothing touches the network before the person has agreed. */
export async function checkForUpdates(d: UpdatesDeps): Promise<void> {
  if (!d.available()) {
    await d.alert('Las actualizaciones solo están en la aplicación instalada (Windows y Android).', TITLE);
    return;
  }
  const agreed = await d.confirm(
    'Lienzo se conectará a github.com para ver si hay una versión nueva. No envía nada tuyo ni de tus dibujos. Sin conexión, el programa sigue funcionando igual.',
    'Buscar',
  );
  if (!agreed) return;

  let offer: UpdateOffer | null;
  const looking = d.busy('Buscando actualizaciones…');
  try {
    offer = await d.find();
  } catch (err) {
    looking.done();
    await d.alert(`No se pudo comprobar si hay actualizaciones. Puede que no haya conexión o que GitHub no responda.\n(Detalle: ${reason(err)})\nLienzo sigue funcionando sin conexión.`, TITLE);
    return;
  }
  looking.done();
  if (!offer) {
    d.say(`Lienzo ${await d.version().catch(() => '')} está al día.`.replace('  ', ' '));
    return;
  }

  const notes = offer.notes.trim().slice(0, 600);
  const go = await d.confirm(
    `Hay una versión nueva: ${offer.version}.${notes ? `\n\n${notes}` : ''}\n\nSe descargará de github.com y se comprobará su firma antes de instalarla. ¿Instalar ahora?`,
    'Instalar',
  );
  if (!go) return;

  await d.beforeInstall().catch(() => undefined);
  const installing = d.busy('Descargando la actualización…');
  try {
    const next = await offer.install();
    installing.done();
    if (next === 'permission') {
      await d.alert('Android necesita tu permiso para instalar: activa «Permitir de esta fuente» para Lienzo y vuelve a elegir Buscar actualizaciones.', TITLE);
    } else if (next === 'installer') {
      d.say('Confirma la instalación en la ventana de Android.');
    }
  } catch (err) {
    installing.done();
    await d.alert(`No se pudo instalar la actualización: ${reason(err)}.\nTu versión actual sigue como estaba.`, TITLE);
  }
}
