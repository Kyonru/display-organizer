use std::collections::HashSet;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Runtime};

use crate::display_engine::automation::{self, AutomationContext};
use crate::display_engine::engine;
use crate::display_engine::models::{AppLifecycleKind, AutomationEventType};
use crate::persistence::{beta_repository, profile_repository};

pub fn setup<R: Runtime>(app: AppHandle<R>) {
    thread::spawn(move || {
        let mut previous_running_apps: Option<HashSet<String>> = None;
        let mut first_tick = true;

        loop {
            evaluate_once(&app, previous_running_apps.take(), first_tick)
                .map(|next_snapshot| {
                    previous_running_apps = Some(next_snapshot);
                    first_tick = false;
                })
                .ok();
            thread::sleep(Duration::from_secs(15));
        }
    });
}

fn evaluate_once<R: Runtime>(
    app: &AppHandle<R>,
    previous_running_apps: Option<HashSet<String>>,
    first_tick: bool,
) -> Result<HashSet<String>, ()> {
    let displays = engine::get_displays().map_err(|_| ())?;
    let profiles = profile_repository::get_profiles().map_err(|_| ())?;
    let rules = beta_repository::get_automation_rules().map_err(|_| ())?;
    let mut context = AutomationContext::current(&displays);
    context.previous_running_apps = previous_running_apps.unwrap_or_default();

    if first_tick {
        context.lifecycle_events = HashSet::from([AppLifecycleKind::AppLaunch]);
    } else {
        context.lifecycle_events.clear();
    }

    let next_snapshot = context.running_apps.clone();
    let evaluation = automation::evaluate_rules_with_context(&rules, &profiles, &context);

    if !evaluation.matches.is_empty() {
        for automation_match in &evaluation.matches {
            let _ = beta_repository::mark_automation_rule_matched(
                &automation_match.rule.id,
                &automation_match.match_signature,
            );
            let _ = beta_repository::record_automation_event(
                Some(automation_match.rule.id.clone()),
                Some(automation_match.rule.profile_id.clone()),
                AutomationEventType::Matched,
                format!(
                    "Matched {} ({})",
                    automation_match.rule.name, automation_match.reason
                ),
            );
        }
        let _ = app.emit("automation:matches", evaluation);
    }

    Ok(next_snapshot)
}
