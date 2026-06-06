import { invoke } from "@tauri-apps/api/core";
import type { ApplyLayoutResult, Layout, LayoutProfile, LayoutProfileDraft } from "../../shared/types";

export function getProfiles(): Promise<LayoutProfile[]> {
  return invoke<LayoutProfile[]>("get_profiles");
}

export function saveProfile(draft: LayoutProfileDraft): Promise<LayoutProfile> {
  return invoke<LayoutProfile>("save_profile", { draft });
}

export function renameProfile(id: string, name: string): Promise<LayoutProfile> {
  return invoke<LayoutProfile>("rename_profile", { id, name });
}

export function duplicateProfile(id: string): Promise<LayoutProfile> {
  return invoke<LayoutProfile>("duplicate_profile", { id });
}

export function deleteProfile(id: string): Promise<void> {
  return invoke<void>("delete_profile", { id });
}

export function applyLayout(layout: Layout): Promise<ApplyLayoutResult> {
  return invoke<ApplyLayoutResult>("apply_layout", { layout });
}

export function applyProfile(id: string): Promise<ApplyLayoutResult> {
  return invoke<ApplyLayoutResult>("apply_profile", { profileId: id });
}
