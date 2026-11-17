// Builds, signs and describes a release: the Windows installer, the Android package and `latest.json`.
//
//   node scripts/release.mjs <keys-folder> [--solo-android]
//
// With `--solo-android` only the signed Android package is made (in `release-out-android/`), to install it on a device with
// `adb install -r`: no Windows build, no `latest.json`, nothing to publish.
//
// <keys-folder> holds `desktop/` and `android/` with the signing keys and their passwords (see `LEEME.txt` there). Nothing
// secret is stored in this repository. The result goes to `release-out/`; publish its files as a GitHub release whose tag is
// `v<version>`, and keep `latest.json` among them: the app looks for it at
// https://github.com/DannyGT97/Lienzo/releases/latest/download/latest.json
//
// The version is the one in package.json (and tauri.conf.json, Cargo.toml: keep the three equal).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const keys = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(join(keys, 'android', 'lienzo-release.jks'))) {
  console.error('Uso: node scripts/release.mjs <carpeta-de-claves>   (con desktop/ y android/)');
  process.exit(1);
}
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const repo = 'DannyGT97/Lienzo';
const download = `https://github.com/${repo}/releases/download/v${version}`;
const androidOnly = process.argv.includes('--solo-android');
const out = resolve(androidOnly ? 'release-out-android' : 'release-out');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const secret = (file) => readFileSync(join(keys, file), 'utf8').trim();
const tauri = (args, env = {}) => execFileSync(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', ...args], { stdio: 'inherit', env: { ...process.env, ...env } });
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// Windows: the installer and its update signature
let winName = '';
let winSig = '';
if (!androidOnly) {
  tauri(['build', '--bundles', 'nsis'], {
    TAURI_SIGNING_PRIVATE_KEY: join(keys, 'desktop', 'actualizador-escritorio.key'), // a path or the key itself
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: secret('desktop/actualizador-escritorio.password.txt'),
  });
  const target = process.env.CARGO_TARGET_DIR ?? 'src-tauri/target';
  const setup = join(target, 'release/bundle/nsis', `Lienzo_${version}_x64-setup.exe`);
  winName = `Lienzo-${version}-windows-x64-setup.exe`;
  copyFileSync(setup, join(out, winName));
  winSig = readFileSync(`${setup}.sig`, 'utf8').trim();

}

// Android: build, align, sign with the app key, then sign the package for the updater
tauri(['android', 'build', '--apk', '--target', 'aarch64']);
const sdk = process.env.ANDROID_HOME ?? join(process.env.LOCALAPPDATA ?? '', 'Android/Sdk');
const buildTools = join(sdk, 'build-tools', process.env.BUILD_TOOLS ?? '36.0.0');
const unsigned = 'src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk';
const aligned = join(out, 'aligned.apk');
const apkName = `Lienzo-${version}-android-arm64.apk`;
const apk = join(out, apkName);
const ext = process.platform === 'win32' ? '.exe' : '';
execFileSync(join(buildTools, `zipalign${ext}`), ['-f', '-p', '4', unsigned, aligned], { stdio: 'inherit' });
const storePass = secret('android/LEEME.txt').match(/Contrasena: (.+)/)?.[1]?.trim();
// apksigner's own jar, run with Java directly: no shell, so a keys folder with spaces in its name works.
const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', `java${ext}`) : 'java';
execFileSync(java, ['-jar', join(buildTools, 'lib', 'apksigner.jar'), 'sign', '--ks', join(keys, 'android', 'lienzo-release.jks'), '--ks-key-alias', 'lienzo', '--ks-pass', `pass:${storePass}`, '--key-pass', `pass:${storePass}`, '--out', apk, aligned], { stdio: 'inherit' });
rmSync(aligned);
rmSync(`${apk}.idsig`, { force: true });
if (androidOnly) {
  console.log(`\nListo: ${apk}`);
  process.exit(0);
}
tauri(['signer', 'sign', '-f', join(keys, 'android', 'actualizador-android.key'), '-p', secret('android/actualizador-android.password.txt'), apk]);
const apkSig = readFileSync(`${apk}.sig`, 'utf8').trim();
rmSync(`${apk}.sig`);

// The information the app reads when the person asks for updates
const notes = existsSync('release-notes.md') ? readFileSync('release-notes.md', 'utf8').trim() : `Lienzo ${version}`;
writeFileSync(
  join(out, 'latest.json'),
  JSON.stringify(
    {
      version,
      notes,
      pub_date: new Date().toISOString(),
      platforms: {
        'windows-x86_64': { signature: winSig, url: `${download}/${winName}` },
        'android-aarch64': { signature: apkSig, url: `${download}/${apkName}` },
      },
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(join(out, 'SHA256SUMS.txt'), `${sha(join(out, apkName))}  ${apkName}\n${sha(join(out, winName))}  ${winName}\n`);
console.log(`\nListo en release-out/ (versión ${version}).`);
