import { describe, expect, it } from "vitest";
import { normalizeSettings } from "./settingsStore";

describe("settings normalization", () => {
  it("defaults automation notifications for older settings", () => {
    expect(
      normalizeSettings({
        profileActions: {
          scriptsEnabled: true,
        },
      }),
    ).toEqual({
      profileActions: {
        scriptsEnabled: true,
      },
      automationNotifications: {
        enabled: true,
        hiddenOnly: true,
      },
    });
  });
});
