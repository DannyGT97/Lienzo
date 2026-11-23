//! The file library: one folder owned by the app, where the home screen keeps documents and the folders the person creates.
//!
//! On Windows it is `Documents\Lienzo`. On Android it is the app's folder on shared storage
//! (`Android/data/app.lienzo.studio/files/Lienzo`, see `appFolder` in `DocPickerPlugin.kt`), which the app can use without any
//! permission and which a computer sees over USB. Every command takes a path relative to that folder ("Manga/cap1.lienzo"); a
//! path that is absolute, climbs out with `..`, or has a name the file systems would refuse is turned down before anything is touched.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
  name: String,
  dir: bool,
  size: u64,
  /// Milliseconds since 1970 (0 when the system does not say).
  modified: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
  /// The folder, as the person would find it in a file explorer.
  path: String,
  /// Whether other apps and a computer can see it (the app's folder on shared storage); false when it is private to the app.
  visible: bool,
  /// Whether the system's file explorer can be opened on it (not on Android).
  reveal: bool,
  /// Android: the library is still in the app's own folder because the person has not allowed access to all files yet.
  needs_access: bool,
}

#[cfg(target_os = "android")]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppFolder {
  path: String,
  shared: bool,
  needs_access: bool,
}

/// The library folder, whether other apps can see it, and whether the app still needs the person's permission to use the shared
/// folder (Android only; until it is given the app's own folder is used).
fn root_full(app: &tauri::AppHandle) -> Result<(PathBuf, bool, bool), String> {
  #[cfg(target_os = "android")]
  let (dir, visible, needs_access) = {
    let picker = app.state::<crate::DocPicker>();
    let folder: AppFolder = picker.0.run_mobile_plugin("appFolder", serde_json::json!({})).map_err(|e| e.to_string())?;
    (PathBuf::from(folder.path), folder.shared, folder.needs_access)
  };
  #[cfg(not(target_os = "android"))]
  let (dir, visible, needs_access) = (app.path().document_dir().map_err(|e| format!("no se encontró la carpeta Documentos: {e}"))?.join("Lienzo"), true, false);
  fs::create_dir_all(&dir).map_err(|e| format!("no se pudo crear la carpeta de la biblioteca: {e}"))?;
  Ok((dir, visible, needs_access))
}

fn root(app: &tauri::AppHandle) -> Result<(PathBuf, bool), String> {
  let (dir, visible, _) = root_full(app)?;
  Ok((dir, visible))
}

/// A name the file systems of every platform keep: no separators or reserved characters, not hidden, not a device name.
fn good_part(part: &str) -> bool {
  let t = part.trim();
  if t.is_empty() || t.len() > 240 || part != t || part.starts_with('.') || part.ends_with('.') {
    return false;
  }
  if part.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c)) {
    return false;
  }
  let stem = part.split('.').next().unwrap_or("").to_ascii_lowercase();
  !(matches!(stem.as_str(), "con" | "prn" | "aux" | "nul") || (stem.len() == 4 && (stem.starts_with("com") || stem.starts_with("lpt")) && stem.as_bytes()[3].is_ascii_digit()))
}

/// `rel` inside `base`, or why it is not allowed. An empty `rel` is the library folder itself.
fn resolve(base: &Path, rel: &str) -> Result<PathBuf, String> {
  let mut out = base.to_path_buf();
  for part in rel.split('/').filter(|p| !p.is_empty()) {
    if !good_part(part) {
      return Err(format!("nombre no válido: «{part}»"));
    }
    out.push(part);
  }
  Ok(out)
}

fn millis(meta: &fs::Metadata) -> u64 {
  meta
    .modified()
    .ok()
    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
    .map(|d| d.as_millis() as u64)
    .unwrap_or(0)
}

fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
  if from.is_dir() {
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for item in fs::read_dir(from).map_err(|e| e.to_string())? {
      let item = item.map_err(|e| e.to_string())?;
      copy_tree(&item.path(), &to.join(item.file_name()))?;
    }
    Ok(())
  } else {
    fs::copy(from, to).map(|_| ()).map_err(|e| e.to_string())
  }
}

#[tauri::command]
pub async fn library_info(app: tauri::AppHandle) -> Result<Info, String> {
  let (dir, visible, needs_access) = root_full(&app)?;
  Ok(Info { path: dir.to_string_lossy().into_owned(), visible, reveal: cfg!(not(target_os = "android")), needs_access })
}

