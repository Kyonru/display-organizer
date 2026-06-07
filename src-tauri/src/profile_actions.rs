use std::collections::HashSet;
use std::path::Path;
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

use chrono::Utc;
use uuid::Uuid;

use crate::display_engine::automation::current_platform;
use crate::display_engine::models::{
    AppSettings, Display, PlatformName, ProfileAction, ProfileActionResult, ProfileActionStatus,
    Rect,
};

pub fn normalize_profile_actions(actions: Vec<ProfileAction>) -> Vec<ProfileAction> {
    actions
        .into_iter()
        .map(|mut action| {
            if action.id().is_none() {
                action.set_id(Uuid::new_v4().to_string());
            }
            action
        })
        .collect()
}

pub fn execute_profile_actions(
    actions: &[ProfileAction],
    active_displays: &[Display],
    settings: &AppSettings,
) -> Vec<ProfileActionResult> {
    let executor = NativeActionExecutor;
    execute_profile_actions_with(actions, active_displays, settings, &executor, thread::sleep)
}

trait ActionExecutor {
    fn execute(
        &self,
        action: &ProfileAction,
        active_displays: &[Display],
    ) -> Result<String, String>;
}

fn execute_profile_actions_with<E, S>(
    actions: &[ProfileAction],
    active_displays: &[Display],
    settings: &AppSettings,
    executor: &E,
    mut sleep: S,
) -> Vec<ProfileActionResult>
where
    E: ActionExecutor,
    S: FnMut(Duration),
{
    let phase_started = Instant::now();
    let mut results = Vec::new();

    for (index, action) in actions.iter().enumerate() {
        let requested_delay = Duration::from_millis(action.delay_ms());
        let elapsed = phase_started.elapsed();
        if requested_delay > elapsed {
            sleep(requested_delay - elapsed);
        }

        let started_at = Utc::now().to_rfc3339();
        let (status, message) = match prepare_action(action, active_displays, settings) {
            ActionReadiness::Run => match executor.execute(action, active_displays) {
                Ok(message) => (ProfileActionStatus::Applied, message),
                Err(message) => (ProfileActionStatus::Error, message),
            },
            ActionReadiness::Skip(message) => (ProfileActionStatus::Skipped, message),
            ActionReadiness::Error(message) => (ProfileActionStatus::Error, message),
        };
        let completed_at = Utc::now().to_rfc3339();

        results.push(ProfileActionResult {
            action_id: action
                .id()
                .map(str::to_string)
                .unwrap_or_else(|| format!("action-{}", index + 1)),
            action_type: action.action_type(),
            status,
            message,
            started_at,
            completed_at,
        });
    }

    results
}

enum ActionReadiness {
    Run,
    Skip(String),
    Error(String),
}

fn prepare_action(
    action: &ProfileAction,
    active_displays: &[Display],
    settings: &AppSettings,
) -> ActionReadiness {
    if !action.enabled() {
        return ActionReadiness::Skip("Action is disabled.".to_string());
    }

    if let Some(reason) = unmet_condition_reason(action, active_displays) {
        return ActionReadiness::Skip(reason);
    }

    if let ProfileAction::RunScript { .. } = action {
        if !settings.profile_actions.scripts_enabled {
            return ActionReadiness::Skip(
                "Scripts are disabled. Enable advanced profile scripts in Settings to run this action."
                    .to_string(),
            );
        }
    }

    match validate_action(action, active_displays) {
        Ok(()) => ActionReadiness::Run,
        Err(message) => ActionReadiness::Error(message),
    }
}

fn unmet_condition_reason(action: &ProfileAction, active_displays: &[Display]) -> Option<String> {
    let conditions = action.conditions()?;

    if let Some(platform) = &conditions.platform {
        if platform != &current_platform() {
            return Some(format!(
                "Skipped because this action only runs on {}.",
                platform_label(platform)
            ));
        }
    }

    if let Some(display_count) = conditions.display_count {
        if display_count != active_displays.len() {
            return Some(format!(
                "Skipped because {} displays are connected, expected {display_count}.",
                active_displays.len()
            ));
        }
    }

    if let Some(display_stable_id) = conditions.display_stable_id.as_deref() {
        let connected = active_displays
            .iter()
            .map(display_identity)
            .collect::<HashSet<_>>();
        if !connected.contains(display_stable_id) {
            return Some(format!(
                "Skipped because display {display_stable_id} is not connected."
            ));
        }
    }

    None
}

