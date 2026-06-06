import type { ApplyLayoutResult, Display, Layout, LayoutProfile, LayoutProfileDraft } from "./types";

const PROFILE_STORAGE_KEY = "display-layout-manager.mock.profiles";

export const mockDisplays: Display[] = [
  {
    id: "mock-built-in",
    stableId: "mock-built-in",
    name: "Built-in Display",
    manufacturer: null,
    model: "Preview Retina",
    serialNumber: null,
    resolution: { width: 1728, height: 1117 },
    refreshRate: null,
    scaleFactor: 2,
    position: { x: 0, y: 0 },
    rotation: 0,
    isPrimary: true,
    isInternal: true,
    connectionType: "internal",
    bounds: { x: 0, y: 0, width: 1728, height: 1117 },
  },
  {
    id: "mock-external",
    stableId: "mock-external",
    name: "Studio Display",
    manufacturer: null,
    model: "Preview External",
    serialNumber: null,
    resolution: { width: 2560, height: 1440 },
    refreshRate: null,
    scaleFactor: 1,
    position: { x: 1728, y: 0 },
    rotation: 0,
    isPrimary: false,
    isInternal: false,
    connectionType: "unknown",
    bounds: { x: 1728, y: 0, width: 2560, height: 1440 },
  },
];

function now() {
  return new Date().toISOString();
}

function id() {
  return globalThis.crypto?.randomUUID?.() ?? `mock-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readProfiles(): LayoutProfile[] {
  const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as LayoutProfile[];
  } catch {
    return [];
  }
}

function writeProfiles(profiles: LayoutProfile[]) {
  window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles));
}

export function getMockProfiles(): Promise<LayoutProfile[]> {
  return Promise.resolve(readProfiles());
}

export function saveMockProfile(draft: LayoutProfileDraft): Promise<LayoutProfile> {
  const timestamp = now();
  const profile: LayoutProfile = {
    id: id(),
    name: draft.name,
    description: draft.description ?? null,
    layout: draft.layout,
    detectionRules: [],
    hotkey: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastAppliedAt: null,
    metadata: {
      appVersion: "0.1.0-preview",
      platformCreatedOn: "macos",
    },
  };
  writeProfiles([profile, ...readProfiles()]);
  return Promise.resolve(profile);
}

export function updateMockProfile(profileId: string, draft: LayoutProfileDraft): Promise<LayoutProfile> {
  const profiles = readProfiles();
  const profile = profiles.find((item) => item.id === profileId);
  if (!profile) {
    return Promise.reject(new Error(`profile not found: ${profileId}`));
  }

  profile.name = draft.name;
  profile.description = draft.description ?? null;
  profile.layout = draft.layout;
  profile.updatedAt = now();
  writeProfiles(profiles);
  return Promise.resolve(profile);
}

export function renameMockProfile(profileId: string, name: string): Promise<LayoutProfile> {
  const profiles = readProfiles();
  const profile = profiles.find((item) => item.id === profileId);
  if (!profile) {
    return Promise.reject(new Error(`profile not found: ${profileId}`));
  }

  profile.name = name;
  profile.updatedAt = now();
  writeProfiles(profiles);
  return Promise.resolve(profile);
}

export function duplicateMockProfile(profileId: string): Promise<LayoutProfile> {
  const profiles = readProfiles();
  const profile = profiles.find((item) => item.id === profileId);
  if (!profile) {
    return Promise.reject(new Error(`profile not found: ${profileId}`));
  }

  const timestamp = now();
  const duplicate: LayoutProfile = {
    ...profile,
    id: id(),
    name: `${profile.name} Copy`,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastAppliedAt: null,
  };
  writeProfiles([duplicate, ...profiles]);
  return Promise.resolve(duplicate);
}

export function deleteMockProfile(profileId: string): Promise<void> {
  writeProfiles(readProfiles().filter((profile) => profile.id !== profileId));
  return Promise.resolve();
}

export function applyMockLayout(layout: Layout): Promise<ApplyLayoutResult> {
  return Promise.resolve({
    applied: true,
    message: "Preview layout applied. Open the Tauri app to apply changes to macOS.",
    previousLayout: null,
    appliedLayout: layout,
  });
}

export function applyMockProfile(profileId: string): Promise<ApplyLayoutResult> {
  const profiles = readProfiles();
  const profile = profiles.find((item) => item.id === profileId);
  if (!profile) {
    return Promise.reject(new Error(`profile not found: ${profileId}`));
  }

  profile.lastAppliedAt = now();
  profile.updatedAt = now();
  writeProfiles(profiles);
  return applyMockLayout(profile.layout);
}