#[tauri::command]
pub async fn library_list(app: tauri::AppHandle, rel: String) -> Result<Vec<Entry>, String> {
  let (base, _) = root(&app)?;
  let dir = resolve(&base, &rel)?;
  tauri::async_runtime::spawn_blocking(move || {
    let mut out = Vec::new();
    for item in fs::read_dir(&dir).map_err(|e| format!("no se pudo leer la carpeta: {e}"))? {
      let Ok(item) = item else { continue };
      let Ok(meta) = item.metadata() else { continue };
      let name = item.file_name().to_string_lossy().into_owned();
      if name.starts_with('.') {
        continue;
      }
      out.push(Entry { name, dir: meta.is_dir(), size: if meta.is_dir() { 0 } else { meta.len() }, modified: millis(&meta) });
    }
    Ok(out)
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn library_mkdir(app: tauri::AppHandle, rel: String) -> Result<(), String> {
  let (base, _) = root(&app)?;
  let dir = resolve(&base, &rel)?;
  if dir.exists() {
    return Err("ya existe algo con ese nombre".into());
  }
  fs::create_dir_all(&dir).map_err(|e| format!("no se pudo crear la carpeta: {e}"))
}

/// Rename or move a file or folder. Refuses to replace anything and to move a folder into itself.
#[tauri::command]
pub async fn library_move(app: tauri::AppHandle, from: String, to: String) -> Result<(), String> {
  let (base, _) = root(&app)?;
  move_entry(&base, &from, &to)
}

/// Whether `a` and `b` are one and the same file or folder (a rename that only changes the case of its name, on a file system that
/// ignores case). Asked of the file system, not of the spelling: on one that tells "foo" from "Foo" (Android) they are two entries.
fn same_entry(a: &Path, b: &Path) -> bool {
  match (fs::canonicalize(a), fs::canonicalize(b)) {
    (Ok(x), Ok(y)) => x == y,
    _ => false,
  }
}

fn move_entry(base: &Path, from: &str, to: &str) -> Result<(), String> {
  let (a, b) = (resolve(base, from)?, resolve(base, to)?);
  if a == base {
    return Err("la carpeta de la biblioteca no se puede mover".into());
  }
  if b.starts_with(&a) {
    return Err("una carpeta no se puede mover dentro de sí misma".into());
  }
  if b.exists() && !same_entry(&a, &b) {
    return Err("ya existe algo con ese nombre".into());
  }
  fs::rename(&a, &b).map_err(|e| format!("no se pudo mover: {e}"))
}

#[tauri::command]
pub async fn library_copy(app: tauri::AppHandle, from: String, to: String) -> Result<(), String> {
  let (base, _) = root(&app)?;
  let (a, b) = (resolve(&base, &from)?, resolve(&base, &to)?);
  if b.exists() {
    return Err("ya existe algo con ese nombre".into());
  }
  if b.starts_with(&a) {
    return Err("una carpeta no se puede copiar dentro de sí misma".into());
  }
  tauri::async_runtime::spawn_blocking(move || copy_tree(&a, &b)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn library_remove(app: tauri::AppHandle, rel: String) -> Result<(), String> {
  let (base, _) = root(&app)?;
  let path = resolve(&base, &rel)?;
  if path == base {
    return Err("la carpeta de la biblioteca no se puede eliminar".into());
  }
  if path.is_dir() {
    fs::remove_dir_all(&path)
  } else {
    fs::remove_file(&path)
  }
  .map_err(|e| format!("no se pudo eliminar: {e}"))
}

/// The bytes of a file, as a binary response (no JSON detour for a big document).
#[tauri::command]
pub async fn library_read(app: tauri::AppHandle, rel: String) -> Result<tauri::ipc::Response, String> {
  let (base, _) = root(&app)?;
  let path = resolve(&base, &rel)?;
  let bytes = tauri::async_runtime::spawn_blocking(move || fs::read(path).map_err(|e| format!("no se pudo leer el archivo: {e}")))
    .await
    .map_err(|e| e.to_string())??;
  Ok(tauri::ipc::Response::new(bytes))
}

/// Bytes `start` to `end` of a file (as many as there are), so the picture of a big document is found without reading all of it.
#[tauri::command]
pub async fn library_read_range(app: tauri::AppHandle, rel: String, start: u64, end: u64) -> Result<tauri::ipc::Response, String> {
  use std::io::{Read, Seek, SeekFrom};
  let (base, _) = root(&app)?;
  let path = resolve(&base, &rel)?;
  let bytes = tauri::async_runtime::spawn_blocking(move || {
    let mut file = fs::File::open(path).map_err(|e| format!("no se pudo leer el archivo: {e}"))?;
    file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    file.take(end.saturating_sub(start).min(256 * 1024 * 1024)).read_to_end(&mut out).map_err(|e| e.to_string())?;
    Ok::<Vec<u8>, String>(out)
  })
  .await
  .map_err(|e| e.to_string())??;
  Ok(tauri::ipc::Response::new(bytes))
}

/// Replace a file's contents with `data` (base64, for the reason given at `write_document`). The new copy is written next to
/// the old one and renamed over it, so a failed write never leaves half a document.
#[tauri::command]
pub async fn library_write(app: tauri::AppHandle, rel: String, data: String) -> Result<(), String> {
  use base64::Engine;
  let (base, _) = root(&app)?;
  let path = resolve(&base, &rel)?;
  if path == base || path.is_dir() {
    return Err("ahí no se puede guardar un archivo".into());
  }
  tauri::async_runtime::spawn_blocking(move || {
    let bytes = base64::engine::general_purpose::STANDARD
      .decode(data.as_bytes())
      .map_err(|e| format!("el archivo preparado no es válido: {e}"))?;
    drop(data);
    let parent = path.parent().ok_or("ruta no válida")?;
    if !parent.is_dir() {
      return Err("la carpeta ya no existe".to_string());
    }
    let tmp = parent.join(format!(".{}.tmp", path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));
    fs::write(&tmp, &bytes).map_err(|e| format!("no se pudo escribir: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| {
      let _ = fs::remove_file(&tmp);
      format!("no se pudo guardar: {e}")
    })
  })
  .await
  .map_err(|e| e.to_string())?
}

/// The hidden temporary file a document is written to before it takes the real one's place.
fn temp_beside(path: &Path) -> PathBuf {
  path.with_file_name(format!(".{}.tmp", path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()))
}

/// The same write as `library_write`, handed over in pieces (see `write_document_begin` in lib.rs for why): `begin` starts the hidden
/// temporary file, each `chunk` (base64) is appended to it, `commit` renames it over the real file, `abort` drops it. The real file
/// is not touched until `commit`, which is one step, so a cut leaves the old document or the new one.
#[tauri::command]
pub async fn library_write_begin(app: tauri::AppHandle, rel: String) -> Result<(), String> {
  let (base, _) = root(&app)?;
  let path = resolve(&base, &rel)?;
  if path == base || path.is_dir() {
    return Err("ahí no se puede guardar un archivo".into());
  }
  tauri::async_runtime::spawn_blocking(move || {
    if !path.parent().is_some_and(|p| p.is_dir()) {
      return Err("la carpeta ya no existe".to_string());
    }
    fs::File::create(temp_beside(&path)).map(|_| ()).map_err(|e| format!("no se pudo escribir: {e}"))
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn library_write_chunk(app: tauri::AppHandle, rel: String, data: String) -> Result<(), String> {
  use base64::Engine;
  use std::io::Write;
  let (base, _) = root(&app)?;
  let path = resolve(&base, &rel)?;
  tauri::async_runtime::spawn_blocking(move || {
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.as_bytes()).map_err(|e| format!("el archivo preparado no es válido: {e}"))?;
    let mut tmp = fs::OpenOptions::new().append(true).open(temp_beside(&path)).map_err(|e| format!("no se pudo escribir: {e}"))?;
    tmp.write_all(&bytes).map_err(|e| format!("no se pudo escribir: {e}"))
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn library_write_commit(app: tauri::AppHandle, rel: String) -> Result<(), String> {
  let (base, _) = root(&app)?;
  let path = resolve(&base, &rel)?;
  tauri::async_runtime::spawn_blocking(move || {
    let tmp = temp_beside(&path);
    let flushed = fs::OpenOptions::new().append(true).open(&tmp).and_then(|f| f.sync_all());
    flushed.map_err(|e| format!("no se pudo escribir: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| {
      let _ = fs::remove_file(&tmp);
      format!("no se pudo guardar: {e}")
    })
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn library_write_abort(app: tauri::AppHandle, rel: String) -> Result<(), String> {
  let (base, _) = root(&app)?;
  let path = resolve(&base, &rel)?;
  let _ = fs::remove_file(temp_beside(&path));
  Ok(())
}

/// Open the system's file explorer on a folder of the library (the folder holding it, when `rel` is a file). Not on Android.
#[tauri::command]
pub async fn library_reveal(app: tauri::AppHandle, rel: String) -> Result<(), String> {
  #[cfg(target_os = "android")]
  {
    let _ = (app, rel);
    Err("el explorador de archivos no se puede abrir desde aquí en Android".into())
  }
  #[cfg(not(target_os = "android"))]
  {
    let (base, _) = root(&app)?;
    let mut dir = resolve(&base, &rel)?;
    if dir.is_file() {
      dir.pop();
    }
    if !dir.is_dir() {
      return Err("la carpeta ya no existe".into());
    }
    #[cfg(windows)]
    let opener = "explorer";
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let opener = "xdg-open";
    std::process::Command::new(opener).arg(&dir).spawn().map(|_| ()).map_err(|e| format!("no se pudo abrir el explorador: {e}"))
  }
}

/// Android: open the system page where the person allows Lienzo to use all files, so the library can live in Documents/Lienzo.
#[tauri::command]
pub async fn library_request_access(app: tauri::AppHandle) -> Result<(), String> {
  #[cfg(target_os = "android")]
  {
    let picker = app.state::<crate::DocPicker>();
    picker.0.run_mobile_plugin::<serde_json::Value>("requestStorageAccess", serde_json::json!({})).map_err(|e| e.to_string())?;
    Ok(())
  }
  #[cfg(not(target_os = "android"))]
  {
    let _ = app;
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// A fresh folder that tells "foo" from "Foo", like Android's storage does. `None` where the system cannot make one (then the
  /// test has nothing to check and passes).
  fn case_sensitive_dir(name: &str) -> Option<PathBuf> {
    let dir = std::env::temp_dir().join(format!("lienzo-library-test-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).ok()?;
    #[cfg(windows)]
    {
      let ok = std::process::Command::new("fsutil").args(["file", "setCaseSensitiveInfo"]).arg(&dir).arg("enable").output().map(|o| o.status.success()).unwrap_or(false);
      if !ok {
        let _ = fs::remove_dir_all(&dir);
        return None;
      }
    }
    fs::write(dir.join("a"), "a").ok()?;
    if fs::write(dir.join("A"), "A").is_err() || fs::read_to_string(dir.join("a")).ok()? != "a" {
      let _ = fs::remove_dir_all(&dir);
      return None;
    }
    fs::remove_file(dir.join("A")).ok()?;
    fs::remove_file(dir.join("a")).ok()?;
    Some(dir)
  }

  #[test]
  fn renaming_over_a_name_that_differs_only_in_case_is_refused_where_case_matters() {
    let Some(dir) = case_sensitive_dir("clash") else { return };
    fs::write(dir.join("foo.lienzo"), "ORIGINAL foo").unwrap();
    fs::write(dir.join("Foo.lienzo"), "the other one").unwrap();
    assert!(move_entry(&dir, "Foo.lienzo", "foo.lienzo").is_err(), "must not replace another document");
    assert_eq!(fs::read_to_string(dir.join("foo.lienzo")).unwrap(), "ORIGINAL foo");
    assert_eq!(fs::read_to_string(dir.join("Foo.lienzo")).unwrap(), "the other one");
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn a_case_only_rename_of_one_entry_still_works_and_other_clashes_are_refused() {
    let dir = std::env::temp_dir().join(format!("lienzo-library-test-{}-plain", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("Foo.lienzo"), "one").unwrap();
    fs::write(dir.join("bar.lienzo"), "two").unwrap();
    move_entry(&dir, "Foo.lienzo", "foo.lienzo").unwrap();
    let names: Vec<String> = fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    assert!(names.contains(&"foo.lienzo".to_string()), "{names:?}");
    assert!(move_entry(&dir, "foo.lienzo", "bar.lienzo").is_err());
    assert_eq!(fs::read_to_string(dir.join("bar.lienzo")).unwrap(), "two");
    let _ = fs::remove_dir_all(&dir);
  }
}
