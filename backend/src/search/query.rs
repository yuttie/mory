use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchMode {
    Grep,
    Text,
    Semantic,
    Hybrid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Occur {
    Optional,
    Required,
    Excluded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Field {
    Any,
    Path,
    Title,
    Body,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Clause {
    pub occur: Occur,
    pub field: Field,
    pub value: String,
    pub phrase: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedQuery {
    pub clauses: Vec<Clause>,
}

impl ParsedQuery {
    pub fn semantic_text(&self) -> String {
        self.clauses
            .iter()
            .filter(|clause| clause.occur != Occur::Excluded && clause.field != Field::Path)
            .map(|clause| clause.value.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// Parse the deliberately small public search language. Every byte must be consumed here; values
/// are never handed to Tantivy's native query parser as syntax.
pub fn parse(input: &str) -> Result<ParsedQuery> {
    let mut clauses = Vec::new();
    let mut chars = input.char_indices().peekable();

    while let Some(&(offset, ch)) = chars.peek() {
        if ch.is_whitespace() {
            chars.next();
            continue;
        }

        let mut occur = Occur::Optional;
        let start = if ch == '+' || ch == '-' {
            chars.next();
            occur = if ch == '+' {
                Occur::Required
            } else {
                Occur::Excluded
            };
            chars.peek().map(|(i, _)| *i).unwrap_or(input.len())
        } else {
            offset
        };

        if chars.peek().is_none() {
            bail!("an operator must be followed by a search term");
        }

        let mut field = Field::Any;
        let mut value_start = start;
        let probe = chars.clone();
        let mut colon = None;
        for (index, current) in probe {
            if current == ':' {
                colon = Some(index);
                break;
            }
            if current.is_whitespace() || current == '"' {
                break;
            }
        }
        if let Some(colon_offset) = colon {
            let name = &input[start..colon_offset];
            field = match name {
                "path" => Field::Path,
                "title" => Field::Title,
                "body" => Field::Body,
                _ => bail!("unknown search field '{name}'"),
            };
            while chars.peek().is_some_and(|(i, _)| *i <= colon_offset) {
                chars.next();
            }
            value_start = colon_offset + 1;
            if chars.peek().is_none_or(|(_, ch)| ch.is_whitespace()) {
                bail!("a field must be followed by a value");
            }
        }

        let phrase = chars.peek().is_some_and(|(_, ch)| *ch == '"');
        let value = if phrase {
            chars.next();
            let content_start = chars.peek().map(|(i, _)| *i).unwrap_or(input.len());
            let mut escaped = false;
            let mut end = None;
            for (index, current) in chars.by_ref() {
                if escaped {
                    escaped = false;
                } else if current == '\\' {
                    escaped = true;
                } else if current == '"' {
                    end = Some(index);
                    break;
                }
            }
            let end = end.ok_or_else(|| anyhow::anyhow!("unterminated quoted phrase"))?;
            let raw = &input[content_start..end];
            let mut result = String::with_capacity(raw.len());
            let mut escaped = false;
            for current in raw.chars() {
                if escaped {
                    if current != '"' && current != '\\' {
                        bail!("only quotes and backslashes may be escaped");
                    }
                    result.push(current);
                    escaped = false;
                } else if current == '\\' {
                    escaped = true;
                } else {
                    result.push(current);
                }
            }
            if chars.peek().is_some_and(|(_, ch)| !ch.is_whitespace()) {
                bail!("a quoted phrase must end the clause");
            }
            result
        } else {
            let actual_start = if field == Field::Any {
                value_start
            } else {
                chars.peek().map(|(i, _)| *i).unwrap_or(input.len())
            };
            let mut end = input.len();
            while let Some((index, current)) = chars.peek().copied() {
                if current.is_whitespace() {
                    end = index;
                    break;
                }
                if matches!(current, '"' | '(' | ')' | '{' | '}' | '[' | ']') {
                    bail!("unsupported search syntax");
                }
                chars.next();
            }
            input[actual_start..end].to_owned()
        };

        if value.is_empty() {
            bail!("search clauses cannot be empty");
        }
        clauses.push(Clause {
            occur,
            field,
            value,
            phrase,
        });
    }

    if clauses.is_empty() {
        bail!("query must not be empty");
    }
    if !clauses.iter().any(|clause| clause.occur != Occur::Excluded) {
        bail!("query must contain at least one positive clause");
    }
    Ok(ParsedQuery { clauses })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_restricted_query_language() {
        let parsed = parse("path:research +検索 -obsolete title:\"quoted phrase\"").unwrap();
        assert_eq!(parsed.clauses.len(), 4);
        assert_eq!(parsed.clauses[0].field, Field::Path);
        assert_eq!(parsed.clauses[1].occur, Occur::Required);
        assert_eq!(parsed.clauses[2].occur, Occur::Excluded);
        assert!(parsed.clauses[3].phrase);
        assert_eq!(parsed.semantic_text(), "検索 quoted phrase");
    }

    #[test]
    fn rejects_tantivy_syntax_and_malformed_clauses() {
        for invalid in [
            "",
            "+",
            "-only",
            "unknown:value",
            "title:",
            "(one OR two)",
            "broken\"phrase",
            "\"open",
        ] {
            assert!(parse(invalid).is_err(), "accepted {invalid:?}");
        }
    }
}
