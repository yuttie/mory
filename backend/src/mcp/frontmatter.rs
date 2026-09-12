//! Editing a note's YAML frontmatter in place, one key at a time.
//!
//! The obvious implementation -- parse the block, change the value, serialize it back -- was
//! measured against the real repository and rejected. Of the 952 notes carrying frontmatter, a
//! `serde_yaml` round-trip reproduces 61 byte for byte. A post-processor tuned to the house style
//! (four-space nesting, sequences indented under their key, an empty value left empty rather than
//! spelled `null`) reaches 494. The remaining 458 cannot be reached at all, because what they
//! lose is not formatting: comments are dropped, block scalars are reflowed, and flow-style
//! entries such as `{ start: 2025-10-06 13:00, end: +1.5h }` are expanded. One real note keeps a
//! commented-out list of candidate interview dates directly under its `events:` block; a
//! round-trip deletes it. "The notes must outlive the app" is not compatible with rewriting nine
//! notes in ten every time a task's progress changes.
//!
//! So the edit is textual: find the key's line, change that line, leave every other byte alone.
//! Text manipulation being what it is, the result is then checked against an oracle --
//! `serde_yaml` parses both the intended result and the edited text, and the edit is refused
//! unless they are the same value. `serde_yaml` decides what the file *means*; the text decides
//! what it *looks like*, and neither is trusted on its own.

use serde_yaml::{Mapping, Value};

/// The default indentation for a level the note does not already demonstrate.
const DEFAULT_INDENT: usize = 4;

/// A note split into its frontmatter and its body.
#[derive(Debug, Clone)]
pub struct Note {
    /// The YAML between the fences, fence lines excluded. Always ends in a newline when
    /// non-empty.
    pub block: String,
    /// Everything after the closing fence.
    pub body: String,
    /// False when the note had no frontmatter at all, so rendering knows whether adding one is a
    /// change to the body's leading whitespace.
    had_frontmatter: bool,
}

impl Note {
    /// Split `text` at its frontmatter fences.
    ///
    /// A note with no frontmatter is all body, which is the ordinary case for a note that has
    /// never carried tags or a task.
    pub fn parse(text: &str) -> Self {
        let Some(rest) = text.strip_prefix("---\n") else {
            return Self {
                block: String::new(),
                body: text.to_owned(),
                had_frontmatter: false,
            };
        };
        // The closing fence is a line that is exactly `---` or `...`.
        let mut offset = 0;
        for line in rest.split_inclusive('\n') {
            let trimmed = line.strip_suffix('\n').unwrap_or(line);
            if trimmed == "---" || trimmed == "..." {
                return Self {
                    block: rest[..offset].to_owned(),
                    body: rest[offset + line.len()..].to_owned(),
                    had_frontmatter: true,
                };
            }
            offset += line.len();
        }
        // An unterminated fence is not frontmatter; treat the whole file as body rather than
        // guessing where the author meant it to end.
        Self {
            block: String::new(),
            body: text.to_owned(),
            had_frontmatter: false,
        }
    }

    pub fn render(&self) -> String {
        if self.block.trim().is_empty() {
            return self.body.clone();
        }
        let mut block = self.block.clone();
        if !block.is_empty() && !block.ends_with('\n') {
            block.push('\n');
        }
        // A note that is *gaining* frontmatter needs a blank line before its heading, which is
        // how every note in the repository is written. One that already had frontmatter keeps
        // whatever separator it already had.
        let body = if self.had_frontmatter || self.body.starts_with('\n') || self.body.is_empty() {
            self.body.clone()
        }
        else {
            format!("\n{}", self.body)
        };
        format!("---\n{block}---\n{body}")
    }
}

/// One change to a note's frontmatter.
#[derive(Debug, Clone)]
pub enum Change {
    /// Set the key at `path`, creating the mappings above it if they are missing.
    Set { path: Vec<String>, value: Value },
    /// Remove the key at `path`. Removing something absent is not an error.
    Remove { path: Vec<String> },
}

