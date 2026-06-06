import { invoke } from "@tauri-apps/api/core";
import {
  applyMockLayout,
  applyMockProfile,
  deleteMockProfile,
  duplicateMockProfile,
  getMockProfiles,
  renameMockProfile,
  saveMockProfile,
  updateMockProfile,
} from "../../shared/mockBackend";
import { isTauriRuntime } from "../../shared/runtime";
import type { ApplyLayoutResult, Layout, LayoutProfile, LayoutProfileDraft } from "../../shared/types";

export function getProfiles(): Promise<LayoutProfile[]> {
  if (!isTauriRuntime()) {
    return getMockProfiles();
  }

  return invoke<LayoutProfile[]>("get_profiles");
}

export function saveProfile(draft: LayoutProfileDraft): Promise<LayoutProfile> {
  if (!isTauriRuntime()) {
    return saveMockProfile(draft);
  }

  return invoke<LayoutProfile>("save_profile", { draft });
}

export function updateProfile(id: string, draft: LayoutProfileDraft): Promise<LayoutProfile> {
  if (!isTauriRuntime()) {
    return updateMockProfile(id, draft);
  }

  return invoke<LayoutProfile>("update_profile", { id, draft });
}

export function renameProfile(id: string, name: string): Promise<LayoutProfile> {
  if (!isTauriRuntime()) {
    return renameMockProfile(id, name);
  }

  return invoke<LayoutProfile>("rename_profile", { id, name });
}

export function duplicateProfile(id: string): Promise<LayoutProfile> {
  if (!isTauriRuntime()) {
    return duplicateMockProfile(id);
  }

  return invoke<LayoutProfile>("duplicate_profile", { id });
}

export function deleteProfile(id: string): Promise<void> {
  if (!isTauriRuntime()) {
    return deleteMockProfile(id);
  }

  return invoke<void>("delete_profile", { id });
}

export function applyLayout(layout: Layout): Promise<ApplyLayoutResult> {
  if (!isTauriRuntime()) {
    return applyMockLayout(layout);
  }

  return invoke<ApplyLayoutResult>("apply_layout", { layout });
}

export function applyProfile(id: string): Promise<ApplyLayoutResult> {
  if (!isTauriRuntime()) {
    return applyMockProfile(id);
  }

  return invoke<ApplyLayoutResult>("apply_profile", { profileId: id });
}
