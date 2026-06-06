import type {
  ApplyLayoutResult,
  AutomationEvaluation,
  AutomationEvent,
  AutomationEventType,
  AutomationRule,
  AutomationRuleDraft,
  DiagnosticsBundle,
  Display,
  Layout,
  LayoutProfile,
  LayoutProfileDraft,
  RecoveryState,
} from "./types";

const PROFILE_STORAGE_KEY = "display-layout-manager.mock.profiles";
const AUTOMATION_STORAGE_KEY = "display-layout-manager.mock.automationRules";
const AUTOMATION_EVENTS_KEY = "display-layout-manager.mock.automationEvents";
const RECOVERY_STORAGE_KEY = "display-layout-manager.mock.recovery";

export const mockDisplays: Display[] = [
  {
    id: "mock-built-in",
    stableId: "mock-built-in",
    modeId: "mock-built-in-retina",
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
    capabilities: previewCapabilities(),
    scaleOptions: [
      {
        id: "mock-built-in-default",
        label: "Default 1512 x 982 (2.00x)",
        scaleFactor: 2,
        resolution: { width: 1512, height: 982 },
        refreshRate: null,
        isCurrent: false,
      },
      {
        id: "mock-built-in-retina",
        label: "More Space 1728 x 1117 (2.00x)",
        scaleFactor: 2,
        resolution: { width: 1728, height: 1117 },
        refreshRate: null,
        isCurrent: true,
      },
    ],
  },
  {
    id: "mock-external",
    stableId: "mock-external",
    modeId: "mock-external-default",
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
    capabilities: previewCapabilities(),
    scaleOptions: [
      {
        id: "mock-external-default",
        label: "Default 2560 x 1440 (1.00x)",
        scaleFactor: 1,
        resolution: { width: 2560, height: 1440 },
        refreshRate: null,
        isCurrent: true,
      },
      {
        id: "mock-external-large",
        label: "Larger Text 1920 x 1080 (1.33x)",
        scaleFactor: 1.33,
        resolution: { width: 1920, height: 1080 },
        refreshRate: null,
        isCurrent: false,
      },
    ],
  },
];

function previewCapabilities() {
  return {
    position: { supported: true, reason: null },
    primary: { supported: true, reason: null },
    rotation: { supported: true, reason: null },
    scale: { supported: true, reason: null },
  };
}

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

function readAutomationRules(): AutomationRule[] {
  const raw = window.localStorage.getItem(AUTOMATION_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as AutomationRule[];
  } catch {
    return [];
  }
}

function writeAutomationRules(rules: AutomationRule[]) {
  window.localStorage.setItem(AUTOMATION_STORAGE_KEY, JSON.stringify(rules));
}

function readAutomationEvents(): AutomationEvent[] {
  const raw = window.localStorage.getItem(AUTOMATION_EVENTS_KEY);
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as AutomationEvent[];
  } catch {
    return [];
  }
}

function writeAutomationEvents(events: AutomationEvent[]) {
  window.localStorage.setItem(AUTOMATION_EVENTS_KEY, JSON.stringify(events.slice(0, 50)));
}

function readRecoveryState(): RecoveryState | null {
  const raw = window.localStorage.getItem(RECOVERY_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as RecoveryState;
  } catch {
    return null;
  }
}

