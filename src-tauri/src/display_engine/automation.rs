use std::collections::{hash_map::DefaultHasher, HashSet};
use std::hash::{Hash, Hasher};
use std::process::Command;

use chrono::{DateTime, Datelike, Local, NaiveTime, Utc};

use crate::display_engine::models::{
    AppEventKind, AppLifecycleKind, AutomationCondition, AutomationEvaluation,
    AutomationMatchResult, AutomationRule, AutomationRuleMatch, AutomationTrigger,
    ConfirmationMode, Display, LayoutProfile, PlatformName, PowerSourceState,
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

#[derive(Debug, Clone)]
pub struct AutomationContext {
    pub displays: Vec<Display>,
    pub platform: PlatformName,
    pub now: DateTime<Local>,
    pub running_apps: HashSet<String>,
    pub previous_running_apps: HashSet<String>,
    pub power_source: Option<PowerSourceState>,
    pub wifi_ssid: Option<String>,
    pub lifecycle_events: HashSet<AppLifecycleKind>,
}

impl AutomationContext {
    pub fn current(displays: &[Display]) -> Self {
        let running_apps = process_snapshot();

        Self {
            displays: displays.to_vec(),
            platform: current_platform(),
            now: Local::now(),
            previous_running_apps: HashSet::new(),
            running_apps,
            power_source: current_power_source(),
            wifi_ssid: current_wifi_ssid(),
            lifecycle_events: HashSet::from([AppLifecycleKind::AppLaunch]),
        }
    }
}

pub fn evaluate_rules(
    rules: &[AutomationRule],
    profiles: &[LayoutProfile],
    displays: &[Display],
) -> AutomationEvaluation {
    let context = AutomationContext::current(displays);
    evaluate_rules_with_context(rules, profiles, &context)
}

pub fn evaluate_rules_with_context(
    rules: &[AutomationRule],
    profiles: &[LayoutProfile],
    context: &AutomationContext,
) -> AutomationEvaluation {
    let mut matches = rules
        .iter()
        .filter_map(|rule| evaluate_rule(rule, profiles, context))
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
        display_count: context.displays.len(),
    }
}

fn evaluate_rule(
    rule: &AutomationRule,
    profiles: &[LayoutProfile],
    context: &AutomationContext,
) -> Option<AutomationMatchResult> {
    if !rule.enabled {
        return None;
    }

    let profile = profiles
        .iter()
        .find(|profile| profile.id == rule.profile_id)?;

    let mut score = 0;
    let mut matched_triggers = Vec::new();
    let mut matched_conditions = Vec::new();
    let mut skipped_reasons = Vec::new();

    for trigger in effective_triggers(rule) {
        match trigger_matches(&trigger, context) {
            MatchDecision::Matched {
                label,
                score: trigger_score,
            } => {
                score += trigger_score;
                matched_triggers.push(label);
            }
            MatchDecision::Skipped(reason) => skipped_reasons.push(reason),
        }
    }

    if matched_triggers.is_empty() {
        return None;
    }

    for condition in effective_conditions(rule) {
        match condition_matches(&condition, context) {
            MatchDecision::Matched {
                label,
                score: condition_score,
            } => {
                score += condition_score;
                matched_conditions.push(label);
            }
            MatchDecision::Skipped(reason) => {
                skipped_reasons.push(reason);
                return None;
            }
        }
    }

    let cooldown_remaining_ms = cooldown_remaining_ms(rule, context.now);
    if cooldown_remaining_ms.unwrap_or(0) > 0 {
        return None;
    }

    let match_signature = match_signature(rule, context, &matched_triggers, &matched_conditions);
    if rule.last_matched_signature.as_deref() == Some(match_signature.as_str()) {
        return None;
    }

    let requires_confirmation = matches!(rule.confirmation_mode, ConfirmationMode::Confirm);
    let mut reasons = matched_triggers.clone();
    reasons.extend(matched_conditions.clone());

    Some(AutomationMatchResult {
        rule: rule.clone(),
        profile_name: profile.name.clone(),
        score,
        reason: if reasons.is_empty() {
            "enabled rule".to_string()
        } else {
            reasons.join(", ")
        },
        matched_triggers,
        matched_conditions,
        skipped_reasons,
        requires_confirmation,
        cooldown_remaining_ms,
        match_signature,
    })
}