fn validate_action(action: &ProfileAction, active_displays: &[Display]) -> Result<(), String> {
    match action {
        ProfileAction::OpenApp {
            app_path,
            args,
            monitor_id,
            position,
            ..
        } => {
            let trimmed = app_path.trim();
            if trimmed.is_empty() {
                return Err("App path is required.".to_string());
            }

            if is_url_target(trimmed) {
                if !args.is_empty() {
                    return Err(
                        "Arguments require a local macOS .app bundle, not a URL.".to_string()
                    );
                }

                if position.is_some() {
                    return Err(
                        "Window placement requires a local macOS .app bundle, not a URL."
                            .to_string(),
                    );
                }

                return Ok(());
            }

            let path = Path::new(trimmed);
            if !path.exists() {
                return Err(format!("App path does not exist: {trimmed}"));
            }

            if path
                .extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| !extension.eq_ignore_ascii_case("app"))
                .unwrap_or(true)
            {
                return Err("App path must point to a macOS .app bundle.".to_string());
            }

            validate_window_target(monitor_id.as_deref(), position.as_ref(), active_displays)
        }
        ProfileAction::CloseApp { app_name, .. } => {
            if app_name.trim().is_empty() {
                Err("App name is required.".to_string())
            } else {
                Ok(())
            }
        }
        ProfileAction::RunScript { command, .. } => {
            if command.trim().is_empty() {
                Err("Script command is required.".to_string())
            } else {
                Ok(())
            }
        }
    }
}

fn validate_window_target(
    monitor_id: Option<&str>,
    position: Option<&Rect>,
    active_displays: &[Display],
) -> Result<(), String> {
    if let Some(monitor_id) = monitor_id {
        if active_displays
            .iter()
            .all(|display| display_identity(display) != monitor_id)
        {
            return Err(format!("Monitor {monitor_id} is not connected."));
        }
    }

    if let Some(position) = position {
        if position.width == 0 || position.height == 0 {
            return Err("Window placement width and height must be greater than zero.".to_string());
        }
    }

    Ok(())
}

struct NativeActionExecutor;

impl ActionExecutor for NativeActionExecutor {
    fn execute(
        &self,
        action: &ProfileAction,
        active_displays: &[Display],
    ) -> Result<String, String> {
        native_execute(action, active_displays)
    }
}

#[cfg(target_os = "macos")]
fn native_execute(action: &ProfileAction, active_displays: &[Display]) -> Result<String, String> {
    match action {
        ProfileAction::OpenApp {
            app_path,
            args,
            monitor_id,
            position,
            ..
        } => open_app(
            app_path,
            args,
            monitor_id.as_deref(),
            position.as_ref(),
            active_displays,
        ),
        ProfileAction::CloseApp { app_name, .. } => close_app(app_name),
        ProfileAction::RunScript { command, .. } => run_script(command),
    }
}

#[cfg(not(target_os = "macos"))]
fn native_execute(_action: &ProfileAction, _active_displays: &[Display]) -> Result<String, String> {
    Err("Profile actions are only implemented for macOS in this build.".to_string())
}

#[cfg(target_os = "macos")]
fn open_app(
    app_path: &str,
    args: &[String],
    monitor_id: Option<&str>,
    position: Option<&Rect>,
    active_displays: &[Display],
) -> Result<String, String> {
    let trimmed = app_path.trim();
    let mut command = Command::new("/usr/bin/open");
    command.arg(trimmed);
    if !args.is_empty() {
        command.arg("--args").args(args);
    }
    run_command(&mut command).map_err(|detail| format!("Failed to open {trimmed}: {detail}"))?;

    if let Some(position) = position {
        let app_name = target_name(trimmed);
        place_front_window(&app_name, monitor_id, position, active_displays)?;
    }

    Ok(format!("Opened {}.", target_name(trimmed)))
}

#[cfg(target_os = "macos")]
fn close_app(app_name: &str) -> Result<String, String> {
    let app_name = app_name.trim();
    let script = format!("tell application {} to quit", apple_script_string(app_name));
    let mut command = Command::new("/usr/bin/osascript");
    command.arg("-e").arg(script);
    run_command(&mut command).map_err(|detail| format!("Failed to close {app_name}: {detail}"))?;
    Ok(format!("Requested {app_name} to quit."))
}

