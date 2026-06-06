use std::collections::HashMap;
use std::collections::HashSet;
use std::env;
use std::ffi::c_void;
use std::path::PathBuf;
use std::process::Command;

use crate::display_engine::models::{
    AppliedDisplayChanges, ApplyDisplayChangeResult, ApplyDisplayChangeStatus, Display,
    DisplayCapabilities, DisplayCapability, DisplayConnectionType, DisplayRotation,
    DisplayScaleOption, Layout, LayoutDisplay, Point, Rect, Size,
};
use crate::display_engine::validation::scale_changed;
use crate::errors::AppError;

type CGDirectDisplayID = u32;
type CGError = i32;
type CGDisplayConfigRef = *mut c_void;
type CGDisplayModeRef = *const c_void;
type CFArrayRef = *const c_void;
type CFAllocatorRef = *const c_void;
type CFBooleanRef = *const c_void;
type CFDictionaryRef = *const c_void;
type CFStringRef = *const c_void;
type CFTypeRef = *const c_void;
type CFIndex = isize;

const MAX_DISPLAYS: usize = 32;
const CG_ERROR_SUCCESS: CGError = 0;
const K_CG_CONFIGURE_PERMANENTLY: u32 = 1;
const DISPLAYPLACER_HINT: &str =
    "Install displayplacer with Homebrew to enable experimental macOS rotation changes";

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct CGSize {
    width: f64,
    height: f64,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    static kCGDisplayShowDuplicateLowResolutionModes: CFStringRef;
    fn CGGetActiveDisplayList(
        max_displays: u32,
        active_displays: *mut CGDirectDisplayID,
        display_count: *mut u32,
    ) -> CGError;
    fn CGDisplayBounds(display: CGDirectDisplayID) -> CGRect;
    fn CGDisplayPixelsWide(display: CGDirectDisplayID) -> usize;
    fn CGDisplayPixelsHigh(display: CGDirectDisplayID) -> usize;
    fn CGDisplayRotation(display: CGDirectDisplayID) -> f64;
    fn CGDisplayIsMain(display: CGDirectDisplayID) -> i32;
    fn CGDisplayIsBuiltin(display: CGDirectDisplayID) -> i32;
    fn CGDisplayCopyDisplayMode(display: CGDirectDisplayID) -> CGDisplayModeRef;
    fn CGDisplayCopyAllDisplayModes(
        display: CGDirectDisplayID,
        options: CFDictionaryRef,
    ) -> CFArrayRef;
    fn CGDisplayModeGetWidth(mode: CGDisplayModeRef) -> usize;
    fn CGDisplayModeGetHeight(mode: CGDisplayModeRef) -> usize;
    fn CGDisplayModeGetPixelWidth(mode: CGDisplayModeRef) -> usize;
    fn CGDisplayModeGetPixelHeight(mode: CGDisplayModeRef) -> usize;
    fn CGDisplayModeGetRefreshRate(mode: CGDisplayModeRef) -> f64;
    fn CGDisplayModeGetIODisplayModeID(mode: CGDisplayModeRef) -> i32;
    fn CGDisplayModeIsUsableForDesktopGUI(mode: CGDisplayModeRef) -> bool;
    fn CGBeginDisplayConfiguration(config: *mut CGDisplayConfigRef) -> CGError;
    fn CGConfigureDisplayOrigin(
        config: CGDisplayConfigRef,
        display: CGDirectDisplayID,
        x: i32,
        y: i32,
    ) -> CGError;
    fn CGConfigureDisplayWithDisplayMode(
        config: CGDisplayConfigRef,
        display: CGDirectDisplayID,
        mode: CGDisplayModeRef,
        options: CFDictionaryRef,
    ) -> CGError;
    fn CGCompleteDisplayConfiguration(config: CGDisplayConfigRef, option: u32) -> CGError;
    fn CGCancelDisplayConfiguration(config: CGDisplayConfigRef) -> CGError;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFBooleanTrue: CFBooleanRef;
    fn CFArrayGetCount(array: CFArrayRef) -> CFIndex;
    fn CFArrayGetValueAtIndex(array: CFArrayRef, index: CFIndex) -> *const c_void;
    fn CFDictionaryCreate(
        allocator: CFAllocatorRef,
        keys: *const *const c_void,
        values: *const *const c_void,
        num_values: CFIndex,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> CFDictionaryRef;
    fn CFRelease(value: CFTypeRef);
}

pub fn query_displays() -> Result<Vec<Display>, AppError> {
    let mut ids = [0_u32; MAX_DISPLAYS];
    let mut count = 0_u32;
    let error =
        unsafe { CGGetActiveDisplayList(MAX_DISPLAYS as u32, ids.as_mut_ptr(), &mut count) };
    if error != CG_ERROR_SUCCESS {
        return Err(AppError::Display(format!(
            "CGGetActiveDisplayList failed with code {error}"
        )));
    }

    let supports_displayplacer_rotation = displayplacer_path().is_some();
    let displays = ids
        .iter()
        .take(count as usize)
        .map(|id| display_from_id(*id, supports_displayplacer_rotation))
        .collect::<Vec<_>>();

    Ok(displays)
}

fn display_from_id(id: CGDirectDisplayID, supports_displayplacer_rotation: bool) -> Display {
    let bounds = unsafe { CGDisplayBounds(id) };
    let pixel_width = unsafe { CGDisplayPixelsWide(id) } as u32;
    let pixel_height = unsafe { CGDisplayPixelsHigh(id) } as u32;
    let is_primary = unsafe { CGDisplayIsMain(id) } != 0;
    let is_internal = unsafe { CGDisplayIsBuiltin(id) } != 0;
    let logical_width = bounds.size.width.max(1.0);
    let stable_id = format!("macos-cg-{id}");
    let (mode_id, scale_options) = display_scale_options(id);
    let current_scale_option = scale_options.iter().find(|option| option.is_current);
    let resolution = current_scale_option
        .map(|option| option.resolution)
        .unwrap_or(Size {
            width: pixel_width,
            height: pixel_height,
        });
    let refresh_rate = current_scale_option.and_then(|option| option.refresh_rate);
    let scale_factor = current_scale_option
        .map(|option| option.scale_factor)
        .unwrap_or_else(|| (pixel_width as f64 / logical_width).max(1.0));
    let scale_capability = if scale_options.len() > 1 {
        DisplayCapability::supported()
    } else {
        DisplayCapability::unsupported("No alternate macOS scale modes were reported")
    };

    Display {
        id: id.to_string(),
        stable_id: Some(stable_id),
        mode_id,
        name: if is_internal {
            "Built-in Display".to_string()
        } else {
            format!("Display {id}")
        },
        manufacturer: None,
        model: None,
        serial_number: None,
        resolution,
        refresh_rate,
        scale_factor,
        position: Point {
            x: bounds.origin.x.round() as i32,
            y: bounds.origin.y.round() as i32,
        },
        rotation: DisplayRotation::from_degrees(unsafe { CGDisplayRotation(id) }),
        is_primary,
        is_internal,
        connection_type: Some(if is_internal {
            DisplayConnectionType::Internal
        } else {
            DisplayConnectionType::Unknown
        }),
        bounds: Rect {
            x: bounds.origin.x.round() as i32,
            y: bounds.origin.y.round() as i32,
            width: bounds.size.width.round().max(0.0) as u32,
            height: bounds.size.height.round().max(0.0) as u32,
        },
        capabilities: DisplayCapabilities {
            position: DisplayCapability::supported(),
            primary: DisplayCapability::supported(),
            rotation: if supports_displayplacer_rotation {
                DisplayCapability::supported()
            } else {
                DisplayCapability::unsupported(DISPLAYPLACER_HINT)
            },
            scale: scale_capability,
        },
        scale_options,
    }
}

pub fn apply_layout(
    layout: &Layout,
    active_displays: &[Display],
) -> Result<Vec<ApplyDisplayChangeResult>, AppError> {
    let display_ids = active_displays
        .iter()
        .filter_map(|display| {
            let stable_id = display.stable_id.as_ref()?;
            let cg_id = display.id.parse::<CGDirectDisplayID>().ok()?;
            Some((stable_id.clone(), cg_id))
        })
        .collect::<HashMap<_, _>>();
    let active_by_stable_id = active_displays
        .iter()
        .map(|display| {
            (
                display
                    .stable_id
                    .clone()
                    .unwrap_or_else(|| display.id.clone()),
                display,
            )
        })
        .collect::<HashMap<_, _>>();

    let mut rotation_results = HashMap::new();
    for layout_display in layout.displays.iter().filter(|display| display.enabled) {
        let display_id = display_ids.get(&layout_display.stable_id).ok_or_else(|| {
            AppError::Validation(format!(
                "unable to map layout display {} to an active macOS display",
                layout_display.stable_id
            ))
        })?;
        let active_display = active_by_stable_id
            .get(&layout_display.stable_id)
            .ok_or_else(|| {
                AppError::Validation(format!(
                    "unable to map layout display {} to an active macOS display",
                    layout_display.stable_id
                ))
            })?;

        if layout_display.rotation != active_display.rotation {
            configure_display_rotation(*display_id, layout_display)?;
            rotation_results.insert(layout_display.stable_id.clone(), true);
        }
    }

    let mut config: CGDisplayConfigRef = std::ptr::null_mut();
    let begin_error = unsafe { CGBeginDisplayConfiguration(&mut config) };
    if begin_error != CG_ERROR_SUCCESS {
        return Err(AppError::Display(format!(
            "CGBeginDisplayConfiguration failed with code {begin_error}"
        )));
    }

    let mut display_results = Vec::new();
    let configure_result = (|| {
        for layout_display in layout.displays.iter().filter(|display| display.enabled) {
            let display_id = display_ids.get(&layout_display.stable_id).ok_or_else(|| {
                AppError::Validation(format!(
                    "unable to map layout display {} to an active macOS display",
                    layout_display.stable_id
                ))
            })?;
            let active_display = active_by_stable_id
                .get(&layout_display.stable_id)
                .ok_or_else(|| {
                    AppError::Validation(format!(
                        "unable to map layout display {} to an active macOS display",
                        layout_display.stable_id
                    ))
                })?;
            let scale_applied = if scale_changed(layout_display, active_display) {
                configure_display_mode(config, *display_id, layout_display, active_display)?
            } else {
                false
            };
            let error = unsafe {
                CGConfigureDisplayOrigin(
                    config,
                    *display_id,
                    layout_display.position.x,
                    layout_display.position.y,
                )
            };
            if error != CG_ERROR_SUCCESS {
                return Err(AppError::Display(format!(
                    "CGConfigureDisplayOrigin failed for {} with code {error}",
                    layout_display.stable_id
                )));
            }
            display_results.push(ApplyDisplayChangeResult {
                stable_id: layout_display.stable_id.clone(),
                status: ApplyDisplayChangeStatus::Applied,
                message: "macOS display settings queued.".to_string(),
                applied: AppliedDisplayChanges {
                    position: layout_display.position != active_display.position,
                    primary: layout.primary_display_stable_id.as_deref()
                        == Some(layout_display.stable_id.as_str())
                        && !active_display.is_primary,
                    rotation: rotation_results
                        .get(&layout_display.stable_id)
                        .copied()
                        .unwrap_or(false),
                    scale: scale_applied,
                },
            });
        }
        Ok(())
    })();

    if let Err(error) = configure_result {
        unsafe {
            CGCancelDisplayConfiguration(config);
        }
        return Err(error);
    }

    let complete_error =
        unsafe { CGCompleteDisplayConfiguration(config, K_CG_CONFIGURE_PERMANENTLY) };
    if complete_error != CG_ERROR_SUCCESS {
        return Err(AppError::Display(format!(
            "CGCompleteDisplayConfiguration failed with code {complete_error}"
        )));
    }

    Ok(display_results)
}

fn configure_display_rotation(
    display: CGDirectDisplayID,
    layout_display: &LayoutDisplay,
) -> Result<(), AppError> {
    let path =
        displayplacer_path().ok_or_else(|| AppError::Display(DISPLAYPLACER_HINT.to_string()))?;
    let argument = format!("id:{display} degree:{}", layout_display.rotation.degrees());
    let output = Command::new(&path)
        .arg(argument)
        .output()
        .map_err(|error| {
            AppError::Display(format!(
                "failed to run displayplacer at {}: {error}",
                path.display()
            ))
        })?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("exit status {}", output.status)
    };

    if is_displayplacer_rotation_only_resolution_error(&detail) {
        return Ok(());
    }

    Err(AppError::Display(format!(
        "displayplacer failed to rotate {}: {detail}",
        layout_display.stable_id
    )))
}

