//! Updates.
//!
//! The program works without a connection and never reaches the network on its own: an update is looked for only when the
//! person asks for it. On Windows the official Tauri updater does the work (`tauri-plugin-updater`, configured in
//! `tauri.conf.json`). Android has no such plugin, so the check, the download and the signature check are done here.
//!
//! Everything that touches the network happens in Rust, never in the web view: the web view's content security policy
//! allows no network at all, and the address the information is read from is fixed in this file, not given by the page.
//!
//! The pure parts (reading the information, comparing versions, checking a signature) do not depend on the platform and
//! are tested below; only the network and the installer hand-over are Android-only.

// Off Android only the pure parts are compiled in and used (by the tests).
#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use serde::Deserialize;
use std::collections::HashMap;

/// Where the information about the newest version is read from.
pub const MANIFEST_URL: &str = "https://github.com/DannyGT97/Lienzo/releases/latest/download/latest.json";
/// A download is only accepted from the releases of this repository.
pub const DOWNLOAD_PREFIX: &str = "https://github.com/DannyGT97/Lienzo/releases/download/";
/// The platform key of the Android build in the update information.
pub const ANDROID_PLATFORM: &str = "android-aarch64";
/// Public key (minisign) the Android updates are signed with. The private key is not in this repository.
pub const ANDROID_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEIyMjlFRDVFQUU3RUI2RDEKUldUUnRuNnVYdTBwc3RQZXBlN1hVM2FUV3BlVEtneU5iTys0bE9XazFHbzlHNFpFdHNLT1FtdmkK";
/// The update information is a few lines; anything bigger is not it.
pub const MAX_MANIFEST_BYTES: usize = 256 * 1024;
/// The largest package accepted.
pub const MAX_PACKAGE_BYTES: u64 = 150 * 1024 * 1024;

#[derive(Debug, Deserialize)]
struct PlatformEntry {
  url: String,
  signature: String,
}

#[derive(Debug, Deserialize)]
struct Manifest {
  version: String,
  #[serde(default)]
  notes: String,
  platforms: HashMap<String, PlatformEntry>,
}

/// A newer version that can be installed.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Available {
  pub version: String,
  pub notes: String,
  #[serde(skip)]
  pub url: String,
  #[serde(skip)]
  pub signature: String,
}

/// Whether `candidate` is a higher version than `current` (both `MAJOR.MINOR.PATCH`, a leading `v` allowed).
pub fn is_newer(current: &str, candidate: &str) -> Result<bool, String> {
  let parse = |v: &str| semver::Version::parse(v.trim().trim_start_matches('v')).map_err(|e| format!("versión no válida «{v}»: {e}"));
  Ok(parse(candidate)? > parse(current)?)
}

/// Only an address inside this repository's releases, over https, is ever downloaded.
pub fn check_download_url(url: &str) -> Result<(), String> {
  if url.starts_with(DOWNLOAD_PREFIX) && !url.contains("..") {
    Ok(())
  } else {
    Err("la dirección de descarga no es de las versiones oficiales de Lienzo".into())
  }
}

/// Read the update information for `platform`: `Ok(None)` when there is nothing newer than `current`.
pub fn parse_manifest(text: &str, platform: &str, current: &str) -> Result<Option<Available>, String> {
  if text.len() > MAX_MANIFEST_BYTES {
    return Err("la información de la actualización es demasiado grande".into());
  }
  let manifest: Manifest = serde_json::from_str(text).map_err(|e| format!("la información de la actualización no se entiende: {e}"))?;
  if !is_newer(current, &manifest.version)? {
    return Ok(None);
  }
  let entry = manifest.platforms.get(platform).ok_or_else(|| format!("la versión {} no trae paquete para este dispositivo", manifest.version))?;
  check_download_url(&entry.url)?;
  Ok(Some(Available { version: manifest.version.trim().trim_start_matches('v').to_string(), notes: manifest.notes, url: entry.url.clone(), signature: entry.signature.clone() }))
}

