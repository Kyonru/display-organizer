import type { ProfileAction, Rect } from "../../shared/types";

export function createActionId() {
  return globalThis.crypto?.randomUUID?.() ?? `action-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function actionEnabled(action: ProfileAction) {
  return action.enabled ?? true;
}

export function actionLabel(action: ProfileAction) {
  if (action.type === "open_app") {
    if (isUrlTarget(action.appPath)) {
      return urlLabel(action.appPath);
    }

    return action.appPath.split("/").pop()?.replace(/\.app$/i, "") || "Open app";
  }

  if (action.type === "close_app") {
    return action.appName || "Close app";
  }

  return "Run script";
}

export function isUrlTarget(value: string) {
  return value.startsWith("https://") || value.startsWith("http://") || value.startsWith("macappstore://");
}

function urlLabel(value: string) {
  try {
    return new URL(value).hostname || "URL";
  } catch {
    return "URL";
  }
}

export function argsToText(args: string[] | undefined) {
  return (args ?? []).join("\n");
}

export function textToArgs(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function maybeNumber(value: string) {
  if (value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function updatePositionValue(position: Rect | null | undefined, key: keyof Rect, value: string) {
  const parsed = maybeNumber(value);
  if (parsed === null) {
    return null;
  }

  return {
    x: position?.x ?? 0,
    y: position?.y ?? 0,
    width: position?.width ?? 1200,
    height: position?.height ?? 800,
    [key]: parsed,
  };
}

export function normalizeAction(action: ProfileAction): ProfileAction {
  return {
    ...action,
    id: action.id ?? createActionId(),
    enabled: action.enabled ?? true,
    conditions: action.conditions ?? null,
  } as ProfileAction;
}

export function createOpenAppAction(appPath: string): ProfileAction {
  return normalizeAction({
    id: createActionId(),
    type: "open_app",
    enabled: true,
    conditions: null,
    appPath,
    args: [],
    delayMs: 0,
    monitorId: null,
    position: null,
  });
}

export function moveAction(actions: ProfileAction[], actionId: string, direction: -1 | 1) {
  const index = actions.findIndex((action) => action.id === actionId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= actions.length) {
    return actions;
  }

  const nextActions = [...actions];
  [nextActions[index], nextActions[nextIndex]] = [nextActions[nextIndex], nextActions[index]];
  return nextActions;
}
