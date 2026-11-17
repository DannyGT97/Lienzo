package app.lienzo.studio

import android.app.Activity
import android.content.Intent
import android.webkit.MimeTypeMap
import androidx.activity.result.ActivityResult
import app.tauri.Logger
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class PickDocumentArgs {
  var extensions: Array<String>? = null
}

@InvokeArg
class InstallApkArgs {
  var path: String? = null
}

@InvokeArg
class CreateDocumentArgs {
  var fileName: String? = null
  var extensions: Array<String>? = null
}

/**
 * Opens a document the way Android intends for files an app will edit and save back: ACTION_OPEN_DOCUMENT with a
 * read+write grant that is kept across restarts. The stock dialog plugin uses ACTION_GET_CONTENT instead, which only
 * hands out a temporary read grant, so a file opened with it can never be overwritten in place.
 */
@TauriPlugin
class DocPickerPlugin(private val activity: Activity) : Plugin(activity) {
  /**
   * The types the open pickers may restrict themselves to, or null for no restriction. The system only knows the types of the
   * usual pictures: `.clip`, `.lienzo`, `.psb` or `.ora` have none, and a picker restricted to the pictures' types greys those
   * files out (a PSD too, on some versions). So unless every extension has a type, nothing is restricted and the app looks at
   * the name and the first bytes of what was chosen.
   */
  private fun openableTypes(extensions: Array<String>?): Array<String>? {
    val list = extensions ?: return null
    val types = list.map { if (it.contains('/')) it else MimeTypeMap.getSingleton().getMimeTypeFromExtension(it.lowercase()) }
    if (types.isEmpty() || types.any { it == null }) return null
    return types.filterNotNull().distinct().toTypedArray()
  }

