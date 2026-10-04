// Keeps the console window away on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    moli_todo_lib::run()
}
