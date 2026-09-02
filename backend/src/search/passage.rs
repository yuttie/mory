use markdown::mdast::Node;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};

const TARGET_TOKENS: usize = 500;
const MAX_TOKENS: usize = 800;
const OVERLAP_TOKENS: usize = 80;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Passage {
    pub passage_id: String,
    pub start_byte: usize,
    pub end_byte: usize,
    pub start_line: usize,
    pub end_line: usize,
    pub heading: String,
    pub text: String,
    pub text_hash: String,
}

#[derive(Debug)]
struct Unit {
    start_byte: usize,
    end_byte: usize,
    start_line: usize,
    end_line: usize,
    heading: String,
    text: String,
}

pub fn passages(blob_id: &str, source: &str) -> Vec<Passage> {
    let mut options = markdown::ParseOptions::gfm();
    options.constructs.frontmatter = true;
    let Ok(Node::Root(root)) = markdown::to_mdast(source, &options) else {
        return fallback_passages(blob_id, source);
    };

    let mut units = Vec::new();
    let mut breadcrumbs: Vec<(u8, String)> = Vec::new();
    for node in &root.children {
        if matches!(node, Node::Yaml(_) | Node::Toml(_) | Node::ThematicBreak(_)) {
            continue;
        }
        if let Node::Heading(heading) = node {
            let title = node.to_string();
            breadcrumbs.retain(|(depth, _)| *depth < heading.depth);
            breadcrumbs.push((heading.depth, title));
        }
        let Some(position) = node.position() else {
            continue;
        };
        let text = node.to_string();
        if text.trim().is_empty() {
            continue;
        }
        units.push(Unit {
            start_byte: char_offset_to_byte(source, position.start.offset),
            end_byte: char_offset_to_byte(source, position.end.offset),
            start_line: position.start.line,
            end_line: position.end.line,
            heading: breadcrumbs
                .iter()
                .map(|(_, name)| name.as_str())
                .collect::<Vec<_>>()
                .join(" › "),
            text,
        });
    }
    if units.is_empty() {
        return fallback_passages(blob_id, source);
    }
    assemble(blob_id, units)
}

fn char_offset_to_byte(source: &str, offset: usize) -> usize {
    if source.is_char_boundary(offset) {
        return offset;
    }
    source
        .char_indices()
        .nth(offset)
        .map(|(index, _)| index)
        .unwrap_or(source.len())
}

fn approximate_tokens(text: &str) -> usize {
    let mut count = 0;
    let mut latin_run: usize = 0;
    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' {
            latin_run += 1;
        } else {
            count += latin_run.div_ceil(4);
            latin_run = 0;
            if !ch.is_whitespace() {
                count += 1;
            }
        }
    }
    count += latin_run.div_ceil(4);
    count.max(1)
}

fn assemble(blob_id: &str, units: Vec<Unit>) -> Vec<Passage> {
    let mut expanded = Vec::new();
    for unit in units {
        if approximate_tokens(&unit.text) <= MAX_TOKENS {
            expanded.push(unit);
            continue;
        }
        let words = word_spans(&unit.text);
        if words.len() <= MAX_TOKENS {
            // A delimiter-free Japanese paragraph (or a giant code token) has one whitespace
            // word but many search tokens. Split on Unicode scalar boundaries as a conservative
            // cap; this may produce smaller chunks for Latin text, never an oversized one.
            let chars = unit
                .text
                .char_indices()
                .map(|(index, _)| index)
                .chain(std::iter::once(unit.text.len()))
                .collect::<Vec<_>>();
            let step = MAX_TOKENS - OVERLAP_TOKENS;
            for start in (0..chars.len() - 1).step_by(step) {
                let end = (start + MAX_TOKENS).min(chars.len() - 1);
                expanded.push(split_unit(
                    &unit,
                    chars[start],
                    chars[end],
                    unit.text[chars[start]..chars[end]].to_owned(),
                ));
                if end == chars.len() - 1 {
                    break;
                }
            }
            continue;
        }
        let step = MAX_TOKENS - OVERLAP_TOKENS;
        for start in (0..words.len()).step_by(step) {
            let end = (start + MAX_TOKENS).min(words.len());
            let start_byte = words[start].0;
            let end_byte = words[end - 1].1;
            let text = words[start..end]
                .iter()
                .map(|(start, end)| &unit.text[*start..*end])
                .collect::<Vec<_>>()
                .join(" ");
            expanded.push(split_unit(&unit, start_byte, end_byte, text));
            if end == words.len() {
                break;
            }
        }
    }

    let mut result = Vec::new();
    let mut current: Vec<Unit> = Vec::new();
    let mut size = 0;
    for unit in expanded {
        let unit_size = approximate_tokens(&unit.text);
        if !current.is_empty() && size + unit_size > TARGET_TOKENS {
            result.push(make_passage(blob_id, &current));
            current.clear();
            size = 0;
        }
        size += unit_size;
        current.push(unit);
    }
    if !current.is_empty() {
        result.push(make_passage(blob_id, &current));
    }
    result
}

