use super::{
    bbox::{Rect, Rgba},
    path::Path,
};

/// Per-element flag bits, matching SPEC §3.4 exactly. Wire encoding is one byte.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ElementFlags(pub u8);

impl ElementFlags {
    pub const EVENODD: u8 = 1 << 0;
    pub const VISIBLE_PAINTED: u8 = 1 << 1;
    pub const VISIBLE_STROKE: u8 = 1 << 2;
    pub const VISIBLE_FILL: u8 = 1 << 3;
    pub const IS_DECORATIVE: u8 = 1 << 4;
    pub const LINECAP_ROUND: u8 = 1 << 5;
    pub const LINEJOIN_ROUND: u8 = 1 << 6;

    pub fn evenodd(self) -> bool {
        (self.0 & Self::EVENODD) != 0
    }
    pub fn visible_painted(self) -> bool {
        (self.0 & Self::VISIBLE_PAINTED) != 0
    }
    pub fn visible_stroke(self) -> bool {
        (self.0 & Self::VISIBLE_STROKE) != 0
    }
    pub fn visible_fill(self) -> bool {
        (self.0 & Self::VISIBLE_FILL) != 0
    }
    pub fn is_decorative(self) -> bool {
        (self.0 & Self::IS_DECORATIVE) != 0
    }
    pub fn linecap_round(self) -> bool {
        (self.0 & Self::LINECAP_ROUND) != 0
    }
    pub fn linejoin_round(self) -> bool {
        (self.0 & Self::LINEJOIN_ROUND) != 0
    }
}

/// In-memory element. Mirrors the wire-format `Element` from SPEC §3.4 but stores
/// an optional id alongside (ids live in STRS on the wire and are tracked separately
/// in IDIX; the IR holds them here for ergonomics during construction).
#[derive(Debug, Clone)]
pub struct Element {
    pub id: Option<String>,
    pub bbox: Rect,
    pub fill: Rgba,
    pub stroke: Rgba,
    pub stroke_width: f32,
    pub flags: ElementFlags,
    /// 0xFF means "not text"; otherwise an index into a text run table (post-v1.0).
    pub text_run_idx: u8,
    /// 0 means "no preference"; non-zero is a layer-batching hint.
    pub layer_hint: u16,
    pub path: Path,
}

impl Default for Element {
    fn default() -> Self {
        Self {
            id: None,
            bbox: Rect::EMPTY,
            fill: Rgba::TRANSPARENT,
            stroke: Rgba::TRANSPARENT,
            stroke_width: 0.0,
            flags: ElementFlags::default(),
            text_run_idx: 0xFF,
            layer_hint: 0,
            path: Path::default(),
        }
    }
}