/// Check `bytes` against a minisign signature, both as Tauri writes them (base64 of the minisign text).
pub fn verify(bytes: &[u8], signature_b64: &str, pubkey_b64: &str) -> Result<(), String> {
  use base64::Engine;
  let decode = |label: &str, s: &str| -> Result<String, String> {
    let raw = base64::engine::general_purpose::STANDARD.decode(s.trim()).map_err(|e| format!("{label} no válida: {e}"))?;
    String::from_utf8(raw).map_err(|_| format!("{label} no válida"))
  };
  let key = minisign_verify::PublicKey::decode(&decode("clave", pubkey_b64)?).map_err(|e| format!("clave no válida: {e}"))?;
  let signature = minisign_verify::Signature::decode(&decode("firma", signature_b64)?).map_err(|e| format!("firma no válida: {e}"))?;
  key.verify(bytes, &signature, false).map_err(|_| "la firma del paquete no es correcta: no se instala".to_string())
}

// ---- Android: look, download, check, hand over to the system installer --------------------------------------------

#[cfg(target_os = "android")]
mod android {
  use super::*;
  use tauri::Manager;

  async fn get(url: &str, limit: u64) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
      .https_only(true)
      .timeout(std::time::Duration::from_secs(120))
      .build()
      .map_err(|e| e.to_string())?;
    let response = client.get(url).send().await.map_err(|_| "no hay conexión con GitHub".to_string())?;
    if !response.status().is_success() {
      return Err(format!("GitHub respondió {}", response.status()));
    }
    if response.content_length().is_some_and(|n| n > limit) {
      return Err("el archivo es demasiado grande".into());
    }
    let bytes = response.bytes().await.map_err(|_| "se cortó la descarga".to_string())?;
    if bytes.len() as u64 > limit {
      return Err("el archivo es demasiado grande".into());
    }
    Ok(bytes.to_vec())
  }

  async fn available(app: &tauri::AppHandle) -> Result<Option<Available>, String> {
    let text = String::from_utf8(get(MANIFEST_URL, MAX_MANIFEST_BYTES as u64).await?).map_err(|_| "la información de la actualización no se entiende".to_string())?;
    parse_manifest(&text, ANDROID_PLATFORM, &app.package_info().version.to_string())
  }

  pub async fn check(app: tauri::AppHandle) -> Result<Option<Available>, String> {
    available(&app).await
  }

  /// Download the newest package, check its signature, and give it to the system installer. Returns what the person must do next.
  pub async fn install(app: tauri::AppHandle) -> Result<String, String> {
    // The page only says "install": the address and the signature are read again here, never taken from the page.
    let update = available(&app).await?.ok_or_else(|| "ya tienes la última versión".to_string())?;
    let bytes = get(&update.url, MAX_PACKAGE_BYTES).await?;
    verify(&bytes, &update.signature, ANDROID_PUBKEY)?;
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("updates");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for old in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
      let _ = std::fs::remove_file(old.path());
    }
    let file = dir.join(format!("Lienzo-{}.apk", update.version));
    std::fs::write(&file, &bytes).map_err(|e| e.to_string())?;
    crate::install_apk(&app, file.to_string_lossy().into_owned())
  }
}

#[cfg(target_os = "android")]
pub use android::{check, install};

#[cfg(test)]
mod tests {
  use super::*;

