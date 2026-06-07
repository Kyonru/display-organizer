# Display Layout Manager Engineering Specification

## 0. Executive Summary

**Display Layout Manager** is a cross-platform desktop application for visually arranging, saving, detecting, and applying multi-monitor layouts.

The application will provide an operating-system-style monitor arrangement canvas, but extend it with advanced features:

- Named layout profiles
- Profile Actions for workspace setup
- Automatic setup detection
- Hotkeys
- Tray/menu bar controls
- Import/export
- Automation and workspace management

Recommended stack:

- **Tauri** for desktop shell and native integration
- **React + TypeScript** for UI
- **Zustand** for frontend state
- **Rust** for platform display APIs and persistence
- **React Flow or custom canvas** for monitor arrangement
- **SQLite or JSON-backed storage** for local profile persistence

The most critical architectural choice is to isolate platform-specific display behavior behind a Rust **Display Engine Abstraction Layer** so the frontend works against a consistent model across macOS, Windows, and Linux.

---

# 1. Technical Architecture

## 1.1 High-Level Architecture

```text
React UI
  |
  | Tauri invoke/events
  v
Rust Command Layer
  |
  v
Display Engine Core
  |
  +-- macOS Adapter
  +-- Windows Adapter
  +-- Linux X11 Adapter
  +-- Future Wayland Adapter
  |
  v
Native OS Display APIs
```

The app should be split into five main layers:

1. **Frontend UI**
   - Canvas arrangement
   - Profile management
   - Settings
   - Tray interaction state
   - Hotkey configuration UI

2. **Frontend State**
   - Zustand stores for displays, profiles, app settings, canvas state, and detected setup

3. **Tauri Command API**
   - Typed Rust commands exposed to the frontend
   - Event streams for display changes, profile application status, and errors

4. **Rust Display Engine**
   - Platform-neutral display querying and layout application
   - Validation, normalization, profile matching, and monitor identity resolution

5. **Platform Adapters**
   - macOS CoreGraphics
   - Windows DisplayConfig APIs
   - Linux XRandR first
   - Wayland later through compositor-specific protocols or portals where available

---

## 1.2 Frontend Architecture

Recommended frontend modules:

```text
src/
  app/
    App.tsx
    routes.tsx
    providers.tsx

  features/
    displays/
      components/
      hooks/
      displayStore.ts
      displayApi.ts

    canvas/
      components/
      canvasStore.ts
      layoutMath.ts
      snapping.ts
      alignmentGuides.ts

    profiles/
      components/
      profileStore.ts
      profileApi.ts
      profileActions.ts

    hotkeys/
      components/
      hotkeyStore.ts

    tray/
      trayStore.ts

    settings/
      components/
      settingsStore.ts

  shared/
    components/
    hooks/
    lib/
    types/
```

### Frontend Responsibilities

The frontend should handle:

- Visual monitor arrangement
- Drag, pan, zoom, selection, and snapping
- Profile CRUD
- Profile Actions editing and apply results
- Displaying detected monitor metadata
- User confirmation flows
- Settings and automation preferences
- Hotkey configuration UI
- Import/export UX

The frontend should not directly understand platform APIs. It should only consume normalized display and profile models from Rust.

---

## 1.3 Backend Architecture

The Rust side should be responsible for:

- Querying connected displays
- Reading native metadata
- Applying display layouts
- Detecting monitor changes
- Matching current setups to saved profiles
- Persisting profiles and settings
- Executing Profile Actions after successful profile layout apply
- Registering global hotkeys
- Managing tray/menu bar behavior
- Emitting events to the frontend

Recommended backend crates/modules:

```text
src-tauri/src/
  main.rs
  commands/
  display_engine/
  platform/
  persistence/
  tray/
  hotkeys/
  events/
  errors/
```

---

## 1.4 Rust-Tauri Communication

Use Tauri commands for request/response operations:

```rust
#[tauri::command]
async fn get_displays() -> Result<Vec<Display>, AppError>;

#[tauri::command]
async fn get_profiles() -> Result<Vec<LayoutProfile>, AppError>;

#[tauri::command]
async fn save_profile(profile: LayoutProfileDraft) -> Result<LayoutProfile, AppError>;

#[tauri::command]
async fn apply_profile(profile_id: String) -> Result<ProfileApplyResult, AppError>;

#[tauri::command]
async fn apply_profile_draft(profile: LayoutProfileDraft) -> Result<ProfileApplyResult, AppError>;

#[tauri::command]
async fn export_profiles(profile_ids: Vec<String>) -> Result<String, AppError>;

#[tauri::command]
async fn import_profiles(payload: String) -> Result<ImportResult, AppError>;
```

Use Tauri events for async updates:

```text
display:changed
display:hotplugged
display:removed
profile:applied
profile:apply_failed
setup:matched
hotkey:triggered
tray:profile_selected
```

Frontend example:

```ts
listen<DisplayChangedPayload>("display:changed", event => {
  useDisplayStore.getState().refreshDisplays(event.payload.displays);
});
```

---

## 1.5 State Management Design

Use Zustand stores with clear ownership.

### `displayStore`

Owns current live display state.

```ts
type DisplayState = {
  displays: Display[];
  primaryDisplayId: string | null;
  isRefreshing: boolean;
  lastUpdatedAt: string | null;
  refreshDisplays: () => Promise<void>;
};
```

### `profileStore`

Owns saved profiles and profile actions.

```ts
type ProfileState = {
  profiles: LayoutProfile[];
  activeProfileId: string | null;
  matchedProfileId: string | null;
  loadProfiles: () => Promise<void>;
  saveProfile: (draft: LayoutProfileDraft) => Promise<void>;
  applyProfile: (id: string) => Promise<void>;
  duplicateProfile: (id: string) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
};
```

### `canvasStore`

Owns transient UI state.

```ts
type CanvasState = {
  zoom: number;
  pan: { x: number; y: number };
  selectedDisplayIds: string[];
  snapToGrid: boolean;
  snapToEdges: boolean;
  gridSize: number;
};
```

### `settingsStore`

Owns app-level settings.

```ts
type SettingsState = {
  launchAtLogin: boolean;
  minimizeToTray: boolean;
  autoApplyProfiles: boolean;
  confirmBeforeApply: boolean;
  hotkeysEnabled: boolean;
};
```

---

## 1.6 Display Abstraction Layer

The Rust Display Engine should expose a platform-neutral trait:

```rust
pub trait DisplayPlatform {
    fn query_displays(&self) -> Result<Vec<Display>, DisplayError>;
    fn apply_layout(&self, layout: Layout) -> Result<ApplyLayoutResult, DisplayError>;
    fn watch_changes(&self, sender: DisplayEventSender) -> Result<(), DisplayError>;
    fn get_capabilities(&self) -> PlatformCapabilities;
}
```

Each OS adapter implements this trait:

```text
MacDisplayPlatform
WindowsDisplayPlatform
XrandrDisplayPlatform
WaylandDisplayPlatform
```

This isolates native complexity and lets the UI remain stable.

---

# 2. Project Structure