fn is_displayplacer_rotation_only_resolution_error(detail: &str) -> bool {
    detail.contains("could not find res:0x0") && detail.contains("scaling:off")
}

fn displayplacer_path() -> Option<PathBuf> {
    env::var_os("DISPLAYPLACER_PATH")
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .or_else(|| {
            [
                "/opt/homebrew/bin/displayplacer",
                "/usr/local/bin/displayplacer",
                "/usr/bin/displayplacer",
            ]
            .iter()
            .map(PathBuf::from)
            .find(|path| path.is_file())
        })
        .or_else(|| {
            env::var_os("PATH").and_then(|paths| {
                env::split_paths(&paths)
                    .map(|path| path.join("displayplacer"))
                    .find(|path| path.is_file())
            })
        })
}

fn display_scale_options(display: CGDirectDisplayID) -> (Option<String>, Vec<DisplayScaleOption>) {
    let current_mode = unsafe { CGDisplayCopyDisplayMode(display) };
    let current_signature = if current_mode.is_null() {
        None
    } else {
        Some(mode_signature(current_mode))
    };

    let modes = copy_all_display_modes(display);
    if modes.is_null() {
        release_if_present(current_mode);
        return (None, Vec::new());
    }

    let mut options = Vec::new();
    let mut seen = HashSet::new();
    let mut current_mode_id = None;
    let count = unsafe { CFArrayGetCount(modes) }.max(0) as usize;

    for index in 0..count {
        let mode = unsafe { CFArrayGetValueAtIndex(modes, index as CFIndex) } as CGDisplayModeRef;
        if mode.is_null() {
            continue;
        }
        if !unsafe { CGDisplayModeIsUsableForDesktopGUI(mode) } {
            continue;
        }

        let mode_id = mode_identifier(mode);
        if !seen.insert(mode_id.clone()) {
            continue;
        }

        let signature = mode_signature(mode);
        let refresh_rate = optional_refresh_rate(unsafe { CGDisplayModeGetRefreshRate(mode) });
        let scale_factor = mode_scale_factor(&signature);
        let is_current = current_signature
            .as_ref()
            .map(|current| current == &signature)
            .unwrap_or(false);

        if is_current {
            current_mode_id = Some(mode_id.clone());
        }

        options.push(DisplayScaleOption {
            id: mode_id,
            label: mode_label(&signature, scale_factor, refresh_rate),
            scale_factor,
            resolution: Size {
                width: signature.logical_width.max(1) as u32,
                height: signature.logical_height.max(1) as u32,
            },
            refresh_rate,
            is_current,
        });
    }

    release_if_present(modes);
    release_if_present(current_mode);

    options.sort_by(|a, b| {
        a.resolution
            .width
            .cmp(&b.resolution.width)
            .then(a.resolution.height.cmp(&b.resolution.height))
    });

    (current_mode_id, options)
}

