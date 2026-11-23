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

  // ---- the same write, handed over in pieces ---------------------------------------------------------------------------
  // A big document sent over in one message is one huge string for the web view to build, copy and send: on a tablet the whole
  // window stops while it does. In pieces, each costs a few milliseconds and the window keeps answering between them. The pieces
  // are written straight into the journal's copy, so nothing is held in memory, and `commit` then writes the target from it.

  /// Start receiving the new bytes of `target`. Returns the key to name the pieces with. Anything left from an earlier try is dropped.
  pub fn begin(&self, target: &str) -> Result<String, String> {
    let _one_at_a_time = BUSY.lock().unwrap_or_else(|e| e.into_inner());
    let key = key_of(target);
    fs::create_dir_all(&self.dir).map_err(|e| format!("no se pudo preparar la copia segura: {e}"))?;
    fs::File::create(self.part(&key)).map_err(|e| format!("no se pudo hacer la copia segura: {e}"))?;
    Ok(key)
  }

  /// The next piece, after the ones before it.
  pub fn append(&self, key: &str, bytes: &[u8]) -> Result<(), String> {
    let _one_at_a_time = BUSY.lock().unwrap_or_else(|e| e.into_inner());
    let mut part = fs::OpenOptions::new().append(true).open(self.part(key)).map_err(|e| format!("no se pudo hacer la copia segura: {e}"))?;
    part.write_all(bytes).map_err(|e| format!("no se pudo hacer la copia segura: {e}"))
  }

  /// Nothing more is coming (the save was cancelled or failed on the way): the target was never touched.
  pub fn abort(&self, key: &str) {
    let _one_at_a_time = BUSY.lock().unwrap_or_else(|e| e.into_inner());
    let _ = fs::remove_file(self.part(key));
  }

  /// All the pieces are in: make the copy permanent, then write `target` from it like `write_through` does (and with the same
  /// guarantees: if `open` fails nothing was touched; once it opens, the copy stays until the file is written and its size checked).
  pub fn commit(&self, key: &str, target: &str, open: impl FnOnce() -> Result<fs::File, String>) -> Result<(), String> {
    let _one_at_a_time = BUSY.lock().unwrap_or_else(|e| e.into_inner());
    if key != key_of(target) {
      return Err("el guardado no corresponde a ese archivo".into());
    }
    let sealed = (|| {
      fs::OpenOptions::new().append(true).open(self.part(key))?.sync_all()?; // opened for writing: some systems refuse to flush a file opened only for reading
      fs::rename(self.part(key), self.data(key))?;
      let mut n = fs::File::create(self.note(key))?;
      n.write_all(target.as_bytes())?;
      n.sync_all()
    })();
    if let Err(e) = sealed {
      self.abort_locked(key);
      return Err(format!("no se pudo hacer la copia segura: {e}"));
    }
    let mut file = match open() {
      Ok(f) => f,
      Err(e) => {
        self.forget(key);
        return Err(e);
      }
    };
    match copy_into(&mut file, &self.data(key)) {
      Ok(()) => {
        self.forget(key);
        Ok(())
      }
      Err(e) => Err(format!("{e}. Hay una copia segura del documento: se completará la próxima vez que abras Lienzo.")),
    }
  }

  fn part(&self, key: &str) -> PathBuf {
    self.dir.join(format!("{key}.part"))
  }

  fn abort_locked(&self, key: &str) {
    let _ = fs::remove_file(self.part(key));
    self.forget(key);
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
      let (Ok(target), true) = (fs::read_to_string(&path), self.data(&key).is_file()) else {
        self.forget(&key);
        continue;
      };
      let result = open(&target).and_then(|mut f| copy_into(&mut f, &self.data(&key)));
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

/// Write the file at `from` into `file` in pieces (a big document is never held in memory) and make sure it is all there.
fn copy_into(file: &mut fs::File, from: &Path) -> Result<(), String> {
  let mut source = fs::File::open(from).map_err(|e| format!("no se pudo leer la copia segura: {e}"))?;
  let length = source.metadata().map_err(|e| e.to_string())?.len();
  std::io::copy(&mut std::io::BufReader::with_capacity(1 << 20, &mut source), file).map_err(|e| format!("no se pudo escribir el archivo: {e}"))?;
  file.flush().map_err(|e| format!("no se pudo escribir el archivo: {e}"))?;
  let _ = file.sync_all();
  check_size(file, length)
}

/// Write all of `bytes` and make sure they are all there.
fn put(file: &mut fs::File, bytes: &[u8]) -> Result<(), String> {
  file.write_all(bytes).and_then(|_| file.flush()).map_err(|e| format!("no se pudo escribir el archivo: {e}"))?;
  let _ = file.sync_all(); // not every provider can; the size below is what is checked
  check_size(file, bytes.len() as u64)
}

/// A provider that hands out a pipe instead of the file itself reports no size at all (0): that is not a cut, `write_all` would have failed.
fn check_size(file: &fs::File, expected: u64) -> Result<(), String> {
  match file.metadata() {
    Ok(m) if m.len() != 0 && m.len() != expected => Err(format!("el archivo quedó con {} bytes en vez de {expected}", m.len())),
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

  #[test]
  fn a_document_handed_over_in_pieces_ends_up_whole_and_leaves_nothing_behind() {
    let dir = temp("pieces");
    let target = dir.join("doc.lienzo");
    fs::write(&target, "the old document, longer than a piece").unwrap();
    let journal = Journal::new(dir.join("journal"));
    let whole: Vec<u8> = (0..30_000u32).map(|i| (i % 253) as u8).collect();
    let key = journal.begin("content://doc").unwrap();
    for piece in whole.chunks(7_000) {
      journal.append(&key, piece).unwrap();
    }
    assert_eq!(fs::read(&target).unwrap(), b"the old document, longer than a piece", "nothing touches the file before the commit");
    journal.commit(&key, "content://doc", || open_for_writing(&target)).unwrap();
    assert_eq!(fs::read(&target).unwrap(), whole);
    assert_eq!(fs::read_dir(dir.join("journal")).unwrap().count(), 0);
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn pieces_that_never_get_committed_leave_the_file_alone_and_are_cleaned_up() {
    let dir = temp("aborted");
    let target = dir.join("doc.lienzo");
    fs::write(&target, "untouched").unwrap();
    let journal = Journal::new(dir.join("journal"));
    let key = journal.begin("content://doc").unwrap();
    journal.append(&key, b"half of a new document").unwrap();
    journal.abort(&key);
    assert_eq!(fs::read_dir(dir.join("journal")).unwrap().count(), 0);
    // Killed before the end: the leftover is dropped at the next start and the file is still the old document.
    let key = journal.begin("content://doc").unwrap();
    journal.append(&key, b"half").unwrap();
    assert!(journal.recover(|_| Err("no debería abrirse".into())).is_empty());
    assert_eq!(fs::read_dir(dir.join("journal")).unwrap().count(), 0);
    assert_eq!(fs::read(&target).unwrap(), b"untouched");
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn a_commit_to_another_file_or_to_one_that_cannot_be_opened_touches_nothing() {
    let dir = temp("refused");
    let journal = Journal::new(dir.join("journal"));
    let key = journal.begin("content://doc").unwrap();
    journal.append(&key, b"bytes").unwrap();
    assert!(journal.commit(&key, "content://other", || Err("no".into())).is_err());
    let err = journal.commit(&key, "content://doc", || Err("sin permiso".into())).unwrap_err();
    assert_eq!(err, "sin permiso");
    assert_eq!(fs::read_dir(dir.join("journal")).unwrap().count(), 0, "a file that could not be opened was never touched: no copy to keep");
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn a_commit_cut_short_is_finished_at_the_next_start() {
    let dir = temp("cutcommit");
    let target = dir.join("doc.lienzo");
    fs::write(&target, "old").unwrap();
    let journal = Journal::new(dir.join("journal"));
    let whole = vec![7u8; 4000];
    let key = journal.begin("content://doc").unwrap();
    journal.append(&key, &whole).unwrap();
    // A target that opens for reading only: the write fails after the file was reached, so the copy must stay.
    let err = journal.commit(&key, "content://doc", || fs::File::open(&target).map_err(|e| e.to_string())).unwrap_err();
    assert!(err.contains("copia segura"), "{err}");
    let report = Journal::new(dir.join("journal")).recover(|_| open_for_writing(&target));
    assert!(report[0].ok);
    assert_eq!(fs::read(&target).unwrap(), whole);
    let _ = fs::remove_dir_all(&dir);
  }
}