fn effective_triggers(rule: &AutomationRule) -> Vec<AutomationTrigger> {
    if !rule.triggers.is_empty() {
        return rule.triggers.clone();
    }

    vec![display_trigger_from_match(&rule.match_config)]
}

fn effective_conditions(rule: &AutomationRule) -> Vec<AutomationCondition> {
    rule.conditions.clone()
}

fn display_trigger_from_match(match_config: &AutomationRuleMatch) -> AutomationTrigger {
    AutomationTrigger::DisplaySetupChanged {
        display_stable_ids: match_config.display_stable_ids.clone(),
        display_count: match_config.display_count,
        require_internal: match_config.require_internal,
        require_external: match_config.require_external,
        platform: match_config.platform.clone(),
    }
}

enum MatchDecision {
    Matched { label: String, score: u32 },
    Skipped(String),
}

fn trigger_matches(trigger: &AutomationTrigger, context: &AutomationContext) -> MatchDecision {
    match trigger {
        AutomationTrigger::DisplaySetupChanged {
            display_stable_ids,
            display_count,
            require_internal,
            require_external,
            platform,
        } => display_setup_matches(
            display_stable_ids,
            *display_count,
            *require_internal,
            *require_external,
            platform.as_ref(),
            context,
            "display setup",
        ),
        AutomationTrigger::TimeSchedule {
            exact_time,
            start_time,
            end_time,
            weekdays,
        } => time_matches(
            exact_time.as_deref(),
            start_time.as_deref(),
            end_time.as_deref(),
            weekdays,
            context,
            "time schedule",
        ),
        AutomationTrigger::AppEvent { app_name, event } => {
            app_event_matches(app_name, event, context)
        }
        AutomationTrigger::AppLifecycle { event } => {
            if context.lifecycle_events.contains(event) {
                MatchDecision::Matched {
                    label: lifecycle_label(event),
                    score: 30,
                }
            } else {
                MatchDecision::Skipped(format!("{} did not occur", lifecycle_label(event)))
            }
        }
        AutomationTrigger::PowerSource { source } => {
            power_source_matches(source, context, "power source")
        }
        AutomationTrigger::NetworkContext { ssid, contains } => {
            wifi_matches(ssid, *contains, context, "Wi-Fi")
        }
    }
}

fn condition_matches(
    condition: &AutomationCondition,
    context: &AutomationContext,
) -> MatchDecision {
    match condition {
        AutomationCondition::DisplayCount { count } => {
            if context.displays.len() == *count {
                MatchDecision::Matched {
                    label: format!("{count} displays"),
                    score: 10,
                }
            } else {
                MatchDecision::Skipped(format!(
                    "expected {count} displays, found {}",
                    context.displays.len()
                ))
            }
        }
        AutomationCondition::DisplayIds { stable_ids, exact } => {
            display_ids_match(stable_ids, *exact, context, "display ids")
        }
        AutomationCondition::InternalDisplay { required } => bool_presence_matches(
            context.displays.iter().any(|display| display.is_internal),
            *required,
            "internal display",
            5,
        ),
        AutomationCondition::ExternalDisplay { required } => bool_presence_matches(
            context.displays.iter().any(|display| !display.is_internal),
            *required,
            "external display",
            5,
        ),
        AutomationCondition::Platform { platform } => {
            if &context.platform == platform {
                MatchDecision::Matched {
                    label: "platform".to_string(),
                    score: 10,
                }
            } else {
                MatchDecision::Skipped(format!(
                    "platform is {:?}, expected {:?}",
                    context.platform, platform
                ))
            }
        }
        AutomationCondition::TimeWindow {
            start_time,
            end_time,
            weekdays,
        } => time_matches(
            None,
            Some(start_time),
            Some(end_time),
            weekdays,
            context,
            "time window",
        ),
        AutomationCondition::AppRunning { app_name, running } => {
            let is_running = app_running(app_name, &context.running_apps);
            if is_running == *running {
                MatchDecision::Matched {
                    label: if *running {
                        format!("{app_name} running")
                    } else {
                        format!("{app_name} not running")
                    },
                    score: 15,
                }
            } else {
                MatchDecision::Skipped(if *running {
                    format!("{app_name} is not running")
                } else {
                    format!("{app_name} is running")
                })
            }
        }
        AutomationCondition::PowerSource { source } => {
            power_source_matches(source, context, "power source")
        }
        AutomationCondition::WifiSsid { ssid, contains } => {
            wifi_matches(ssid, *contains, context, "Wi-Fi")
        }
    }
}

