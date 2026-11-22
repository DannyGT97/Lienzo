//! Writes that a cut cannot leave half done.
//!
//! A document is written over the file it came from. If the power goes, the battery dies or the app is closed by force while the
//! bytes are going out, the file holds a piece of the new document and is lost. Two ways to avoid that, by what the system allows:
//!
//! - `replace_file` (Windows and the other desktops, where the file is a path): the new copy is written next to the old one and
//!   renamed over it. The rename is one step: the file is the old document or the new one, never something between.
//! - `Journal` (Android, where the file is a `content://` address that can only be opened and rewritten in place, so there is
//!   nothing to rename): a complete copy of the new document is kept in the app's own folder *before* the file is touched, and
//!   forgotten when the file has been written and checked. If the write was cut, the copy is still there at the next start and
//!   `recover` writes it again, so the file is completed and never stays damaged.
//!
//! Nothing in here knows about Tauri or Android: the file system is handed in, so the logic is tested on any computer.

// Off Android only the tests use the journal.
#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

/// A copy that could not be written back is kept this long (the person may still fix the cause, e.g. allow access again).
const KEEP_FAILED: Duration = Duration::from_secs(30 * 24 * 3600);

/// One write at a time through the journal: two at once would share the files of the same target.
static BUSY: Mutex<()> = Mutex::new(());

// ---- desktop: write beside, then rename over -------------------------------------------------------------------------

/// Replace the file at `path` with `bytes`. The new copy is complete on the disk before it takes the old one's place. Where a
/// temporary file cannot be made next to the target (a folder that may not be written to, a file the person may only overwrite),
/// the file is written in place as before.
pub fn replace_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
  let name = path.file_name().ok_or("ruta no válida")?.to_string_lossy().into_owned();
  let tmp = path.with_file_name(format!(".{name}.lienzo-tmp"));
  let mut file = match fs::File::create(&tmp) {
    Ok(f) => f,
    Err(_) => return fs::write(path, bytes).map_err(|e| format!("no se pudo escribir el archivo: {e}")),
  };
  let written = file.write_all(bytes).and_then(|_| file.flush()).and_then(|_| file.sync_all());
  drop(file);
  if let Err(e) = written {
    let _ = fs::remove_file(&tmp);
    return Err(format!("no se pudo escribir el archivo: {e}"));
  }
  fs::rename(&tmp, path).map_err(|e| {
    let _ = fs::remove_file(&tmp);
    format!("no se pudo guardar el archivo: {e}")
  })
}

// ---- Android: keep a complete copy first -----------------------------------------------------------------------------

/// FNV-1a of `text` in hex: one stable name per target, whatever characters its address has.
fn key_of(text: &str) -> String {
  let mut hash: u64 = 0xcbf29ce484222325;
  for b in text.bytes() {
    hash ^= u64::from(b);
    hash = hash.wrapping_mul(0x100000001b3);
  }
  format!("{hash:016x}")
}

/// A write that was cut and what was done about it when the app started again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recovered {
  /// The address of the file that was being written.
  pub target: String,
  /// The file was completed.
  pub ok: bool,
  /// Why not, when it was not.
  pub error: Option<String>,
}

pub struct Journal {
  dir: PathBuf,
}

impl Journal {
  pub fn new(dir: PathBuf) -> Self {
    Self { dir }
  }

  fn data(&self, key: &str) -> PathBuf {
    self.dir.join(format!("{key}.bin"))
  }
  fn note(&self, key: &str) -> PathBuf {
    self.dir.join(format!("{key}.target"))
  }

  /// A complete copy of `bytes` in the journal, on the disk, with the note that says where it belongs. The note is written last:
  /// a copy without a note is half made and is ignored.
  fn keep(&self, key: &str, target: &str, bytes: &[u8]) -> Result<(), String> {
    fs::create_dir_all(&self.dir).map_err(|e| format!("no se pudo preparar la copia segura: {e}"))?;
    let part = self.dir.join(format!("{key}.part"));
    let made = (|| {
      let mut f = fs::File::create(&part)?;
      f.write_all(bytes)?;
      f.sync_all()?;
      drop(f);
      fs::rename(&part, self.data(key))?;
      let mut n = fs::File::create(self.note(key))?;
      n.write_all(target.as_bytes())?;
      n.sync_all()
    })();
    made.map_err(|e| {
      let _ = fs::remove_file(&part);
      format!("no se pudo hacer la copia segura: {e}")
    })
  }

