export type DisplayRotation = 0 | 90 | 180 | 270;

export type DisplayConnectionType =
  | "internal"
  | "hdmi"
  | "displayport"
  | "usb-c"
  | "thunderbolt"
  | "virtual"
  | "unknown";

export type Point = {
  x: number;
  y: number;
};

export type Size = {
  width: number;
  height: number;
};

export type Rect = Point & Size;

export type DisplayCapability = {
  supported: boolean;
  reason: string | null;
};

export type DisplayCapabilities = {
  position: DisplayCapability;
  primary: DisplayCapability;
  rotation: DisplayCapability;
  scale: DisplayCapability;
};

export type DisplayScaleOption = {
  id: string;
  label: string;
  scaleFactor: number;
  resolution: Size;
  refreshRate: number | null;
  isCurrent: boolean;
};

export type Display = {
  id: string;
  stableId: string | null;
  modeId: string | null;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  resolution: Size;
  refreshRate: number | null;
  scaleFactor: number;
  position: Point;
  rotation: DisplayRotation;
  isPrimary: boolean;
  isInternal: boolean;
  connectionType: DisplayConnectionType | null;
  bounds: Rect;
  capabilities: DisplayCapabilities;
  scaleOptions: DisplayScaleOption[];
};

export type LayoutDisplay = {
  stableId: string;
  modeId?: string | null;
  position: Point;
  resolution: Size;
  refreshRate: number | null;
  scaleFactor: number;
  rotation: DisplayRotation;
  enabled: boolean;
};

export type Layout = {
  displays: LayoutDisplay[];
  primaryDisplayStableId: string | null;
};

export type LayoutProfile = {
  id: string;
  name: string;
  description?: string | null;
  layout: Layout;
  detectionRules: unknown[];
  hotkey?: string | null;
  createdAt: string;
  updatedAt: string;
  lastAppliedAt?: string | null;
  metadata: {
    appVersion: string;
    platformCreatedOn: "macos" | "windows" | "linux";
  };
};

export type LayoutProfileDraft = {
  name: string;
  description?: string | null;
  layout: Layout;
};

export type AutomationRuleMatch = {
  displayStableIds: string[];
  displayCount: number | null;
  requireInternal: boolean | null;
  requireExternal: boolean | null;
  dockSignature: string | null;
  platform: "macos" | "windows" | "linux" | null;
};

export type AutomationRule = {
  id: string;
  name: string;
  enabled: boolean;
  profileId: string;
  match: AutomationRuleMatch;
  createdAt: string;
  updatedAt: string;
  lastTriggeredAt: string | null;
};

export type AutomationRuleDraft = {
  id?: string | null;
  name: string;
  enabled: boolean;
  profileId: string;
  match: AutomationRuleMatch;
};

export type AutomationMatchResult = {
  rule: AutomationRule;
  profileName: string;
  score: number;
  reason: string;
};

export type AutomationEvaluation = {
  matches: AutomationMatchResult[];
  evaluatedAt: string;
  displayCount: number;
};

export type AutomationEventType = "matched" | "applied" | "skipped" | "failed";

export type AutomationEvent = {
  id: string;
  ruleId: string | null;
  profileId: string | null;
  eventType: AutomationEventType;
  message: string;
  createdAt: string;
};

export type ApplyLayoutResult = {
  applied: boolean;
  message: string;
  previousLayout?: Layout | null;
  appliedLayout?: Layout | null;
  displayResults?: ApplyDisplayChangeResult[];
};

export type ApplyDisplayChangeResult = {
  stableId: string;
  status: "applied" | "skipped" | "error";
  message: string;
  applied: {
    position: boolean;
    primary: boolean;
    rotation: boolean;
    scale: boolean;
  };
};

export type RecoveryState = {
  id: string;
  previousLayout: Layout;
  appliedLayout: Layout | null;
  createdAt: string;
  expiresAt: string;
  message: string;
  displayResults: ApplyDisplayChangeResult[];
};

export type DiagnosticsProfileSummary = {
  id: string;
  name: string;
  displayCount: number;
  updatedAt: string;
  lastAppliedAt: string | null;
};

export type DiagnosticsDisplaySnapshot = {
  stableIdHash: string;
  name: string;
  resolution: Size;
  refreshRate: number | null;
  scaleFactor: number;
  position: Point;
  rotation: DisplayRotation;
  isPrimary: boolean;
  isInternal: boolean;
  capabilities: DisplayCapabilities;
};

export type DiagnosticsBundle = {
  appVersion: string;
  generatedAt: string;
  platform: "macos" | "windows" | "linux";
  displays: DiagnosticsDisplaySnapshot[];
  profiles: DiagnosticsProfileSummary[];
  automationRules: AutomationRule[];
  recentEvents: AutomationEvent[];
  recoveryState: RecoveryState | null;
};
