//! The part of the desktop app that touches the disk, kept free of the window toolkit so it can be tested
//! anywhere. The app keeps two files in its data folder: `state.json` (the copy of the tasks, changes not sent
//! yet, and the sync cursor) and `settings.json` (sign-in refresh token, window position and the like).

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// The only files the web page may read or write, by name.
pub const DATA_FILES: [&str; 2] = ["state.json", "settings.json"];

/// A store file from the old app is a few kilobytes; anything much bigger is not one.
const MAX_LEGACY_BYTES: u64 = 10 * 1024 * 1024;

/// Folder of the old 哞哞清单 app inside `%APPDATA%`.
const LEGACY_FOLDER: &str = "哞哞清单";

#[derive(Debug, Clone)]
pub struct DataDir {
    root: PathBuf,
}

fn invalid(name: &str) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        format!("not a data file: {name}"),
    )
}

impl DataDir {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    fn path(&self, name: &str) -> io::Result<PathBuf> {
        if DATA_FILES.contains(&name) {
            Ok(self.root.join(name))
        } else {
            Err(invalid(name))
        }
    }

    /// The file's text, or `None` when it does not exist yet.
    pub fn read(&self, name: &str) -> io::Result<Option<String>> {
        match fs::read_to_string(self.path(name)?) {
            Ok(text) => Ok(Some(text)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Replaces the file in one step: the new text goes to a temporary file in the same folder, which is then
    /// renamed over the old one, so a crash leaves either the old or the new content, never half of each.
    pub fn write(&self, name: &str, text: &str) -> io::Result<()> {
        let target = self.path(name)?;
        fs::create_dir_all(&self.root)?;
        let temp = self.root.join(format!("{name}.tmp"));
        {
            let mut file = fs::File::create(&temp)?;
            file.write_all(text.as_bytes())?;
            file.sync_all()?;
        }
        fs::rename(&temp, &target)
    }

    /// Replaces a diagnostic file (not one of the data files the page can read back).
    pub fn write_log(&self, name: &str, text: &str) -> io::Result<()> {
        fs::create_dir_all(&self.root)?;
        fs::write(self.root.join(name), text)
    }

    /// Moves an unreadable file aside (`<name>.corrupt-<stamp>`) so the next save does not overwrite it.
    pub fn quarantine(&self, name: &str, stamp: u64) -> io::Result<()> {
        let from = self.path(name)?;
        if !from.exists() {
            return Ok(());
        }
        fs::rename(&from, self.root.join(format!("{name}.corrupt-{stamp}")))
    }
}

/// Where the old app kept its tasks, given the value of `%APPDATA%` (None off Windows).
/// True when the app runs from a mounted disk image or a quarantined copy macOS runs from a temporary
/// location (App Translocation). Such a copy cannot replace itself, so updating asks to move it first.
pub fn runs_from_disk_image(exe: &Path) -> bool {
    let text = exe.to_string_lossy();
    text.starts_with("/Volumes/") || text.contains("/AppTranslocation/")
}

pub fn legacy_store_path(appdata: Option<&Path>) -> Option<PathBuf> {
    appdata.map(|dir| dir.join(LEGACY_FOLDER).join("store.json"))
}

/// The old app's store file as text; `None` when there is none, or it is too big to be one.
pub fn read_legacy_store(appdata: Option<&Path>) -> io::Result<Option<String>> {
    let Some(path) = legacy_store_path(appdata) else {
        return Ok(None);
    };
    match fs::metadata(&path) {
        Ok(meta) if meta.is_file() && meta.len() <= MAX_LEGACY_BYTES => {
            fs::read_to_string(path).map(Some)
        }
        Ok(_) => Ok(None),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn disk_image_and_translocated_copies_cannot_update_themselves() {
        use super::runs_from_disk_image as blocked;
        use std::path::Path;
        assert!(blocked(Path::new(
            "/Volumes/Moli Todo/Moli Todo.app/Contents/MacOS/moli-todo"
        )));
        assert!(blocked(Path::new(
            "/private/var/folders/x/AppTranslocation/ABC/d/Moli Todo.app/Contents/MacOS/moli-todo"
        )));
        assert!(!blocked(Path::new(
            "/Applications/Moli Todo.app/Contents/MacOS/moli-todo"
        )));
        assert!(!blocked(Path::new(
            r"C:\Users\a\AppData\Local\Moli Todo\moli-todo.exe"
        )));
    }

    use super::*;

    fn dir() -> (tempfile::TempDir, DataDir) {
        let temp = tempfile::tempdir().unwrap();
        let data = DataDir::new(temp.path().join("data"));
        (temp, data)
    }

    #[test]
    fn reads_nothing_before_the_first_write() {
        let (_t, data) = dir();
        assert_eq!(data.read("state.json").unwrap(), None);
    }

    #[test]
    fn writes_and_reads_back_and_replaces() {
        let (_t, data) = dir();
        data.write("state.json", "{\"a\":1}").unwrap();
        assert_eq!(
            data.read("state.json").unwrap().as_deref(),
            Some("{\"a\":1}")
        );
        data.write("state.json", "{\"a\":2}").unwrap();
        assert_eq!(
            data.read("state.json").unwrap().as_deref(),
            Some("{\"a\":2}")
        );
    }

    #[test]
    fn leaves_no_temporary_file_behind() {
        let (t, data) = dir();
        data.write("settings.json", "{}").unwrap();
        let names: Vec<_> = fs::read_dir(t.path().join("data"))
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        assert_eq!(names, vec!["settings.json".to_string()]);
    }

    #[test]
    fn refuses_names_that_are_not_ours() {
        let (_t, data) = dir();
        for name in [
            "../state.json",
            "other.json",
            "state.json/../x",
            "",
            "/etc/passwd",
        ] {
            assert!(data.read(name).is_err(), "{name}");
            assert!(data.write(name, "x").is_err(), "{name}");
            assert!(data.quarantine(name, 1).is_err(), "{name}");
        }
    }

    #[test]
    fn quarantine_moves_the_file_aside_and_ignores_a_missing_one() {
        let (_t, data) = dir();
        data.quarantine("state.json", 5).unwrap();
        data.write("state.json", "garbage").unwrap();
        data.quarantine("state.json", 5).unwrap();
        assert_eq!(data.read("state.json").unwrap(), None);
        let kept = fs::read_to_string(data.root.join("state.json.corrupt-5")).unwrap();
        assert_eq!(kept, "garbage");
    }

    #[test]
    fn finds_the_old_store_only_where_appdata_is_known() {
        assert_eq!(legacy_store_path(None), None);
        let path = legacy_store_path(Some(Path::new("/x/Roaming"))).unwrap();
        assert!(path.ends_with("哞哞清单/store.json"));
    }

    #[test]
    fn reads_the_old_store_when_present() {
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(read_legacy_store(Some(temp.path())).unwrap(), None);
        assert_eq!(read_legacy_store(None).unwrap(), None);
        let folder = temp.path().join(LEGACY_FOLDER);
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("store.json"), "{\"tasks\":[]}").unwrap();
        assert_eq!(
            read_legacy_store(Some(temp.path())).unwrap().as_deref(),
            Some("{\"tasks\":[]}")
        );
    }

    #[test]
    fn ignores_an_old_store_that_is_a_folder() {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir_all(temp.path().join(LEGACY_FOLDER).join("store.json")).unwrap();
        assert_eq!(read_legacy_store(Some(temp.path())).unwrap(), None);
    }
}
