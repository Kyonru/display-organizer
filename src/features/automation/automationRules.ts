import type {
  AutomationCondition,
  AutomationRule,
  AutomationRuleDraft,
  AutomationRuleMatch,
  AutomationTrigger,
  Display,
  LayoutProfile,
  PlatformName,
} from "../../shared/types";

export const DEFAULT_COOLDOWN_MS = 600_000;

export function defaultAutomationMatch(displays: Display[] = []): AutomationRuleMatch {
  return {
    displayStableIds: displays.map((display) => display.stableId ?? display.id).sort(),
    displayCount: displays.length || null,
    requireInternal: displays.length > 0 ? displays.some((display) => display.isInternal) : null,
    requireExternal: displays.length > 0 ? displays.some((display) => !display.isInternal) : null,
    dockSignature: null,
    platform: "macos",
  };
}

export function createDisplaySetupRuleDraft(
  profile: LayoutProfile,
  displays: Display[],
): AutomationRuleDraft {
  const match = defaultAutomationMatch(displays);

  return {
    name: `${profile.name} setup`,
    enabled: true,
    profileId: profile.id,
    match,
    triggers: [
      {
        type: "display_setup_changed",
        displayStableIds: match.displayStableIds,
        displayCount: match.displayCount,
        requireInternal: match.requireInternal,
        requireExternal: match.requireExternal,
        platform: match.platform,
      },
    ],
    conditions: [],
    confirmationMode: "confirm",
    cooldownMs: DEFAULT_COOLDOWN_MS,
  };
}

export function automationRuleToDraft(rule: AutomationRule): AutomationRuleDraft {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    profileId: rule.profileId,
    match: rule.match,
    triggers: rule.triggers ?? [],
    conditions: rule.conditions ?? [],
    confirmationMode: rule.confirmationMode ?? "confirm",
    cooldownMs: rule.cooldownMs ?? DEFAULT_COOLDOWN_MS,
  };
}

export function createTriggerPreset(kind: AutomationTrigger["type"], displays: Display[]): AutomationTrigger {
  if (kind === "display_setup_changed") {
    const match = defaultAutomationMatch(displays);
    return {
      type: "display_setup_changed",
      displayStableIds: match.displayStableIds,
      displayCount: match.displayCount,
      requireInternal: match.requireInternal,
      requireExternal: match.requireExternal,
      platform: match.platform,
    };
  }

  if (kind === "time_schedule") {
    return { type: "time_schedule", exactTime: "09:00", startTime: null, endTime: null, weekdays: [] };
  }

  if (kind === "app_event") {
    return { type: "app_event", appName: "Slack", event: "running" };
  }

  if (kind === "app_lifecycle") {
    return { type: "app_lifecycle", event: "app_launch" };
  }

  if (kind === "power_source") {
    return { type: "power_source", source: "ac" };
  }

  return { type: "network_context", ssid: "", contains: false };
}

export function createConditionPreset(kind: AutomationCondition["type"], displays: Display[]): AutomationCondition {
  if (kind === "display_count") {
    return { type: "display_count", count: displays.length || 1 };
  }

  if (kind === "display_ids") {
    return {
      type: "display_ids",
      stableIds: displays.map((display) => display.stableId ?? display.id).sort(),
      exact: true,
    };
  }

  if (kind === "internal_display") {
    return { type: "internal_display", required: true };
  }

  if (kind === "external_display") {
    return { type: "external_display", required: true };
  }

  if (kind === "platform") {
    return { type: "platform", platform: "macos" };
  }

  if (kind === "time_window") {
    return { type: "time_window", startTime: "09:00", endTime: "17:00", weekdays: [] };
  }

  if (kind === "app_running") {
    return { type: "app_running", appName: "Slack", running: true };
  }

  if (kind === "power_source") {
    return { type: "power_source", source: "ac" };
  }

  return { type: "wifi_ssid", ssid: "", contains: false };
}

export function triggerLabel(trigger: AutomationTrigger): string {
  if (trigger.type === "display_setup_changed") {
    return `Display setup · ${trigger.displayCount ?? trigger.displayStableIds?.length ?? "any"} displays`;
  }
  if (trigger.type === "time_schedule") {
    return trigger.exactTime
      ? `Time · ${trigger.exactTime}`
      : `Time · ${trigger.startTime ?? "?"}-${trigger.endTime ?? "?"}`;
  }
  if (trigger.type === "app_event") {
    return `App · ${trigger.appName || "app"} ${trigger.event.replace("_", " ")}`;
  }
  if (trigger.type === "app_lifecycle") {
    return trigger.event === "app_launch" ? "Launch" : "Wake";
  }
  if (trigger.type === "power_source") {
    return `Power · ${trigger.source}`;
  }
  return trigger.contains ? `Wi-Fi contains · ${trigger.ssid || "SSID"}` : `Wi-Fi · ${trigger.ssid || "SSID"}`;
}

export function conditionLabel(condition: AutomationCondition): string {
  if (condition.type === "display_count") {
    return `${condition.count} displays`;
  }
  if (condition.type === "display_ids") {
    return `${condition.exact ? "Exact" : "Has"} display set`;
  }
  if (condition.type === "internal_display") {
    return condition.required ? "Has internal display" : "No internal display";
  }
  if (condition.type === "external_display") {
    return condition.required ? "Has external display" : "No external display";
  }
  if (condition.type === "platform") {
    return `Platform · ${condition.platform}`;
  }
  if (condition.type === "time_window") {
    return `Time · ${condition.startTime}-${condition.endTime}`;
  }
  if (condition.type === "app_running") {
    return `${condition.appName || "App"} ${condition.running ? "running" : "not running"}`;
  }
  if (condition.type === "power_source") {
    return `Power · ${condition.source}`;
  }
  return condition.contains ? `Wi-Fi contains · ${condition.ssid || "SSID"}` : `Wi-Fi · ${condition.ssid || "SSID"}`;
}

export function cooldownLabel(cooldownMs: number) {
  if (cooldownMs <= 0) {
    return "No cooldown";
  }

  const minutes = Math.round(cooldownMs / 60_000);
  return `${minutes} min cooldown`;
}

export function platformOptions(): PlatformName[] {
  return ["macos", "windows", "linux"];
}