fn configure_display_mode(
    config: CGDisplayConfigRef,
    display: CGDirectDisplayID,
    layout_display: &LayoutDisplay,
    active_display: &Display,
) -> Result<bool, AppError> {
    let modes = copy_all_display_modes(display);
    if modes.is_null() {
        return Err(AppError::Display(format!(
            "macOS reported no scale modes for {}",
            layout_display.stable_id
        )));
    }

    let count = unsafe { CFArrayGetCount(modes) }.max(0) as usize;
    let mut fallback_mode = None;
    let mut closest_mode_score = f64::MAX;
    let requested_mode_id = layout_display.mode_id.as_deref();

    for index in 0..count {
        let mode = unsafe { CFArrayGetValueAtIndex(modes, index as CFIndex) } as CGDisplayModeRef;
        if mode.is_null() {
            continue;
        }
        if !unsafe { CGDisplayModeIsUsableForDesktopGUI(mode) } {
            continue;
        }

        let mode_id = mode_identifier(mode);
        if requested_mode_id == Some(mode_id.as_str()) {
            let result = configure_mode(config, display, mode, &layout_display.stable_id);
            release_if_present(modes);
            return result.map(|_| true);
        }

        let can_use_fallback = requested_mode_id
            .map(|requested_id| legacy_mode_identifier(mode) == requested_id)
            .unwrap_or(true);

        if can_use_fallback {
            let score = mode_match_score(mode, layout_display);
            if score < closest_mode_score {
                closest_mode_score = score;
                fallback_mode = Some(mode);
            }
        }
    }

    if let Some(mode) = fallback_mode {
        let result = configure_mode(config, display, mode, &layout_display.stable_id);
        release_if_present(modes);
        return result.map(|_| true);
    }

    release_if_present(modes);
    Err(AppError::Validation(format!(
        "requested scale mode {:?} was not found for {} (current mode {:?})",
        layout_display.mode_id, layout_display.stable_id, active_display.mode_id
    )))
}

