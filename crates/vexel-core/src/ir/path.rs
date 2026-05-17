use super::bbox::Point;

/// Path verbs, matching the wire encoding in SPEC §3.4.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Verb {
    Move = 1,
    Line = 2,
    Quad = 3,
    Cubic = 4,
    Close = 5,
}

impl Verb {
    pub fn from_u8(v: u8) -> Option<Verb> {
        match v {
            1 => Some(Verb::Move),
            2 => Some(Verb::Line),
            3 => Some(Verb::Quad),
            4 => Some(Verb::Cubic),
            5 => Some(Verb::Close),
            _ => None,
        }
    }

    /// Number of points consumed by this verb.
    pub fn point_count(&self) -> usize {
        match self {
            Verb::Move | Verb::Line => 1,
            Verb::Quad => 2,
            Verb::Cubic => 3,
            Verb::Close => 0,
        }
    }
}

/// A path as a flat verb stream plus a flat point array, matching the wire
/// encoding so serialization can copy directly.
#[derive(Debug, Clone, Default)]
pub struct Path {
    pub verbs: Vec<Verb>,
    pub points: Vec<Point>,
}

impl Path {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn move_to(&mut self, x: f32, y: f32) {
        self.verbs.push(Verb::Move);
        self.points.push(Point::new(x, y));
    }

    pub fn line_to(&mut self, x: f32, y: f32) {
        self.verbs.push(Verb::Line);
        self.points.push(Point::new(x, y));
    }

    pub fn quad_to(&mut self, cx: f32, cy: f32, x: f32, y: f32) {
        self.verbs.push(Verb::Quad);
        self.points.push(Point::new(cx, cy));
        self.points.push(Point::new(x, y));
    }

    pub fn cubic_to(&mut self, c1x: f32, c1y: f32, c2x: f32, c2y: f32, x: f32, y: f32) {
        self.verbs.push(Verb::Cubic);
        self.points.push(Point::new(c1x, c1y));
        self.points.push(Point::new(c2x, c2y));
        self.points.push(Point::new(x, y));
    }

    pub fn close(&mut self) {
        self.verbs.push(Verb::Close);
    }

    pub fn verb_count(&self) -> u32 {
        self.verbs.len() as u32
    }

    pub fn point_count(&self) -> u32 {
        self.points.len() as u32
    }
}