  @Command
  fun pickDocument(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(PickDocumentArgs::class.java)
      val types = openableTypes(args.extensions)

      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
      intent.addCategory(Intent.CATEGORY_OPENABLE)
      intent.type = "*/*"
      if (types != null) intent.putExtra(Intent.EXTRA_MIME_TYPES, types)
      intent.addFlags(
        Intent.FLAG_GRANT_READ_URI_PERMISSION or
          Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
          Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
      )
      startActivityForResult(invoke, intent, "pickDocumentResult")
    } catch (ex: Exception) {
      val message = ex.message ?: "Failed to pick a document"
      Logger.error(message)
      invoke.reject(message)
    }
  }

  /**
   * Several documents at once, to be copied into the library (so only a read is needed and no grant is kept: the bytes are
   * read right away). Answers `uris`, empty when the person cancels.
   */
  @Command
  fun pickDocuments(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(PickDocumentArgs::class.java)
      val types = openableTypes(args.extensions)

      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
      intent.addCategory(Intent.CATEGORY_OPENABLE)
      intent.type = "*/*"
      if (types != null) intent.putExtra(Intent.EXTRA_MIME_TYPES, types)
      intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      startActivityForResult(invoke, intent, "pickDocumentsResult")
    } catch (ex: Exception) {
      val message = ex.message ?: "Failed to pick documents"
      Logger.error(message)
      invoke.reject(message)
    }
  }

  @ActivityCallback
  fun pickDocumentsResult(invoke: Invoke, result: ActivityResult) {
    try {
      val list = JSArray()
      if (result.resultCode == Activity.RESULT_OK) {
        val clip = result.data?.clipData
        if (clip != null) {
          for (i in 0 until clip.itemCount) list.put(clip.getItemAt(i).uri.toString())
        } else {
          result.data?.data?.let { list.put(it.toString()) }
        }
      }
      val out = JSObject()
      out.put("uris", list)
      invoke.resolve(out)
    } catch (ex: Exception) {
      val message = ex.message ?: "Failed to read the picked documents"
      Logger.error(message)
      invoke.reject(message)
    }
  }

  /**
   * Asks where to save a new file (ACTION_CREATE_DOCUMENT) and keeps the read+write grant across restarts. The stock dialog
   * plugin does not keep it, so a file saved with it could be saved again only until the app's process ended; after that
   * the system refused the write ("no hay permiso de escritura") and the person had to choose the file again.
   */
  @Command
  fun createDocument(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(CreateDocumentArgs::class.java)
      val types = (args.extensions ?: emptyArray()).map {
        if (it.contains('/')) it else MimeTypeMap.getSingleton().getMimeTypeFromExtension(it.lowercase()) ?: "application/octet-stream"
      }.distinct()

      val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
      intent.addCategory(Intent.CATEGORY_OPENABLE)
      intent.putExtra(Intent.EXTRA_TITLE, args.fileName ?: "")
      if (types.size == 1) {
        intent.type = types.first()
      } else {
        intent.type = "*/*"
        if (types.isNotEmpty()) intent.putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
      }
      intent.addFlags(
        Intent.FLAG_GRANT_READ_URI_PERMISSION or
          Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
          Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
      )
      startActivityForResult(invoke, intent, "pickDocumentResult")
    } catch (ex: Exception) {
      val message = ex.message ?: "Failed to choose where to save"
      Logger.error(message)
      invoke.reject(message)
    }
  }

  /**
   * Hands a package that the app already downloaded and verified (see update.rs) to Android's installer. The system asks the
   * person to confirm, and refuses a package signed with another key than the installed app's. When Lienzo has not been allowed
   * to install apps yet, the settings page where that is allowed is opened and `needsPermission` says so.
   */
  @Command
  fun installApk(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(InstallApkArgs::class.java)
      val file = java.io.File(args.path ?: throw IllegalArgumentException("missing path"))
      // Only a file inside the app's own cache folder, where update.rs puts it.
      val updates = java.io.File(activity.cacheDir, "updates").canonicalFile
      if (!file.canonicalFile.startsWith(updates) || !file.name.endsWith(".apk")) throw SecurityException("not an update package")
      val out = JSObject()
      if (!activity.packageManager.canRequestPackageInstalls()) {
        val settings = Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:" + activity.packageName))
        settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(settings)
        out.put("needsPermission", true)
        invoke.resolve(out)
        return
      }
      val uri = androidx.core.content.FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", file)
      val install = Intent(Intent.ACTION_VIEW)
      install.setDataAndType(uri, "application/vnd.android.package-archive")
      install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      activity.startActivity(install)
      out.put("needsPermission", false)
      invoke.resolve(out)
    } catch (ex: Exception) {
      val message = ex.message ?: "Failed to open the installer"
      Logger.error(message)
      invoke.reject(message)
    }
  }

  /** Whether the app may use file paths in shared storage (all-files access from Android 11, the storage permission before). */
  private fun hasAllFilesAccess(): Boolean =
    if (android.os.Build.VERSION.SDK_INT >= 30) android.os.Environment.isExternalStorageManager()
    else activity.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) == android.content.pm.PackageManager.PERMISSION_GRANTED

  /** A name for `name` that is free in `dir`: "doc (antes).lienzo", "doc (antes 2).lienzo"… */
  private fun freeName(dir: java.io.File, name: String): java.io.File {
    val dot = name.lastIndexOf('.')
    val stem = if (dot > 0) name.substring(0, dot) else name
    val ext = if (dot > 0) name.substring(dot) else ""
    var n = 1
    while (true) {
      val candidate = java.io.File(dir, "$stem (antes${if (n > 1) " $n" else ""})$ext")
      if (!candidate.exists()) return candidate
      n++
    }
  }

  /**
   * Moves what the library held in the app's own folder into `to`, keeping its folders. Nothing is opened or read: each item is
   * renamed into place (or, when the two folders are on different volumes, copied and the original removed only when the copy
   * worked). Something that already exists in `to` is never overwritten: the moved one gets "(antes)" in its name.
   */
  private fun moveLibrary(from: java.io.File, to: java.io.File) {
    val items = from.listFiles() ?: return
    for (item in items) {
      if (item.name.startsWith(".")) continue // a half-written file of the app itself: left where it is
      val target = java.io.File(to, item.name)
      try {
        if (item.isDirectory && target.isDirectory) {
          moveLibrary(item, target)
          item.delete() // only goes when it ended up empty
          continue
        }
        val dest = if (target.exists()) freeName(to, item.name) else target
        if (!item.renameTo(dest)) {
          if (item.copyRecursively(dest, overwrite = false)) item.deleteRecursively()
        }
      } catch (ex: Exception) {
        Logger.error("could not move " + item.name + ": " + ex.message)
      }
    }
    from.delete()
  }

  /**
   * The folder of the file library: Documents/Lienzo on shared storage, which any explorer shows and where Clip Studio keeps its
   * own folder, once the person has granted access to all files. What the library held before, in the app's own folder
   * (Android/data/<app>/files/Lienzo, hidden from most explorers), is moved there the first time. Without the access the app's
   * own folder is used and `needsAccess` says so, so the window can ask for it.
   */
  @Command
  fun appFolder(invoke: Invoke) {
    try {
      val own = activity.getExternalFilesDir(null)
      val old = java.io.File(own ?: activity.filesDir, "Lienzo")
      var dir = old
      var needsAccess = true
      if (hasAllFilesAccess()) {
        try {
          val docs = java.io.File(android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOCUMENTS), "Lienzo")
          docs.mkdirs()
          if (docs.isDirectory && docs.canWrite()) {
            if (old.isDirectory) moveLibrary(old, docs)
            dir = docs
            needsAccess = false
          }
        } catch (ex: Exception) {
          Logger.error("shared library folder not usable: " + ex.message)
        }
      }
      dir.mkdirs()
      val out = JSObject()
      out.put("path", dir.absolutePath)
      out.put("shared", own != null || !needsAccess)
      out.put("needsAccess", needsAccess)
      invoke.resolve(out)
    } catch (ex: Exception) {
      val message = ex.message ?: "Failed to find the library folder"
      Logger.error(message)
      invoke.reject(message)
    }
  }

  /** Opens the system page where the person allows Lienzo to use all files (the storage permission before Android 11). */
  @Command
  fun requestStorageAccess(invoke: Invoke) {
    try {
      if (!hasAllFilesAccess()) {
        if (android.os.Build.VERSION.SDK_INT >= 30) {
          val page = Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, android.net.Uri.parse("package:" + activity.packageName))
          page.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          try {
            activity.startActivity(page)
          } catch (_: Exception) {
            val all = Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
            all.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(all)
          }
        } else {
          activity.requestPermissions(arrayOf(android.Manifest.permission.WRITE_EXTERNAL_STORAGE), 4711)
        }
      }
      invoke.resolve(JSObject())
    } catch (ex: Exception) {
      val message = ex.message ?: "Failed to open the access settings"
      Logger.error(message)
      invoke.reject(message)
    }
  }

  @ActivityCallback
  fun pickDocumentResult(invoke: Invoke, result: ActivityResult) {
    try {
      when (result.resultCode) {
        Activity.RESULT_OK -> {
          val uri = result.data?.data
          val out = JSObject()
          if (uri != null) {
            // Keep the grant after a restart. Some providers refuse the write part (read-only sources): keep what
            // they allow, and let a later write report the refusal.
            val resolver = activity.contentResolver
            try {
              resolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
              )
            } catch (_: Exception) {
              try {
                resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
              } catch (_: Exception) {
                // the temporary grant still lasts for this session
              }
            }
            out.put("uri", uri.toString())
          }
          invoke.resolve(out)
        }
        // Cancelled: answer without a uri.
        else -> invoke.resolve(JSObject())
      }
    } catch (ex: Exception) {
      val message = ex.message ?: "Failed to read the picked document"
      Logger.error(message)
      invoke.reject(message)
    }
  }
}
