use crate::display_engine::automation;
use crate::display_engine::engine;
use crate::display_engine::models::{
    ApplyLayoutResult, AutomationEvaluation, AutomationEvent, AutomationEventType, AutomationRule,
    AutomationRuleDraft, DiagnosticsBundle, Display, Layout, LayoutProfile, LayoutProfileDraft,
    RecoveryState,
};
use crate::errors::AppError;
use crate::persistence::beta_repository;
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

    let result = match engine::apply_layout(&layout) {
        Ok(result) => result,
        Err(error) => {
            let _ = engine::apply_layout(&last_known_good);
            return Err(error);
        }
    };
    beta_repository::create_recovery_state(&result)?;
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

#[tauri::command]
pub fn get_automation_rules() -> Result<Vec<AutomationRule>, AppError> {
    beta_repository::get_automation_rules()
}

#[tauri::command]
pub fn save_automation_rule(draft: AutomationRuleDraft) -> Result<AutomationRule, AppError> {
    beta_repository::save_automation_rule(draft)
}

#[tauri::command]
pub fn delete_automation_rule(id: String) -> Result<(), AppError> {
    beta_repository::delete_automation_rule(id)
}

#[tauri::command]
pub fn evaluate_automation_rules() -> Result<AutomationEvaluation, AppError> {
    let rules = beta_repository::get_automation_rules()?;
    let profiles = profile_repository::get_profiles()?;
    let displays = engine::get_displays()?;
    let evaluation = automation::evaluate_rules(&rules, &profiles, &displays);

    for automation_match in &evaluation.matches {
        beta_repository::record_automation_event(
            Some(automation_match.rule.id.clone()),
            Some(automation_match.rule.profile_id.clone()),
            AutomationEventType::Matched,
            format!("Matched {}", automation_match.rule.name),
        )?;
    }

    Ok(evaluation)
}

#[tauri::command]
pub fn record_automation_event(
    rule_id: Option<String>,
    profile_id: Option<String>,
    event_type: AutomationEventType,
    message: String,
) -> Result<AutomationEvent, AppError> {
    if matches!(event_type, AutomationEventType::Applied) {
        if let Some(rule_id) = rule_id.as_deref() {
            beta_repository::mark_automation_rule_triggered(rule_id)?;
        }
    }

    beta_repository::record_automation_event(rule_id, profile_id, event_type, message)
}

#[tauri::command]
pub fn get_recovery_state() -> Result<Option<RecoveryState>, AppError> {
    beta_repository::get_recovery_state()
}

#[tauri::command]
pub fn keep_recovery() -> Result<(), AppError> {
    beta_repository::clear_recovery_state()
}

#[tauri::command]
pub fn revert_recovery() -> Result<ApplyLayoutResult, AppError> {
    let state = beta_repository::get_recovery_state()?
        .ok_or_else(|| AppError::Validation("no pending recovery state".to_string()))?;
    let result = engine::apply_layout(&state.previous_layout)?;
    beta_repository::clear_recovery_state()?;
    Ok(result)
}

#[tauri::command]
pub fn export_diagnostics() -> Result<DiagnosticsBundle, AppError> {
    let displays = engine::get_displays().unwrap_or_default();
    let profiles = profile_repository::get_profiles().unwrap_or_default();
    beta_repository::export_diagnostics(displays, profiles)
}