fn configure_mode(
    config: CGDisplayConfigRef,
    display: CGDirectDisplayID,
    mode: CGDisplayModeRef,
    stable_id: &str,
) -> Result<(), AppError> {
    let error =
        unsafe { CGConfigureDisplayWithDisplayMode(config, display, mode, std::ptr::null()) };
    if error != CG_ERROR_SUCCESS {
        return Err(AppError::Display(format!(
            "CGConfigureDisplayWithDisplayMode failed for {stable_id} with code {error}"
        )));
    }

    Ok(())
}

fn mode_identifier(mode: CGDisplayModeRef) -> String {
    let mode_id = unsafe { CGDisplayModeGetIODisplayModeID(mode) };
    let signature = mode_signature(mode);
    format!(
        "macos-mode-{mode_id}-{}x{}-{}x{}-{}",
        signature.logical_width,
        signature.logical_height,
        signature.pixel_width,
        signature.pixel_height,
        signature.refresh_millihertz
    )
}

fn legacy_mode_identifier(mode: CGDisplayModeRef) -> String {
    let mode_id = unsafe { CGDisplayModeGetIODisplayModeID(mode) };
    format!("macos-mode-{mode_id}")
}

fn mode_match_score(mode: CGDisplayModeRef, layout_display: &LayoutDisplay) -> f64 {
    let signature = mode_signature(mode);
    let logical_width = signature.logical_width.max(1) as f64;
    let logical_height = signature.logical_height.max(1) as f64;
    let mode_scale = mode_scale_factor(&signature);
    let requested_width = layout_display.resolution.width.max(1) as f64;
    let requested_height = layout_display.resolution.height.max(1) as f64;
    let width_delta = (logical_width - requested_width).abs() / logical_width.max(requested_width);
    let height_delta =
        (logical_height - requested_height).abs() / logical_height.max(requested_height);
    let scale_delta = (mode_scale - layout_display.scale_factor).abs();
    let refresh_delta = layout_display
        .refresh_rate
        .and_then(|requested_rate| {
            if signature.refresh_millihertz > 0 {
                let mode_rate = signature.refresh_millihertz as f64 / 1000.0;
                Some((mode_rate - requested_rate).abs() / mode_rate.max(requested_rate).max(1.0))
            } else {
                None
            }
        })
        .unwrap_or(0.0);

    width_delta * 10.0 + height_delta * 10.0 + scale_delta + refresh_delta
}