  fn forget(&self, key: &str) {
    let _ = fs::remove_file(self.note(key));
    let _ = fs::remove_file(self.data(key));
  }

  /// Write `bytes` to `target` through the journal. `open` opens the target for writing (truncating it): if that fails nothing was
  /// touched and the copy is dropped. From then on the target is changing, so the copy stays until the write is done and its size
  /// checked; if the write fails or is cut, the copy is still there for `recover`.
  pub fn write_through(&self, target: &str, bytes: &[u8], open: impl FnOnce() -> Result<fs::File, String>) -> Result<(), String> {
    let _one_at_a_time = BUSY.lock().unwrap_or_else(|e| e.into_inner());
    let key = key_of(target);
    self.keep(&key, target, bytes)?;
    let mut file = match open() {
      Ok(f) => f,
      Err(e) => {
        self.forget(&key);
        return Err(e);
      }
    };
    match put(&mut file, bytes) {
      Ok(()) => {
        self.forget(&key);
        Ok(())
      }
      Err(e) => Err(format!("{e}. Hay una copia segura del documento: se completará la próxima vez que abras Lienzo.")),
    }
  }

  /// Finish every write that was cut: each copy in the journal is written again to its target. A copy that cannot be written yet
  /// (access lost, file gone) is kept for a while and reported, then dropped.
  pub fn recover(&self, open: impl Fn(&str) -> Result<fs::File, String>) -> Vec<Recovered> {
    let _one_at_a_time = BUSY.lock().unwrap_or_else(|e| e.into_inner());
    let mut done = Vec::new();
    let Ok(entries) = fs::read_dir(&self.dir) else { return done };
    for entry in entries.flatten() {
      let path = entry.path();
      match path.extension().and_then(|e| e.to_str()) {
        Some("part") => {
          let _ = fs::remove_file(&path); // a copy that was never finished
          continue;
        }
        Some("target") => {}
        _ => continue,
      }
      let Some(key) = path.file_stem().map(|s| s.to_string_lossy().into_owned()) else { continue };
      let (Ok(target), Ok(bytes)) = (fs::read_to_string(&path), fs::read(self.data(&key))) else {
        self.forget(&key);
        continue;
      };
      let result = open(&target).and_then(|mut f| put(&mut f, &bytes).map_err(|e| e.to_string()));
      match result {
        Ok(()) => {
          self.forget(&key);
          done.push(Recovered { target, ok: true, error: None });
        }
        Err(error) => {
          let old = fs::metadata(&path).and_then(|m| m.modified()).ok().and_then(|t| SystemTime::now().duration_since(t).ok()).is_some_and(|age| age > KEEP_FAILED);
          if old {
            self.forget(&key);
          }
          done.push(Recovered { target, ok: false, error: Some(error) });
        }
      }
    }
    done
  }
}

