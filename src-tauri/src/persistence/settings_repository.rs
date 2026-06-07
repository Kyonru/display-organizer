use std::fs;
use std::path::PathBuf;

use crate::display_engine::models::AppSettings;
use crate::errors::AppError;
use crate::persistence::profile_repository;

fn settings_path() -> Result<PathBuf, AppError> {
    Ok(profile_repository::app_data_dir()?.join("settings.json"))
}

pub fn get_settings() -> Result<AppSettings, AppError> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let contents = fs::read_to_string(path)?;
    if contents.trim().is_empty() {
        return Ok(AppSettings::default());
    }

    Ok(serde_json::from_str(&contents)?)
}

pub fn save_settings(settings: AppSettings) -> Result<AppSettings, AppError> {
    let path = settings_path()?;
    fs::write(path, serde_json::to_string_pretty(&settings)?)?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use crate::display_engine::models::{
        AppSettings, AutomationNotificationSettings, ProfileActionSettings,
    };

    use super::{get_settings, save_settings};

    #[test]
    fn settings_round_trip_json() {
        let settings = AppSettings {
            profile_actions: ProfileActionSettings {
                scripts_enabled: true,
            },
            automation_notifications: AutomationNotificationSettings {
                enabled: false,
                hidden_only: true,
            },
        };

        save_settings(settings).expect("save settings");
        let loaded = get_settings().expect("get settings");

        assert!(loaded.profile_actions.scripts_enabled);
        assert!(!loaded.automation_notifications.enabled);
        assert!(loaded.automation_notifications.hidden_only);
    }

    #[test]
    fn older_settings_default_automation_notifications() {
        let settings = serde_json::from_str::<AppSettings>(
            r#"{
              "profileActions": { "scriptsEnabled": true }
            }"#,
        )
        .expect("deserialize older settings");

        assert!(settings.profile_actions.scripts_enabled);
        assert!(settings.automation_notifications.enabled);
        assert!(settings.automation_notifications.hidden_only);
    }
}
