use std::collections::HashSet;

use crate::display_engine::models::{Display, Layout, Point};
use crate::errors::AppError;

pub fn validate_layout_for_displays(
    layout: &Layout,
    active_displays: &[Display],
) -> Result<(), AppError> {
    let layout_ids = layout
        .displays
        .iter()
        .filter(|display| display.enabled)
        .map(|display| display.stable_id.as_str())
        .collect::<HashSet<_>>();

    for display in active_displays {
        let stable_id = display.stable_id.as_deref().unwrap_or(display.id.as_str());
        if !layout_ids.contains(stable_id) {
            return Err(AppError::Validation(format!(
                "layout is missing active display {stable_id}"
            )));
        }
    }

    for layout_display in layout.displays.iter().filter(|display| display.enabled) {
        let active_display = active_displays
            .iter()
            .find(|display| {
                display.stable_id.as_deref().unwrap_or(display.id.as_str())
                    == layout_display.stable_id
            })
            .ok_or_else(|| {
                AppError::Validation(format!(
                    "layout display {} is not connected",
                    layout_display.stable_id
                ))
            })?;

        if layout_display.position != active_display.position
            && !active_display.capabilities.position.supported
        {
            return Err(AppError::Validation(format!(
                "position changes are not supported for {}",
                layout_display.stable_id
            )));
        }

        if layout_display.rotation != active_display.rotation
            && !active_display.capabilities.rotation.supported
        {
            return Err(AppError::Validation(format!(
                "rotation changes are not supported for {}",
                layout_display.stable_id
            )));
        }

        if scale_changed(layout_display, active_display)
            && !active_display.capabilities.scale.supported
        {
            return Err(AppError::Validation(format!(
                "scale changes are not supported for {}",
                layout_display.stable_id
            )));
        }
    }

    if let Some(primary_id) = layout.primary_display_stable_id.as_deref() {
        let primary_display = active_displays
            .iter()
            .find(|display| {
                display.stable_id.as_deref().unwrap_or(display.id.as_str()) == primary_id
            })
            .ok_or_else(|| {
                AppError::Validation(format!("primary display {primary_id} is not connected"))
            })?;

        if !primary_display.is_primary && !primary_display.capabilities.primary.supported {
            return Err(AppError::Validation(format!(
                "primary display changes are not supported for {primary_id}"
            )));
        }
    }

    Ok(())
}

pub fn scale_changed(
    layout_display: &crate::display_engine::models::LayoutDisplay,
    active_display: &Display,
) -> bool {
    if let Some(mode_id) = layout_display.mode_id.as_deref() {
        let active_mode_matches = active_display
            .mode_id
            .as_deref()
            .map(|active_mode_id| mode_ids_compatible(mode_id, active_mode_id))
            .unwrap_or(false);

        if !active_mode_matches {
            return true;
        }
    }

    let refresh_changed = layout_display
        .refresh_rate
        .zip(active_display.refresh_rate)
        .map(|(requested_rate, active_rate)| (requested_rate - active_rate).abs() > 0.5)
        .unwrap_or(false);

    layout_display.resolution != active_display.resolution
        || (layout_display.scale_factor - active_display.scale_factor).abs() > 0.01
        || refresh_changed
}

pub fn mode_ids_compatible(requested_mode_id: &str, active_mode_id: &str) -> bool {
    requested_mode_id == active_mode_id
        || (is_legacy_macos_mode_id(requested_mode_id)
            && active_mode_id.starts_with(&format!("{requested_mode_id}-")))
}

fn is_legacy_macos_mode_id(mode_id: &str) -> bool {
    let suffix = mode_id.strip_prefix("macos-mode-");
    suffix
        .map(|value| !value.is_empty() && value.chars().all(|ch| ch.is_ascii_digit()))
        .unwrap_or(false)
}

pub fn normalize_primary_to_origin(layout: &Layout) -> Layout {
    let primary_id = layout.primary_display_stable_id.as_deref().or_else(|| {
        layout
            .displays
            .first()
            .map(|display| display.stable_id.as_str())
    });

    let primary_position = primary_id
        .and_then(|id| {
            layout
                .displays
                .iter()
                .find(|display| display.stable_id == id)
        })
        .map(|display| display.position)
        .unwrap_or(Point { x: 0, y: 0 });

    let mut normalized = layout.clone();
    for display in &mut normalized.displays {
        display.position = Point {
            x: display.position.x - primary_position.x,
            y: display.position.y - primary_position.y,
        };
    }
    normalized
}

