use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};

mod library;
mod safe_write;
mod settings;
mod update;

/// The Android side of the document picker (`DocPickerPlugin.kt`): opens a file with a write grant that survives restarts.
#[cfg(target_os = "android")]
pub(crate) struct DocPicker(tauri::plugin::PluginHandle<tauri::Wry>);

#[cfg(target_os = "android")]
#[derive(serde::Serialize)]
struct PickDocumentArgs {
  extensions: Vec<String>,
}

#[cfg(target_os = "android")]
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateDocumentArgs {
  file_name: String,
  extensions: Vec<String>,
}

#[cfg(target_os = "android")]
#[derive(serde::Deserialize)]
struct PickedDocument {
  uri: Option<String>,
}

#[cfg(target_os = "android")]
#[derive(serde::Deserialize)]
struct PickedDocuments {
  uris: Option<Vec<String>>,
}

#[cfg(target_os = "android")]
#[derive(serde::Serialize)]
struct InstallApkArgs {
  path: String,
}

#[cfg(target_os = "android")]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallApkResult {
  needs_permission: Option<bool>,
}

/// Hand a downloaded and verified package to Android's installer. When the system still has to be told that Lienzo may install
/// apps, its settings page is opened instead and the person is told what to do.
#[cfg(target_os = "android")]
pub(crate) fn install_apk(app: &tauri::AppHandle, path: String) -> Result<String, String> {
  use tauri::Manager;
  let picker = app.state::<DocPicker>();
  let result: InstallApkResult = picker.0.run_mobile_plugin("installApk", InstallApkArgs { path }).map_err(|e| e.to_string())?;
  Ok(if result.needs_permission.unwrap_or(false) {
    "permission".to_string()
  } else {
    "installer".to_string()
  })
}

fn doc_picker() -> TauriPlugin<tauri::Wry> {
  PluginBuilder::new("docpicker")
    .setup(|_app, _api| {
      #[cfg(target_os = "android")]
      {
        use tauri::Manager;
        _app.manage(DocPicker(_api.register_android_plugin("app.lienzo.studio", "DocPickerPlugin")?));
      }
      Ok(())
    })
    .build()
}

/// Ask Android for a document to open, keeping read+write access to it. `None` when the person cancels.
#[tauri::command]
async fn pick_document(app: tauri::AppHandle, extensions: Vec<String>) -> Result<Option<String>, String> {
  #[cfg(target_os = "android")]
  {
    use tauri::Manager;
    let picker = app.state::<DocPicker>();
    let picked: PickedDocument = picker
      .0
      .run_mobile_plugin_async("pickDocument", PickDocumentArgs { extensions })
      .await
      .map_err(|e| e.to_string())?;
    Ok(picked.uri)
  }
  #[cfg(not(target_os = "android"))]
  {
    let _ = (app, extensions);
    Err("pick_document is only available on Android".into())
  }
}

/// Ask Android for several documents at once (to copy them into the library). Empty when the person cancels.
#[tauri::command]
async fn pick_documents(app: tauri::AppHandle, extensions: Vec<String>) -> Result<Vec<String>, String> {
  #[cfg(target_os = "android")]
  {
    use tauri::Manager;
    let picker = app.state::<DocPicker>();
    let picked: PickedDocuments = picker
      .0
      .run_mobile_plugin_async("pickDocuments", PickDocumentArgs { extensions })
      .await
      .map_err(|e| e.to_string())?;
    Ok(picked.uris.unwrap_or_default())
  }
  #[cfg(not(target_os = "android"))]
  {
    let _ = (app, extensions);
    Err("pick_documents is only available on Android".into())
  }
}

/// Ask Android where to save a new document, keeping read+write access to it. `None` when the person cancels.
#[tauri::command]
async fn create_document(app: tauri::AppHandle, file_name: String, extensions: Vec<String>) -> Result<Option<String>, String> {
  #[cfg(target_os = "android")]
  {
    use tauri::Manager;
    let picker = app.state::<DocPicker>();
    let picked: PickedDocument = picker
      .0
      .run_mobile_plugin_async("createDocument", CreateDocumentArgs { file_name, extensions })
      .await
      .map_err(|e| e.to_string())?;
    Ok(picked.uri)
  }
  #[cfg(not(target_os = "android"))]
  {
    let _ = (app, file_name, extensions);
    Err("create_document is only available on Android".into())
  }
}

