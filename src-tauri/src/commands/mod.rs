use crate::display_engine::engine;
use crate::display_engine::models::{
    ApplyLayoutResult, Display, Layout, LayoutProfile, LayoutProfileDraft,
};
use crate::errors::AppError;
use crate::persistence::profile_repository;

#[tauri::command]
pub fn get_displays() -> Result<Vec<Display>, AppError> {
    engine::get_displays()
}

#[tauri::command]
pub fn get_profiles() -> Result<Vec<LayoutProfile>, AppError> {
    profile_repository::get_profiles()
}

#[tauri::command]
pub fn save_profile(draft: LayoutProfileDraft) -> Result<LayoutProfile, AppError> {
    profile_repository::save_profile(draft)
}

#[tauri::command]
pub fn update_profile(id: String, draft: LayoutProfileDraft) -> Result<LayoutProfile, AppError> {
    profile_repository::update_profile(id, draft)
}

#[tauri::command]
pub fn rename_profile(id: String, name: String) -> Result<LayoutProfile, AppError> {
    profile_repository::rename_profile(id, name)
}

#[tauri::command]
pub fn duplicate_profile(id: String) -> Result<LayoutProfile, AppError> {
    profile_repository::duplicate_profile(id)
}

#[tauri::command]
pub fn delete_profile(id: String) -> Result<(), AppError> {
    profile_repository::delete_profile(id)
}

#[tauri::command]
pub fn apply_layout(layout: Layout) -> Result<ApplyLayoutResult, AppError> {
    let current_displays = engine::get_displays()?;
    let last_known_good = Layout::from(current_displays.as_slice());
    profile_repository::save_last_known_good(&last_known_good)?;

    let result = engine::apply_layout(&layout)?;
    profile_repository::persist_apply_recovery(&result)?;
    Ok(result)
}

#[tauri::command]
pub fn apply_profile(profile_id: String) -> Result<ApplyLayoutResult, AppError> {
    let profile = profile_repository::get_profile(&profile_id)?;
    let result = apply_layout(profile.layout)?;
    if result.applied {
        profile_repository::mark_profile_applied(&profile_id)?;
    }
    Ok(result)
}