fn word_spans(text: &str) -> Vec<(usize, usize)> {
    let mut words = Vec::new();
    let mut start = None;
    for (offset, ch) in text.char_indices() {
        if ch.is_whitespace() {
            if let Some(start) = start.take() {
                words.push((start, offset));
            }
        } else if start.is_none() {
            start = Some(offset);
        }
    }
    if let Some(start) = start {
        words.push((start, text.len()));
    }
    words
}

fn split_unit(unit: &Unit, start: usize, end: usize, text: String) -> Unit {
    let start_line = unit.start_line + unit.text[..start].matches('\n').count();
    let end_line = start_line + unit.text[start..end].matches('\n').count();
    Unit {
        start_byte: (unit.start_byte + start).min(unit.end_byte),
        end_byte: (unit.start_byte + end).min(unit.end_byte),
        start_line,
        end_line,
        heading: unit.heading.clone(),
        text,
    }
}

fn make_passage(blob_id: &str, units: &[Unit]) -> Passage {
    let first = units.first().unwrap();
    let last = units.last().unwrap();
    let text = units
        .iter()
        .map(|unit| unit.text.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let text_hash = format!("{:x}", Sha1::digest(text.as_bytes()));
    let identity = format!(
        "{blob_id}:{}:{}:{text_hash}",
        first.start_byte, last.end_byte
    );
    Passage {
        passage_id: format!("{:x}", Sha1::digest(identity.as_bytes())),
        start_byte: first.start_byte,
        end_byte: last.end_byte,
        start_line: first.start_line,
        end_line: last.end_line,
        heading: last.heading.clone(),
        text,
        text_hash,
    }
}

fn fallback_passages(blob_id: &str, source: &str) -> Vec<Passage> {
    let unit = Unit {
        start_byte: 0,
        end_byte: source.len(),
        start_line: 1,
        end_line: source.lines().count().max(1),
        heading: String::new(),
        text: source.to_owned(),
    };
    assemble(blob_id, vec![unit])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_source_positions_and_heading_context() {
        let source = "---\ntags: [rust]\n---\n# Search\n\nFirst paragraph.\n\n## Index\n\nSecond paragraph.\n";
        let found = passages("blob", source);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].start_line, 4);
        assert_eq!(found[0].heading, "Search › Index");
        assert!(found[0].text.contains("Second paragraph"));
    }

    #[test]
    fn passage_identity_changes_with_content_not_ordinal() {
        let first = passages("blob", "# One\n\nText");
        let second = passages("blob", "# One\n\nChanged");
        assert_ne!(first[0].passage_id, second[0].passage_id);
    }

    #[test]
    fn delimiter_free_japanese_is_capped_and_overlapped() {
        let source = format!("# 長文\n\n{}", "検索".repeat(600));
        let found = passages("blob", &source);
        assert!(found.len() >= 2);
        assert!(found
            .iter()
            .all(|passage| passage.text.chars().count() <= MAX_TOKENS));
    }

    #[test]
    fn giant_code_tokens_are_split_conservatively() {
        let source = format!("```text\n{}\n```", "x".repeat(10_000));
        let found = passages("blob", &source);
        assert!(found.len() > 1);
        assert!(found
            .iter()
            .all(|passage| approximate_tokens(&passage.text) <= MAX_TOKENS));
    }
}
