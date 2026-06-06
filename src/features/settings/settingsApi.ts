import { invoke } from "@tauri-apps/api/core";
import { getMockSettings, saveMockSettings } from "../../shared/mockBackend";
import { isTauriRuntime } from "../../shared/runtime";
import type { AppSettings } from "../../shared/types";

export function getSettings(): Promise<AppSettings> {
  if (!isTauriRuntime()) {
    return getMockSettings();
  }

  return invoke<AppSettings>("get_settings");
}

export function saveSettings(settings: AppSettings): Promise<AppSettings> {
  if (!isTauriRuntime()) {
    return saveMockSettings(settings);
  }

  return invoke<AppSettings>("save_settings", { settings });
}