/// Write all of `bytes` and make sure they are all there.
fn put(file: &mut fs::File, bytes: &[u8]) -> Result<(), String> {
  file.write_all(bytes).and_then(|_| file.flush()).map_err(|e| format!("no se pudo escribir el archivo: {e}"))?;
  let _ = file.sync_all(); // not every provider can; the size below is what is checked
  // A provider that hands out a pipe instead of the file itself reports no size at all (0): that is not a cut, `write_all` would have failed.
  match file.metadata() {
    Ok(m) if m.len() != 0 && m.len() != bytes.len() as u64 => Err(format!("el archivo quedó con {} bytes en vez de {}", m.len(), bytes.len())),
    _ => Ok(()),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("lienzo-safe-write-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  fn open_for_writing(path: &Path) -> Result<fs::File, String> {
    fs::OpenOptions::new().write(true).truncate(true).create(true).open(path).map_err(|e| e.to_string())
  }

  #[test]
  fn replacing_a_file_leaves_no_temporary_copy_and_keeps_the_new_bytes() {
    let dir = temp("replace");
    let file = dir.join("a.lienzo");
    fs::write(&file, "old").unwrap();
    replace_file(&file, b"new document").unwrap();
    assert_eq!(fs::read(&file).unwrap(), b"new document");
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    replace_file(&dir.join("fresh.lienzo"), b"x").unwrap();
    assert_eq!(fs::read(dir.join("fresh.lienzo")).unwrap(), b"x");
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn a_write_that_completes_leaves_nothing_in_the_journal() {
    let dir = temp("clean");
    let target = dir.join("doc.lienzo");
    fs::write(&target, "old old old old").unwrap();
    let journal = Journal::new(dir.join("journal"));
    journal.write_through("content://doc", b"new", || open_for_writing(&target)).unwrap();
    assert_eq!(fs::read(&target).unwrap(), b"new");
    assert_eq!(fs::read_dir(dir.join("journal")).unwrap().count(), 0);
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn a_target_that_cannot_be_opened_is_untouched_and_keeps_no_copy() {
    let dir = temp("denied");
    let journal = Journal::new(dir.join("journal"));
    let err = journal.write_through("content://doc", b"new", || Err("sin permiso".to_string())).unwrap_err();
    assert_eq!(err, "sin permiso");
    assert_eq!(fs::read_dir(dir.join("journal")).unwrap().count(), 0);
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn a_cut_write_is_finished_at_the_next_start() {
    let dir = temp("cut");
    let target = dir.join("doc.lienzo");
    fs::write(&target, "the old document").unwrap();
    let journal = Journal::new(dir.join("journal"));
    let new: Vec<u8> = (0..5000u32).map(|i| (i % 251) as u8).collect();

    // What a cut leaves behind: the file opened (and so emptied), the copy kept, and only the start of the bytes written.
    journal.keep(&key_of("content://doc"), "content://doc", &new).unwrap();
    let mut half = open_for_writing(&target).unwrap();
    half.write_all(&new[..1234]).unwrap();
    drop(half);
    assert_eq!(fs::read(&target).unwrap().len(), 1234, "the file is damaged: it holds a piece of the new document");

    // The app starts again.
    let restarted = Journal::new(dir.join("journal"));
    let report = restarted.recover(|t| {
      assert_eq!(t, "content://doc");
      open_for_writing(&target)
    });
    assert_eq!(report, vec![Recovered { target: "content://doc".into(), ok: true, error: None }]);
    assert_eq!(fs::read(&target).unwrap(), new, "the document is whole again");
    assert_eq!(fs::read_dir(dir.join("journal")).unwrap().count(), 0);
    assert!(restarted.recover(|_| Err("no debería hacer falta".into())).is_empty());
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn a_failure_while_writing_keeps_the_copy_and_says_so() {
    let dir = temp("fail");
    let target = dir.join("doc.lienzo");
    // A file opened for reading only: opening works, writing does not.
    fs::write(&target, "old").unwrap();
    let journal = Journal::new(dir.join("journal"));
    let err = journal.write_through("content://doc", b"new", || fs::File::open(&target).map_err(|e| e.to_string())).unwrap_err();
    assert!(err.contains("copia segura"), "{err}");
    assert_eq!(fs::read_dir(dir.join("journal")).unwrap().count(), 2, "the copy and its note stay");
    // Next start, with access back, the document is written.
    let report = journal.recover(|_| open_for_writing(&target));
    assert!(report[0].ok);
    assert_eq!(fs::read(&target).unwrap(), b"new");
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn a_newer_write_to_the_same_file_replaces_the_pending_copy_and_a_copy_without_a_note_is_dropped() {
    let dir = temp("newer");
    let journal = Journal::new(dir.join("journal"));
    let key = key_of("content://doc");
    journal.keep(&key, "content://doc", b"first").unwrap();
    journal.keep(&key, "content://doc", b"second").unwrap();
    assert_eq!(fs::read(journal.data(&key)).unwrap(), b"second");
    fs::write(dir.join("journal").join("0000.part"), "half a copy").unwrap();
    let target = dir.join("doc.lienzo");
    let report = journal.recover(|_| open_for_writing(&target));
    assert_eq!(report.len(), 1);
    assert_eq!(fs::read(&target).unwrap(), b"second");
    assert!(!dir.join("journal").join("0000.part").exists());
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn a_copy_that_cannot_be_written_back_is_kept_and_reported() {
    let dir = temp("kept");
    let journal = Journal::new(dir.join("journal"));
    journal.keep(&key_of("content://gone"), "content://gone", b"precious").unwrap();
    let report = journal.recover(|_| Err("el archivo ya no existe".into()));
    assert_eq!(report, vec![Recovered { target: "content://gone".into(), ok: false, error: Some("el archivo ya no existe".into()) }]);
    assert!(journal.data(&key_of("content://gone")).exists(), "the only whole copy of the document is not thrown away");
    let _ = fs::remove_dir_all(&dir);
  }
}