#[cfg(target_os = "macos")]
fn run_script(command: &str) -> Result<String, String> {
    let mut script = Command::new("/bin/zsh");
    script.arg("-lc").arg(command);
    run_command(&mut script).map_err(|detail| format!("Script failed: {detail}"))?;
    Ok("Script completed.".to_string())
}

#[cfg(target_os = "macos")]
fn place_front_window(
    app_name: &str,
    monitor_id: Option<&str>,
    position: &Rect,
    active_displays: &[Display],
) -> Result<(), String> {
    let display_offset = monitor_id
        .and_then(|id| {
            active_displays
                .iter()
                .find(|display| display_identity(display) == id)
        })
        .map(|display| display.position)
        .unwrap_or(crate::display_engine::models::Point { x: 0, y: 0 });
    let x = display_offset.x + position.x;
    let y = display_offset.y + position.y;
    let script = format!(
        r#"tell application "System Events"
if not (exists process {app}) then error "application process is not running"
tell process {app}
  set frontmost to true
  if (count of windows) is 0 then error "application has no windows"
  set position of front window to {{{x}, {y}}}
  set size of front window to {{{width}, {height}}}
end tell
end tell"#,
        app = apple_script_string(app_name),
        width = position.width,
        height = position.height,
    );
    let mut command = Command::new("/usr/bin/osascript");
    command.arg("-e").arg(script);
    run_command(&mut command).map_err(|detail| {
        format!(
            "Unable to place {app_name}. Grant Accessibility permission to Display Layout Manager in System Settings > Privacy & Security > Accessibility. Details: {detail}"
        )
    })
}

#[cfg(target_os = "macos")]
fn run_command(command: &mut Command) -> Result<(), String> {
    let output = command
        .output()
        .map_err(|error| format!("could not start command: {error}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stderr.is_empty() {
        Err(stderr)
    } else if !stdout.is_empty() {
        Err(stdout)
    } else {
        Err(format!("exit status {}", output.status))
    }
}

#[cfg(target_os = "macos")]
fn app_name_from_path(app_path: &str) -> String {
    Path::new(app_path)
        .file_stem()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| app_path.to_string())
}

fn target_name(target: &str) -> String {
    if is_url_target(target) {
        return "URL".to_string();
    }

    app_name_from_path(target)
}

fn is_url_target(value: &str) -> bool {
    value.starts_with("https://")
        || value.starts_with("http://")
        || value.starts_with("macappstore://")
}