```text
display-layout-manager/
  package.json
  pnpm-lock.yaml
  tsconfig.json
  vite.config.ts
  index.html
  README.md

  src/
    app/
      App.tsx
      providers.tsx
      routes.tsx

    features/
      displays/
        components/
          DisplayInspector.tsx
          DisplayList.tsx
          DisplayMetadataPanel.tsx
        hooks/
          useDisplays.ts
        displayApi.ts
        displayStore.ts
        displayTypes.ts

      canvas/
        components/
          ArrangementCanvas.tsx
          MonitorNode.tsx
          CanvasToolbar.tsx
          AlignmentGuides.tsx
          GridLayer.tsx
          SelectionOverlay.tsx
        layoutMath.ts
        snapping.ts
        alignmentGuides.ts
        canvasStore.ts
        canvasTypes.ts

      profiles/
        components/
          ProfileSidebar.tsx
          ProfileManager.tsx
          ProfileEditorDialog.tsx
          ImportExportDialog.tsx
        profileApi.ts
        profileStore.ts
        profileTypes.ts

      setupDetection/
        setupDetectionStore.ts
        setupDetectionTypes.ts

      hotkeys/
        components/
          HotkeySettings.tsx
          HotkeyRecorder.tsx
        hotkeyApi.ts
        hotkeyStore.ts
        hotkeyTypes.ts

      settings/
        components/
          SettingsScreen.tsx
          GeneralSettings.tsx
          AutomationSettings.tsx
          PlatformSettings.tsx
        settingsApi.ts
        settingsStore.ts
        settingsTypes.ts

      tray/
        trayApi.ts
        trayStore.ts

    shared/
      components/
        Button.tsx
        IconButton.tsx
        Dialog.tsx
        Sidebar.tsx
        Toolbar.tsx
        Toggle.tsx
        Select.tsx
        Tooltip.tsx
      hooks/
        useTauriEvent.ts
        useDebouncedValue.ts
      lib/
        assertNever.ts
        formatDisplayName.ts
        ids.ts
      types/
        common.ts

    styles/
      globals.css
      tokens.css

  src-tauri/
    Cargo.toml
    tauri.conf.json
    build.rs

    src/
      main.rs
      lib.rs

      commands/
        mod.rs
        displays.rs
        profiles.rs
        settings.rs
        hotkeys.rs
        tray.rs

      display_engine/
        mod.rs
        engine.rs
        models.rs
        matching.rs
        validation.rs
        normalization.rs
        capabilities.rs
        errors.rs

      profile_actions.rs

      platform/
        mod.rs

        macos/
          mod.rs
          core_graphics.rs
          display_reconfig.rs
          metadata.rs

        windows/
          mod.rs
          query_display_config.rs
          set_display_config.rs
          device_info.rs

        linux/
          mod.rs
          xrandr.rs
          x11_events.rs
          wayland.rs

      persistence/
        mod.rs
        database.rs
        migrations.rs
        profile_repository.rs
        settings_repository.rs
        import_export.rs

      hotkeys/
        mod.rs
        registry.rs
        actions.rs

      tray/
        mod.rs
        menu.rs
        status.rs

      events/
        mod.rs
        display_events.rs
        profile_events.rs

      errors/
        mod.rs
        app_error.rs
```

---

# 3. Display Engine Design

## 3.1 Display Model

```ts
type Display = {
  id: string;
  stableId: string | null;

  name: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;

  resolution: {
    width: number;
    height: number;
  };

  refreshRate: number | null;
  scaleFactor: number;

  position: {
    x: number;
    y: number;
  };

  rotation: DisplayRotation;
  isPrimary: boolean;
  isInternal: boolean;
  connectionType: DisplayConnectionType | null;

  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  workArea?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

type DisplayRotation = 0 | 90 | 180 | 270;

type DisplayConnectionType =
  | "internal"
  | "hdmi"
  | "displayport"
  | "usb-c"
  | "thunderbolt"
  | "virtual"
  | "unknown";
```

Important distinction:

- `id`: Runtime OS display identifier. May change.
- `stableId`: Best-effort persistent identity from EDID/manufacturer/model/serial/path.

---

## 3.2 Layout Model

```ts
type Layout = {
  displays: LayoutDisplay[];
  primaryDisplayStableId: string | null;
};

type LayoutDisplay = {
  stableId: string;
  fallbackMatch: DisplayMatchSignature;

  position: {
    x: number;
    y: number;
  };

  resolution: {
    width: number;
    height: number;
  };

  refreshRate: number | null;
  scaleFactor: number;
  rotation: DisplayRotation;
  enabled: boolean;
};
```

