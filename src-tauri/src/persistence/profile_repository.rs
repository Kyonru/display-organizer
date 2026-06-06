use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use uuid::Uuid;

use crate::display_engine::models::{
    Layout, LayoutProfile, LayoutProfileDraft, PlatformName, ProfileMetadata,
};
use crate::errors::AppError;

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

pub(crate) fn app_data_dir() -> Result<PathBuf, AppError> {
    #[cfg(test)]
    {
        let dir = std::env::temp_dir().join("display-layout-manager-tests");
        fs::create_dir_all(&dir)?;
        return Ok(dir);
    }

    #[cfg(not(test))]
    {
        let dir = dirs::data_dir()
            .ok_or_else(|| AppError::Storage("unable to resolve app data directory".to_string()))?
            .join("Display Layout Manager");
        fs::create_dir_all(&dir)?;
        Ok(dir)
    }
}

fn profiles_path() -> Result<PathBuf, AppError> {
    Ok(app_data_dir()?.join("profiles.json"))
}

fn last_known_good_path() -> Result<PathBuf, AppError> {
    Ok(app_data_dir()?.join("last-known-good-layout.json"))
}

pub fn get_profiles() -> Result<Vec<LayoutProfile>, AppError> {
    let path = profiles_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let contents = fs::read_to_string(path)?;
    if contents.trim().is_empty() {
        return Ok(Vec::new());
    }

    Ok(serde_json::from_str(&contents)?)
}

fn write_profiles(profiles: &[LayoutProfile]) -> Result<(), AppError> {
    let path = profiles_path()?;
    let payload = serde_json::to_string_pretty(profiles)?;
    fs::write(path, payload)?;
    Ok(())
}

pub fn save_profile(draft: LayoutProfileDraft) -> Result<LayoutProfile, AppError> {
    let now = Utc::now().to_rfc3339();
    let profile = LayoutProfile {
        id: Uuid::new_v4().to_string(),
        name: draft.name.trim().to_string(),
        description: draft.description,
        layout: draft.layout,
        detection_rules: Vec::new(),
        hotkey: None,
        created_at: now.clone(),
        updated_at: now,
        last_applied_at: None,
        metadata: ProfileMetadata {
            app_version: APP_VERSION.to_string(),
            platform_created_on: PlatformName::Macos,
        },
    };

    if profile.name.is_empty() {
        return Err(AppError::Validation("profile name is required".to_string()));
    }

    let mut profiles = get_profiles()?;
    profiles.insert(0, profile.clone());
    write_profiles(&profiles)?;
    Ok(profile)
}

pub fn update_profile(id: String, draft: LayoutProfileDraft) -> Result<LayoutProfile, AppError> {
    let trimmed = draft.name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("profile name is required".to_string()));
    }

    let mut profiles = get_profiles()?;
    let profile = profiles
        .iter_mut()
        .find(|profile| profile.id == id)
        .ok_or_else(|| AppError::ProfileNotFound(id.clone()))?;

    profile.name = trimmed.to_string();
    profile.description = draft.description;
    profile.layout = draft.layout;
    profile.updated_at = Utc::now().to_rfc3339();
    let updated = profile.clone();
    write_profiles(&profiles)?;
    Ok(updated)
}

pub fn rename_profile(id: String, name: String) -> Result<LayoutProfile, AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("profile name is required".to_string()));
    }

    let mut profiles = get_profiles()?;
    let profile = profiles
        .iter_mut()
        .find(|profile| profile.id == id)
        .ok_or_else(|| AppError::ProfileNotFound(id.clone()))?;
    profile.name = trimmed.to_string();
    profile.updated_at = Utc::now().to_rfc3339();
    let updated = profile.clone();
    write_profiles(&profiles)?;
    Ok(updated)
}

pub fn duplicate_profile(id: String) -> Result<LayoutProfile, AppError> {
    let mut profiles = get_profiles()?;
    let source = profiles
        .iter()
        .find(|profile| profile.id == id)
        .cloned()
        .ok_or_else(|| AppError::ProfileNotFound(id.clone()))?;

    let now = Utc::now().to_rfc3339();
    let mut duplicate = source;
    duplicate.id = Uuid::new_v4().to_string();
    duplicate.name = format!("{} Copy", duplicate.name);
    duplicate.created_at = now.clone();
    duplicate.updated_at = now;
    duplicate.last_applied_at = None;

    profiles.insert(0, duplicate.clone());
    write_profiles(&profiles)?;
    Ok(duplicate)
}

pub fn delete_profile(id: String) -> Result<(), AppError> {
    let mut profiles = get_profiles()?;
    let initial_len = profiles.len();
    profiles.retain(|profile| profile.id != id);
    if profiles.len() == initial_len {
        return Err(AppError::ProfileNotFound(id));
    }
    write_profiles(&profiles)
}

pub fn get_profile(id: &str) -> Result<LayoutProfile, AppError> {
    get_profiles()?
        .into_iter()
        .find(|profile| profile.id == id)
        .ok_or_else(|| AppError::ProfileNotFound(id.to_string()))
}

pub fn mark_profile_applied(id: &str) -> Result<(), AppError> {
    let mut profiles = get_profiles()?;
    let profile = profiles
        .iter_mut()
        .find(|profile| profile.id == id)
        .ok_or_else(|| AppError::ProfileNotFound(id.to_string()))?;
    profile.last_applied_at = Some(Utc::now().to_rfc3339());
    profile.updated_at = Utc::now().to_rfc3339();
    write_profiles(&profiles)
}

pub fn save_last_known_good(layout: &Layout) -> Result<(), AppError> {
    let path = last_known_good_path()?;
    fs::write(path, serde_json::to_string_pretty(layout)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::display_engine::models::{
        DisplayRotation, Layout, LayoutDisplay, LayoutProfileDraft, Point, Size,
    };

    use super::{
        delete_profile, duplicate_profile, get_profiles, rename_profile, save_profile,
        update_profile,
    };

    fn draft(name: &str) -> LayoutProfileDraft {
        LayoutProfileDraft {
            name: name.to_string(),
            description: None,
            layout: Layout {
                displays: vec![LayoutDisplay {
                    stable_id: "display-a".to_string(),
                    mode_id: Some("display-a-mode".to_string()),
                    position: Point { x: 0, y: 0 },
                    resolution: Size {
                        width: 100,
                        height: 100,
                    },
                    refresh_rate: None,
                    scale_factor: 1.0,
                    rotation: DisplayRotation::Deg0,
                    enabled: true,
                }],
                primary_display_stable_id: Some("display-a".to_string()),
            },
        }
    }

    #[test]
    fn profile_crud_round_trips_json() {
        let profile = save_profile(draft("Test Profile")).expect("save profile");
        let renamed =
            rename_profile(profile.id.clone(), "Renamed".to_string()).expect("rename profile");
        assert_eq!(renamed.name, "Renamed");

        let updated = update_profile(profile.id.clone(), draft("Updated")).expect("update profile");
        assert_eq!(updated.name, "Updated");

        let duplicate = duplicate_profile(profile.id.clone()).expect("duplicate profile");
        assert!(duplicate.name.contains("Copy"));

        delete_profile(profile.id).expect("delete original");
        delete_profile(duplicate.id).expect("delete duplicate");

        let profiles = get_profiles().expect("get profiles");
        assert!(!profiles.iter().any(|profile| profile.name == "Renamed"));
    }
}