fn mode_scale_factor(signature: &ModeSignature) -> f64 {
    let width_scale = signature.pixel_width.max(1) as f64 / signature.logical_width.max(1) as f64;
    let height_scale =
        signature.pixel_height.max(1) as f64 / signature.logical_height.max(1) as f64;

    ((width_scale + height_scale) / 2.0).max(1.0)
}

fn mode_label(signature: &ModeSignature, scale_factor: f64, refresh_rate: Option<f64>) -> String {
    let backing_store = if signature.pixel_width != signature.logical_width
        || signature.pixel_height != signature.logical_height
    {
        format!(
            " @ {} x {} px",
            signature.pixel_width, signature.pixel_height
        )
    } else {
        String::new()
    };
    let refresh = refresh_rate
        .map(|rate| format!(", {:.0} Hz", rate))
        .unwrap_or_default();

    format!(
        "{} x {}{} ({:.2}x{})",
        signature.logical_width, signature.logical_height, backing_store, scale_factor, refresh
    )
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct ModeSignature {
    logical_width: usize,
    logical_height: usize,
    pixel_width: usize,
    pixel_height: usize,
    refresh_millihertz: u64,
}

fn mode_signature(mode: CGDisplayModeRef) -> ModeSignature {
    ModeSignature {
        logical_width: unsafe { CGDisplayModeGetWidth(mode) },
        logical_height: unsafe { CGDisplayModeGetHeight(mode) },
        pixel_width: unsafe { CGDisplayModeGetPixelWidth(mode) },
        pixel_height: unsafe { CGDisplayModeGetPixelHeight(mode) },
        refresh_millihertz: refresh_millihertz(unsafe { CGDisplayModeGetRefreshRate(mode) }),
    }
}

fn copy_all_display_modes(display: CGDirectDisplayID) -> CFArrayRef {
    let options = display_mode_options();
    let modes = unsafe { CGDisplayCopyAllDisplayModes(display, options) };
    release_if_present(options);
    modes
}

fn display_mode_options() -> CFDictionaryRef {
    let keys = [unsafe { kCGDisplayShowDuplicateLowResolutionModes } as *const c_void];
    let values = [unsafe { kCFBooleanTrue } as *const c_void];

    unsafe {
        CFDictionaryCreate(
            std::ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            1,
            std::ptr::null(),
            std::ptr::null(),
        )
    }
}

fn optional_refresh_rate(value: f64) -> Option<f64> {
    if value > 0.0 {
        Some(value)
    } else {
        None
    }
}

fn refresh_millihertz(value: f64) -> u64 {
    if value > 0.0 {
        (value * 1000.0).round() as u64
    } else {
        0
    }
}

fn release_if_present(value: CFTypeRef) {
    if !value.is_null() {
        unsafe {
            CFRelease(value);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        is_displayplacer_rotation_only_resolution_error, mode_label, mode_scale_factor,
        ModeSignature,
    };

    #[test]
    fn computes_scaled_mode_from_logical_and_pixel_sizes() {
        let signature = ModeSignature {
            logical_width: 2560,
            logical_height: 1440,
            pixel_width: 5120,
            pixel_height: 2880,
            refresh_millihertz: 60000,
        };

        assert_eq!(mode_scale_factor(&signature), 2.0);
    }

    #[test]
    fn labels_scaled_modes_with_backing_pixel_size() {
        let signature = ModeSignature {
            logical_width: 2560,
            logical_height: 1440,
            pixel_width: 5120,
            pixel_height: 2880,
            refresh_millihertz: 60000,
        };

        assert_eq!(
            mode_label(&signature, 2.0, Some(60.0)),
            "2560 x 1440 @ 5120 x 2880 px (2.00x, 60 Hz)"
        );
    }

    #[test]
    fn treats_displayplacer_rotation_only_resolution_error_as_non_fatal() {
        assert!(is_displayplacer_rotation_only_resolution_error(
            "Screen ID 2: could not find res:0x0 scaling:off"
        ));
    }
}