impl Change {
    pub fn set(path: &[&str], value: impl Into<Value>) -> Self {
        Self::Set {
            path: path.iter().map(|part| (*part).to_owned()).collect(),
            value: value.into(),
        }
    }

    pub fn remove(path: &[&str]) -> Self {
        Self::Remove {
            path: path.iter().map(|part| (*part).to_owned()).collect(),
        }
    }

    fn path(&self) -> &[String] {
        match self {
            Change::Set { path, .. } | Change::Remove { path } => path,
        }
    }
}

/// Why an edit was refused, in words a model can act on.
#[derive(Debug)]
pub struct EditError(pub String);

impl std::fmt::Display for EditError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

fn refuse(message: impl Into<String>) -> EditError {
    EditError(message.into())
}

/// Apply `changes` to `text`'s frontmatter and return the whole note.
pub fn apply(text: &str, changes: &[Change]) -> Result<String, EditError> {
    let mut note = Note::parse(text);

    let before: Value = if note.block.trim().is_empty() {
        Value::Mapping(Mapping::new())
    }
    else {
        serde_yaml::from_str(&note.block)
            .map_err(|e| refuse(format!("the note's frontmatter is not valid YAML: {e}")))?
    };
    let before = match before {
        Value::Mapping(mapping) => mapping,
        Value::Null => Mapping::new(),
        _ => return Err(refuse("the note's frontmatter is not a mapping")),
    };

    // A change the note already satisfies is dropped before any text is touched. Without this a
    // no-op set still rewrites its line, and rewriting a `note: |` block scalar as a quoted
    // one-liner is a change the oracle cannot object to -- it means the same thing -- but which
    // the author would not recognise as their file.
    let changes = changes
        .iter()
        .filter(|change| !already_satisfied(&before, change))
        .cloned()
        .collect::<Vec<_>>();
    if changes.is_empty() {
        return Ok(text.to_owned());
    }

    // What the result must mean, computed in memory and never written out.
    let expected = expected_value(&before, &changes)?;

    let mut lines = block_lines(&note.block);
    let step = detect_indent(&lines);
    for change in &changes {
        apply_one(&mut lines, step, change)?;
    }
    let edited = lines.join("");

    // The oracle. A textual edit that parses to anything other than the intended value is a bug
    // in this module, and a bug here would quietly corrupt a note.
    let actual: Value = if edited.trim().is_empty() {
        Value::Mapping(Mapping::new())
    }
    else {
        serde_yaml::from_str(&edited).map_err(|e| {
            refuse(format!(
                "editing this note's frontmatter would have made it invalid YAML ({e}); \
                 nothing was written. Use update_note to rewrite the file instead.",
            ))
        })?
    };
    let actual = match actual {
        Value::Mapping(mapping) => mapping,
        Value::Null => Mapping::new(),
        _ => return Err(refuse("the edited frontmatter is not a mapping")),
    };
    if actual != expected {
        return Err(refuse(
            "this note's frontmatter is shaped in a way the in-place editor cannot change \
             safely, so nothing was written. Use read_note and update_note to rewrite the file \
             yourself.",
        ));
    }

    // `had_frontmatter` deliberately keeps its original value: `render` uses it to decide
    // whether the body needs a blank line put in front of a heading that never had one.
    note.block = edited;
    Ok(note.render())
}

/// Whether the note already says what the change asks for.
fn already_satisfied(before: &Mapping, change: &Change) -> bool {
    let path = change.path();
    let Some((last, parents)) = path.split_last() else {
        return false;
    };
    let mut cursor = before;
    for part in parents {
        match cursor.get(Value::String(part.clone())) {
            Some(Value::Mapping(next)) => cursor = next,
            // A missing parent means a Set has work to do and a Remove does not.
            _ => return matches!(change, Change::Remove { .. }),
        }
    }
    let existing = cursor.get(Value::String(last.clone()));
    match change {
        Change::Set { value, .. } => existing == Some(value),
        Change::Remove { .. } => existing.is_none(),
    }
}

