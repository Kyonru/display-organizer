use std::collections::HashMap;
use std::ffi::c_void;

use crate::display_engine::models::{
    Display, DisplayConnectionType, DisplayRotation, Layout, Point, Rect, Size,
};
use crate::errors::AppError;

type CGDirectDisplayID = u32;
type CGError = i32;
type CGDisplayConfigRef = *mut c_void;

const MAX_DISPLAYS: usize = 32;
const CG_ERROR_SUCCESS: CGError = 0;
const K_CG_CONFIGURE_PERMANENTLY: u32 = 1;

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
    fn CGBeginDisplayConfiguration(config: *mut CGDisplayConfigRef) -> CGError;
    fn CGConfigureDisplayOrigin(
        config: CGDisplayConfigRef,
        display: CGDirectDisplayID,
        x: i32,
        y: i32,
    ) -> CGError;
    fn CGCompleteDisplayConfiguration(config: CGDisplayConfigRef, option: u32) -> CGError;
    fn CGCancelDisplayConfiguration(config: CGDisplayConfigRef) -> CGError;
}

pub fn query_displays() -> Result<Vec<Display>, AppError> {
    let mut ids = [0_u32; MAX_DISPLAYS];
    let mut count = 0_u32;
    let error = unsafe { CGGetActiveDisplayList(MAX_DISPLAYS as u32, ids.as_mut_ptr(), &mut count) };
    if error != CG_ERROR_SUCCESS {
        return Err(AppError::Display(format!(
            "CGGetActiveDisplayList failed with code {error}"
        )));
    }

    let displays = ids
        .iter()
        .take(count as usize)
        .map(|id| display_from_id(*id))
        .collect::<Vec<_>>();

    Ok(displays)
}

fn display_from_id(id: CGDirectDisplayID) -> Display {
    let bounds = unsafe { CGDisplayBounds(id) };
    let pixel_width = unsafe { CGDisplayPixelsWide(id) } as u32;
    let pixel_height = unsafe { CGDisplayPixelsHigh(id) } as u32;
    let is_primary = unsafe { CGDisplayIsMain(id) } != 0;
    let is_internal = unsafe { CGDisplayIsBuiltin(id) } != 0;
    let logical_width = bounds.size.width.max(1.0);
    let scale_factor = (pixel_width as f64 / logical_width).max(1.0);
    let stable_id = format!("macos-cg-{id}");

    Display {
        id: id.to_string(),
        stable_id: Some(stable_id),
        name: if is_internal {
            "Built-in Display".to_string()
        } else {
            format!("Display {id}")
        },
        manufacturer: None,
        model: None,
        serial_number: None,
        resolution: Size {
            width: pixel_width,
            height: pixel_height,
        },
        refresh_rate: None,
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
    }
}

pub fn apply_layout(layout: &Layout, active_displays: &[Display]) -> Result<(), AppError> {
    let display_ids = active_displays
        .iter()
        .filter_map(|display| {
            let stable_id = display.stable_id.as_ref()?;
            let cg_id = display.id.parse::<CGDirectDisplayID>().ok()?;
            Some((stable_id.clone(), cg_id))
        })
        .collect::<HashMap<_, _>>();

    let mut config: CGDisplayConfigRef = std::ptr::null_mut();
    let begin_error = unsafe { CGBeginDisplayConfiguration(&mut config) };
    if begin_error != CG_ERROR_SUCCESS {
        return Err(AppError::Display(format!(
            "CGBeginDisplayConfiguration failed with code {begin_error}"
        )));
    }

    let configure_result = (|| {
        for layout_display in layout.displays.iter().filter(|display| display.enabled) {
            let display_id = display_ids
                .get(&layout_display.stable_id)
                .ok_or_else(|| {
                    AppError::Validation(format!(
                        "unable to map layout display {} to an active macOS display",
                        layout_display.stable_id
                    ))
                })?;
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
        }
        Ok(())
    })();

    if let Err(error) = configure_result {
        unsafe {
            CGCancelDisplayConfiguration(config);
        }
        return Err(error);
    }

    let complete_error = unsafe { CGCompleteDisplayConfiguration(config, K_CG_CONFIGURE_PERMANENTLY) };
    if complete_error != CG_ERROR_SUCCESS {
        return Err(AppError::Display(format!(
            "CGCompleteDisplayConfiguration failed with code {complete_error}"
        )));
    }

    Ok(())
}
