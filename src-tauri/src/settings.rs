//! A copy of the app's settings kept in a file of its own (`settings.json` in the app's config folder).
//!
//! The page keeps its settings in `localStorage`, which belongs to the WebView: it is lost when the WebView's data is cleared,
//! is a different store for the dev server and the installed app, and the last changes can be missing when an update closes the
//! app abruptly. The page mirrors every change to this file and restores from it at start (see `src/app/settings-store.ts`).

use std::{fs, io::ErrorKind, path::Path};
use tauri::Manager;

const FILE: &str = "settings.json";
/// Settings are a few kilobytes; anything much bigger is not settings.
const MAX_BYTES: usize = 2 * 1024 * 1024;

fn read_file(path: &Path) -> Result<Option<String>, String> {
  match fs::read_to_string(path) {
    Ok(text) => Ok(Some(text)),
    Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
    Err(e) => Err(format!("no se pudieron leer los ajustes: {e}")),
  }
}

/// Written next to the old copy and renamed over it, so a crash never leaves half a file.
fn write_file(path: &Path, data: &str) -> Result<(), String> {
  if data.len() > MAX_BYTES {
    return Err("los ajustes son demasiado grandes".into());
  }
  let parent = path.parent().ok_or("ruta no válida")?;
  fs::create_dir_all(parent).map_err(|e| format!("no se pudo crear la carpeta de ajustes: {e}"))?;
  let tmp = path.with_extension("json.tmp");
  fs::write(&tmp, data).map_err(|e| format!("no se pudieron escribir los ajustes: {e}"))?;
  fs::rename(&tmp, path).map_err(|e| {
    let _ = fs::remove_file(&tmp);
    format!("no se pudieron guardar los ajustes: {e}")
  })
}

fn path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
  app.path().app_config_dir().map(|d| d.join(FILE)).map_err(|e| e.to_string())
}

/// The saved settings text, or `None` when none were saved yet.
#[tauri::command]
pub async fn settings_read(app: tauri::AppHandle) -> Result<Option<String>, String> {
  let path = path(&app)?;
  tauri::async_runtime::spawn_blocking(move || read_file(&path)).await.map_err(|e| e.to_string())?
}

/// Replace the saved settings with `data` (JSON text made by the page).
#[tauri::command]
pub async fn settings_write(app: tauri::AppHandle, data: String) -> Result<(), String> {
  let path = path(&app)?;
  tauri::async_runtime::spawn_blocking(move || write_file(&path, &data)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("lienzo-settings-test-{}-{name}", std::process::id()))
  }

  #[test]
  fn missing_file_is_none_and_a_write_is_read_back() {
    let dir = temp("a");
    let file = dir.join(FILE);
    assert_eq!(read_file(&file).unwrap(), None);
    write_file(&file, "{\"a\":1}").unwrap();
    write_file(&file, "{\"a\":2}").unwrap(); // replaces the first copy
    assert_eq!(read_file(&file).unwrap().as_deref(), Some("{\"a\":2}"));
    assert!(!dir.join("settings.json.tmp").exists());
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn refuses_something_that_is_not_settings_sized() {
    let dir = temp("b");
    assert!(write_file(&dir.join(FILE), &"x".repeat(MAX_BYTES + 1)).is_err());
    let _ = fs::remove_dir_all(&dir);
  }
}