The layout model should store logical OS display positions, not canvas coordinates. Canvas coordinates should be derived.

---

## 3.3 Profile Model

```ts
type LayoutProfile = {
  id: string;
  name: string;
  description?: string;

  layout: Layout;

  actions: ProfileAction[];

  detectionRules: DetectionRule[];

  hotkey?: string;

  createdAt: string;
  updatedAt: string;
  lastAppliedAt?: string;

  metadata: {
    appVersion: string;
    platformCreatedOn: "macos" | "windows" | "linux";
  };
};
```

Profile Actions turn a display profile into a workspace profile:

```ts
type ProfileAction =
  | {
      id?: string;
      enabled?: boolean;
      conditions?: ProfileActionConditions;
      type: "open_app";
      appPath: string;
      args?: string[];
      delayMs?: number;
      monitorId?: string;
      position?: { x: number; y: number; width: number; height: number };
    }
  | {
      id?: string;
      enabled?: boolean;
      conditions?: ProfileActionConditions;
      type: "close_app";
      appName: string;
    }
  | {
      id?: string;
      enabled?: boolean;
      conditions?: ProfileActionConditions;
      type: "run_script";
      command: string;
      delayMs?: number;
    };

type ProfileActionConditions = {
  platform?: "macos" | "windows" | "linux";
  displayStableId?: string;
  displayCount?: number;
};
```

Actions run only after a successful profile layout apply. Manual layout apply remains layout-only. Scripts are disabled by default and must be explicitly enabled as an advanced setting. Window placement may require macOS Accessibility permission.

---

## 3.4 Detection Model

```ts
type DetectionRule = {
  id: string;
  type:
    | "display_connected"
    | "display_count"
    | "dock_connected"
    | "manufacturer_model"
    | "serial_match"
    | "connection_type";

  operator: "equals" | "contains" | "exists";
  value: string | number | boolean;
};
```

Detection should support a confidence score:

```ts
type ProfileMatch = {
  profileId: string;
  confidence: number;
  reasons: string[];
};
```

Example:

- Same display count: +20
- Same serial numbers: +50
- Same manufacturer/model: +20
- Same primary display: +10

---

## 3.5 Persistence Strategy

Recommended persistence:

- **SQLite** for long-term maintainability
- Use Rust repository layer
- Store profiles as structured JSON blobs plus indexed metadata

Tables:

```sql
profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  layout_json TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  detection_rules_json TEXT NOT NULL,
  hotkey TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_applied_at TEXT
);

settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

display_history (
  id TEXT PRIMARY KEY,
  stable_id TEXT,
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  metadata_json TEXT
);
```

Profile Action settings should include `profileActions.scriptsEnabled`, defaulting to `false`. Diagnostics should export action counts, action types, and app basenames, but not raw script commands.

Import/export format:

```json
{
  "schemaVersion": 1,
  "app": "Display Layout Manager",
  "profiles": []
}
```

---

# 4. Platform Implementation

## 4.1 macOS

### APIs

Use CoreGraphics:

- `CGGetActiveDisplayList`
- `CGDisplayBounds`
- `CGDisplayPixelsWide`
- `CGDisplayPixelsHigh`
- `CGDisplayRotation`
- `CGDisplayIsMain`
- `CGDisplayCopyDisplayMode`
- `CGDisplayModeGetRefreshRate`
- `CGDisplayModeGetPixelWidth`
- `CGDisplayModeGetPixelHeight`
- `CGDisplayRegisterReconfigurationCallback`

For applying layouts:

- `CGBeginDisplayConfiguration`
- `CGConfigureDisplayOrigin`
- `CGConfigureDisplayMode`
- `CGConfigureDisplayStereoOperation`
- `CGCompleteDisplayConfiguration`

### Metadata

Use IOKit to read EDID where possible:

- Vendor ID
- Product ID
- Serial number
- Display name

### Implementation Notes

macOS display APIs can be restrictive around certain display modes and external monitor metadata. The app should distinguish between:

