use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;

use chrono::{Duration, Utc};
use uuid::Uuid;

use crate::display_engine::automation::current_platform;
use crate::display_engine::models::{
    ApplyLayoutResult, AutomationEvent, AutomationEventType, AutomationRule, AutomationRuleDraft,
    DiagnosticsBundle, DiagnosticsDisplaySnapshot, DiagnosticsProfileSummary, Display,
    LayoutProfile, RecoveryState,
};
use crate::errors::AppError;
use crate::persistence::profile_repository;

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_EVENTS: usize = 50;

fn path(name: &str) -> Result<PathBuf, AppError> {
    Ok(profile_repository::app_data_dir()?.join(name))
}

fn automation_rules_path() -> Result<PathBuf, AppError> {
    path("automation-rules.json")
}

fn automation_events_path() -> Result<PathBuf, AppError> {
    path("automation-events.json")
}

fn recovery_state_path() -> Result<PathBuf, AppError> {
    path("recovery-state.json")
}

fn read_json<T>(path: PathBuf, fallback: T) -> Result<T, AppError>
where
    T: serde::de::DeserializeOwned,
{
    if !path.exists() {
        return Ok(fallback);
    }

    let contents = fs::read_to_string(path)?;
    if contents.trim().is_empty() {
        return Ok(fallback);
    }

    Ok(serde_json::from_str(&contents)?)
}

fn write_json<T>(path: PathBuf, value: &T) -> Result<(), AppError>
where
    T: serde::Serialize,
{
    fs::write(path, serde_json::to_string_pretty(value)?)?;
    Ok(())
}

pub fn get_automation_rules() -> Result<Vec<AutomationRule>, AppError> {
    read_json(automation_rules_path()?, Vec::new())
}

pub fn save_automation_rule(draft: AutomationRuleDraft) -> Result<AutomationRule, AppError> {
    let trimmed = draft.name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(
            "automation rule name is required".to_string(),
        ));
    }

    if draft.profile_id.trim().is_empty() {
        return Err(AppError::Validation(
            "automation rule profile is required".to_string(),
        ));
    }

    let mut rules = get_automation_rules()?;
    let now = Utc::now().to_rfc3339();

    let saved = if let Some(id) = draft.id.clone() {
        if let Some(rule) = rules.iter_mut().find(|rule| rule.id == id) {
            rule.name = trimmed.to_string();
            rule.enabled = draft.enabled;
            rule.profile_id = draft.profile_id;
            rule.match_config = draft.match_config;
            rule.updated_at = now;
            rule.clone()
        } else {
            return Err(AppError::Validation(format!(
                "automation rule {id} was not found"
            )));
        }
    } else {
        let rule = AutomationRule {
            id: Uuid::new_v4().to_string(),
            name: trimmed.to_string(),
            enabled: draft.enabled,
            profile_id: draft.profile_id,
            match_config: draft.match_config,
            created_at: now.clone(),
            updated_at: now,
            last_triggered_at: None,
        };
        rules.insert(0, rule.clone());
        rule
    };

    write_json(automation_rules_path()?, &rules)?;
    Ok(saved)
}

pub fn mark_automation_rule_triggered(id: &str) -> Result<(), AppError> {
    let mut rules = get_automation_rules()?;
    if let Some(rule) = rules.iter_mut().find(|rule| rule.id == id) {
        rule.last_triggered_at = Some(Utc::now().to_rfc3339());
        rule.updated_at = Utc::now().to_rfc3339();
        write_json(automation_rules_path()?, &rules)?;
    }
    Ok(())
}

pub fn delete_automation_rule(id: String) -> Result<(), AppError> {
    let mut rules = get_automation_rules()?;
    let initial_len = rules.len();
    rules.retain(|rule| rule.id != id);
    if rules.len() == initial_len {
        return Err(AppError::Validation(format!(
            "automation rule {id} was not found"
        )));
    }
    write_json(automation_rules_path()?, &rules)
}

pub fn get_automation_events() -> Result<Vec<AutomationEvent>, AppError> {
    read_json(automation_events_path()?, Vec::new())
}

pub fn record_automation_event(
    rule_id: Option<String>,
    profile_id: Option<String>,
    event_type: AutomationEventType,
    message: String,
) -> Result<AutomationEvent, AppError> {
    let event = AutomationEvent {
        id: Uuid::new_v4().to_string(),
        rule_id,
        profile_id,
        event_type,
        message,
        created_at: Utc::now().to_rfc3339(),
    };

    let mut events = get_automation_events()?;
    events.insert(0, event.clone());
    events.truncate(MAX_EVENTS);
    write_json(automation_events_path()?, &events)?;
    Ok(event)
}

pub fn create_recovery_state(
    result: &ApplyLayoutResult,
) -> Result<Option<RecoveryState>, AppError> {
    let Some(previous_layout) = result.previous_layout.clone() else {
        return Ok(None);
    };

    let created_at = Utc::now();
    let state = RecoveryState {
        id: Uuid::new_v4().to_string(),
        previous_layout,
        applied_layout: result.applied_layout.clone(),
        created_at: created_at.to_rfc3339(),
        expires_at: (created_at + Duration::seconds(20)).to_rfc3339(),
        message: result.message.clone(),
        display_results: result.display_results.clone(),
    };

    write_json(recovery_state_path()?, &state)?;
    Ok(Some(state))
}

