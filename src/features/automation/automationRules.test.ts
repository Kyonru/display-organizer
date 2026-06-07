import { describe, expect, it } from "vitest";
import {
  automationRuleToDraft,
  createConditionPreset,
  createDisplaySetupRuleDraft,
  createTriggerPreset,
  DEFAULT_COOLDOWN_MS,
} from "./automationRules";
import type { AutomationRule, Display, LayoutProfile } from "../../shared/types";

function display(id: string, isInternal = false): Display {
  return {
    id,
    stableId: id,
    modeId: null,
    name: id,
    manufacturer: null,
    model: null,
    serialNumber: null,
    resolution: { width: 100, height: 100 },
    refreshRate: null,
    scaleFactor: 1,
    position: { x: 0, y: 0 },
    rotation: 0,
    isPrimary: isInternal,
    isInternal,
    connectionType: isInternal ? "internal" : "unknown",
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    capabilities: {
      position: { supported: true, reason: null },
      primary: { supported: true, reason: null },
      rotation: { supported: true, reason: null },
      scale: { supported: true, reason: null },
    },
    scaleOptions: [],
  };
}

function profile(): LayoutProfile {
  return {
    id: "profile-a",
    name: "Work Desk",
    description: null,
    layout: { displays: [], primaryDisplayStableId: null },
    actions: [],
    detectionRules: [],
    hotkey: null,
    createdAt: "now",
    updatedAt: "now",
    lastAppliedAt: null,
    metadata: { appVersion: "test", platformCreatedOn: "macos" },
  };
}

describe("automation rule helpers", () => {
  it("creates a display setup draft from the active profile and displays", () => {
    const draft = createDisplaySetupRuleDraft(profile(), [display("a", true), display("b")]);

    expect(draft.profileId).toBe("profile-a");
    expect(draft.confirmationMode).toBe("confirm");
    expect(draft.cooldownMs).toBe(DEFAULT_COOLDOWN_MS);
    expect(draft.triggers?.[0]).toMatchObject({
      type: "display_setup_changed",
      displayCount: 2,
      requireInternal: true,
      requireExternal: true,
    });
  });

  it("creates useful defaults for trigger and condition presets", () => {
    expect(createTriggerPreset("time_schedule", [])).toMatchObject({
      type: "time_schedule",
      exactTime: "09:00",
    });
    expect(createTriggerPreset("app_event", [])).toMatchObject({
      type: "app_event",
      event: "running",
    });
    expect(createConditionPreset("display_ids", [display("a")])).toMatchObject({
      type: "display_ids",
      stableIds: ["a"],
      exact: true,
    });
  });

  it("round-trips saved rules to editable drafts", () => {
    const rule: AutomationRule = {
      id: "rule-a",
      name: "Morning",
      enabled: true,
      profileId: "profile-a",
      match: {
        displayStableIds: [],
        displayCount: null,
        requireInternal: null,
        requireExternal: null,
        dockSignature: null,
        platform: null,
      },
      triggers: [{ type: "app_lifecycle", event: "app_launch" }],
      conditions: [{ type: "power_source", source: "ac" }],
      confirmationMode: "auto",
      cooldownMs: 300_000,
      createdAt: "now",
      updatedAt: "now",
      lastTriggeredAt: null,
      lastMatchedSignature: "old",
    };

    expect(automationRuleToDraft(rule)).toMatchObject({
      id: "rule-a",
      confirmationMode: "auto",
      cooldownMs: 300_000,
      triggers: [{ type: "app_lifecycle", event: "app_launch" }],
    });
  });
});