/// Android only: is there a newer version? Returns its number and notes, or null. Looks only where `update.rs` says, and only when asked.
#[tauri::command]
async fn android_update_check(app: tauri::AppHandle) -> Result<Option<update::Available>, String> {
  #[cfg(target_os = "android")]
  {
    update::check(app).await
  }
  #[cfg(not(target_os = "android"))]
  {
    let _ = app;
    Err("android_update_check is only available on Android".into())
  }
}

/// Android only: download the newest version, check its signature and open the system installer. Returns "installer" or "permission".
#[tauri::command]
async fn android_update_install(app: tauri::AppHandle) -> Result<String, String> {
  #[cfg(target_os = "android")]
  {
    update::install(app).await
  }
  #[cfg(not(target_os = "android"))]
  {
    let _ = app;
    Err("android_update_install is only available on Android".into())
  }
}

/// The folder where a copy of each document being written is kept until the file has it all (see `safe_write.rs`). It is the app's
/// own data folder, not the cache: the system may empty the cache whenever it needs room, and this copy can be the only whole one.
fn write_journal(app: &tauri::AppHandle) -> Result<safe_write::Journal, String> {
  use tauri::Manager;
  Ok(safe_write::Journal::new(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("pending-writes")))
}

/// Open a document's address for writing, emptying it first (`wt`: the same way the file plugin opens it, so the provider's
/// permissions apply as usual).
fn open_document(app: &tauri::AppHandle, path: &str) -> Result<std::fs::File, String> {
  use std::str::FromStr;
  use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};
  let target = FilePath::from_str(path).map_err(|e| format!("ruta no válida: {e}"))?;
  let mut options = OpenOptions::new();
  options.write(true).truncate(true).create(true);
  app.fs().open(target, options).map_err(|e| format!("failed to open file: {e}"))
}

