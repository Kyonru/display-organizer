mod commands;
mod display_engine;
mod errors;
mod persistence;
mod platform;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::get_displays,
            commands::get_profiles,
            commands::save_profile,
            commands::update_profile,
            commands::rename_profile,
            commands::duplicate_profile,
            commands::delete_profile,
            commands::apply_layout,
            commands::apply_profile,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Display Layout Manager");
}
