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

export type PlatformName = "macos" | "windows" | "linux";

export type ProfileActionConditions = {
  platform?: PlatformName | null;
  displayStableId?: string | null;
  displayCount?: number | null;
};

export type ProfileActionBase = {
  id?: string | null;
  enabled?: boolean;
  conditions?: ProfileActionConditions | null;
};

export type ProfileAction =
  | (ProfileActionBase & {
      type: "open_app";
      appPath: string;
      args?: string[];
      delayMs?: number | null;
      monitorId?: string | null;
      position?: Rect | null;
    })
  | (ProfileActionBase & {
      type: "close_app";
      appName: string;
    })
  | (ProfileActionBase & {
      type: "run_script";
      command: string;
      delayMs?: number | null;
    });

export type ProfileActionType = ProfileAction["type"];

export type ProfileActionResult = {
  actionId: string;
  actionType: ProfileActionType;
  status: "applied" | "skipped" | "error";
  message: string;
  startedAt: string;
  completedAt: string;
};

export type AppSettings = {
  profileActions: {
    scriptsEnabled: boolean;
  };
  automationNotifications: {
    enabled: boolean;
    hiddenOnly: boolean;
  };
};

export type LayoutProfile = {
  id: string;
  name: string;
  description?: string | null;
  layout: Layout;
  actions: ProfileAction[];
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
  actions?: ProfileAction[];
};

export type AutomationRuleMatch = {
  displayStableIds: string[];
  displayCount: number | null;
  requireInternal: boolean | null;
  requireExternal: boolean | null;
  dockSignature: string | null;
  platform: PlatformName | null;
};

export type ConfirmationMode = "confirm" | "auto";
export type AppEventKind = "opened" | "closed" | "running";
export type AppLifecycleKind = "app_launch" | "system_wake";
export type PowerSourceState = "ac" | "battery" | "charging";

export type AutomationTrigger =
  | {
      type: "display_setup_changed";
      displayStableIds?: string[];
      displayCount?: number | null;
      requireInternal?: boolean | null;
      requireExternal?: boolean | null;
      platform?: PlatformName | null;
    }
  | {
      type: "time_schedule";
      exactTime?: string | null;
      startTime?: string | null;
      endTime?: string | null;
      weekdays?: number[];
    }
  | {
      type: "app_event";
      appName: string;
      event: AppEventKind;
    }
  | {
      type: "app_lifecycle";
      event: AppLifecycleKind;
    }
  | {
      type: "power_source";
      source: PowerSourceState;
    }
  | {
      type: "network_context";
      ssid: string;
      contains?: boolean;
    };

export type AutomationCondition =
  | {
      type: "display_count";
      count: number;
    }
  | {
      type: "display_ids";
      stableIds: string[];
      exact?: boolean;
    }
  | {
      type: "internal_display";
      required: boolean;
    }
  | {
      type: "external_display";
      required: boolean;
    }
  | {
      type: "platform";
      platform: PlatformName;
    }
  | {
      type: "time_window";
      startTime: string;
      endTime: string;
      weekdays?: number[];
    }
  | {
      type: "app_running";
      appName: string;
      running: boolean;
    }
  | {
      type: "power_source";
      source: PowerSourceState;
    }
  | {
      type: "wifi_ssid";
      ssid: string;
      contains?: boolean;
    };

export type AutomationRule = {
  id: string;
  name: string;
  enabled: boolean;
  profileId: string;
  match: AutomationRuleMatch;
  triggers: AutomationTrigger[];
  conditions: AutomationCondition[];
  confirmationMode: ConfirmationMode;
  cooldownMs: number;
  createdAt: string;
  updatedAt: string;
  lastTriggeredAt: string | null;
  lastMatchedSignature: string | null;
};

export type AutomationRuleDraft = {
  id?: string | null;
  name: string;
  enabled: boolean;
  profileId: string;
  match: AutomationRuleMatch;
  triggers?: AutomationTrigger[];
  conditions?: AutomationCondition[];
  confirmationMode?: ConfirmationMode;
  cooldownMs?: number;
};

export type AutomationMatchResult = {
  rule: AutomationRule;
  profileName: string;
  score: number;
  reason: string;
  matchedTriggers: string[];
  matchedConditions: string[];
  skippedReasons: string[];
  requiresConfirmation: boolean;
  cooldownRemainingMs: number | null;
  matchSignature: string;
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

export type ProfileApplyResult = {
  applied: boolean;
  message: string;
  layoutResult: ApplyLayoutResult;
  actionResults: ProfileActionResult[];
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
  actionCount: number;
  actionTypes: ProfileActionType[];
  actionAppNames: string[];
  hasScripts: boolean;
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
  platform: PlatformName;
  settings: AppSettings;
  displays: DiagnosticsDisplaySnapshot[];
  profiles: DiagnosticsProfileSummary[];
  automationRules: AutomationRule[];
  recentEvents: AutomationEvent[];
  recoveryState: RecoveryState | null;
};
