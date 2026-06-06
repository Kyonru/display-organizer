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

export type Display = {
  id: string;
  stableId: string | null;
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
};

export type LayoutDisplay = {
  stableId: string;
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

export type ApplyLayoutResult = {
  applied: boolean;
  message: string;
  previousLayout?: Layout | null;
  appliedLayout?: Layout | null;
};
