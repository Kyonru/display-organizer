use crate::display_engine::models::{ApplyDisplayChangeResult, Display, Layout};
use crate::errors::AppError;

#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(target_os = "macos")]
pub fn query_displays() -> Result<Vec<Display>, AppError> {
    macos::query_displays()
}

#[cfg(target_os = "macos")]
pub fn apply_layout(
    layout: &Layout,
    active_displays: &[Display],
) -> Result<Vec<ApplyDisplayChangeResult>, AppError> {
    macos::apply_layout(layout, active_displays)
}

#[cfg(not(target_os = "macos"))]
pub fn query_displays() -> Result<Vec<Display>, AppError> {
    Err(AppError::Display(
        "this MVP only supports macOS display APIs".to_string(),
    ))
}

#[cfg(not(target_os = "macos"))]
pub fn apply_layout(
    _layout: &Layout,
    _active_displays: &[Display],
) -> Result<Vec<ApplyDisplayChangeResult>, AppError> {
    Err(AppError::Display(
        "this MVP only supports macOS display APIs".to_string(),
    ))
}
