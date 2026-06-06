use std::collections::HashSet;

use crate::display_engine::models::{Display, Layout, Point};
use crate::errors::AppError;

pub fn validate_layout_for_displays(layout: &Layout, active_displays: &[Display]) -> Result<(), AppError> {
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

    Ok(())
}

pub fn normalize_primary_to_origin(layout: &Layout) -> Layout {
    let primary_id = layout
        .primary_display_stable_id
        .as_deref()
        .or_else(|| layout.displays.first().map(|display| display.stable_id.as_str()));

    let primary_position = primary_id
        .and_then(|id| layout.displays.iter().find(|display| display.stable_id == id))
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
        Display, DisplayConnectionType, DisplayRotation, Layout, LayoutDisplay, Point, Rect, Size,
    };

    use super::{normalize_primary_to_origin, validate_layout_for_displays};

    fn display(id: &str) -> Display {
        Display {
            id: id.to_string(),
            stable_id: Some(id.to_string()),
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
        }
    }

    fn layout_display(id: &str, x: i32, y: i32) -> LayoutDisplay {
        LayoutDisplay {
            stable_id: id.to_string(),
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
}
