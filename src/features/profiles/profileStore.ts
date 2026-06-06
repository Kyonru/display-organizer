import { create } from "zustand";
import type { ApplyLayoutResult, Layout, LayoutProfile, LayoutProfileDraft } from "../../shared/types";
import * as api from "./profileApi";

type ProfileState = {
  profiles: LayoutProfile[];
  activeProfileId: string | null;
  isLoading: boolean;
  isApplying: boolean;
  error: string | null;
  lastApplyResult: ApplyLayoutResult | null;
  loadProfiles: () => Promise<void>;
  saveProfile: (draft: LayoutProfileDraft) => Promise<LayoutProfile | null>;
  renameProfile: (id: string, name: string) => Promise<void>;
  duplicateProfile: (id: string) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
  applyLayout: (layout: Layout) => Promise<ApplyLayoutResult | null>;
  applyProfile: (id: string) => Promise<ApplyLayoutResult | null>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: [],
  activeProfileId: null,
  isLoading: false,
  isApplying: false,
  error: null,
  lastApplyResult: null,
  loadProfiles: async () => {
    set({ isLoading: true, error: null });
    try {
      const profiles = await api.getProfiles();
      set({ profiles, isLoading: false });
    } catch (error) {
      set({ isLoading: false, error: errorMessage(error) });
    }
  },
  saveProfile: async (draft) => {
    set({ error: null });
    try {
      const profile = await api.saveProfile(draft);
      set({ profiles: [profile, ...get().profiles], activeProfileId: profile.id });
      return profile;
    } catch (error) {
      set({ error: errorMessage(error) });
      return null;
    }
  },
  renameProfile: async (id, name) => {
    set({ error: null });
    try {
      const profile = await api.renameProfile(id, name);
      set({ profiles: get().profiles.map((item) => (item.id === id ? profile : item)) });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  duplicateProfile: async (id) => {
    set({ error: null });
    try {
      const profile = await api.duplicateProfile(id);
      set({ profiles: [profile, ...get().profiles] });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  deleteProfile: async (id) => {
    set({ error: null });
    try {
      await api.deleteProfile(id);
      set({
        profiles: get().profiles.filter((profile) => profile.id !== id),
        activeProfileId: get().activeProfileId === id ? null : get().activeProfileId,
      });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  applyLayout: async (layout) => {
    set({ isApplying: true, error: null });
    try {
      const result = await api.applyLayout(layout);
      set({ isApplying: false, lastApplyResult: result });
      return result;
    } catch (error) {
      set({ isApplying: false, error: errorMessage(error) });
      return null;
    }
  },
  applyProfile: async (id) => {
    set({ isApplying: true, error: null, activeProfileId: id });
    try {
      const result = await api.applyProfile(id);
      await get().loadProfiles();
      set({ isApplying: false, lastApplyResult: result });
      return result;
    } catch (error) {
      set({ isApplying: false, error: errorMessage(error) });
      return null;
    }
  },
}));
