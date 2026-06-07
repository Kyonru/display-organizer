import { create } from "zustand";
import type { AppSettings } from "../../shared/types";
import * as api from "./settingsApi";

type SettingsState = {
  settings: AppSettings;
  isLoading: boolean;
  error: string | null;
  loadSettings: () => Promise<void>;
  setScriptsEnabled: (scriptsEnabled: boolean) => Promise<void>;
  setAutomationNotificationsEnabled: (enabled: boolean) => Promise<void>;
};

const defaultSettings: AppSettings = {
  profileActions: {
    scriptsEnabled: false,
  },
  automationNotifications: {
    enabled: true,
    hiddenOnly: true,
  },
};

export function normalizeSettings(settings: Partial<AppSettings>): AppSettings {
  return {
    profileActions: {
      ...defaultSettings.profileActions,
      ...(settings.profileActions ?? {}),
    },
    automationNotifications: {
      ...defaultSettings.automationNotifications,
      ...(settings.automationNotifications ?? {}),
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  isLoading: false,
  error: null,
  loadSettings: async () => {
    set({ isLoading: true, error: null });
    try {
      const settings = normalizeSettings(await api.getSettings());
      set({ settings, isLoading: false });
    } catch (error) {
      set({ isLoading: false, error: errorMessage(error) });
    }
  },
  setScriptsEnabled: async (scriptsEnabled) => {
    const nextSettings: AppSettings = {
      ...get().settings,
      profileActions: {
        ...get().settings.profileActions,
        scriptsEnabled,
      },
    };
    set({ settings: nextSettings, error: null });
    try {
      const settings = normalizeSettings(await api.saveSettings(nextSettings));
      set({ settings });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  setAutomationNotificationsEnabled: async (enabled) => {
    const nextSettings: AppSettings = {
      ...get().settings,
      automationNotifications: {
        ...get().settings.automationNotifications,
        enabled,
      },
    };
    set({ settings: nextSettings, error: null });
    try {
      const settings = normalizeSettings(await api.saveSettings(nextSettings));
      set({ settings });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
}));
