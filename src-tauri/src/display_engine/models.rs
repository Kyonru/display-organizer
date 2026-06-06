use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;

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

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DisplayRotation {
    Deg0,
    Deg90,
    Deg180,
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

    pub fn degrees(self) -> u16 {
        match self {
            Self::Deg0 => 0,
            Self::Deg90 => 90,
            Self::Deg180 => 180,
            Self::Deg270 => 270,
        }
    }

    fn from_degrees_strict(value: i64) -> Option<Self> {
        match value {
            0 => Some(Self::Deg0),
            90 => Some(Self::Deg90),
            180 => Some(Self::Deg180),
            270 => Some(Self::Deg270),
            _ => None,
        }
    }
}

impl Serialize for DisplayRotation {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u16(self.degrees())
    }
}

impl<'de> Deserialize<'de> for DisplayRotation {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(DisplayRotationVisitor)
    }
}

struct DisplayRotationVisitor;

impl Visitor<'_> for DisplayRotationVisitor {
    type Value = DisplayRotation;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a display rotation of 0, 90, 180, or 270 degrees")
    }

    fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        DisplayRotation::from_degrees_strict(value)
            .ok_or_else(|| E::custom(format!("unsupported display rotation {value}")))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        let value = i64::try_from(value)
            .map_err(|_| E::custom(format!("unsupported display rotation {value}")))?;
        self.visit_i64(value)
    }

    fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        if value.fract() != 0.0 {
            return Err(E::custom(format!("unsupported display rotation {value}")));
        }

        self.visit_i64(value as i64)
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        let parsed = value
            .parse::<i64>()
            .map_err(|_| E::custom(format!("unsupported display rotation {value}")))?;
        self.visit_i64(parsed)
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRuleMatch {
    #[serde(default)]
    pub display_stable_ids: Vec<String>,
    #[serde(default)]
    pub display_count: Option<usize>,
    #[serde(default)]
    pub require_internal: Option<bool>,
    #[serde(default)]
    pub require_external: Option<bool>,
    #[serde(default)]
    pub dock_signature: Option<String>,
    #[serde(default)]
    pub platform: Option<PlatformName>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRule {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub profile_id: String,
    #[serde(rename = "match")]
    pub match_config: AutomationRuleMatch,
    pub created_at: String,
    pub updated_at: String,
    pub last_triggered_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRuleDraft {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub enabled: bool,
    pub profile_id: String,
    #[serde(rename = "match")]
    pub match_config: AutomationRuleMatch,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationMatchResult {
    pub rule: AutomationRule,
    pub profile_name: String,
    pub score: u32,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationEvaluation {
    pub matches: Vec<AutomationMatchResult>,
    pub evaluated_at: String,
    pub display_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationEvent {
    pub id: String,
    pub rule_id: Option<String>,
    pub profile_id: Option<String>,
    pub event_type: AutomationEventType,
    pub message: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AutomationEventType {
    Matched,
    Applied,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryState {
    pub id: String,
    pub previous_layout: Layout,
    pub applied_layout: Option<Layout>,
    pub created_at: String,
    pub expires_at: String,
    pub message: String,
    #[serde(default)]
    pub display_results: Vec<ApplyDisplayChangeResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsProfileSummary {
    pub id: String,
    pub name: String,
    pub display_count: usize,
    pub updated_at: String,
    pub last_applied_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsDisplaySnapshot {
    pub stable_id_hash: String,
    pub name: String,
    pub resolution: Size,
    pub refresh_rate: Option<f64>,
    pub scale_factor: f64,
    pub position: Point,
    pub rotation: DisplayRotation,
    pub is_primary: bool,
    pub is_internal: bool,
    pub capabilities: DisplayCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsBundle {
    pub app_version: String,
    pub generated_at: String,
    pub platform: PlatformName,
    pub displays: Vec<DiagnosticsDisplaySnapshot>,
    pub profiles: Vec<DiagnosticsProfileSummary>,
    pub automation_rules: Vec<AutomationRule>,
    pub recent_events: Vec<AutomationEvent>,
    pub recovery_state: Option<RecoveryState>,
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

#[cfg(test)]
mod tests {
    use super::DisplayRotation;

    #[test]
    fn display_rotation_accepts_numeric_json() {
        let rotation = serde_json::from_str::<DisplayRotation>("90").unwrap();

        assert_eq!(rotation, DisplayRotation::Deg90);
    }

    #[test]
    fn display_rotation_accepts_legacy_string_json() {
        let rotation = serde_json::from_str::<DisplayRotation>("\"270\"").unwrap();

        assert_eq!(rotation, DisplayRotation::Deg270);
    }

    #[test]
    fn display_rotation_serializes_as_number() {
        let value = serde_json::to_string(&DisplayRotation::Deg180).unwrap();

        assert_eq!(value, "180");
    }
}