fn display_setup_matches(
    display_stable_ids: &[String],
    display_count: Option<usize>,
    require_internal: Option<bool>,
    require_external: Option<bool>,
    platform: Option<&PlatformName>,
    context: &AutomationContext,
    label: &str,
) -> MatchDecision {
    let mut score = 20;
    let mut labels = vec![label.to_string()];

    if let Some(platform) = platform {
        if platform != &context.platform {
            return MatchDecision::Skipped(format!(
                "platform is {:?}, expected {:?}",
                context.platform, platform
            ));
        }
        score += 10;
        labels.push("platform".to_string());
    }

    if let Some(display_count) = display_count {
        if display_count != context.displays.len() {
            return MatchDecision::Skipped(format!(
                "expected {display_count} displays, found {}",
                context.displays.len()
            ));
        }
        score += 10;
        labels.push("display count".to_string());
    }

    if !display_stable_ids.is_empty() {
        match display_ids_match(display_stable_ids, true, context, "exact display set") {
            MatchDecision::Matched {
                score: id_score, ..
            } => {
                score += id_score;
                labels.push("exact display set".to_string());
            }
            MatchDecision::Skipped(reason) => return MatchDecision::Skipped(reason),
        }
    }

    if let Some(require_internal) = require_internal {
        match bool_presence_matches(
            context.displays.iter().any(|display| display.is_internal),
            require_internal,
            "internal display",
            5,
        ) {
            MatchDecision::Matched {
                score: internal_score,
                ..
            } => {
                score += internal_score;
                labels.push("internal display".to_string());
            }
            MatchDecision::Skipped(reason) => return MatchDecision::Skipped(reason),
        }
    }

    if let Some(require_external) = require_external {
        match bool_presence_matches(
            context.displays.iter().any(|display| !display.is_internal),
            require_external,
            "external display",
            5,
        ) {
            MatchDecision::Matched {
                score: external_score,
                ..
            } => {
                score += external_score;
                labels.push("external display".to_string());
            }
            MatchDecision::Skipped(reason) => return MatchDecision::Skipped(reason),
        }
    }

    MatchDecision::Matched {
        label: labels.join(" + "),
        score,
    }
}

fn display_ids_match(
    stable_ids: &[String],
    exact: bool,
    context: &AutomationContext,
    label: &str,
) -> MatchDecision {
    let expected = stable_ids.iter().cloned().collect::<HashSet<_>>();
    let actual = display_ids(&context.displays);
    let matched = if exact {
        expected == actual
    } else {
        expected
            .iter()
            .all(|display_id| actual.contains(display_id))
    };

    if matched {
        MatchDecision::Matched {
            label: label.to_string(),
            score: if exact { 100 } else { 60 },
        }
    } else {
        MatchDecision::Skipped(if exact {
            "display set changed".to_string()
        } else {
            "required display is missing".to_string()
        })
    }
}

fn bool_presence_matches(actual: bool, expected: bool, label: &str, score: u32) -> MatchDecision {
    if actual == expected {
        MatchDecision::Matched {
            label: label.to_string(),
            score,
        }
    } else {
        MatchDecision::Skipped(format!("{label} requirement was not met"))
    }
}

