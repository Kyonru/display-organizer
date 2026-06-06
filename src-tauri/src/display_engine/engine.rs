use crate::display_engine::models::{ApplyLayoutResult, Display, Layout};
use crate::display_engine::validation::{
    normalize_primary_to_origin, reconcile_layout_with_display_capabilities,
    validate_layout_for_displays,
};
use crate::errors::AppError;
use crate::platform;

pub fn get_displays() -> Result<Vec<Display>, AppError> {
    platform::query_displays()
}

pub fn apply_layout(layout: &Layout) -> Result<ApplyLayoutResult, AppError> {
    let active_displays = get_displays()?;
    let reconciled = reconcile_layout_with_display_capabilities(layout, &active_displays);
    validate_layout_for_displays(&reconciled, &active_displays)?;
    let previous_layout = Layout::from(active_displays.as_slice());
    let normalized = normalize_primary_to_origin(&reconciled);

    let display_results = platform::apply_layout(&normalized, &active_displays)?;

    Ok(ApplyLayoutResult {
        applied: true,
        message: "Layout applied to macOS.".to_string(),
        previous_layout: Some(previous_layout),
        applied_layout: Some(normalized),
        display_results,
    })
}
