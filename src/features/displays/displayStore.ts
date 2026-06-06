import { create } from "zustand";
import type { Display } from "../../shared/types";
import { getDisplays } from "./displayApi";

type DisplayState = {
  displays: Display[];
  primaryDisplayId: string | null;
  isRefreshing: boolean;
  lastUpdatedAt: string | null;
  error: string | null;
  refreshDisplays: () => Promise<void>;
  setDisplays: (displays: Display[]) => void;
};

export const useDisplayStore = create<DisplayState>((set) => ({
  displays: [],
  primaryDisplayId: null,
  isRefreshing: false,
  lastUpdatedAt: null,
  error: null,
  setDisplays: (displays) =>
    set({
      displays,
      primaryDisplayId: displays.find((display) => display.isPrimary)?.id ?? null,
      lastUpdatedAt: new Date().toISOString(),
      error: null,
    }),
  refreshDisplays: async () => {
    set({ isRefreshing: true, error: null });
    try {
      const displays = await getDisplays();
      set({
        displays,
        primaryDisplayId: displays.find((display) => display.isPrimary)?.id ?? null,
        lastUpdatedAt: new Date().toISOString(),
        isRefreshing: false,
      });
    } catch (error) {
      set({
        isRefreshing: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));
