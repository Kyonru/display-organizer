import { describe, expect, it } from "vitest";
import {
  automationNotificationDecision,
  buildAutomationNotification,
} from "./automationNotifications";
import type {
  AppSettings,
  AutomationEvaluation,
  AutomationMatchResult,
  AutomationRule,
} from "../../shared/types";

const settings: AppSettings = {
  profileActions: {
    scriptsEnabled: false,
  },
  automationNotifications: {
    enabled: true,
    hiddenOnly: true,
  },
};

function rule(id: string): AutomationRule {
  return {
    id,
    name: "Desk rule",
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
    triggers: [],
    conditions: [],
    confirmationMode: "confirm",
    cooldownMs: 600_000,
    createdAt: "now",
    updatedAt: "now",
    lastTriggeredAt: null,
    lastMatchedSignature: null,
  };
}

function match(id: string, requiresConfirmation = true): AutomationMatchResult {
  return {
    rule: rule(id),
    profileName: "Work Desk",
    score: 100,
    reason: "display setup",
    matchedTriggers: ["display setup"],
    matchedConditions: [],
    skippedReasons: [],
    requiresConfirmation,
    cooldownRemainingMs: null,
    matchSignature: `signature-${id}`,
  };
}

function evaluation(matches: AutomationMatchResult[]): AutomationEvaluation {
  return {
    matches,
    evaluatedAt: "now",
    displayCount: 2,
  };
}

describe("automation notifications", () => {
  it("rejects disabled, duplicate, browser, and auto-only matches", () => {
    expect(
      automationNotificationDecision(
        evaluation([match("a")]),
        { ...settings, automationNotifications: { enabled: false, hiddenOnly: true } },
        { isNative: true, isFocused: false, isVisible: false },
        new Set(),
      ),
    ).toMatchObject({ shouldNotify: false, reason: "notifications disabled" });

    expect(
      automationNotificationDecision(
        evaluation([match("a")]),
        settings,
        { isNative: false, isFocused: false, isVisible: false },
        new Set(),
      ),
    ).toMatchObject({ shouldNotify: false, reason: "browser preview" });

    expect(
      automationNotificationDecision(
        evaluation([match("a")]),
        settings,
        { isNative: true, isFocused: false, isVisible: false },
        new Set(["signature-a"]),
      ),
    ).toMatchObject({ shouldNotify: false, reason: "duplicate" });

    expect(
      automationNotificationDecision(
        evaluation([match("a", false)]),
        settings,
        { isNative: true, isFocused: false, isVisible: false },
        new Set(),
      ),
    ).toMatchObject({ shouldNotify: false, reason: "no confirm matches" });
  });

  it("allows focused and hidden native confirmation matches", () => {
    const focusedDecision = automationNotificationDecision(
      evaluation([match("a")]),
      settings,
      { isNative: true, isFocused: true, isVisible: true },
      new Set(),
    );
    const decision = automationNotificationDecision(
      evaluation([match("b")]),
      settings,
      { isNative: true, isFocused: false, isVisible: true },
      new Set(),
    );

    expect(focusedDecision).toMatchObject({ shouldNotify: true, signature: "signature-a" });
    expect(decision).toMatchObject({ shouldNotify: true, signature: "signature-b" });
  });

  it("builds single and grouped notification copy", () => {
    expect(buildAutomationNotification([match("a")])).toEqual({
      title: "Automation matched",
      body: "Apply Work Desk? display setup",
    });

    expect(buildAutomationNotification([match("a"), match("b")])).toEqual({
      title: "Automation matches",
      body: "2 profiles are ready. Open Display Layout Manager to choose.",
    });
  });
});
