# Display Layout Manager

Display Layout Manager is a desktop tool for arranging multiple monitors visually, applying saved display layouts to the operating system, and launching workspace actions attached to those profiles.

The current implementation is a Tauri v2 desktop app with a React, TypeScript, Zustand, React Flow, Tailwind frontend and a Rust display engine. The working native target is macOS. Windows and Linux X11 support are part of the planned Alpha/Beta architecture in `PLAN.md`, but native adapters for those platforms are not complete in this repo yet.

## Feature Status

| Area | Status |
| --- | --- |
| macOS display detection | Implemented |
| Visual display canvas | Implemented |
| Layout profiles | Implemented |
| Profile Actions / workspace automation | Implemented for macOS profile apply |
| Apply positions to macOS | Implemented |
| Change primary display | Implemented through layout origin normalization |
| Change macOS scale/resolution modes | Implemented when CoreGraphics reports usable modes |
| Change macOS rotation | Experimental through `displayplacer` |
| Menu bar quick switching | Implemented |
| Automation rules | Implemented for setup matching and confirmation-first apply |
| Recovery banner | Implemented |
| Diagnostics export | Implemented |
| Windows native adapter | Planned |
| Linux X11 native adapter | Planned |
| Wayland support | Future |

## Main Features

### Display Detection

The app queries active macOS displays through CoreGraphics and shows:

- Display id and stable MVP id
- Name
- Logical position
- Resolution
- Refresh rate when available
- Scale factor
- Rotation
- Primary display state
- Built-in versus external state
- Bounds
- Per-display capability flags
- Available macOS scale options when reported by the OS

Manufacturer, model, serial number, EDID metadata, and detailed connection type are intentionally limited in the current macOS MVP and may be null.

### Arrangement Canvas

The center canvas is powered by React Flow and supports:

- Draggable monitor nodes
- Pan and zoom
- Mini map
- Grid background
- Snap to grid
- Multi-select through React Flow selection behavior
- Rotation preview on monitor nodes
- Dark and light mode through React Flow `colorMode`
- A canvas label showing the current OS layout, selected saved profile, dirty state, or actual recently applied profile

Dragging a display updates the in-memory layout draft. Press `Apply` to send the layout to macOS.

### Profiles

Profiles store named display arrangements. The profile panel supports:

- Add a new profile from the current draft
- Select and open a profile
- Save edits back into the selected profile
- Duplicate a profile
- Delete a profile
- Apply a profile
- Highlight the currently opened profile

Profiles persist to JSON in the app data directory.

### Profile Actions

Profiles can also store workspace actions. Profile actions run only after a profile layout applies successfully. Manual layout-only apply remains available when no saved profile is active.

Supported actions:

- Open a macOS `.app` bundle
- Open an `http`, `https`, or `macappstore` URL
- Pass one argument per line to opened apps
- Delay actions relative to the start of the action phase
- Place an opened app's front window on a selected monitor
- Gracefully request an app to quit by name
- Run a local `zsh` script command when advanced scripts are enabled

Each action has an id, enabled flag, and optional conditions for platform, connected display, and display count. Unmatched conditions produce skipped action results rather than errors.

Scripts are disabled by default and marked as advanced. Window placement uses macOS System Events, so macOS may require Accessibility permission for Display Layout Manager in System Settings > Privacy & Security > Accessibility.

Arguments and window placement require a local installed `.app` bundle. App Store links open as URLs and do not launch the installed app unless macOS resolves that URL itself.

### Display Settings Inspector

The right inspector shows the selected display and allows editing supported settings:

- Primary display
- Scale/resolution mode
- Rotation

Controls are capability-gated. Unsupported controls are disabled and show a short reason from the platform adapter.

### macOS Apply Behavior

The macOS adapter applies supported settings with native APIs where possible:

- Positions are applied with `CGBeginDisplayConfiguration`, `CGConfigureDisplayOrigin`, and `CGCompleteDisplayConfiguration`.
- Scale/resolution modes are applied with `CGDisplayCopyAllDisplayModes`, `CGDisplayCopyDisplayMode`, and `CGConfigureDisplayWithDisplayMode`.
- Primary display is represented by normalizing the selected primary display to origin `(0, 0)`.
- Rotation is read-only in public CoreGraphics APIs, so the app supports experimental rotation only when `displayplacer` is available.

Before applying a layout, the app persists the current OS layout as last-known-good. After a successful apply, it refreshes display state and creates a short recovery window.

### macOS Rotation With displayplacer

Apple does not expose a public CoreGraphics setter for display rotation. To enable experimental rotation:

```sh
brew install displayplacer
```

The app searches for `displayplacer` in:

- `DISPLAYPLACER_PATH`
- `/opt/homebrew/bin/displayplacer`
- `/usr/local/bin/displayplacer`
- `/usr/bin/displayplacer`
- The current `PATH`

Known `displayplacer` rotation-only errors containing `res:0x0` and `scaling:off` are treated as non-fatal because the screen can still rotate successfully.

### Automation

Automation rules match the current connected display setup and suggest profiles to apply. Rules currently support:

- Connected display stable ids
- Display count
- Internal display presence
- External display presence
- Platform
- Optional dock signature field in the model