/// The mapping the edited block must parse to.
fn expected_value(before: &Mapping, changes: &[Change]) -> Result<Mapping, EditError> {
    let mut result = before.clone();
    for change in changes {
        let path = change.path();
        let Some((last, parents)) = path.split_last() else {
            return Err(refuse("a frontmatter change needs a key to change"));
        };

        // Removing a key under a parent that does not exist is already done, and must not
        // create the parent on its way to discovering that.
        if matches!(change, Change::Remove { .. }) {
            let mut cursor = &result;
            let mut missing = false;
            for part in parents {
                match cursor.get(Value::String(part.clone())) {
                    Some(Value::Mapping(next)) => cursor = next,
                    _ => {
                        missing = true;
                        break;
                    },
                }
            }
            if missing {
                continue;
            }
        }

        let mut cursor = &mut result;
        for part in parents {
            let key = Value::String(part.clone());
            // A missing or empty level becomes a mapping; `events:` with nothing under it is the
            // ordinary state of a note that has never had an event.
            let entry = cursor.entry(key.clone()).or_insert(Value::Null);
            if matches!(entry, Value::Null) {
                *entry = Value::Mapping(Mapping::new());
            }
            let Value::Mapping(next) = entry else {
                return Err(refuse(format!(
                    "`{part}` in this note's frontmatter is not a mapping, so `{}` cannot be \
                     set under it",
                    path.join("."),
                )));
            };
            cursor = next;
        }

        match change {
            Change::Set { value, .. } => {
                cursor.insert(Value::String(last.clone()), value.clone());
            },
            Change::Remove { .. } => {
                cursor.remove(Value::String(last.clone()));
            },
        }
    }
    Ok(result)
}

// ---------------------------------------------------------------------------------------------
// The textual engine
// ---------------------------------------------------------------------------------------------

/// The block as lines, each keeping its own newline so joining is lossless.
fn block_lines(block: &str) -> Vec<String> {
    block.split_inclusive('\n').map(str::to_owned).collect()
}

fn indent_of(line: &str) -> usize {
    line.len() - line.trim_start().len()
}

/// Whether a line carries no structure of its own, so it belongs to whatever surrounds it.
fn is_filler(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.is_empty() || trimmed.starts_with('#')
}

/// The note's own step for a *new* level of nesting.
///
/// Only mapping-under-mapping transitions count. A note that indents its sequences by two and
/// its mappings by four -- which real notes do -- would otherwise teach this the wrong number,
/// and the levels that already exist are measured directly anyway.
fn detect_indent(lines: &[String]) -> usize {
    let mut previous = None;
    for line in lines {
        if is_filler(line) {
            continue;
        }
        let indent = indent_of(line);
        if let Some(previous) = previous {
            if indent > previous && !line.trim_start().starts_with("- ") {
                return indent - previous;
            }
        }
        previous = Some(indent);
    }
    DEFAULT_INDENT
}

/// The key a line declares, or `None` when it declares none.
///
/// The key is parsed rather than compared as text, so a quoted key matches the name it spells.
fn key_of(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    if is_filler(line) || trimmed.starts_with('-') {
        return None;
    }
    // Find the `:` that ends the key: either at the end of the line or followed by whitespace.
    let bytes = trimmed.as_bytes();
    let mut quote: Option<u8> = None;
    for (i, &byte) in bytes.iter().enumerate() {
        match quote {
            Some(open) if byte == open => quote = None,
            Some(_) => {},
            None if byte == b'"' || byte == b'\'' => quote = Some(byte),
            None if byte == b':' => {
                let ends_key = bytes.get(i + 1).is_none_or(|next| next.is_ascii_whitespace());
                if ends_key {
                    let raw = &trimmed[..i];
                    return serde_yaml::from_str::<Value>(raw)
                        .ok()
                        .and_then(|value| match value {
                            Value::String(key) => Some(key),
                            other => serde_yaml::to_string(&other)
                                .ok()
                                .map(|text| text.trim().to_owned()),
                        });
                }
            },
            None => {},
        }
    }
    None
}