fn time_matches(
    exact_time: Option<&str>,
    start_time: Option<&str>,
    end_time: Option<&str>,
    weekdays: &[u32],
    context: &AutomationContext,
    label: &str,
) -> MatchDecision {
    if !weekday_matches(weekdays, context.now) {
        return MatchDecision::Skipped("weekday did not match".to_string());
    }

    let now_time = minute_time(context.now);

    if let Some(exact_time) = exact_time {
        let Some(exact) = parse_time(exact_time) else {
            return MatchDecision::Skipped(format!("invalid time {exact_time}"));
        };

        if now_time == exact {
            return MatchDecision::Matched {
                label: format!("{label} {exact_time}"),
                score: 35,
            };
        }

        return MatchDecision::Skipped(format!(
            "time is {}, expected {exact_time}",
            now_time.format("%H:%M")
        ));
    }

    let Some(start) = start_time.and_then(parse_time) else {
        return MatchDecision::Skipped("time window start is missing".to_string());
    };
    let Some(end) = end_time.and_then(parse_time) else {
        return MatchDecision::Skipped("time window end is missing".to_string());
    };

    if time_in_window(now_time, start, end) {
        MatchDecision::Matched {
            label: format!("{label} {}-{}", start.format("%H:%M"), end.format("%H:%M")),
            score: 30,
        }
    } else {
        MatchDecision::Skipped(format!(
            "time {} outside {}-{}",
            now_time.format("%H:%M"),
            start.format("%H:%M"),
            end.format("%H:%M")
        ))
    }
}

fn app_event_matches(
    app_name: &str,
    event: &AppEventKind,
    context: &AutomationContext,
) -> MatchDecision {
    let current = app_running(app_name, &context.running_apps);
    let previous = app_running(app_name, &context.previous_running_apps);
    let matched = match event {
        AppEventKind::Opened => current && !previous,
        AppEventKind::Closed => !current && previous,
        AppEventKind::Running => current,
    };

    if matched {
        MatchDecision::Matched {
            label: format!("{app_name} {}", app_event_label(event)),
            score: match event {
                AppEventKind::Running => 20,
                AppEventKind::Opened | AppEventKind::Closed => 40,
            },
        }
    } else {
        MatchDecision::Skipped(format!("{app_name} did not {}", app_event_label(event)))
    }
}

fn app_running(app_name: &str, processes: &HashSet<String>) -> bool {
    let needle = normalize_process_name(app_name);
    processes
        .iter()
        .any(|process| normalize_process_name(process).contains(&needle))
}

fn power_source_matches(
    expected: &PowerSourceState,
    context: &AutomationContext,
    label: &str,
) -> MatchDecision {
    let Some(actual) = &context.power_source else {
        return MatchDecision::Skipped("power source unavailable".to_string());
    };

    if actual == expected {
        MatchDecision::Matched {
            label: label.to_string(),
            score: 15,
        }
    } else {
        MatchDecision::Skipped(format!(
            "power source is {:?}, expected {:?}",
            actual, expected
        ))
    }
}

fn wifi_matches(
    ssid: &str,
    contains: bool,
    context: &AutomationContext,
    label: &str,
) -> MatchDecision {
    let Some(actual) = &context.wifi_ssid else {
        return MatchDecision::Skipped("Wi-Fi SSID unavailable".to_string());
    };
    let matched = if contains {
        actual.to_lowercase().contains(&ssid.to_lowercase())
    } else {
        actual.eq_ignore_ascii_case(ssid)
    };

    if matched {
        MatchDecision::Matched {
            label: label.to_string(),
            score: 15,
        }
    } else {
        MatchDecision::Skipped("Wi-Fi SSID did not match".to_string())
    }
}

fn cooldown_remaining_ms(rule: &AutomationRule, now: DateTime<Local>) -> Option<u64> {
    if rule.cooldown_ms == 0 {
        return Some(0);
    }

    let last_triggered_at = rule.last_triggered_at.as_deref()?;
    let parsed = DateTime::parse_from_rfc3339(last_triggered_at).ok()?;
    let elapsed_ms = now
        .signed_duration_since(parsed.with_timezone(&Local))
        .num_milliseconds()
        .max(0) as u64;

    Some(rule.cooldown_ms.saturating_sub(elapsed_ms))
}

