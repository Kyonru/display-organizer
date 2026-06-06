use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Size {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DisplayCapability {
    pub supported: bool,
    pub reason: Option<String>,
}

impl DisplayCapability {
    pub fn supported() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DisplayCapabilities {
    pub position: DisplayCapability,
    pub primary: DisplayCapability,
    pub rotation: DisplayCapability,
    pub scale: DisplayCapability,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DisplayScaleOption {
    pub id: String,
    pub label: String,
    pub scale_factor: f64,
    pub resolution: Size,
    pub refresh_rate: Option<f64>,
    pub is_current: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum DisplayRotation {
    #[serde(rename = "0")]
    Deg0,
    #[serde(rename = "90")]
    Deg90,
    #[serde(rename = "180")]
    Deg180,
    #[serde(rename = "270")]
    Deg270,
}

impl DisplayRotation {
    pub fn from_degrees(value: f64) -> Self {
        match value.round() as i32 {
            90 => Self::Deg90,
            180 => Self::Deg180,
            270 => Self::Deg270,
            _ => Self::Deg0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum DisplayConnectionType {
    Internal,
    Hdmi,
    Displayport,
    UsbC,
    Thunderbolt,
    Virtual,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub id: String,
    pub stable_id: Option<String>,
    pub mode_id: Option<String>,
    pub name: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub serial_number: Option<String>,
    pub resolution: Size,
    pub refresh_rate: Option<f64>,
    pub scale_factor: f64,
    pub position: Point,
    pub rotation: DisplayRotation,
    pub is_primary: bool,
    pub is_internal: bool,
    pub connection_type: Option<DisplayConnectionType>,
    pub bounds: Rect,
    pub capabilities: DisplayCapabilities,
    pub scale_options: Vec<DisplayScaleOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayoutDisplay {
    pub stable_id: String,
    #[serde(default)]
    pub mode_id: Option<String>,
    pub position: Point,
    pub resolution: Size,
    pub refresh_rate: Option<f64>,
    pub scale_factor: f64,
    pub rotation: DisplayRotation,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub displays: Vec<LayoutDisplay>,
    pub primary_display_stable_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayoutProfile {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub layout: Layout,
    pub detection_rules: Vec<serde_json::Value>,
    pub hotkey: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_applied_at: Option<String>,
    pub metadata: ProfileMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMetadata {
    pub app_version: String,
    pub platform_created_on: PlatformName,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PlatformName {
    Macos,
    Windows,
    Linux,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutProfileDraft {
    pub name: String,
    pub description: Option<String>,
    pub layout: Layout,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyLayoutResult {
    pub applied: bool,
    pub message: String,
    pub previous_layout: Option<Layout>,
    pub applied_layout: Option<Layout>,
    #[serde(default)]
    pub display_results: Vec<ApplyDisplayChangeResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyDisplayChangeResult {
    pub stable_id: String,
    pub status: ApplyDisplayChangeStatus,
    pub message: String,
    pub applied: AppliedDisplayChanges,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ApplyDisplayChangeStatus {
    Applied,
    Skipped,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppliedDisplayChanges {
    pub position: bool,
    pub primary: bool,
    pub rotation: bool,
    pub scale: bool,
}

impl From<&Display> for LayoutDisplay {
    fn from(value: &Display) -> Self {
        Self {
            stable_id: value.stable_id.clone().unwrap_or_else(|| value.id.clone()),
            mode_id: value.mode_id.clone().or_else(|| {
                value
                    .scale_options
                    .iter()
                    .find(|option| option.is_current)
                    .map(|option| option.id.clone())
            }),
            position: value.position,
            resolution: value.resolution,
            refresh_rate: value.refresh_rate,
            scale_factor: value.scale_factor,
            rotation: value.rotation,
            enabled: true,
        }
    }
}

impl From<&[Display]> for Layout {
    fn from(displays: &[Display]) -> Self {
        Self {
            displays: displays.iter().map(LayoutDisplay::from).collect(),
            primary_display_stable_id: displays
                .iter()
                .find(|display| display.is_primary)
                .and_then(|display| display.stable_id.clone())
                .or_else(|| {
                    displays
                        .iter()
                        .find(|display| display.is_primary)
                        .map(|display| display.id.clone())
                }),
        }
    }
}
