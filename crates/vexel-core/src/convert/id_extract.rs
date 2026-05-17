//! Mermaid-aware id normalization — SPEC §4.4.
//!
//! Mermaid generates verbose ids like `flowchart-A-1` for node `A`. We want to
//! preserve those for round-trip with the source SVG but also let consumers
//! look up by the bare logical id. `normalize` returns the bare form when one
//! exists, so the caller can insert both into IDIX pointing at the same
//! element.
//!
//! TODO(week-3 of plan): the leading-direction patterns below were derived from
//! Mermaid 11.4 flowchart, sequence, class, and state outputs. Other diagram
//! types (ER, gantt, pie, mindmap) need empirical fixtures; extend the matcher
//! when those land.

/// Returns the normalized form of `id` if it matches a known Mermaid pattern.
/// Returns `None` when the id has no logical short form (caller inserts only
/// the raw id).
pub fn normalize(id: &str) -> Option<String> {
    // flowchart-X-N → X (X may contain hyphens? Mermaid uses alnum + underscore.)
    if let Some(rest) = id.strip_prefix("flowchart-") {
        // Strip trailing -N (one or more digits).
        if let Some(dash) = rest.rfind('-') {
            let (head, tail) = rest.split_at(dash);
            if tail[1..].chars().all(|c| c.is_ascii_digit()) && !head.is_empty() {
                return Some(head.to_owned());
            }
        }
    }

    // L_A_B_N or L-A-B-N → A->B (edge labels).
    for sep in ['_', '-'] {
        if let Some(rest) = id.strip_prefix("L").and_then(|s| s.strip_prefix(sep)) {
            let parts: Vec<&str> = rest.split(sep).collect();
            if parts.len() >= 3 {
                // Last part should be a digit-only suffix.
                if parts.last().unwrap().chars().all(|c| c.is_ascii_digit()) {
                    let a = parts[0];
                    let b = parts[1..parts.len() - 1].join(&sep.to_string());
                    if !a.is_empty() && !b.is_empty() {
                        return Some(format!("{a}->{b}"));
                    }
                }
            }
        }
    }

    // Sequence diagram: `actor0`, `note1` → kept as-is. No normalization yet.
    // Class/state diagram: `classGroup-Foo` → `Foo` (same shape as flowchart).
    if let Some(rest) = id.strip_prefix("classGroup-") {
        if !rest.is_empty() {
            return Some(rest.to_owned());
        }
    }
    if let Some(rest) = id.strip_prefix("state-") {
        if let Some(dash) = rest.rfind('-') {
            let (head, tail) = rest.split_at(dash);
            if tail[1..].chars().all(|c| c.is_ascii_digit()) && !head.is_empty() {
                return Some(head.to_owned());
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::normalize;

    #[test]
    fn flowchart_node() {
        assert_eq!(normalize("flowchart-A-1").as_deref(), Some("A"));
        assert_eq!(normalize("flowchart-Foo-12").as_deref(), Some("Foo"));
    }

    #[test]
    fn flowchart_edge() {
        assert_eq!(normalize("L_A_B_0").as_deref(), Some("A->B"));
        assert_eq!(normalize("L-A-B-0").as_deref(), Some("A->B"));
        assert_eq!(normalize("L_Start_End_3").as_deref(), Some("Start->End"));
    }

    #[test]
    fn class_state() {
        assert_eq!(normalize("classGroup-MyClass").as_deref(), Some("MyClass"));
        assert_eq!(normalize("state-Idle-0").as_deref(), Some("Idle"));
    }

    #[test]
    fn unknown_passes_through() {
        assert_eq!(normalize("my-custom-id"), None);
        assert_eq!(normalize("button"), None);
        assert_eq!(normalize(""), None);
    }
}