Automation is confirmation-first. When a rule matches, the app shows an apply prompt instead of applying silently. Prompts expire after 30 seconds and record a skipped automation event.

### Recovery

After applying a layout, the app shows a 20-second recovery banner:

- `Keep` clears the recovery state.
- `Revert` applies the previous last-known-good layout.

If the app launches and a recovery state still exists, it offers the same recovery state to help recover from bad layouts.

### Diagnostics Export

The Diagnostics button exports a local JSON bundle and shows a toast when the download is triggered. The bundle includes:

- App version
- Generated timestamp
- Platform
- Redacted display snapshots
- Profile summaries
- Profile action counts, action types, and app names
- Automation rules
- Recent automation events
- Current recovery state when present

Diagnostics hash display stable ids and do not export serial numbers, raw EDID, or script commands by default.

### Menu Bar Quick Switching

The Tauri menu bar/tray integration provides quick access to:

- Refresh displays
- Apply the current layout
- Apply saved profiles

The menu bar icon uses the app monitor icon and is configured in `src-tauri/tauri.conf.json`.

### Theme

The app supports dark and light mode. The selected theme is saved in local storage and applied to:

- Shell UI
- Sidebars
- Inspector
- React Flow canvas
- Background grid
- Mini map

## Data Storage

Runtime data is stored in the app data directory. On macOS this resolves through `dirs::data_dir()` and is usually:

```text
~/Library/Application Support/Display Layout Manager
```

Files currently used:

- `profiles.json`
- `settings.json`
- `last-known-good-layout.json`
- `automation-rules.json`
- `automation-events.json`
- `recovery-state.json`

## Development

Install dependencies:

```sh
pnpm install
```

Run the web preview with the mock backend:

```sh
pnpm dev
```

Run the native Tauri app:

```sh
pnpm tauri dev
```

Build the frontend:

```sh
pnpm build
```

Run TypeScript and frontend tests:

```sh
pnpm test
```

Run Rust tests:

```sh
cargo test --manifest-path src-tauri/Cargo.toml
```

Build a debug app bundle:

```sh
pnpm tauri build --debug
```

## Testing Notes

Recommended manual macOS checks:

- Launch with one display and confirm it renders correctly.
- Launch with two or more displays and confirm relative positions match macOS System Settings.
- Drag a display, apply the layout, and confirm the OS arrangement changes.
- Save, open, edit, duplicate, delete, and reapply profiles.
- Add Profile Actions, save a profile, apply it, and confirm action results appear.
- Pick `/Applications/Slack.app` or another app and confirm native profile apply opens it.
- Open an app with arguments, one argument per line.
- Add monitor-relative window placement and confirm macOS prompts for Accessibility permission if needed.
- Confirm close-app actions request a graceful quit.
- Confirm scripts are skipped by default, then run only after enabling the advanced Scripts toggle.
- Change primary display and confirm the main display moves to origin.
- Change scale/resolution on a display that reports multiple CoreGraphics modes.
- Install `displayplacer`, rotate a display, and confirm both the OS and node preview update.
- Export diagnostics and confirm a toast appears after the download starts.
- Use the menu bar item to apply profiles.
- Create an automation rule from the current setup and verify the confirmation prompt appears.
- Use recovery `Keep` and `Revert` after applying a layout.

## Limitations

- macOS rotation depends on `displayplacer`; public CoreGraphics APIs only expose rotation reading.
- Profile Actions are implemented natively for macOS first; Windows and Linux action executors are future adapter work.
- Window placement depends on macOS Accessibility permission and targets the front window of the selected app process.
- Script actions are local `zsh` commands, disabled by default, and intentionally redacted from diagnostics.
- Scale options depend on what CoreGraphics reports as usable for desktop GUI.
- Stable identity uses `macos-cg-{display_id}` in the current macOS implementation, so robust EDID-based identity is still future work.
- Windows and Linux X11 native adapters are planned but not complete.
- Wayland display management is future work because compositor support varies.
- Hotkeys, workspace presets, window management, per-monitor wallpapers, brightness control, cloud sync, and team sharing are future features described in `PLAN.md`.

## Architecture Pointers

- Frontend app shell: `src/app/App.tsx`
- Canvas math and tests: `src/features/canvas/layoutMath.ts`
- Display state: `src/features/displays`
- Profile state: `src/features/profiles`
- Settings state: `src/features/settings`
- Automation, recovery, and diagnostics state: `src/features/betaStore.ts`
- Rust command surface: `src-tauri/src/commands/mod.rs`
- Rust display engine models: `src-tauri/src/display_engine/models.rs`
- Rust validation: `src-tauri/src/display_engine/validation.rs`
- Automation matching: `src-tauri/src/display_engine/automation.rs`
- Profile action execution: `src-tauri/src/profile_actions.rs`
- macOS adapter: `src-tauri/src/platform/macos/mod.rs`
- Persistence: `src-tauri/src/persistence`
- Menu bar integration: `src-tauri/src/tray.rs`
- App menu integration: `src-tauri/src/app_menu.rs`

See `PLAN.md` for the full product and roadmap specification.
