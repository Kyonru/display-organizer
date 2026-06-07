import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  onAction,
  registerActionTypes,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import type { AppSettings, AutomationEvaluation, AutomationMatchResult } from "../../shared/types";

const ACTION_TYPE_ID = "automation-match";
const OPEN_ACTION_ID = "open-display-layout-manager";

export type AutomationNotificationWindowState = {
  isNative: boolean;
  isFocused: boolean;
  isVisible: boolean;
};

export type AutomationNotificationDecision =
  | { shouldNotify: true; signature: string; matches: AutomationMatchResult[] }
  | { shouldNotify: false; reason: string };

let actionHandlerRegistered = false;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function confirmRequiredMatches(evaluation: AutomationEvaluation | null) {
  return evaluation?.matches.filter((match) => match.requiresConfirmation) ?? [];
}

export function automationNotificationSignature(matches: AutomationMatchResult[]) {
  return matches
    .map((match) => match.matchSignature || match.rule.id)
    .sort()
    .join("|");
}

export function buildAutomationNotification(matches: AutomationMatchResult[]) {
  if (matches.length === 1) {
    const match = matches[0];

    return {
      title: "Automation matched",
      body: `Apply ${match.profileName}? ${match.reason}`,
    };
  }

  return {
    title: "Automation matches",
    body: `${matches.length} profiles are ready. Open Display Layout Manager to choose.`,
  };
}

export function automationNotificationDecision(
  evaluation: AutomationEvaluation | null,
  settings: AppSettings,
  windowState: AutomationNotificationWindowState,
  notifiedSignatures: ReadonlySet<string>,
): AutomationNotificationDecision {
  if (!windowState.isNative) {
    return { shouldNotify: false, reason: "browser preview" };
  }

  if (!settings.automationNotifications.enabled) {
    return { shouldNotify: false, reason: "notifications disabled" };
  }

  const matches = confirmRequiredMatches(evaluation);
  if (matches.length === 0) {
    return { shouldNotify: false, reason: "no confirm matches" };
  }

  const signature = automationNotificationSignature(matches);
  if (!signature || notifiedSignatures.has(signature)) {
    return { shouldNotify: false, reason: "duplicate" };
  }

  return { shouldNotify: true, signature, matches };
}

export async function registerAutomationNotificationActionHandler() {
  if (actionHandlerRegistered) {
    return null;
  }

  await registerActionTypes([
    {
      id: ACTION_TYPE_ID,
      actions: [
        {
          id: OPEN_ACTION_ID,
          title: "Open",
          foreground: true,
        },
      ],
    },
  ]);

  actionHandlerRegistered = true;
  return onAction(() => {
    void focusMainWindow();
  });
}

export async function focusMainWindow() {
  const window = getCurrentWindow();
  await window.show();
  await window.unminimize();
  await window.setFocus();
}

export async function currentAutomationNotificationWindowState(isNative: boolean) {
  if (!isNative) {
    return {
      isNative,
      isFocused: true,
      isVisible: true,
    };
  }

  const window = getCurrentWindow();
  const [isFocused, isVisible] = await Promise.all([window.isFocused(), window.isVisible()]);

  return {
    isNative,
    isFocused,
    isVisible,
  };
}

export async function maybeSendAutomationNotification({
  evaluation,
  settings,
  isNative,
  notifiedSignatures,
}: {
  evaluation: AutomationEvaluation | null;
  settings: AppSettings;
  isNative: boolean;
  notifiedSignatures: Set<string>;
}) {
  const windowState = await currentAutomationNotificationWindowState(isNative);
  const decision = automationNotificationDecision(evaluation, settings, windowState, notifiedSignatures);

  if (!decision.shouldNotify) {
    return decision.reason;
  }

  let permissionGranted = await isPermissionGranted();
  if (!permissionGranted) {
    permissionGranted = (await requestPermission()) === "granted";
  }

  if (!permissionGranted) {
    return "permission denied";
  }

  const notification = buildAutomationNotification(decision.matches);
  try {
    await invoke<void>("send_local_notification", notification);
  } catch (error) {
    return `notification error: ${errorMessage(error)}`;
  }

  notifiedSignatures.add(decision.signature);
  return "sent";
}
