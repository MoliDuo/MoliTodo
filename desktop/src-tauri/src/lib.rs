//! Moli Todo desktop shell. The interface, sync and sign-in are in the web page (`desktop/src`); this side
//! only gives it what a page cannot have: files in the app's data folder, the old app's task file, requests
//! to the sign-in service without the browser's cross-site limits (the http plugin), a tray icon, autostart,
//! a way to quit and restart, and the update plugin when the build has an update key.

use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use moli_todo_core::{read_legacy_store as read_legacy, runs_from_disk_image, DataDir};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::MacosLauncher;

#[tauri::command]
fn read_data_file(dir: State<'_, DataDir>, name: String) -> Result<Option<String>, String> {
    dir.read(&name).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_data_file(dir: State<'_, DataDir>, name: String, text: String) -> Result<(), String> {
    dir.write(&name, &text).map_err(|e| e.to_string())
}

#[tauri::command]
fn quarantine_data_file(dir: State<'_, DataDir>, name: String) -> Result<(), String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    dir.quarantine(&name, stamp).map_err(|e| e.to_string())
}

/// The old app's task file, where it used to be (Windows only); `null` when there is none.
#[tauri::command]
fn read_legacy_store() -> Result<Option<String>, String> {
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
    read_legacy(appdata.as_deref()).map_err(|e| e.to_string())
}

/// The page could not start: keep the reason in the data folder (`startup-error.log`) and make sure the
/// window is visible so the reason can be read in it.
#[tauri::command]
fn report_startup_failure(app: AppHandle, dir: State<'_, DataDir>, text: String) {
    let _ = dir.write_log("startup-error.log", &text);
    show_main(&app);
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Updates are only on in a build that was given an update key (`plugins.updater` in tauri.conf.json,
/// written by `scripts/setup-updater-keys.sh`). Without it the plugin is not even started, so a
/// development build or an unreleased tree still runs.
#[tauri::command]
fn updates_enabled(app: AppHandle) -> bool {
    app.config().plugins.0.contains_key("updater")
}

/// True when the app runs from a mounted disk image and so cannot replace itself (standard 007, 7.4.5).
#[tauri::command]
fn install_blocked() -> bool {
    std::env::current_exe()
        .map(|exe| runs_from_disk_image(&exe))
        .unwrap_or(false)
}

#[tauri::command]
fn restart_app(app: AppHandle) {
    app.restart();
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        // A second launch brings the running widget to the front instead of starting another.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app)
        }))
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            app.manage(DataDir::new(app.path().app_data_dir()?));
            if app.config().plugins.0.contains_key("updater") {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            // The page shows the window once it has put it back where it was. If the page fails to start,
            // show it anyway so the app never stays invisible.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(5));
                if let Some(window) = handle.get_webview_window("main") {
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_data_file,
            write_data_file,
            quarantine_data_file,
            read_legacy_store,
            report_startup_failure,
            quit_app,
            updates_enabled,
            install_blocked,
            restart_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running Moli Todo");
}
