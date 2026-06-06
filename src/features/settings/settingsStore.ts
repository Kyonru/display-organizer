import { create } from "zustand";
import type { AppSettings } from "../../shared/types";
import * as api from "./settingsApi";

type SettingsState = {
  settings: AppSettings;
  isLoading: boolean;
  error: string | null;
  loadSettings: () => Promise<void>;
  setScriptsEnabled: (scriptsEnabled: boolean) => Promise<void>;
};

const defaultSettings: AppSettings = {
  profileActions: {
    scriptsEnabled: false,
  },
};

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
      const settings = await api.getSettings();
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
      const settings = await api.saveSettings(nextSettings);
      set({ settings });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
}));
