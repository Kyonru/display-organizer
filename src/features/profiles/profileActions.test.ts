import { describe, expect, it } from "vitest";
import {
  actionLabel,
  argsToText,
  createOpenAppAction,
  moveAction,
  normalizeAction,
  textToArgs,
  updatePositionValue,
} from "./profileActions";
import type { ProfileAction } from "../../shared/types";

describe("profile action helpers", () => {
  it("creates an open-app action from a picked app path", () => {
    const action = createOpenAppAction("/Applications/Slack.app");

    expect(action.type).toBe("open_app");
    expect(action.id).toBeTruthy();
    expect(action.enabled).toBe(true);
    expect(actionLabel(action)).toBe("Slack");
  });

  it("labels URL targets clearly", () => {
    const action = createOpenAppAction("https://apps.apple.com/us/app/snakechronicles/id6450267213");

    expect(actionLabel(action)).toBe("apps.apple.com");
  });

  it("round-trips app args through one-per-line text", () => {
    const text = argsToText(["~/Projects/feather", "--reuse-window"]);

    expect(textToArgs(text)).toEqual(["~/Projects/feather", "--reuse-window"]);
  });

  it("updates window placement values while preserving defaults", () => {
    const position = updatePositionValue(null, "width", "1440");

    expect(position).toEqual({ x: 0, y: 0, width: 1440, height: 800 });
  });

  it("normalizes missing action id and enabled state", () => {
    const action = normalizeAction({
      type: "close_app",
      appName: "Preview",
    } as ProfileAction);

    expect(action.id).toBeTruthy();
    expect(action.enabled).toBe(true);
    expect(action.conditions).toBeNull();
  });

  it("moves actions by id without mutating the original order", () => {
    const actions: ProfileAction[] = [
      { id: "a", type: "close_app", appName: "A" },
      { id: "b", type: "close_app", appName: "B" },
    ];

    const moved = moveAction(actions, "b", -1);

    expect(moved.map((action) => action.id)).toEqual(["b", "a"]);
    expect(actions.map((action) => action.id)).toEqual(["a", "b"]);
  });
});