/// The half-open range of lines belonging to the mapping nested under `lines[at]`.
///
/// Trailing filler is left outside the range, so a comment that separates two blocks stays where
/// the author put it rather than being swept into the one above.
fn child_range(lines: &[String], at: usize) -> (usize, usize) {
    let parent = indent_of(&lines[at]);
    let mut end = at + 1;
    let mut last_real = at + 1;
    while end < lines.len() {
        if is_filler(&lines[end]) {
            end += 1;
            continue;
        }
        if indent_of(&lines[end]) <= parent {
            break;
        }
        end += 1;
        last_real = end;
    }
    (at + 1, last_real)
}

/// Where `key` is declared within `[from, to)` at exactly `indent`.
fn find_key(lines: &[String], from: usize, to: usize, indent: usize, key: &str) -> Option<usize> {
    (from..to).find(|&i| {
        !is_filler(&lines[i])
            && indent_of(&lines[i]) == indent
            && key_of(&lines[i]).as_deref() == Some(key)
    })
}

/// Whether a key line's value continues onto following lines rather than sitting on the line.
fn inline_value(line: &str) -> Option<&str> {
    let trimmed = line.trim_start().trim_end_matches('\n').trim_end();
    let colon = trimmed.find(": ").map(|i| i + 1).or_else(|| {
        trimmed.ends_with(':').then_some(trimmed.len() - 1)
    })?;
    Some(trimmed[colon + 1..].trim_start())
}

fn apply_one(
    lines: &mut Vec<String>,
    default_step: usize,
    change: &Change,
) -> Result<(), EditError> {
    let path = change.path();
    let Some((last, parents)) = path.split_last() else {
        return Err(refuse("a frontmatter change needs a key to change"));
    };

    // Descend to the mapping that holds `last`, creating levels that are missing.
    //
    // `level` is the indentation keys actually sit at in the current range, read off the note
    // rather than computed: a note that indents one level by two spaces and the next by four is
    // still a note, and guessing a single step for the whole file corrupts it.
    let mut from = 0usize;
    let mut to = lines.len();
    let mut level = 0usize;
    let mut step = default_step;
    for part in parents {
        match find_key(lines, from, to, level, part) {
            Some(at) => {
                let value = inline_value(&lines[at]).unwrap_or("");
                if value.starts_with('{') || value.starts_with('[') {
                    return Err(refuse(format!(
                        "`{part}` is written in flow style in this note, which the in-place \
                         editor will not edit. Use read_note and update_note instead.",
                    )));
                }
                if !value.is_empty() && value != "null" && value != "~" {
                    return Err(refuse(format!(
                        "`{part}` holds a plain value in this note, so `{}` cannot be set under \
                         it.",
                        path.join("."),
                    )));
                }
                // `part: null` is the same emptiness as `part:`, spelled out; make it the shape
                // a child can go under.
                if value == "null" || value == "~" {
                    lines[at] = format!("{}{}:\n", " ".repeat(level), spell_key(part));
                }
                let (child_from, child_to) = child_range(lines, at);
                let child_level = (child_from..child_to)
                    .find(|&i| !is_filler(&lines[i]))
                    .map(|i| indent_of(&lines[i]))
                    .unwrap_or(level + step);
                if child_level <= level {
                    return Err(refuse(format!(
                        "`{part}` in this note is not indented the way the in-place editor \
                         expects.",
                    )));
                }
                step = child_level - level;
                from = child_from;
                to = child_to;
                level = child_level;
            },
            None => {
                // Removing something whose parent does not exist is already done.
                if matches!(change, Change::Remove { .. }) {
                    return Ok(());
                }
                let at = insertion_point(lines, from, to);
                lines.insert(at, format!("{}{}:\n", " ".repeat(level), spell_key(part)));
                from = at + 1;
                to = at + 1;
                level += step;
            },
        }
    }

    let existing = find_key(lines, from, to, level, last);
    match change {
        Change::Remove { .. } => {
            if let Some(at) = existing {
                let (_, end) = child_range(lines, at);
                lines.drain(at..end);
            }
        },
        Change::Set { value, .. } => {
            match existing {
                Some(at) => {
                    // Replacing a value that already spans lines -- a sequence, a nested
                    // mapping, a block scalar -- reuses the indentation those lines already
                    // have. A note that indented a block scalar's body by eight keeps eight.
                    let (child_from, child_to) = child_range(lines, at);
                    let child_step = (child_from..child_to)
                        .find(|&i| !is_filler(&lines[i]))
                        .map(|i| indent_of(&lines[i]).saturating_sub(level))
                        .filter(|depth| *depth > 0)
                        .unwrap_or(step);
                    let rendered = render_entry(last, value, level, child_step);
                    lines.splice(at..child_to, rendered);
                },
                None => {
                    let at = insertion_point(lines, from, to);
                    lines.splice(at..at, render_entry(last, value, level, step));
                },
            }
        },
    }
    Ok(())
}