/// Replace the contents of a file (an Android content address) with `data`, given as base64 text.
///
/// Why not the file plugin's `writeFile`: on Android the WebView cannot send a request body to the native side, so a byte
/// array travels as JSON text with one number per byte (and is read back as one JSON value per byte). A 50 MB document
/// freezes the page and can run the tablet out of memory. A single string is a third bigger than the file and nothing more.
///
/// A content address cannot be written beside and renamed over, only rewritten in place, so a cut (battery, force close) in the
/// middle would leave a piece of the document. Before the file is touched a whole copy is kept in the app's own folder
/// (`safe_write::Journal`), and `recover_interrupted_writes` finishes any write that was cut when the app starts again.
///
/// This command bypasses the file plugin's scope, so it is limited to what it is for: Android, and a `content://` address
/// (a document the person picked, whose grant the system holds). Nothing else can be written through it.
#[tauri::command]
async fn write_document(app: tauri::AppHandle, path: String, data: String) -> Result<(), String> {
  if !cfg!(target_os = "android") {
    return Err("write_document is only available on Android".into());
  }
  if !path.starts_with("content://") {
    return Err("write_document only writes documents chosen with the system picker".into());
  }
  use base64::Engine;

  tauri::async_runtime::spawn_blocking(move || {
    let bytes = base64::engine::general_purpose::STANDARD
      .decode(data.as_bytes())
      .map_err(|e| format!("el archivo preparado no es válido: {e}"))?;
    drop(data);
    write_journal(&app)?.write_through(&path, &bytes, || open_document(&app, &path))
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Finish the writes that were cut the last time (Android): each one is written again from the copy kept before it began. Called
/// when the app starts; says which files were completed and which could not be yet.
#[tauri::command]
async fn recover_interrupted_writes(app: tauri::AppHandle) -> Result<Vec<safe_write::Recovered>, String> {
  if !cfg!(target_os = "android") {
    return Ok(Vec::new());
  }
  tauri::async_runtime::spawn_blocking(move || Ok(write_journal(&app)?.recover(|path| open_document(&app, path))))
    .await
    .map_err(|e| e.to_string())?
}

/// Write a file on the computer without ever leaving it half written: the bytes travel as the request body (the file plugin's
/// way: no text detour for a big document) and the path in the `path` header, URI-encoded. Only places the dialogs or the
/// file plugin's scope already allow, like the plugin's own `writeFile`.
#[tauri::command]
async fn write_file_safe(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
  use tauri_plugin_fs::FsExt;
  if cfg!(target_os = "android") {
    return Err("write_file_safe is not for Android".into());
  }
  let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
    return Err("el archivo no llegó como bytes".into());
  };
  let header = request.headers().get("path").and_then(|v| v.to_str().ok()).ok_or("falta la ruta del archivo")?;
  let path = std::path::PathBuf::from(percent_decode(header)?);
  if !app.fs_scope().is_allowed(&path) {
    return Err("Lienzo no tiene permiso para escribir ahí".into());
  }
  let bytes = bytes.clone();
  tauri::async_runtime::spawn_blocking(move || safe_write::replace_file(&path, &bytes)).await.map_err(|e| e.to_string())?
}

/// `%XX` escapes (what `encodeURIComponent` makes) back to text.
fn percent_decode(text: &str) -> Result<String, String> {
  let raw = text.as_bytes();
  let mut out = Vec::with_capacity(raw.len());
  let mut i = 0;
  while i < raw.len() {
    if raw[i] == b'%' {
      let hex = raw.get(i + 1..i + 3).and_then(|h| std::str::from_utf8(h).ok()).and_then(|h| u8::from_str_radix(h, 16).ok()).ok_or("ruta no válida")?;
      out.push(hex);
      i += 3;
    } else {
      out.push(raw[i]);
      i += 1;
    }
  }
  String::from_utf8(out).map_err(|_| "ruta no válida".to_string())
}

/// Close the program (after the person answered what to do with their unsaved changes).
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
  app.exit(0);
}

/// What kind of build this is, for "Acerca de": a test build (debug) or the one published as a release.
#[derive(serde::Serialize)]
struct BuildInfo {
  debug: bool,
  os: &'static str,
  identifier: String,
}

#[tauri::command]
fn build_info(app: tauri::AppHandle) -> BuildInfo {
  let id = app.config().identifier.clone();
  // The Android test build gets a ".debug" suffix from Gradle (see build.gradle.kts), which the configuration does not know about.
  let identifier = if cfg!(all(debug_assertions, target_os = "android")) { format!("{id}.debug") } else { id };
  BuildInfo { debug: cfg!(debug_assertions), os: std::env::consts::OS, identifier }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default();
  // The updater plugin does not exist on Android; there `update.rs` does the work.
  #[cfg(desktop)]
  let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
  builder
    .plugin(tauri_plugin_dialog::init())
    .plugin(doc_picker())
    .invoke_handler(tauri::generate_handler![build_info, pick_document, pick_documents, create_document, write_document, recover_interrupted_writes, write_file_safe, quit_app, android_update_check, android_update_install, library::library_info, library::library_list, library::library_mkdir, library::library_move, library::library_copy, library::library_remove, library::library_read, library::library_read_range, library::library_write, library::library_reveal, library::library_request_access, settings::settings_read, settings::settings_write])
    .plugin(tauri_plugin_fs::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}

#[cfg(test)]
mod tests {
  use super::percent_decode;

  #[test]
  fn reads_the_path_the_page_encoded() {
    assert_eq!(percent_decode("C%3A%5CUsers%5CAna%20Mar%C3%ADa%5Cdibujo.lienzo").unwrap(), r"C:\Users\Ana María\dibujo.lienzo");
    assert_eq!(percent_decode("plain.lienzo").unwrap(), "plain.lienzo");
    assert!(percent_decode("bad%zz").is_err());
    assert!(percent_decode("cut%4").is_err());
  }
}