pub fn get_recovery_state() -> Result<Option<RecoveryState>, AppError> {
    read_json(recovery_state_path()?, None)
}

pub fn clear_recovery_state() -> Result<(), AppError> {
    let path = recovery_state_path()?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

pub fn export_diagnostics(
    displays: Vec<Display>,
    profiles: Vec<LayoutProfile>,
) -> Result<DiagnosticsBundle, AppError> {
    let automation_rules = get_automation_rules()?;
    let recent_events = get_automation_events()?;
    let recovery_state = get_recovery_state()?;

    Ok(DiagnosticsBundle {
        app_version: APP_VERSION.to_string(),
        generated_at: Utc::now().to_rfc3339(),
        platform: current_platform(),
        displays: displays.into_iter().map(redact_display).collect(),
        profiles: profiles
            .into_iter()
            .map(|profile| DiagnosticsProfileSummary {
                id: profile.id,
                name: profile.name,
                display_count: profile.layout.displays.len(),
                updated_at: profile.updated_at,
                last_applied_at: profile.last_applied_at,
            })
            .collect(),
        automation_rules,
        recent_events,
        recovery_state,
    })
}

fn redact_display(display: Display) -> DiagnosticsDisplaySnapshot {
    DiagnosticsDisplaySnapshot {
        stable_id_hash: hash_id(display.stable_id.as_deref().unwrap_or(display.id.as_str())),
        name: display.name,
        resolution: display.resolution,
        refresh_rate: display.refresh_rate,
        scale_factor: display.scale_factor,
        position: display.position,
        rotation: display.rotation,
        is_primary: display.is_primary,
        is_internal: display.is_internal,
        capabilities: display.capabilities,
    }
}

fn hash_id(value: &str) -> String {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use crate::display_engine::models::{
        AutomationEventType, AutomationRuleDraft, AutomationRuleMatch, Display,
        DisplayCapabilities, DisplayCapability, DisplayConnectionType, DisplayRotation, Layout,
        Point, Rect, Size,
    };

    use super::{
        clear_recovery_state, create_recovery_state, export_diagnostics, get_recovery_state,
        record_automation_event, save_automation_rule,
    };

    fn display() -> Display {
        Display {
            id: "display-a".to_string(),
            stable_id: Some("secret-stable-id".to_string()),
            mode_id: None,
            name: "Display".to_string(),
            manufacturer: None,
            model: None,
            serial_number: Some("secret-serial".to_string()),
            resolution: Size {
                width: 100,
                height: 100,
            },
            refresh_rate: None,
            scale_factor: 1.0,
            position: Point { x: 0, y: 0 },
            rotation: DisplayRotation::Deg0,
            is_primary: true,
            is_internal: true,
            connection_type: Some(DisplayConnectionType::Internal),
            bounds: Rect {
                x: 0,
                y: 0,
                width: 100,
                height: 100,
            },
            capabilities: DisplayCapabilities {
                position: DisplayCapability::supported(),
                primary: DisplayCapability::supported(),
                rotation: DisplayCapability::supported(),
                scale: DisplayCapability::supported(),
            },
            scale_options: Vec::new(),
        }
    }

    #[test]
    fn automation_rule_round_trips_json() {
        let rule = save_automation_rule(AutomationRuleDraft {
            id: None,
            name: "Desk".to_string(),
            enabled: true,
            profile_id: "profile-a".to_string(),
            match_config: AutomationRuleMatch {
                display_stable_ids: vec!["display-a".to_string()],
                display_count: Some(1),
                require_internal: Some(true),
                require_external: Some(false),
                dock_signature: None,
                platform: None,
            },
        })
        .expect("save automation rule");

        assert_eq!(rule.name, "Desk");
    }

    #[test]
    fn recovery_state_round_trips() {
        let layout = Layout {
            displays: Vec::new(),
            primary_display_stable_id: None,
        };
        let result = crate::display_engine::models::ApplyLayoutResult {
            applied: true,
            message: "Applied".to_string(),
            previous_layout: Some(layout),
            applied_layout: None,
            display_results: Vec::new(),
        };

        create_recovery_state(&result).expect("create recovery");
        assert!(get_recovery_state().expect("get recovery").is_some());
        clear_recovery_state().expect("clear recovery");
        assert!(get_recovery_state().expect("get recovery").is_none());
    }

    #[test]
    fn diagnostics_redacts_display_identity() {
        record_automation_event(
            None,
            None,
            AutomationEventType::Skipped,
            "Skipped".to_string(),
        )
        .expect("record event");

        let bundle = export_diagnostics(vec![display()], Vec::new()).expect("diagnostics");
        assert_ne!(bundle.displays[0].stable_id_hash, "secret-stable-id");
        assert_eq!(bundle.displays[0].stable_id_hash.len(), 16);
    }
}
