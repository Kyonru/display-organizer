use std::collections::HashSet;

use chrono::Utc;

use crate::display_engine::models::{
    AutomationEvaluation, AutomationMatchResult, AutomationRule, Display, LayoutProfile,
    PlatformName,
};

pub fn current_platform() -> PlatformName {
    #[cfg(target_os = "macos")]
    {
        PlatformName::Macos
    }

    #[cfg(target_os = "windows")]
    {
        PlatformName::Windows
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        PlatformName::Linux
    }
}

pub fn evaluate_rules(
    rules: &[AutomationRule],
    profiles: &[LayoutProfile],
    displays: &[Display],
) -> AutomationEvaluation {
    let mut matches = rules
        .iter()
        .filter_map(|rule| evaluate_rule(rule, profiles, displays))
        .collect::<Vec<_>>();

    matches.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then(left.rule.name.cmp(&right.rule.name))
    });

    AutomationEvaluation {
        matches,
        evaluated_at: Utc::now().to_rfc3339(),
        display_count: displays.len(),
    }
}

fn evaluate_rule(
    rule: &AutomationRule,
    profiles: &[LayoutProfile],
    displays: &[Display],
) -> Option<AutomationMatchResult> {
    if !rule.enabled {
        return None;
    }

    let profile = profiles
        .iter()
        .find(|profile| profile.id == rule.profile_id)?;
    let mut score = 0;
    let mut reasons = Vec::new();

    if let Some(platform) = &rule.match_config.platform {
        if platform != &current_platform() {
            return None;
        }
        score += 10;
        reasons.push("platform".to_string());
    }

    if let Some(display_count) = rule.match_config.display_count {
        if display_count != displays.len() {
            return None;
        }
        score += 10;
        reasons.push("display count".to_string());
    }

    if !rule.match_config.display_stable_ids.is_empty() {
        let expected = rule
            .match_config
            .display_stable_ids
            .iter()
            .cloned()
            .collect::<HashSet<_>>();
        let actual = displays
            .iter()
            .map(|display| {
                display
                    .stable_id
                    .clone()
                    .unwrap_or_else(|| display.id.clone())
            })
            .collect::<HashSet<_>>();

        if expected != actual {
            return None;
        }

        score += 100;
        reasons.push("exact display set".to_string());
    }

    if let Some(require_internal) = rule.match_config.require_internal {
        if displays.iter().any(|display| display.is_internal) != require_internal {
            return None;
        }
        score += 5;
        reasons.push("internal display".to_string());
    }

    if let Some(require_external) = rule.match_config.require_external {
        if displays.iter().any(|display| !display.is_internal) != require_external {
            return None;
        }
        score += 5;
        reasons.push("external display".to_string());
    }

    if rule.match_config.dock_signature.is_some() {
        score += 1;
        reasons.push("dock signature".to_string());
    }

    Some(AutomationMatchResult {
        rule: rule.clone(),
        profile_name: profile.name.clone(),
        score,
        reason: if reasons.is_empty() {
            "enabled rule".to_string()
        } else {
            reasons.join(", ")
        },
    })
}

#[cfg(test)]
mod tests {
    use super::evaluate_rules;
    use crate::display_engine::models::{
        AutomationRule, AutomationRuleMatch, Display, DisplayCapabilities, DisplayCapability,
        DisplayConnectionType, DisplayRotation, Layout, LayoutProfile, PlatformName,
        ProfileMetadata, Rect, Size,
    };

    fn display(id: &str, is_internal: bool) -> Display {
        Display {
            id: id.to_string(),
            stable_id: Some(id.to_string()),
            mode_id: None,
            name: id.to_string(),
            manufacturer: None,
            model: None,
            serial_number: None,
            resolution: Size {
                width: 100,
                height: 100,
            },
            refresh_rate: None,
            scale_factor: 1.0,
            position: crate::display_engine::models::Point { x: 0, y: 0 },
            rotation: DisplayRotation::Deg0,
            is_primary: id == "a",
            is_internal,
            connection_type: Some(if is_internal {
                DisplayConnectionType::Internal
            } else {
                DisplayConnectionType::Unknown
            }),
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

    fn profile() -> LayoutProfile {
        LayoutProfile {
            id: "profile-a".to_string(),
            name: "Desk".to_string(),
            description: None,
            layout: Layout {
                displays: Vec::new(),
                primary_display_stable_id: None,
            },
            detection_rules: Vec::new(),
            hotkey: None,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
            last_applied_at: None,
            metadata: ProfileMetadata {
                app_version: "test".to_string(),
                platform_created_on: PlatformName::Macos,
            },
        }
    }

    fn rule(match_config: AutomationRuleMatch) -> AutomationRule {
        AutomationRule {
            id: "rule-a".to_string(),
            name: "Desk rule".to_string(),
            enabled: true,
            profile_id: "profile-a".to_string(),
            match_config,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
            last_triggered_at: None,
        }
    }

    #[test]
    fn matches_exact_display_set() {
        let evaluation = evaluate_rules(
            &[rule(AutomationRuleMatch {
                display_stable_ids: vec!["a".to_string(), "b".to_string()],
                display_count: Some(2),
                require_internal: Some(true),
                require_external: Some(true),
                dock_signature: None,
                platform: None,
            })],
            &[profile()],
            &[display("a", true), display("b", false)],
        );

        assert_eq!(evaluation.matches.len(), 1);
    }

    #[test]
    fn rejects_missing_or_extra_display() {
        let evaluation = evaluate_rules(
            &[rule(AutomationRuleMatch {
                display_stable_ids: vec!["a".to_string(), "b".to_string()],
                display_count: None,
                require_internal: None,
                require_external: None,
                dock_signature: None,
                platform: None,
            })],
            &[profile()],
            &[display("a", true), display("c", false)],
        );

        assert!(evaluation.matches.is_empty());
    }

    #[test]
    fn rejects_platform_mismatch() {
        let evaluation = evaluate_rules(
            &[rule(AutomationRuleMatch {
                display_stable_ids: Vec::new(),
                display_count: Some(1),
                require_internal: None,
                require_external: None,
                dock_signature: None,
                platform: Some(PlatformName::Windows),
            })],
            &[profile()],
            &[display("a", true)],
        );

        assert!(evaluation.matches.is_empty());
    }
}
