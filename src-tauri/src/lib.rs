mod app_menu;
mod automation_monitor;
mod commands;
mod display_engine;
mod errors;
mod persistence;
mod platform;
mod profile_actions;
mod tray;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            app_menu::setup(app)?;
            tray::setup(app)?;
            automation_monitor::setup(app.handle().clone());
            Ok(())
        })
        .on_menu_event(|app, event| {
            tray::handle_menu_action(app, event.id().as_ref());
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
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
            commands::apply_profile_draft,
            commands::get_settings,
            commands::save_settings,
            commands::get_automation_rules,
            commands::save_automation_rule,
            commands::delete_automation_rule,
            commands::evaluate_automation_rules,
            commands::record_automation_event,
            commands::send_local_notification,
            commands::get_recovery_state,
            commands::keep_recovery,
            commands::revert_recovery,
            commands::export_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Display Layout Manager");
}