  const GOOD: &str = r#"{ "version": "0.2.0", "notes": "Novedades", "platforms": {
    "android-aarch64": { "url": "https://github.com/DannyGT97/Lienzo/releases/download/v0.2.0/Lienzo-0.2.0-android-arm64.apk", "signature": "c2ln" },
    "windows-x86_64": { "url": "https://github.com/DannyGT97/Lienzo/releases/download/v0.2.0/Lienzo-0.2.0-windows-x64-setup.exe", "signature": "c2ln" } } }"#;

  #[test]
  fn compares_versions_by_number_not_by_text() {
    assert!(is_newer("0.1.0", "0.1.1").unwrap());
    assert!(is_newer("0.1.9", "0.1.10").unwrap());
    assert!(is_newer("0.9.0", "v1.0.0").unwrap());
    assert!(!is_newer("0.2.0", "0.2.0").unwrap());
    assert!(!is_newer("0.2.0", "0.1.9").unwrap());
    assert!(is_newer("0.1.0", "no").is_err());
  }

  #[test]
  fn offers_only_a_newer_version_with_a_package_for_the_device() {
    let found = parse_manifest(GOOD, ANDROID_PLATFORM, "0.1.0").unwrap().unwrap();
    assert_eq!(found.version, "0.2.0");
    assert!(found.url.ends_with("android-arm64.apk"));
    assert_eq!(parse_manifest(GOOD, ANDROID_PLATFORM, "0.2.0").unwrap(), None);
    assert_eq!(parse_manifest(GOOD, ANDROID_PLATFORM, "0.3.0").unwrap(), None);
    assert!(parse_manifest(GOOD, "linux-x86_64", "0.1.0").is_err());
  }

  #[test]
  fn refuses_a_package_from_anywhere_but_the_official_releases() {
    for bad in [
      "http://github.com/DannyGT97/Lienzo/releases/download/v1/x.apk",
      "https://evil.example/DannyGT97/Lienzo/releases/download/v1/x.apk",
      "https://github.com/other/Lienzo/releases/download/v1/x.apk",
      "https://github.com/DannyGT97/Lienzo/releases/download/../../x.apk",
    ] {
      assert!(check_download_url(bad).is_err(), "{bad}");
      let text = GOOD.replace("https://github.com/DannyGT97/Lienzo/releases/download/v0.2.0/Lienzo-0.2.0-android-arm64.apk", bad);
      assert!(parse_manifest(&text, ANDROID_PLATFORM, "0.1.0").is_err(), "{bad}");
    }
  }

  #[test]
  fn refuses_information_that_is_not_what_it_should_be() {
    assert!(parse_manifest("no es json", ANDROID_PLATFORM, "0.1.0").is_err());
    assert!(parse_manifest("{}", ANDROID_PLATFORM, "0.1.0").is_err());
    assert!(parse_manifest(&"x".repeat(MAX_MANIFEST_BYTES + 1), ANDROID_PLATFORM, "0.1.0").is_err());
  }

  // A key pair and a signature made with `tauri signer`, for the text "paquete de prueba".
  const TEST_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEIyMjlFRDVFQUU3RUI2RDEKUldUUnRuNnVYdTBwc3RQZXBlN1hVM2FUV3BlVEtneU5iTys0bE9XazFHbzlHNFpFdHNLT1FtdmkK";

  // The text "paquete de prueba", signed with `tauri signer sign` and the Android update key.
  const TEST_SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUUnRuNnVYdTBwc3M2RnJZbEdGL0JCY3c5bCs1WkdrRURYWVloZC82dUJWMERFOWM4eVlwdjBabkJkS2ZsUllvQ2NrZlo4Vm9EeDZnck16YzlaRi8wTWFEL2ViQWM4MGdjPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk0NTgyMDE2CWZpbGU6cGFxdWV0ZS50eHQKVkNpc3NvMENYS01YeWJzd1oxV0Y2bjNtV3BqUlRxNk10SmVXaFdTL2VQU0RXWXpUNWd4QUNtNEVTNnpRUUlCTDM0ak9CTG8xNGFGVTAwT2czeEdCQUE9PQo=";

  #[test]
  fn accepts_the_real_signature_and_nothing_else() {
    assert!(verify(b"paquete de prueba", TEST_SIGNATURE, ANDROID_PUBKEY).is_ok());
    assert!(verify(b"paquete de pruebA", TEST_SIGNATURE, ANDROID_PUBKEY).is_err(), "a changed package must not pass");
    assert!(verify(b"", TEST_SIGNATURE, ANDROID_PUBKEY).is_err());
  }

  #[test]
  fn refuses_a_signature_that_does_not_match() {
    assert!(verify(b"paquete", "no es base64!", TEST_PUBKEY).is_err());
    assert!(verify(b"paquete", "c2lnbmF0dXJl", TEST_PUBKEY).is_err()); // base64 of "signature": not a minisign file
    assert!(verify(b"paquete", "c2ln", "c2ln").is_err());
  }
}