function writeRecoveryState(state: RecoveryState | null) {
  if (state) {
    window.localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(state));
  } else {
    window.localStorage.removeItem(RECOVERY_STORAGE_KEY);
  }
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
  const previousLayout: Layout = {
    displays: mockDisplays.map((display) => ({
      stableId: display.stableId ?? display.id,
      modeId: display.modeId,
      position: display.position,
      resolution: display.resolution,
      refreshRate: display.refreshRate,
      scaleFactor: display.scaleFactor,
      rotation: display.rotation,
      enabled: true,
    })),
    primaryDisplayStableId: mockDisplays.find((display) => display.isPrimary)?.stableId ?? null,
  };
  const result: ApplyLayoutResult = {
    applied: true,
    message: "Preview layout applied. Open the Tauri app to apply changes to macOS.",
    previousLayout,
    appliedLayout: layout,
    displayResults: layout.displays.map((display) => ({
      stableId: display.stableId,
      status: "applied",
      message: "Preview applied.",
      applied: {
        position: true,
        primary: layout.primaryDisplayStableId === display.stableId,
        rotation: true,
        scale: Boolean(display.modeId),
      },
    })),
  };
  writeRecoveryState({
    id: id(),
    previousLayout,
    appliedLayout: layout,
    createdAt: now(),
    expiresAt: new Date(Date.now() + 20_000).toISOString(),
    message: result.message,
    displayResults: result.displayResults ?? [],
  });

  return Promise.resolve({
    ...result,
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

export function getMockAutomationRules(): Promise<AutomationRule[]> {
  return Promise.resolve(readAutomationRules());
}

export function saveMockAutomationRule(draft: AutomationRuleDraft): Promise<AutomationRule> {
  const rules = readAutomationRules();
  const timestamp = now();
  const existing = draft.id ? rules.find((rule) => rule.id === draft.id) : null;
  const rule: AutomationRule = existing
    ? {
        ...existing,
        name: draft.name,
        enabled: draft.enabled,
        profileId: draft.profileId,
        match: draft.match,
        updatedAt: timestamp,
      }
    : {
        id: id(),
        name: draft.name,
        enabled: draft.enabled,
        profileId: draft.profileId,
        match: draft.match,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastTriggeredAt: null,
      };

  writeAutomationRules(existing ? rules.map((item) => (item.id === rule.id ? rule : item)) : [rule, ...rules]);
  return Promise.resolve(rule);
}

export function deleteMockAutomationRule(ruleId: string): Promise<void> {
  writeAutomationRules(readAutomationRules().filter((rule) => rule.id !== ruleId));
  return Promise.resolve();
}

function ruleMatches(rule: AutomationRule, profiles: LayoutProfile[]) {
  if (!rule.enabled || !profiles.some((profile) => profile.id === rule.profileId)) {
    return false;
  }

  const displayIds = new Set(mockDisplays.map((display) => display.stableId ?? display.id));
  const expectedIds = new Set(rule.match.displayStableIds);
  const idsMatch =
    expectedIds.size === 0 ||
    (expectedIds.size === displayIds.size && [...expectedIds].every((displayId) => displayIds.has(displayId)));

  return (
    idsMatch &&
    (rule.match.displayCount === null || rule.match.displayCount === mockDisplays.length) &&
    (rule.match.requireInternal === null ||
      mockDisplays.some((display) => display.isInternal) === rule.match.requireInternal) &&
    (rule.match.requireExternal === null ||
      mockDisplays.some((display) => !display.isInternal) === rule.match.requireExternal) &&
    (rule.match.platform === null || rule.match.platform === "macos")
  );
}

export function evaluateMockAutomationRules(): Promise<AutomationEvaluation> {
  const profiles = readProfiles();
  const matches = readAutomationRules()
    .filter((rule) => ruleMatches(rule, profiles))
    .map((rule) => ({
      rule,
      profileName: profiles.find((profile) => profile.id === rule.profileId)?.name ?? "Profile",
      score: 100 + (rule.match.displayCount === null ? 0 : 10),
      reason: "exact display set",
    }))
    .sort((left, right) => right.score - left.score);

  return Promise.resolve({
    matches,
    evaluatedAt: now(),
    displayCount: mockDisplays.length,
  });
}

export function recordMockAutomationEvent(
  ruleId: string | null,
  profileId: string | null,
  eventType: AutomationEventType,
  message: string,
): Promise<AutomationEvent> {
  if (eventType === "applied" && ruleId) {
    writeAutomationRules(
      readAutomationRules().map((rule) =>
        rule.id === ruleId ? { ...rule, lastTriggeredAt: now(), updatedAt: now() } : rule,
      ),
    );
  }

  const event: AutomationEvent = {
    id: id(),
    ruleId,
    profileId,
    eventType,
    message,
    createdAt: now(),
  };
  writeAutomationEvents([event, ...readAutomationEvents()]);
  return Promise.resolve(event);
}

export function getMockRecoveryState(): Promise<RecoveryState | null> {
  return Promise.resolve(readRecoveryState());
}

export function keepMockRecovery(): Promise<void> {
  writeRecoveryState(null);
  return Promise.resolve();
}

export function revertMockRecovery(): Promise<ApplyLayoutResult> {
  const state = readRecoveryState();
  writeRecoveryState(null);
  return applyMockLayout(state?.previousLayout ?? { displays: [], primaryDisplayStableId: null });
}

export function exportMockDiagnostics(): Promise<DiagnosticsBundle> {
  return Promise.resolve({
    appVersion: "0.1.0-preview",
    generatedAt: now(),
    platform: "macos",
    displays: mockDisplays.map((display) => ({
      stableIdHash: `mock-${display.stableId ?? display.id}`,
      name: display.name,
      resolution: display.resolution,
      refreshRate: display.refreshRate,
      scaleFactor: display.scaleFactor,
      position: display.position,
      rotation: display.rotation,
      isPrimary: display.isPrimary,
      isInternal: display.isInternal,
      capabilities: display.capabilities,
    })),
    profiles: readProfiles().map((profile) => ({
      id: profile.id,
      name: profile.name,
      displayCount: profile.layout.displays.length,
      updatedAt: profile.updatedAt,
      lastAppliedAt: profile.lastAppliedAt ?? null,
    })),
    automationRules: readAutomationRules(),
    recentEvents: readAutomationEvents(),
    recoveryState: readRecoveryState(),
  });
}
