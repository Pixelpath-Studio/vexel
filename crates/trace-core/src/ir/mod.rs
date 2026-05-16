//! In-memory intermediate representation used by the converter and the streaming
//! `Session`. Lowered to bytes by `crate::serialize`.

pub mod bbox;
pub mod element;
pub mod path;

pub use bbox::{Point, Rect, Rgba, ViewBox};
pub use element::{Element, ElementFlags};
pub use path::{Path, Verb};

/// The full in-memory document. Owned by `Session` and by the converter.
#[derive(Debug, Clone)]
pub struct Ir {
    pub viewbox: ViewBox,
    pub elements: Vec<Element>,
    /// Unstructured key/value pairs serialized as the META section.
    pub metadata: Vec<(String, String)>,
}

impl Ir {
    pub fn new(viewbox: ViewBox) -> Self {
        Self {
            viewbox,
            elements: Vec::new(),
            metadata: Vec::new(),
        }
    }

    pub fn push_element(&mut self, el: Element) -> u32 {
        let idx = self.elements.len() as u32;
        self.elements.push(el);
        idx
    }

    pub fn set_metadata(&mut self, key: impl Into<String>, value: impl Into<String>) {
        let key = key.into();
        let value = value.into();
        if let Some(slot) = self.metadata.iter_mut().find(|(k, _)| k == &key) {
            slot.1 = value;
        } else {
            self.metadata.push((key, value));
        }
    }
}