fn match_signature(
    rule: &AutomationRule,
    context: &AutomationContext,
    matched_triggers: &[String],
    matched_conditions: &[String],
) -> String {
    let display_ids = {
        let mut ids = display_ids(&context.displays)
            .into_iter()
            .collect::<Vec<_>>();
        ids.sort();
        ids.join("|")
    };
    let mut hasher = DefaultHasher::new();
    context.wifi_ssid.hash(&mut hasher);
    let time_key = if rule_uses_time(rule) {
        context.now.format("%Y-%m-%dT%H:%M").to_string()
    } else {
        String::new()
    };
    let app_key = if rule_uses_apps(rule) {
        let mut running = context.running_apps.iter().cloned().collect::<Vec<_>>();
        let mut previous = context
            .previous_running_apps
            .iter()
            .cloned()
            .collect::<Vec<_>>();
        running.sort();
        previous.sort();
        format!("{}->{}", previous.join("|"), running.join("|"))
    } else {
        String::new()
    };

    format!(
        "{}:{}:{}:{}:{}:{:?}:{}:{}:{}",
        rule.id,
        rule.profile_id,
        display_ids,
        time_key,
        app_key,
        context.power_source,
        hasher.finish(),
        matched_triggers.join("|"),
        matched_conditions.join("|")
    )
}

fn rule_uses_time(rule: &AutomationRule) -> bool {
    rule.triggers
        .iter()
        .any(|trigger| matches!(trigger, AutomationTrigger::TimeSchedule { .. }))
        || rule
            .conditions
            .iter()
            .any(|condition| matches!(condition, AutomationCondition::TimeWindow { .. }))
}

fn rule_uses_apps(rule: &AutomationRule) -> bool {
    rule.triggers
        .iter()
        .any(|trigger| matches!(trigger, AutomationTrigger::AppEvent { .. }))
        || rule
            .conditions
            .iter()
            .any(|condition| matches!(condition, AutomationCondition::AppRunning { .. }))
}

fn display_ids(displays: &[Display]) -> HashSet<String> {
    displays
        .iter()
        .map(|display| {
            display
                .stable_id
                .clone()
                .unwrap_or_else(|| display.id.clone())
        })
        .collect::<HashSet<_>>()
}

fn weekday_matches(weekdays: &[u32], now: DateTime<Local>) -> bool {
    if weekdays.is_empty() {
        return true;
    }

    let weekday = now.weekday().num_days_from_monday() + 1;
    weekdays.contains(&weekday)
}

fn parse_time(value: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(value, "%H:%M").ok()
}

fn minute_time(value: DateTime<Local>) -> NaiveTime {
    NaiveTime::from_hms_opt(value.hour(), value.minute(), 0).unwrap_or(NaiveTime::MIN)
}

fn time_in_window(now: NaiveTime, start: NaiveTime, end: NaiveTime) -> bool {
    if start <= end {
        now >= start && now <= end
    } else {
        now >= start || now <= end
    }
}

fn app_event_label(event: &AppEventKind) -> &'static str {
    match event {
        AppEventKind::Opened => "open",
        AppEventKind::Closed => "close",
        AppEventKind::Running => "run",
    }
}

fn lifecycle_label(event: &AppLifecycleKind) -> String {
    match event {
        AppLifecycleKind::AppLaunch => "app launch".to_string(),
        AppLifecycleKind::SystemWake => "system wake".to_string(),
    }
}

fn normalize_process_name(value: &str) -> String {
    value.trim().trim_end_matches(".app").to_lowercase()
}

fn process_snapshot() -> HashSet<String> {
    let mut system = sysinfo::System::new_all();
    system.refresh_all();
    system
        .processes()
        .values()
        .flat_map(|process| {
            let mut names = vec![process.name().to_string()];
            if let Some(executable) = process.exe() {
                if let Some(name) = executable.file_stem().and_then(|name| name.to_str()) {
                    names.push(name.to_string());
                }
            }
            names
        })
        .filter(|name| !name.trim().is_empty())
        .collect()
}