/// Where a new key at `level` goes: after the last real line of the range, before its trailing
/// filler, so a comment that trails a block stays below what it comments on.
fn insertion_point(lines: &[String], from: usize, to: usize) -> usize {
    let mut at = to.min(lines.len());
    while at > from && is_filler(&lines[at - 1]) {
        at -= 1;
    }
    at
}

/// A key, quoted only when it needs to be.
fn spell_key(key: &str) -> String {
    let simple = !key.is_empty()
        && !key.starts_with(['#', '-', '?', '&', '*', '!', '|', '>', '%', '@', '`', '"', '\''])
        && !key.contains(':')
        && !key.contains('\n')
        && key.trim() == key;
    if simple {
        // Round-trip it: a bare word that YAML would read as a bool, a number or a date must be
        // quoted, and `serde_yaml` is the authority on which those are.
        let reads_back = serde_yaml::from_str::<Value>(key)
            .is_ok_and(|value| value == Value::String(key.to_owned()));
        if reads_back {
            return key.to_owned();
        }
    }
    serde_yaml::to_string(&Value::String(key.to_owned()))
        .map(|text| text.trim().to_owned())
        .unwrap_or_else(|_| format!("{key:?}"))
}

/// One key and its value, as the lines they occupy.
fn render_entry(key: &str, value: &Value, level: usize, indent: usize) -> Vec<String> {
    let pad = " ".repeat(level);
    let key = spell_key(key);
    match value {
        Value::Sequence(items) if items.is_empty() => vec![format!("{pad}{key}: []\n")],
        Value::Sequence(items) => {
            let mut lines = vec![format!("{pad}{key}:\n")];
            let item_pad = " ".repeat(level + indent);
            for item in items {
                lines.push(format!("{item_pad}- {}\n", spell_scalar(item)));
            }
            lines
        },
        Value::Mapping(entries) if entries.is_empty() => vec![format!("{pad}{key}: {{}}\n")],
        Value::Mapping(entries) => {
            let mut lines = vec![format!("{pad}{key}:\n")];
            for (child_key, child_value) in entries {
                let child_key = match child_key {
                    Value::String(text) => text.clone(),
                    other => serde_yaml::to_string(other)
                        .map(|text| text.trim().to_owned())
                        .unwrap_or_default(),
                };
                lines.extend(render_entry(&child_key, child_value, level + indent, indent));
            }
            lines
        },
        Value::Null => vec![format!("{pad}{key}:\n")],
        // A multi-line string written as a quoted one-liner full of \n escapes is unreadable in
        // a file meant to be edited by hand, and these are exactly the `note:` fields an event
        // carries.
        Value::String(text) if is_block_scalar_safe(text) => {
            let body_pad = " ".repeat(level + indent);
            // `|` keeps the single trailing newline the string ends with; `|-` says there is
            // none. Getting this wrong changes the value, which the oracle would catch -- but it
            // is cheaper to be right than to be refused.
            let (header, content) = match text.strip_suffix('\n') {
                Some(content) if !content.ends_with('\n') => ("|", content),
                _ => ("|-", text.as_str()),
            };
            let mut lines = vec![format!("{pad}{key}: {header}\n")];
            for line in content.split('\n') {
                if line.is_empty() {
                    lines.push("\n".to_owned());
                }
                else {
                    lines.push(format!("{body_pad}{line}\n"));
                }
            }
            lines
        },
        scalar => vec![format!("{pad}{key}: {}\n", spell_scalar(scalar))],
    }
}