#[cfg(test)]
mod tests {
    use crate::display_engine::models::{
        Display, DisplayCapabilities, DisplayCapability, DisplayConnectionType, DisplayRotation,
        DisplayScaleOption, Layout, LayoutDisplay, Point, Rect, Size,
    };

    use super::{normalize_primary_to_origin, scale_changed, validate_layout_for_displays};

    fn display(id: &str) -> Display {
        Display {
            id: id.to_string(),
            stable_id: Some(id.to_string()),
            mode_id: Some(format!("{id}-mode-default")),
            name: id.to_string(),
            manufacturer: None,
            model: None,
            serial_number: None,
            resolution: Size {
                width: 100,
                height: 100,
            },
            refresh_rate: None,
            scale_factor: 1.0,
            position: Point { x: 0, y: 0 },
            rotation: DisplayRotation::Deg0,
            is_primary: id == "a",
            is_internal: false,
            connection_type: Some(DisplayConnectionType::Unknown),
            bounds: Rect {
                x: 0,
                y: 0,
                width: 100,
                height: 100,
            },
            capabilities: DisplayCapabilities {
                position: DisplayCapability::supported(),
                primary: DisplayCapability::supported(),
                rotation: DisplayCapability::supported(),
                scale: DisplayCapability::supported(),
            },
            scale_options: vec![DisplayScaleOption {
                id: format!("{id}-mode-default"),
                label: "Default".to_string(),
                scale_factor: 1.0,
                resolution: Size {
                    width: 100,
                    height: 100,
                },
                refresh_rate: None,
                is_current: true,
            }],
        }
    }

    fn layout_display(id: &str, x: i32, y: i32) -> LayoutDisplay {
        LayoutDisplay {
            stable_id: id.to_string(),
            mode_id: Some(format!("{id}-mode-default")),
            position: Point { x, y },
            resolution: Size {
                width: 100,
                height: 100,
            },
            refresh_rate: None,
            scale_factor: 1.0,
            rotation: DisplayRotation::Deg0,
            enabled: true,
        }
    }

    #[test]
    fn rejects_missing_active_display() {
        let layout = Layout {
            displays: vec![layout_display("a", 0, 0)],
            primary_display_stable_id: Some("a".to_string()),
        };

        let result = validate_layout_for_displays(&layout, &[display("a"), display("b")]);

        assert!(result.is_err());
    }

    #[test]
    fn normalizes_primary_display_to_origin() {
        let layout = Layout {
            displays: vec![layout_display("a", 100, 50), layout_display("b", -100, 50)],
            primary_display_stable_id: Some("a".to_string()),
        };

        let normalized = normalize_primary_to_origin(&layout);

        assert_eq!(normalized.displays[0].position, Point { x: 0, y: 0 });
        assert_eq!(normalized.displays[1].position, Point { x: -200, y: 0 });
    }

    #[test]
    fn rejects_unsupported_rotation_change() {
        let mut active = display("a");
        active.capabilities.rotation = DisplayCapability::unsupported("read-only");
        let mut requested = layout_display("a", 0, 0);
        requested.rotation = DisplayRotation::Deg90;
        let layout = Layout {
            displays: vec![requested],
            primary_display_stable_id: Some("a".to_string()),
        };

        let result = validate_layout_for_displays(&layout, &[active]);

        assert!(result.is_err());
    }

    #[test]
    fn rejects_unsupported_scale_change_by_mode_id() {
        let mut active = display("a");
        active.capabilities.scale = DisplayCapability::unsupported("read-only");
        let mut requested = layout_display("a", 0, 0);
        requested.mode_id = Some("a-mode-other".to_string());
        let layout = Layout {
            displays: vec![requested],
            primary_display_stable_id: Some("a".to_string()),
        };

        let result = validate_layout_for_displays(&layout, &[active]);

        assert!(result.is_err());
    }

    #[test]
    fn treats_legacy_macos_mode_id_as_current_mode_alias() {
        let mut active = display("a");
        active.mode_id = Some("macos-mode-98-2560x1440-2560x1440-180000".to_string());
        active.resolution = Size {
            width: 2560,
            height: 1440,
        };
        active.scale_factor = 1.0;

        let mut requested = layout_display("a", 0, 0);
        requested.mode_id = Some("macos-mode-98".to_string());
        requested.resolution = active.resolution;
        requested.scale_factor = active.scale_factor;

        assert!(!scale_changed(&requested, &active));
    }
}
