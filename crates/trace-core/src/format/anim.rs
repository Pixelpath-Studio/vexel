//! ANIM — animation tracks — SPEC §3.9.
//!
//! Wire layout:
//!   track_count u32
//!   tracks      track_count × {
//!     element_index u32
//!     type          u8       (1=stroke_draw, 2=fill_fade, 3=appear,
//!                              4=opacity_to, 5=transform_to, 6=remove)
//!     start_ms      u32
//!     duration_ms   u32
//!     easing        u8       (0=linear, 1=ease-out, 2=ease-in-out, 3=hand-natural)
//!     payload_len   u16
//!     payload       payload_len bytes
//!     _pad          align(4)
//!   }
//!
//! Tracks are stored sorted by `start_ms` for monotonic playback.

use crate::error::{Result, TraceError};
use byteorder::{ByteOrder, LittleEndian as LE};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum TrackType {
    StrokeDraw = 1,
    FillFade = 2,
    Appear = 3,
    OpacityTo = 4,
    TransformTo = 5,
    Remove = 6,
}

impl TrackType {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            1 => Some(Self::StrokeDraw),
            2 => Some(Self::FillFade),
            3 => Some(Self::Appear),
            4 => Some(Self::OpacityTo),
            5 => Some(Self::TransformTo),
            6 => Some(Self::Remove),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Easing {
    Linear = 0,
    EaseOut = 1,
    EaseInOut = 2,
    HandNatural = 3,
}

impl Easing {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Linear),
            1 => Some(Self::EaseOut),
            2 => Some(Self::EaseInOut),
            3 => Some(Self::HandNatural),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct AnimTrack {
    pub element_index: u32,
    pub track_type: TrackType,
    pub start_ms: u32,
    pub duration_ms: u32,
    pub easing: Easing,
    pub payload: Vec<u8>,
}

const TRACK_HEADER_SIZE: usize = 4 + 1 + 4 + 4 + 1 + 2; // 16

pub fn serialize(tracks: &[AnimTrack]) -> Vec<u8> {
    // Tracks must be sorted by start_ms on the wire.
    let mut sorted: Vec<&AnimTrack> = tracks.iter().collect();
    sorted.sort_by_key(|t| t.start_ms);

    let mut out = Vec::with_capacity(4 + sorted.len() * 32);
    let mut count = [0u8; 4];
    LE::write_u32(&mut count, sorted.len() as u32);
    out.extend_from_slice(&count);

    for t in sorted {
        let start = out.len();
        out.resize(start + TRACK_HEADER_SIZE, 0);
        let b = &mut out[start..start + TRACK_HEADER_SIZE];
        LE::write_u32(&mut b[0..4], t.element_index);
        b[4] = t.track_type as u8;
        LE::write_u32(&mut b[5..9], t.start_ms);
        LE::write_u32(&mut b[9..13], t.duration_ms);
        b[13] = t.easing as u8;
        LE::write_u16(&mut b[14..16], t.payload.len() as u16);
        out.extend_from_slice(&t.payload);
        while out.len() % 4 != 0 {
            out.push(0);
        }
    }
    out
}

#[derive(Debug, Clone, Copy)]
pub struct Anim<'a> {
    bytes: &'a [u8],
    count: u32,
}

impl<'a> Anim<'a> {
    pub fn new(bytes: &'a [u8]) -> Result<Self> {
        if bytes.len() < 4 {
            return Err(TraceError::InvalidFile("ANIM header truncated"));
        }
        Ok(Self {
            bytes,
            count: LE::read_u32(&bytes[0..4]),
        })
    }

    pub fn count(&self) -> u32 {
        self.count
    }

    pub fn iter(&self) -> AnimIter<'a> {
        AnimIter {
            bytes: self.bytes,
            cursor: 4,
            remaining: self.count,
        }
    }
}

pub struct AnimIter<'a> {
    bytes: &'a [u8],
    cursor: usize,
    remaining: u32,
}

impl<'a> Iterator for AnimIter<'a> {
    type Item = Result<AnimTrack>;
    fn next(&mut self) -> Option<Self::Item> {
        if self.remaining == 0 {
            return None;
        }
        self.remaining -= 1;
        let start = self.cursor;
        if start + TRACK_HEADER_SIZE > self.bytes.len() {
            return Some(Err(TraceError::InvalidFile("ANIM track header truncated")));
        }
        let b = &self.bytes[start..start + TRACK_HEADER_SIZE];
        let element_index = LE::read_u32(&b[0..4]);
        let track_type = match TrackType::from_u8(b[4]) {
            Some(t) => t,
            None => return Some(Err(TraceError::InvalidFile("unknown ANIM track type"))),
        };
        let start_ms = LE::read_u32(&b[5..9]);
        let duration_ms = LE::read_u32(&b[9..13]);
        let easing = match Easing::from_u8(b[13]) {
            Some(e) => e,
            None => return Some(Err(TraceError::InvalidFile("unknown ANIM easing"))),
        };
        let payload_len = LE::read_u16(&b[14..16]) as usize;
        let payload_start = start + TRACK_HEADER_SIZE;
        let payload_end = payload_start + payload_len;
        if payload_end > self.bytes.len() {
            return Some(Err(TraceError::InvalidFile("ANIM payload truncated")));
        }
        let payload = self.bytes[payload_start..payload_end].to_vec();
        let mut next = payload_end;
        while next % 4 != 0 {
            next += 1;
        }
        self.cursor = next;
        Some(Ok(AnimTrack {
            element_index,
            track_type,
            start_ms,
            duration_ms,
            easing,
            payload,
        }))
    }
}