/// Whether a string can be written as a plain block scalar and read back unchanged.
///
/// YAML takes a literal block's indentation from its first non-empty line, so a value whose
/// first line is empty or starts with white space would need an explicit indentation indicator
/// (`|2`). Those are spelled as a quoted string instead: uglier, but never wrong.
///
/// A line that is only white space is fine, and worth allowing: the notes use two trailing
/// spaces as a Markdown hard line break, and a "blank" line in such a value is really two
/// spaces. Written at the block's own indentation plus its own content it reads back verbatim,
/// which was measured rather than assumed.
fn is_block_scalar_safe(text: &str) -> bool {
    let Some(first) = text.split('\n').next() else {
        return false;
    };
    text.contains('\n') && !first.is_empty() && !first.starts_with([' ', '\t'])
}

/// A scalar on one line, quoted only when it needs to be.
///
/// Sequences and mappings never reach this: `render_entry` handles them as blocks, so nothing
/// here has to fit a collection onto a line.
fn spell_scalar(value: &Value) -> String {
    serde_yaml::to_string(value)
        .map(|text| text.trim_end().trim_end_matches("\n...").trim().to_owned())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(text: &str, path: &[&str], value: impl Into<Value>) -> String {
        apply(text, &[Change::set(path, value)]).expect("the edit should apply")
    }

    /// The point of the whole module: everything the author wrote that was not asked about comes
    /// back byte for byte.
    #[test]
    fn an_edit_changes_one_line_and_leaves_every_other_byte_alone() {
        let before = "---\n\
                      tags:\n  - 就活\n  - 公募\n\
                      events:\n\
                      \x20   面接日:\n\
                      \x20       start: 2025-07-07 17:00\n\
                      \x20       end: 18:00\n\
                      \x20       color: orange\n\
                      # 面接候補日:\n\
                      #     times:\n\
                      #         - { start: 2025-07-01 16:00, end: 19:00 }\n\
                      ---\n\n# Interview\n\nBody text.\n";
        let after = set(before, &["events", "面接日", "color"], "indigo");

        assert_eq!(after, before.replace("color: orange", "color: indigo"));
        // The commented-out block, the two-space `tags:` list and the body all survive.
        assert!(after.contains("#         - { start: 2025-07-01 16:00, end: 19:00 }"));
        assert!(after.contains("tags:\n  - 就活"));
        assert!(after.ends_with("\n# Interview\n\nBody text.\n"));
    }

    #[test]
    fn a_note_keeps_its_own_indentation_step() {
        let two = "---\ntask:\n  progress: 0\n---\n\n# T\n";
        assert!(set(two, &["task", "importance"], 3).contains("\n  importance: 3\n"));

        let four = "---\ntask:\n    progress: 0\n---\n\n# T\n";
        assert!(set(four, &["task", "importance"], 3).contains("\n    importance: 3\n"));
    }

    /// `events:` with nothing under it is the ordinary state of a note that never had one.
    #[test]
    fn an_empty_key_becomes_the_parent_of_what_is_added_under_it() {
        let before = "---\ntags:\n    - x\nevents:\n---\n\n# N\n";
        let after = apply(
            before,
            &[
                Change::set(&["events", "Book club", "start"], "2026-03-12 19:00"),
                Change::set(&["events", "Book club", "color"], "indigo"),
            ],
        )
        .expect("the edit should apply");
        assert_eq!(
            after,
            "---\ntags:\n    - x\nevents:\n    Book club:\n        start: 2026-03-12 19:00\n\
             \x20       color: indigo\n---\n\n# N\n",
        );
    }

    #[test]
    fn a_note_with_no_frontmatter_gains_one() {
        let after = set("# Just a heading\n", &["task", "progress"], 0);
        assert_eq!(after, "---\ntask:\n    progress: 0\n---\n\n# Just a heading\n");
    }

    #[test]
    fn a_sequence_is_written_in_the_house_style() {
        let before = "---\ntask:\n    scheduled_dates: []\n---\n\n# T\n";
        let after = set(
            before,
            &["task", "scheduled_dates"],
            Value::Sequence(vec!["2026-03-01".into(), "2026-03-02".into()]),
        );
        assert_eq!(
            after,
            "---\ntask:\n    scheduled_dates:\n        - 2026-03-01\n        - 2026-03-02\n\
             ---\n\n# T\n",
        );
        // And back to empty, which must not leave the old items behind.
        let emptied = set(&after, &["task", "scheduled_dates"], Value::Sequence(vec![]));
        assert_eq!(emptied, before);
    }

    #[test]
    fn removing_a_key_takes_its_children_with_it() {
        let before = "---\nevents:\n    A:\n        start: 2026-01-01\n    B:\n        \
                      start: 2026-02-01\n---\n\n# N\n";
        let after = apply(before, &[Change::remove(&["events", "A"])])
            .expect("the removal should apply");
        assert_eq!(after, "---\nevents:\n    B:\n        start: 2026-02-01\n---\n\n# N\n");

        // Removing something absent is not an error, and changes nothing.
        assert_eq!(
            apply(before, &[Change::remove(&["events", "Z"])]).expect("no-op"),
            before,
        );
        assert_eq!(
            apply(before, &[Change::remove(&["task", "progress"])]).expect("no-op"),
            before,
        );
    }

    #[test]
    fn a_block_scalar_is_replaced_whole_rather_than_half() {
        let before = "---\nevents:\n    A:\n        note: |\n            line one\n            \
                      line two\n        color: red\n---\n\n# N\n";
        let after = set(before, &["events", "A", "note"], "short");
        assert_eq!(
            after,
            "---\nevents:\n    A:\n        note: short\n        color: red\n---\n\n# N\n",
        );
    }

    /// A key whose name YAML would read as something else has to be quoted, or the note would
    /// come back meaning something different.
    #[test]
    fn a_key_that_is_not_a_plain_string_is_quoted() {
        let after = set("---\nevents:\n---\n\n# N\n", &["events", "2026-01-01"], Value::Null);
        assert!(after.contains("2026-01-01"), "{after}");
        // Whatever spelling was chosen, it must read back as the name that was asked for.
        let parsed: Value = serde_yaml::from_str(&Note::parse(&after).block).expect("valid YAML");
        assert!(parsed["events"].as_mapping().unwrap().contains_key("2026-01-01"));
    }

    /// Flow style is the shape the editor cannot reach into, and it says so instead of guessing.
    #[test]
    fn a_flow_mapping_is_refused_rather_than_mangled() {
        let before = "---\nevents: { A: { start: 2026-01-01 } }\n---\n\n# N\n";
        let error = apply(before, &[Change::set(&["events", "A", "color"], "red")])
            .expect_err("flow style should be refused");
        assert!(error.0.contains("flow style"), "{error}");
    }

    #[test]
    fn a_scalar_cannot_be_given_children() {
        let before = "---\ntask: not a mapping\n---\n\n# N\n";
        assert!(apply(before, &[Change::set(&["task", "progress"], 0)]).is_err());
    }

    #[test]
    fn invalid_yaml_is_reported_rather_than_edited() {
        let before = "---\ntags: [unclosed\n---\n\n# N\n";
        let error = apply(before, &[Change::set(&["task", "progress"], 0)])
            .expect_err("invalid YAML should be refused");
        assert!(error.0.contains("not valid YAML"), "{error}");
    }

    #[test]
    fn the_body_is_never_touched() {
        let before = "---\ntask:\n    progress: 0\n---\n\n# T\n\n---\n\nA horizontal rule above.\n";
        let after = set(before, &["task", "progress"], 50);
        assert!(after.ends_with("\n# T\n\n---\n\nA horizontal rule above.\n"));
        assert!(after.contains("progress: 50"));
    }
}