- Layout application succeeded
- Partial application succeeded
- OS rejected requested mode
- Metadata unavailable

### macOS Milestones

MVP:

- Query displays
- Read bounds, scale, primary, rotation
- Apply position changes

Alpha:

- EDID metadata
- Hotplug events
- Mode and refresh rate support

Beta:

- Robust validation before applying
- Recovery flow for bad layouts

---

## 4.2 Windows

### APIs

Use Display Configuration APIs:

- `QueryDisplayConfig`
- `DisplayConfigGetDeviceInfo`
- `SetDisplayConfig`

Useful structures:

- `DISPLAYCONFIG_PATH_INFO`
- `DISPLAYCONFIG_MODE_INFO`
- `DISPLAYCONFIG_SOURCE_MODE`
- `DISPLAYCONFIG_TARGET_MODE`
- `DISPLAYCONFIG_TARGET_DEVICE_NAME`
- `DISPLAYCONFIG_ADAPTER_NAME`

### Metadata

Use:

- `SetupDiGetClassDevs`
- `SetupDiEnumDeviceInfo`
- `SetupDiGetDeviceRegistryProperty`
- Registry EDID parsing where available

### Applying Layouts

Use `SetDisplayConfig` with flags such as:

- `SDC_APPLY`
- `SDC_USE_SUPPLIED_DISPLAY_CONFIG`
- `SDC_SAVE_TO_DATABASE`

Need careful mapping between:

- Adapter IDs
- Source IDs
- Target IDs
- Monitor device path

### Windows Milestones

MVP:

- Query active display paths
- Read current layout positions
- Apply position and primary display

Alpha:

- Stable monitor identity
- Refresh rate and rotation
- Hotplug detection using window messages

Beta:

- More reliable EDID parsing
- Safe rollback if layout apply fails

---

## 4.3 Linux

## X11 / XRandR First

Use XRandR through either:

- Direct `x11rb` / Xlib bindings
- Shelling to `xrandr` only for prototyping, not final production

Capabilities:

- Query connected outputs
- Read resolution
- Read position
- Read rotation
- Read primary output
- Apply output position
- Apply primary output
- Apply mode and refresh rate

Relevant XRandR concepts:

- Output
- CRTC
- Mode
- Screen resources
- EDID property
- RandR events

### Applying Layouts

Use XRandR calls equivalent to:

```text
--output HDMI-1 --mode 2560x1440 --pos 0x0 --rotate normal
--output DP-1 --mode 1920x1080 --pos 2560x0 --rotate left
--primary
```

### Event Detection

Subscribe to RandR screen change notifications.

## Future Wayland Support

Wayland is fragmented. There is no universal permissionless API for display layout changes across all compositors.

Potential paths:

- KDE KScreen D-Bus API
- GNOME Mutter D-Bus APIs where available
- `wlr-output-management` protocol for wlroots compositors
- XDG portals if display management support matures

Wayland should be treated as a separate capability tier.

### Linux Milestones

MVP:

- X11/XRandR query and apply

Alpha:

- XRandR event subscription
- EDID parsing

Beta:

- Desktop environment detection
- Wayland read-only support where possible

Post-v1:

- KDE/GNOME/wlroots-specific Wayland adapters

---

# 5. UI/UX Design

## 5.1 Main Screen

The main screen should be the actual arrangement workspace, not a landing page.

Primary layout:

```text
+--------------------------------------------------------+
| Top Toolbar                                            |
+----------------------+---------------------------------+
| Profile Sidebar      | Arrangement Canvas              |
|                      |                                 |
| - Current Setup      |  [ Monitor 1 ] [ Monitor 2 ]    |
| - Saved Profiles     |             [ Monitor 3 ]       |
| - Apply Button       |                                 |
+----------------------+---------------------------------+
| Status Bar                                             |
+--------------------------------------------------------+
```

Top toolbar:

