use crate::display_engine::automation;
use crate::display_engine::engine;
use crate::display_engine::models::{
    AppSettings, ApplyLayoutResult, AutomationEvaluation, AutomationEvent, AutomationEventType,
    AutomationRule, AutomationRuleDraft, DiagnosticsBundle, Display, Layout, LayoutProfile,
    LayoutProfileDraft, ProfileActionStatus, ProfileApplyResult, RecoveryState,
};
use crate::errors::AppError;
use crate::persistence::beta_repository;
use crate::persistence::profile_repository;
use crate::persistence::settings_repository;
use crate::profile_actions;

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
pub fn apply_profile(profile_id: String) -> Result<ProfileApplyResult, AppError> {
    let profile = profile_repository::get_profile(&profile_id)?;
    let draft = LayoutProfileDraft {
        name: profile.name,
        description: profile.description,
        layout: profile.layout,
        actions: profile.actions,
    };
    let result = apply_profile_draft_internal(draft)?;
    if result.applied {
        profile_repository::mark_profile_applied(&profile_id)?;
    }
    Ok(result)
}

#[tauri::command]
pub fn apply_profile_draft(draft: LayoutProfileDraft) -> Result<ProfileApplyResult, AppError> {
    apply_profile_draft_internal(draft)
}

fn apply_profile_draft_internal(draft: LayoutProfileDraft) -> Result<ProfileApplyResult, AppError> {
    let layout_result = apply_layout(draft.layout)?;
    let settings = settings_repository::get_settings().unwrap_or_default();
    let active_displays = engine::get_displays().unwrap_or_default();
    let action_results = if layout_result.applied {
        profile_actions::execute_profile_actions(&draft.actions, &active_displays, &settings)
    } else {
        Vec::new()
    };
    let message = profile_apply_message(&layout_result, &action_results);

    Ok(ProfileApplyResult {
        applied: layout_result.applied,
        message,
        layout_result,
        action_results,
    })
}

fn profile_apply_message(
    layout_result: &ApplyLayoutResult,
    action_results: &[crate::display_engine::models::ProfileActionResult],
) -> String {
    if action_results.is_empty() {
        return layout_result.message.clone();
    }

    let applied = action_results
        .iter()
        .filter(|result| matches!(result.status, ProfileActionStatus::Applied))
        .count();
    let skipped = action_results
        .iter()
        .filter(|result| matches!(result.status, ProfileActionStatus::Skipped))
        .count();
    let errors = action_results
        .iter()
        .filter(|result| matches!(result.status, ProfileActionStatus::Error))
        .count();

    format!(
        "{} Actions: {applied} applied, {skipped} skipped, {errors} failed.",
        layout_result.message
    )
}

#[tauri::command]
pub fn get_settings() -> Result<AppSettings, AppError> {
    settings_repository::get_settings()
}

#[tauri::command]
pub fn save_settings(settings: AppSettings) -> Result<AppSettings, AppError> {
    settings_repository::save_settings(settings)
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
        beta_repository::mark_automation_rule_matched(
            &automation_match.rule.id,
            &automation_match.match_signature,
        )?;
        beta_repository::record_automation_event(
            Some(automation_match.rule.id.clone()),
            Some(automation_match.rule.profile_id.clone()),
            AutomationEventType::Matched,
            format!(
                "Matched {} ({})",
                automation_match.rule.name, automation_match.reason
            ),
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
pub fn send_local_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), AppError> {
    let title = title.trim();
    let body = body.trim();

    if title.is_empty() {
        return Err(AppError::Validation(
            "notification title cannot be empty".to_string(),
        ));
    }

    #[cfg(target_os = "macos")]
    {
        let product_name = app
            .config()
            .product_name
            .clone()
            .unwrap_or_else(|| "Display Layout Manager".to_string());
        let running_from_app_bundle = std::env::current_exe()
            .ok()
            .map(|path| {
                path.ancestors().any(|ancestor| {
                    ancestor
                        .extension()
                        .is_some_and(|extension| extension.to_string_lossy() == "app")
                })
            })
            .unwrap_or(false);
        let bundle_identifier = if running_from_app_bundle {
            app.config().identifier.clone()
        } else {
            notify_rust::get_bundle_identifier_or_default(&product_name)
        };
        let _ = notify_rust::set_application(&bundle_identifier);
    }

    let mut notification = notify_rust::Notification::new();
    notification
        .summary(title)
        .body(body)
        .appname("Display Layout Manager");

    #[cfg(target_os = "macos")]
    notification.sound_name("Ping");

    #[cfg(windows)]
    notification.app_id(&app.config().identifier);

    notification
        .show()
        .map(|_| ())
        .map_err(|error| AppError::Notification(error.to_string()))
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