#[cfg(target_os = "macos")]
fn current_power_source() -> Option<PowerSourceState> {
    let output = Command::new("/usr/bin/pmset")
        .args(["-g", "batt"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout).to_lowercase();

    if text.contains("ac power") {
        Some(PowerSourceState::Ac)
    } else if text.contains("charging") {
        Some(PowerSourceState::Charging)
    } else if text.contains("battery power") {
        Some(PowerSourceState::Battery)
    } else {
        None
    }
}

#[cfg(not(target_os = "macos"))]
fn current_power_source() -> Option<PowerSourceState> {
    None
}

#[cfg(target_os = "macos")]
fn current_wifi_ssid() -> Option<String> {
    let output = Command::new("/usr/sbin/networksetup")
        .args(["-getairportnetwork", "en0"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.split_once(": ")
        .map(|(_, ssid)| ssid.trim().to_string())
        .filter(|ssid| !ssid.is_empty())
}

#[cfg(not(target_os = "macos"))]
fn current_wifi_ssid() -> Option<String> {
    None
}

trait TimeParts {
    fn hour(&self) -> u32;
    fn minute(&self) -> u32;
}

impl TimeParts for DateTime<Local> {
    fn hour(&self) -> u32 {
        chrono::Timelike::hour(self)
    }

    fn minute(&self) -> u32 {
        chrono::Timelike::minute(self)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use chrono::{Local, TimeZone};

    use super::{evaluate_rules_with_context, AutomationContext};
    use crate::display_engine::models::{
        AppEventKind, AppLifecycleKind, AutomationCondition, AutomationRule, AutomationRuleMatch,
        AutomationTrigger, ConfirmationMode, Display, DisplayCapabilities, DisplayCapability,
        DisplayConnectionType, DisplayRotation, Layout, LayoutProfile, PlatformName,
        PowerSourceState, ProfileMetadata, Rect, Size,
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
            actions: Vec::new(),
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
            triggers: Vec::new(),
            conditions: Vec::new(),
            confirmation_mode: ConfirmationMode::Confirm,
            cooldown_ms: 600_000,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
            last_triggered_at: None,
            last_matched_signature: None,
        }
    }

    fn context(displays: Vec<Display>) -> AutomationContext {
        AutomationContext {
            displays,
            platform: PlatformName::Macos,
            now: Local.with_ymd_and_hms(2026, 6, 8, 9, 30, 0).unwrap(),
            running_apps: HashSet::new(),
            previous_running_apps: HashSet::new(),
            power_source: Some(PowerSourceState::Ac),
            wifi_ssid: Some("Studio".to_string()),
            lifecycle_events: HashSet::from([AppLifecycleKind::AppLaunch]),
        }
    }

    #[test]
    fn legacy_rule_matches_exact_display_set() {
        let evaluation = evaluate_rules_with_context(
            &[rule(AutomationRuleMatch {
                display_stable_ids: vec!["a".to_string(), "b".to_string()],
                display_count: Some(2),
                require_internal: Some(true),
                require_external: Some(true),
                dock_signature: None,
                platform: None,
            })],
            &[profile()],
            &context(vec![display("a", true), display("b", false)]),
        );

        assert_eq!(evaluation.matches.len(), 1);
    }

    #[test]
    fn rejects_missing_or_extra_display() {
        let evaluation = evaluate_rules_with_context(
            &[rule(AutomationRuleMatch {
                display_stable_ids: vec!["a".to_string(), "b".to_string()],
                display_count: None,
                require_internal: None,
                require_external: None,
                dock_signature: None,
                platform: None,
            })],
            &[profile()],
            &context(vec![display("a", true), display("c", false)]),
        );

        assert!(evaluation.matches.is_empty());
    }

    #[test]
    fn rejects_platform_mismatch() {
        let evaluation = evaluate_rules_with_context(
            &[rule(AutomationRuleMatch {
                display_stable_ids: Vec::new(),
                display_count: Some(1),
                require_internal: None,
                require_external: None,
                dock_signature: None,
                platform: Some(PlatformName::Windows),
            })],
            &[profile()],
            &context(vec![display("a", true)]),
        );

        assert!(evaluation.matches.is_empty());
    }

    #[test]
    fn time_schedule_matches_exact_time_and_crossing_midnight_window() {
        let mut exact = rule(AutomationRuleMatch {
            display_stable_ids: Vec::new(),
            display_count: None,
            require_internal: None,
            require_external: None,
            dock_signature: None,
            platform: None,
        });
        exact.triggers = vec![AutomationTrigger::TimeSchedule {
            exact_time: Some("09:30".to_string()),
            start_time: None,
            end_time: None,
            weekdays: vec![1],
        }];

        let evaluation =
            evaluate_rules_with_context(&[exact], &[profile()], &context(vec![display("a", true)]));
        assert_eq!(evaluation.matches.len(), 1);

        let mut window = rule(AutomationRuleMatch {
            display_stable_ids: Vec::new(),
            display_count: None,
            require_internal: None,
            require_external: None,
            dock_signature: None,
            platform: None,
        });
        window.triggers = vec![AutomationTrigger::TimeSchedule {
            exact_time: None,
            start_time: Some("22:00".to_string()),
            end_time: Some("10:00".to_string()),
            weekdays: Vec::new(),
        }];

        let evaluation = evaluate_rules_with_context(
            &[window],
            &[profile()],
            &context(vec![display("a", true)]),
        );
        assert_eq!(evaluation.matches.len(), 1);
    }

    #[test]
    fn app_event_detects_opened_closed_and_running() {
        let mut app_rule = rule(AutomationRuleMatch {
            display_stable_ids: Vec::new(),
            display_count: None,
            require_internal: None,
            require_external: None,
            dock_signature: None,
            platform: None,
        });
        app_rule.triggers = vec![AutomationTrigger::AppEvent {
            app_name: "Slack".to_string(),
            event: AppEventKind::Opened,
        }];

        let mut ctx = context(vec![display("a", true)]);
        ctx.running_apps = HashSet::from(["Slack".to_string()]);
        let evaluation = evaluate_rules_with_context(&[app_rule], &[profile()], &ctx);
        assert_eq!(evaluation.matches.len(), 1);

        let mut closed_rule = rule(AutomationRuleMatch {
            display_stable_ids: Vec::new(),
            display_count: None,
            require_internal: None,
            require_external: None,
            dock_signature: None,
            platform: None,
        });
        closed_rule.triggers = vec![AutomationTrigger::AppEvent {
            app_name: "Slack".to_string(),
            event: AppEventKind::Closed,
        }];
        let mut ctx = context(vec![display("a", true)]);
        ctx.previous_running_apps = HashSet::from(["Slack".to_string()]);
        let evaluation = evaluate_rules_with_context(&[closed_rule], &[profile()], &ctx);
        assert_eq!(evaluation.matches.len(), 1);
    }

    #[test]
    fn power_wifi_and_conditions_match() {
        let mut rich_rule = rule(AutomationRuleMatch {
            display_stable_ids: Vec::new(),
            display_count: None,
            require_internal: None,
            require_external: None,
            dock_signature: None,
            platform: None,
        });
        rich_rule.triggers = vec![AutomationTrigger::PowerSource {
            source: PowerSourceState::Ac,
        }];
        rich_rule.conditions = vec![
            AutomationCondition::WifiSsid {
                ssid: "Stu".to_string(),
                contains: true,
            },
            AutomationCondition::DisplayCount { count: 1 },
        ];

        let evaluation = evaluate_rules_with_context(
            &[rich_rule],
            &[profile()],
            &context(vec![display("a", true)]),
        );
        assert_eq!(evaluation.matches.len(), 1);
        assert!(evaluation.matches[0].reason.contains("Wi-Fi"));
    }

    #[test]
    fn cooldown_blocks_repeated_match() {
        let mut cooled_rule = rule(AutomationRuleMatch {
            display_stable_ids: Vec::new(),
            display_count: Some(1),
            require_internal: None,
            require_external: None,
            dock_signature: None,
            platform: None,
        });
        cooled_rule.last_triggered_at = Some("2026-06-08T09:29:30-04:00".to_string());
        cooled_rule.cooldown_ms = 60_000;

        let evaluation = evaluate_rules_with_context(
            &[cooled_rule],
            &[profile()],
            &context(vec![display("a", true)]),
        );

        assert!(evaluation.matches.is_empty());
    }

    #[test]
    fn duplicate_signature_suppresses_unchanged_prompt() {
        let mut first_rule = rule(AutomationRuleMatch {
            display_stable_ids: Vec::new(),
            display_count: Some(1),
            require_internal: None,
            require_external: None,
            dock_signature: None,
            platform: None,
        });
        first_rule.cooldown_ms = 0;
        let ctx = context(vec![display("a", true)]);
        let first = evaluate_rules_with_context(&[first_rule.clone()], &[profile()], &ctx);
        let signature = first.matches[0].match_signature.clone();
        first_rule.last_matched_signature = Some(signature);

        let second = evaluate_rules_with_context(&[first_rule], &[profile()], &ctx);

        assert!(second.matches.is_empty());
    }
}