- Refresh displays
- Save as profile
- Apply layout
- Undo canvas changes
- Redo canvas changes
- Zoom controls
- Snap toggles
- Settings button

Sidebar:

- Current detected setup
- Profile list
- Search/filter profiles
- Quick duplicate/delete/export actions

Status bar:

- Connected display count
- Matched profile
- Last applied profile
- Warning state if current layout differs from saved layout

---

## 5.2 Arrangement Canvas

The canvas should support:

- Dragging displays
- Multi-select
- Snap to monitor edges
- Snap to grid
- Alignment guides
- Zoom
- Pan
- Rotation preview
- Primary display indicator
- Display metadata on selection
- Warning badges for unsupported changes

Monitor rectangle content:

```text
Display Name
Resolution @ Refresh Rate
Scale Factor
Primary Badge
Rotation Indicator
```

Canvas coordinate system:

- Use OS logical coordinates as source of truth
- Convert to canvas coordinates with zoom/pan transform
- Normalize negative OS coordinates for display
- Preserve real relative positions

Recommended implementation:

- Use **React Flow** if node dragging, zooming, panning, and selection should be accelerated.
- Use a **custom canvas/SVG layer** if precise snapping and OS-like layout behavior becomes awkward in React Flow.

Architectural recommendation:

- Start with React Flow for MVP.
- Keep layout math independent so migration to custom canvas remains possible.

---

## 5.3 Profile Manager

Features:

- Create profile from current layout
- Rename
- Duplicate
- Delete
- Import/export
- Add description
- Assign hotkey
- Configure auto-switch rules
- Configure Profile Actions
- Show profile compatibility with current setup

Profile detail view:

```text
Name
Description
Displays included
Primary display
Detection rules
Profile Actions
Hotkey
Last applied
Apply button
```

---

## 5.4 Settings

Sections:

1. General
   - Launch at login
   - Minimize to tray
   - Start minimized
   - Confirm before applying layouts

2. Automation
   - Auto-detect setup changes
   - Auto-switch profiles
   - Require confirmation before auto-apply
   - Detection confidence threshold

3. Hotkeys
   - Next profile
   - Previous profile
   - Apply current profile
   - Per-profile hotkeys

4. Display Engine
   - Platform backend status
   - Capabilities
   - Debug display metadata
   - Export diagnostic report

5. Advanced
   - Reset profile database
   - Import/export all data
   - Enable experimental Wayland support

---

## 5.5 Tray/Menu Bar

Tray menu:

```text
Display Layout Manager
Current Setup: Work Desk

Profiles
  Work Desk
  Gaming Setup
  Portable Setup
  Docked Laptop

Actions
  Refresh Displays
  Open Arrangement
  Apply Matched Profile

Settings
Quit
```

Tray status should indicate:

- Current matched profile
- Display change detected
- Apply failure
- Automation enabled/disabled

---

# 6. Milestone Roadmap

## MVP

Estimated effort: **8 to 12 weeks**

Scope:

- Tauri app shell
- React layout workspace
- Detect displays
- Show monitor rectangles
- Drag and arrange displays
- Save local profiles
- Apply layouts on one primary platform first
- Basic profile CRUD
- macOS Profile Actions for opening apps, closing apps, scripts, and window placement
- Manual refresh
- Basic settings

Recommended MVP platform target:

1. macOS first, or
2. Windows first, depending on the team's native API familiarity

MVP success criteria:

- User can detect connected monitors
- User can visually rearrange them
- User can save a profile
- User can apply the profile
- User can restore a previously saved arrangement

---

## Alpha

Estimated effort: **10 to 16 weeks after MVP**

Scope:

- macOS, Windows, and Linux X11 support
- Better metadata extraction
- Stable display identity matching
- Hotplug detection
- Tray/menu bar application
- Hotkeys
- Import/export
- Profile duplication
- Basic auto-profile matching
- Apply validation and error reporting
- Change primary display
- Change display rotation where supported
- Change OS-native UI scale where supported
- Document read-only or unsupported scale/rotation/primary capability differences per platform