#[cfg(target_os = "macos")]
fn apple_script_string(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

fn display_identity(display: &Display) -> &str {
    display.stable_id.as_deref().unwrap_or(display.id.as_str())
}

fn platform_label(platform: &PlatformName) -> &'static str {
    match platform {
        PlatformName::Macos => "macOS",
        PlatformName::Windows => "Windows",
        PlatformName::Linux => "Linux",
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::fs;
    use std::time::Duration;

    use crate::display_engine::models::{
        AppSettings, Display, DisplayCapabilities, DisplayCapability, DisplayConnectionType,
        DisplayRotation, PlatformName, Point, ProfileAction, ProfileActionConditions,
        ProfileActionSettings, ProfileActionStatus, Rect, Size,
    };

    use super::{execute_profile_actions_with, normalize_profile_actions, ActionExecutor};

    struct RecordingExecutor {
        executed: RefCell<Vec<String>>,
    }

    impl RecordingExecutor {
        fn new() -> Self {
            Self {
                executed: RefCell::new(Vec::new()),
            }
        }
    }

    impl ActionExecutor for RecordingExecutor {
        fn execute(
            &self,
            action: &ProfileAction,
            _active_displays: &[Display],
        ) -> Result<String, String> {
            self.executed
                .borrow_mut()
                .push(action.id().unwrap_or("missing").to_string());
            Ok("executed".to_string())
        }
    }

    fn display(id: &str) -> Display {
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
            position: Point { x: 0, y: 0 },
            rotation: DisplayRotation::Deg0,
            is_primary: id == "a",
            is_internal: false,
            connection_type: Some(DisplayConnectionType::Unknown),
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

    fn action(id: &str, delay_ms: u64) -> ProfileAction {
        ProfileAction::RunScript {
            id: Some(id.to_string()),
            enabled: true,
            conditions: None,
            command: "echo ok".to_string(),
            delay_ms: Some(delay_ms),
        }
    }

    fn settings(scripts_enabled: bool) -> AppSettings {
        AppSettings {
            profile_actions: ProfileActionSettings { scripts_enabled },
            ..AppSettings::default()
        }
    }

    fn fake_app_path(name: &str) -> String {
        let path = std::env::temp_dir()
            .join("display-layout-manager-tests")
            .join(format!("{name}.app"));
        fs::create_dir_all(&path).expect("create fake app bundle");
        path.to_string_lossy().to_string()
    }

    #[test]
    fn normalizes_missing_action_ids() {
        let actions = normalize_profile_actions(vec![ProfileAction::RunScript {
            id: None,
            enabled: true,
            conditions: None,
            command: "echo ok".to_string(),
            delay_ms: None,
        }]);

        assert!(actions[0].id().is_some());
    }

    #[test]
    fn scripts_are_skipped_when_disabled() {
        let executor = RecordingExecutor::new();
        let results = execute_profile_actions_with(
            &[ProfileAction::RunScript {
                id: Some("script-a".to_string()),
                enabled: true,
                conditions: None,
                command: "echo ok".to_string(),
                delay_ms: None,
            }],
            &[display("a")],
            &settings(false),
            &executor,
            |_| {},
        );

        assert_eq!(results[0].status, ProfileActionStatus::Skipped);
        assert!(executor.executed.borrow().is_empty());
    }

    #[test]
    fn conditions_skip_unmatched_display_count() {
        let executor = RecordingExecutor::new();
        let results = execute_profile_actions_with(
            &[ProfileAction::CloseApp {
                id: Some("close-a".to_string()),
                enabled: true,
                conditions: Some(ProfileActionConditions {
                    platform: None,
                    display_stable_id: None,
                    display_count: Some(2),
                }),
                app_name: "Preview".to_string(),
            }],
            &[display("a")],
            &settings(true),
            &executor,
            |_| {},
        );

        assert_eq!(results[0].status, ProfileActionStatus::Skipped);
        assert!(executor.executed.borrow().is_empty());
    }

    #[test]
    fn conditions_skip_platform_mismatch() {
        let executor = RecordingExecutor::new();
        let results = execute_profile_actions_with(
            &[ProfileAction::CloseApp {
                id: Some("close-a".to_string()),
                enabled: true,
                conditions: Some(ProfileActionConditions {
                    platform: Some(PlatformName::Windows),
                    display_stable_id: None,
                    display_count: None,
                }),
                app_name: "Preview".to_string(),
            }],
            &[display("a")],
            &settings(true),
            &executor,
            |_| {},
        );

        assert_eq!(results[0].status, ProfileActionStatus::Skipped);
    }

    #[test]
    fn invalid_window_sizes_are_errors() {
        let executor = RecordingExecutor::new();
        let results = execute_profile_actions_with(
            &[ProfileAction::OpenApp {
                id: Some("open-a".to_string()),
                enabled: true,
                conditions: None,
                app_path: fake_app_path("Preview"),
                args: Vec::new(),
                delay_ms: None,
                monitor_id: None,
                position: Some(Rect {
                    x: 0,
                    y: 0,
                    width: 0,
                    height: 100,
                }),
            }],
            &[display("a")],
            &settings(true),
            &executor,
            |_| {},
        );

        assert_eq!(results[0].status, ProfileActionStatus::Error);
    }

    #[test]
    fn action_delays_are_relative_to_phase_start() {
        let executor = RecordingExecutor::new();
        let slept = RefCell::new(Vec::new());
        let actions = vec![action("a", 20), action("b", 20)];

        let _ = execute_profile_actions_with(
            &actions,
            &[display("a")],
            &settings(true),
            &executor,
            |duration| slept.borrow_mut().push(duration),
        );

        assert!(slept.borrow()[0] <= Duration::from_millis(20));
        assert!(slept.borrow()[0] >= Duration::from_millis(15));
        assert!(slept.borrow().len() <= 2);
    }
}
