use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};

mod library;
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

/// Replace the contents of a file (an Android content address) with `data`, given as base64 text.
///
/// Why not the file plugin's `writeFile`: on Android the WebView cannot send a request body to the native side, so a byte
/// array travels as JSON text with one number per byte (and is read back as one JSON value per byte). A 50 MB document
/// freezes the page and can run the tablet out of memory. A single string is a third bigger than the file and nothing more.
/// The file is opened the same way the plugin opens it (`wt`: write, truncating), so the provider's permissions apply as usual.
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
  use std::io::Write;
  use std::str::FromStr;
  use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

  tauri::async_runtime::spawn_blocking(move || {
    let bytes = base64::engine::general_purpose::STANDARD
      .decode(data.as_bytes())
      .map_err(|e| format!("el archivo preparado no es válido: {e}"))?;
    drop(data);
    let target = FilePath::from_str(&path).map_err(|e| format!("ruta no válida: {e}"))?;
    let mut options = OpenOptions::new();
    options.write(true).truncate(true).create(true);
    let mut file = app.fs().open(target, options).map_err(|e| format!("failed to open file: {e}"))?;
    file.write_all(&bytes).map_err(|e| format!("failed to write bytes to file: {e}"))?;
    file.flush().map_err(|e| format!("failed to write bytes to file: {e}"))
  })
  .await
  .map_err(|e| e.to_string())?
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
    .invoke_handler(tauri::generate_handler![pick_document, pick_documents, create_document, write_document, android_update_check, android_update_install, library::library_info, library::library_list, library::library_mkdir, library::library_move, library::library_copy, library::library_remove, library::library_read, library::library_write, library::library_reveal])
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