Alpha success criteria:

- App works on all three target platforms with documented capability differences
- Hotplug events refresh the UI
- Profiles can be matched to connected setups
- Tray quick switching works
- Scale, rotation, and primary controls are visible in the inspector and enabled only when the active platform adapter reports apply support
- Saved profiles preserve scale mode, rotation, and primary display settings where supported
- Saved profiles preserve workspace actions and report applied/skipped/error action results

---

## Beta

Estimated effort: **8 to 12 weeks after Alpha**

Scope:

- Preset-based automation rules for display setup, time, app events, app lifecycle, power source, and Wi-Fi context
- Conditions for display count, display ids, internal/external display presence, platform, time windows, app running state, power source, and Wi-Fi SSID
- Confirmation-first automation with explicit per-rule auto-run opt-in
- Rule cooldowns and match signatures to suppress repeated prompts for unchanged context
- Robust rollback/recovery UX
- Multi-monitor test coverage
- DPI and scaling polish
- Linux XRandR hardening
- Improved Windows monitor identity
- macOS display mode validation
- Profile Action safety, diagnostics redaction, and cross-platform executor hardening
- Diagnostics export with trigger/condition summaries and hashed SSIDs by default

Beta success criteria:

- Reliable daily use for common docked/undocked workflows
- Clear handling of unsupported platform features
- No common bad-layout traps without recovery guidance
- Automation can react to common local context without scripts or arbitrary predicates

---

## v1.0

Estimated effort: **6 to 10 weeks after Beta**

Scope:

- Production packaging
- Auto-update flow
- Signed builds
- Crash reporting
- Privacy-safe diagnostics
- Documentation
- Onboarding
- Purchase/licensing if commercial
- Final accessibility pass
- Full test matrix

v1.0 success criteria:

- Stable app for macOS, Windows, and Linux X11
- Predictable profile application
- Professional tray/menu experience
- Clear limitations for Wayland
- Recoverable errors and strong diagnostics

---

# 7. Risks and Challenges

## OS Permission Issues

macOS and Windows may restrict certain display operations. Some changes may require user approval, elevated permissions, or may simply be rejected by the OS.

Mitigation:

- Capability detection
- Clear user-facing errors
- Validate before applying
- Offer dry-run checks where possible

---

## Wayland Limitations

Wayland does not provide one universal display layout API.

Mitigation:

- Ship Linux support as X11-first
- Detect Wayland sessions
- Provide read-only mode where necessary
- Add compositor-specific adapters later

---

## Monitor Identification Problems

Serial numbers are not always available. Docks and adapters may obscure EDID data.

Mitigation:

- Use confidence-based matching
- Combine serial, manufacturer, model, resolution, connector, and position
- Maintain display history
- Let users manually resolve ambiguous matches

---

## Hotplug Edge Cases

Docking stations can trigger several rapid display events.

Mitigation:

- Debounce display change events
- Wait for configuration to settle
- Compare stable snapshots before applying automation

---

## DPI Scaling Issues

Different platforms report logical and physical pixels differently.

Mitigation:

- Store OS logical layout coordinates
- Separately store physical resolution and scale factor
- Test mixed-DPI setups heavily

---

## Bad Layout Recovery

A user could apply a layout that makes displays unusable.

Mitigation:

- Confirm risky changes
- Store previous known-good layout
- Add rollback timer
- Provide keyboard-accessible recovery action

---

# 8. Testing Strategy

## Unit Tests

Frontend:

- Layout math
- Snapping behavior
- Alignment guides
- Profile matching display names
- Zustand store reducers/actions

Rust:

- Display model normalization
- Profile matching
- Detection rules
- Import/export validation
- Layout validation
- Platform capability mapping

---

## Integration Tests

Rust integration tests:

- Mock platform adapter
- Query display flow
- Apply layout flow
- Profile save/apply flow
- Hotplug event handling
- Persistence migration tests

Use a fake display backend:

```rust
MockDisplayPlatform {
  displays: Vec<Display>,
  apply_result: ApplyLayoutResult,
}
```

This allows deterministic tests without real multi-monitor hardware.

---

## End-to-End Tests

Use Playwright against the Tauri frontend where practical.

Test flows:

- Launch app
- Load current displays
- Drag monitor
- Save profile
- Rename profile
- Duplicate profile
- Delete profile
- Import/export profile
- Apply profile with mocked backend
- Trigger simulated hotplug event
- Trigger simulated profile match

---

## Multi-Monitor Test Matrix

Minimum hardware matrix:

```text
Single internal display
Laptop + one external display
Laptop + two external displays
Desktop + two external displays
Desktop + three or more external displays
Mixed resolution displays
Mixed DPI displays
Portrait + landscape setup
Docked laptop setup
USB-C dock setup
DisplayLink adapter setup
High refresh rate monitor
Ultrawide monitor
```

Platform matrix:

```text
macOS Apple Silicon
macOS Intel if supported
Windows 10
Windows 11
Linux X11 GNOME
Linux X11 KDE
Linux Wayland GNOME read-only
Linux Wayland KDE experimental
```

---

# 9. Performance Considerations

## Real-Time Monitor Updates

Display changes can arrive in bursts.

Approach:

- Debounce hotplug events by 500 to 1500 ms
- Query displays after the system settles
- Emit one consolidated frontend event
- Avoid applying automation until display state is stable

---

## Large Monitor Setups

Most users have 1 to 4 monitors, but the app should remain smooth with 8 to 12.

Approach:

- Keep canvas rendering lightweight
- Memoize monitor nodes
- Avoid global re-renders during drag
- Store transient drag state separately from persisted layout state

---

## State Synchronization

Potential issue:

- The frontend canvas may have unsaved edits while the OS display state changes.

Approach:

- Track dirty layout state
- Show conflict warning
- Allow user to reload from current OS layout or keep draft
- Avoid silently overwriting canvas edits

---

## Native API Calls

Native display APIs can be slow or blocking.

Approach:

- Run display queries and apply operations off the main thread
- Use async Tauri commands
- Use timeouts where appropriate
- Return structured partial failures
- Cache stable metadata where safe

---

# 10. Monetization Ideas

## Free Version

Good fit for adoption.

Included:

- Detect displays
- Manual arrangement
- Save limited profiles
- Manual apply
- Tray quick switch
- Import/export

Potential limit:

- 3 profiles
- No automation
- No advanced hotkeys

---

## One-Time Purchase

Best fit for individual power users.

Included:

- Unlimited profiles
- Hotkeys
- Automation rules
- Import/export
- Advanced detection
- Diagnostics
- All local features

Suggested positioning:

- "Buy once for this major version"
- Optional paid major upgrades

---

## Pro Subscription

Best fit if future cloud or integrations are added.

Pro features:

- Cloud sync
- Cross-device profile sync
- Workspace presets
- Window placement
- Per-monitor wallpapers
- Stream Deck integration
- KVM integration
- Advanced automation

---

## Enterprise

Best fit for IT-managed environments.

Enterprise features:

- Team profile sharing
- Admin-managed monitor profiles
- Deployment configuration
- CLI apply commands
- MDM support
- Audit logs
- License management
- Priority support

---

# Recommended Build Sequence

1. Build the Rust display model and mock backend.
2. Build the React canvas against mock display data.
3. Add profile persistence.
4. Add one real platform backend.
5. Add layout application.
6. Add tray and hotkeys.
7. Add setup detection.
8. Expand platform support.
9. Harden identity matching and recovery flows.
10. Package, sign, test, and release.

The core architectural principle should be: **the UI edits normalized layouts, Rust owns platform truth, and every OS-specific behavior is isolated behind capability-aware display adapters.**
