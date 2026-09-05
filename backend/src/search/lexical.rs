use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use lindera::dictionary::{load_embedded_dictionary, DictionaryKind};
use lindera::mode::Mode;
use lindera::segmenter::Segmenter;
use lindera_analysis::token_filter::japanese_base_form::JapaneseBaseFormTokenFilter;
use lindera_tantivy::tokenizer::LinderaTokenizer;
use tantivy::collector::TopDocs;
use tantivy::query::{BooleanQuery, BoostQuery, Occur as TOccur, PhraseQuery, Query, TermQuery};
use tantivy::schema::{
    Field as TField, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, Value, STORED,
};
use tantivy::tokenizer::{
    AsciiFoldingFilter, Language, LowerCaser, RemoveLongFilter, SimpleTokenizer, Stemmer,
    TextAnalyzer, TokenStream,
};
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term};
use unicode_normalization::UnicodeNormalization;

use super::passage::Passage;
use super::query::{Clause, Field, Occur, ParsedQuery};

pub const FINGERPRINT: &str =
    "mory-search-v3:passage-500-800-80:path-nfkc-fold:ja-ipadic-base:en-nfkc-fold-stem";
const GENERAL_ANALYZER: &str = "mory_general";
const JAPANESE_ANALYZER: &str = "mory_japanese";
const PATH_ANALYZER: &str = "mory_path";
const MANAGED_MARKER: &str = ".mory-search-index";
const MANAGED_MARKER_CONTENT: &str = "mory-search-index-v1\n";

#[derive(Debug, Clone)]
pub struct IndexInput {
    pub path: String,
    pub blob_id: String,
    pub mime_type: String,
    pub title: Option<String>,
    pub tags: String,
    pub passage: Passage,
    pub content_kind: String,
}

#[derive(Debug, Clone)]
pub struct LexicalHit {
    pub path: String,
    pub blob_id: String,
    pub passage_id: String,
    pub mime_type: String,
    pub title: Option<String>,
    pub start_line: Option<usize>,
    pub end_line: Option<usize>,
    pub snippet: String,
    pub content_kind: String,
    pub score: f32,
}

pub type PassageKey = (String, String);

#[derive(Clone, Copy)]
struct Fields {
    kind: TField,
    generation: TField,
    fingerprint: TField,
    content_version: TField,
    path: TField,
    path_search: TField,
    blob_id: TField,
    passage_id: TField,
    mime_type: TField,
    title_display: TField,
    title: TField,
    title_ja: TField,
    heading: TField,
    heading_ja: TField,
    body: TField,
    body_ja: TField,
    snippet: TField,
    content_kind: TField,
    start_line: TField,
    end_line: TField,
}

pub struct LexicalIndex {
    pub generation: String,
    pub content_version: String,
    index: Index,
    reader: IndexReader,
    fields: Fields,
}

impl LexicalIndex {
    pub fn open(path: &Path) -> Result<Self> {
        let index = Index::open_in_dir(path).context("failed to open the lexical search index")?;
        register_analyzers(&index)?;
        let fields = fields_from_schema(&index.schema())?;
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        let (generation, content_version) = read_marker(&reader, fields)?
            .filter(|(_, fingerprint, _)| fingerprint == FINGERPRINT)
            .map(|(generation, _, content_version)| (generation, content_version))
            .context("lexical index schema fingerprint is incompatible")?;
        Ok(Self {
            generation,
            content_version,
            index,
            reader,
            fields,
        })
    }

    pub fn build(
        path: &Path,
        generation: &str,
        content_version: &str,
        inputs: &[IndexInput],
    ) -> Result<Self> {
        if path.exists() {
            fs::remove_dir_all(path).context("failed to clear temporary lexical index")?;
        }
        fs::create_dir_all(path).context("failed to create temporary lexical index")?;
        let (schema, fields) = build_schema();
        let index = Index::create_in_dir(path, schema)?;
        register_analyzers(&index)?;
        let mut writer = index.writer::<TantivyDocument>(64 * 1024 * 1024)?;
        writer.add_document(doc!(
            fields.kind => "meta",
            fields.generation => generation,
            fields.fingerprint => FINGERPRINT,
            fields.content_version => content_version,
        ))?;
        for input in inputs {
            add_input(&mut writer, fields, input)?;
        }
        writer.commit()?;
        drop(writer);
        mark_managed(path)?;
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        Ok(Self {
            generation: generation.to_owned(),
            content_version: content_version.to_owned(),
            index,
            reader,
            fields,
        })
    }

    pub fn update(
        &self,
        generation: &str,
        content_version: &str,
        changed_paths: &HashSet<String>,
        inputs: &[IndexInput],
    ) -> Result<()> {
        let mut writer = self.index.writer::<TantivyDocument>(64 * 1024 * 1024)?;
        writer.delete_term(Term::from_field_text(self.fields.kind, "meta"));
        for path in changed_paths {
            writer.delete_term(Term::from_field_text(self.fields.path, path));
        }
        writer.add_document(doc!(
            self.fields.kind => "meta",
            self.fields.generation => generation,
            self.fields.fingerprint => FINGERPRINT,
            self.fields.content_version => content_version,
        ))?;
        for input in inputs
            .iter()
            .filter(|input| changed_paths.contains(&input.path))
        {
            add_input(&mut writer, self.fields, input)?;
        }
        writer.commit()?;
        Ok(())
    }

    pub fn search(&self, parsed: &ParsedQuery, limit: usize) -> Result<Vec<LexicalHit>> {
        let query = build_query(&self.index, self.fields, parsed)?;
        let searcher = self.reader.searcher();
        let docs = searcher.search(&query, &TopDocs::with_limit(limit).order_by_score())?;
        let mut hits = Vec::with_capacity(docs.len());
        for (score, address) in docs {
            let found: TantivyDocument = searcher.doc(address)?;
            if string(&found, self.fields.kind).as_deref() != Some("passage") {
                continue;
            }
            let title = string(&found, self.fields.title_display).filter(|value| !value.is_empty());
            hits.push(LexicalHit {
                path: string(&found, self.fields.path).unwrap_or_default(),
                blob_id: string(&found, self.fields.blob_id).unwrap_or_default(),
                passage_id: string(&found, self.fields.passage_id).unwrap_or_default(),
                mime_type: string(&found, self.fields.mime_type).unwrap_or_default(),
                title,
                start_line: number(&found, self.fields.start_line).map(|value| value as usize),
                end_line: number(&found, self.fields.end_line).map(|value| value as usize),
                snippet: string(&found, self.fields.snippet).unwrap_or_default(),
                content_kind: string(&found, self.fields.content_kind)
                    .unwrap_or_else(|| "source".to_owned()),
                score,
            });
        }
        Ok(hits)
    }

    pub fn validate_query(&self, parsed: &ParsedQuery) -> Result<()> {
        build_query(&self.index, self.fields, parsed).map(|_| ())
    }

    pub fn matching_passages(&self, parsed: &ParsedQuery) -> Result<HashSet<PassageKey>> {
        let hard_filters = ParsedQuery {
            clauses: parsed
                .clauses
                .iter()
                .filter(|clause| clause.occur != Occur::Optional || clause.field != Field::Any)
                .cloned()
                .collect(),
        };
        let query = build_query(&self.index, self.fields, &hard_filters)?;
        let searcher = self.reader.searcher();
        let count = searcher.num_docs() as usize;
        if count == 0 {
            return Ok(HashSet::new());
        }
        let docs = searcher.search(&query, &TopDocs::with_limit(count).order_by_score())?;
        let mut passages = HashSet::with_capacity(docs.len());
        for (_, address) in docs {
            let found: TantivyDocument = searcher.doc(address)?;
            if let (Some(path), Some(passage_id)) = (
                string(&found, self.fields.path),
                string(&found, self.fields.passage_id),
            ) {
                passages.insert((path, passage_id));
            }
        }
        Ok(passages)
    }
}

fn add_input(
    writer: &mut IndexWriter<TantivyDocument>,
    fields: Fields,
    input: &IndexInput,
) -> Result<()> {
    let normalized_title = normalize(input.title.as_deref().unwrap_or(""));
    let normalized_heading = normalize(&input.passage.heading);
    let normalized_body = normalize(&format!("{}\n{}", input.tags, input.passage.text));
    let mut document = doc!(
        fields.kind => "passage",
        fields.path => input.path.as_str(),
        fields.path_search => normalize_path(&input.path),
        fields.blob_id => input.blob_id.as_str(),
        fields.passage_id => input.passage.passage_id.as_str(),
        fields.mime_type => input.mime_type.as_str(),
        fields.title_display => input.title.as_deref().unwrap_or(""),
        fields.title => normalized_title.as_str(),
        fields.title_ja => normalized_title.as_str(),
        fields.heading => normalized_heading.as_str(),
        fields.heading_ja => normalized_heading.as_str(),
        fields.body => normalized_body.as_str(),
        fields.body_ja => normalized_body.as_str(),
        fields.snippet => input.passage.text.as_str(),
        fields.content_kind => input.content_kind.as_str(),
    );
    if input.content_kind == "source" {
        document.add_u64(fields.start_line, input.passage.start_line as u64);
        document.add_u64(fields.end_line, input.passage.end_line as u64);
    }
    writer.add_document(document)?;
    Ok(())
}

fn normalize(value: &str) -> String {
    value.nfkc().collect::<String>().to_lowercase()
}

fn normalize_path(value: &str) -> String {
    normalize(&value.replace(['/', '.', '_', '-'], " "))
}

fn text_options(tokenizer: &str, stored: bool) -> TextOptions {
    let options = TextOptions::default().set_indexing_options(
        TextFieldIndexing::default()
            .set_tokenizer(tokenizer)
            .set_index_option(IndexRecordOption::WithFreqsAndPositions),
    );
    if stored {
        options.set_stored()
    } else {
        options
    }
}

fn raw_stored() -> TextOptions {
    TextOptions::default()
        .set_indexing_options(
            TextFieldIndexing::default()
                .set_tokenizer("raw")
                .set_index_option(IndexRecordOption::Basic),
        )
        .set_stored()
}

fn build_schema() -> (Schema, Fields) {
    let mut builder = Schema::builder();
    let kind = builder.add_text_field("kind", raw_stored());
    let generation = builder.add_text_field("generation", raw_stored());
    let fingerprint = builder.add_text_field("fingerprint", raw_stored());
    let content_version = builder.add_text_field("content_version", raw_stored());
    let path = builder.add_text_field("path", raw_stored());
    let path_search = builder.add_text_field("path_search", text_options(PATH_ANALYZER, false));
    let blob_id = builder.add_text_field("blob_id", raw_stored());
    let passage_id = builder.add_text_field("passage_id", raw_stored());
    let mime_type = builder.add_text_field("mime_type", STORED);
    let title_display = builder.add_text_field("title_display", STORED);
    let title = builder.add_text_field("title", text_options(GENERAL_ANALYZER, false));
    let title_ja = builder.add_text_field("title_ja", text_options(JAPANESE_ANALYZER, false));
    let heading = builder.add_text_field("heading", text_options(GENERAL_ANALYZER, false));
    let heading_ja = builder.add_text_field("heading_ja", text_options(JAPANESE_ANALYZER, false));
    let body = builder.add_text_field("body", text_options(GENERAL_ANALYZER, false));
    let body_ja = builder.add_text_field("body_ja", text_options(JAPANESE_ANALYZER, false));
    let snippet = builder.add_text_field("snippet", STORED);
    let content_kind = builder.add_text_field("content_kind", STORED);
    let start_line = builder.add_u64_field("start_line", STORED);
    let end_line = builder.add_u64_field("end_line", STORED);
    let fields = Fields {
        kind,
        generation,
        fingerprint,
        content_version,
        path,
        path_search,
        blob_id,
        passage_id,
        mime_type,
        title_display,
        title,
        title_ja,
        heading,
        heading_ja,
        body,
        body_ja,
        snippet,
        content_kind,
        start_line,
        end_line,
    };
    (builder.build(), fields)
}

fn fields_from_schema(schema: &Schema) -> Result<Fields> {
    let get = |name| {
        schema
            .get_field(name)
            .with_context(|| format!("missing search field {name}"))
    };
    Ok(Fields {
        kind: get("kind")?,
        generation: get("generation")?,
        fingerprint: get("fingerprint")?,
        content_version: get("content_version")?,
        path: get("path")?,
        path_search: get("path_search")?,
        blob_id: get("blob_id")?,
        passage_id: get("passage_id")?,
        mime_type: get("mime_type")?,
        title_display: get("title_display")?,
        title: get("title")?,
        title_ja: get("title_ja")?,
        heading: get("heading")?,
        heading_ja: get("heading_ja")?,
        body: get("body")?,
        body_ja: get("body_ja")?,
        snippet: get("snippet")?,
        content_kind: get("content_kind")?,
        start_line: get("start_line")?,
        end_line: get("end_line")?,
    })
}

fn register_analyzers(index: &Index) -> Result<()> {
    let general = TextAnalyzer::builder(SimpleTokenizer::default())
        .filter(RemoveLongFilter::limit(80))
        .filter(LowerCaser)
        .filter(AsciiFoldingFilter)
        .filter(Stemmer::new(Language::English))
        .build();
    index.tokenizers().register(GENERAL_ANALYZER, general);

    let path = TextAnalyzer::builder(SimpleTokenizer::default())
        .filter(RemoveLongFilter::limit(80))
        .filter(LowerCaser)
        .filter(AsciiFoldingFilter)
        .build();
    index.tokenizers().register(PATH_ANALYZER, path);

    let dictionary = load_embedded_dictionary(DictionaryKind::IPADIC)?;
    let segmenter = Segmenter::new(Mode::Normal, dictionary, None);
    let mut japanese = LinderaTokenizer::from_segmenter(segmenter);
    japanese.append_token_filter(JapaneseBaseFormTokenFilter::new().into());
    index.tokenizers().register(JAPANESE_ANALYZER, japanese);
    Ok(())
}

fn read_marker(reader: &IndexReader, fields: Fields) -> Result<Option<(String, String, String)>> {
    let query = TermQuery::new(
        Term::from_field_text(fields.kind, "meta"),
        IndexRecordOption::Basic,
    );
    let searcher = reader.searcher();
    let Some((_, address)) = searcher
        .search(&query, &TopDocs::with_limit(1).order_by_score())?
        .first()
        .copied()
    else {
        return Ok(None);
    };
    let doc: TantivyDocument = searcher.doc(address)?;
    Ok(Some((
        string(&doc, fields.generation).unwrap_or_default(),
        string(&doc, fields.fingerprint).unwrap_or_default(),
        string(&doc, fields.content_version).unwrap_or_default(),
    )))
}

fn analyze(index: &Index, analyzer_name: &str, field: TField, value: &str) -> Result<Vec<Term>> {
    let mut analyzer = index
        .tokenizers()
        .get(analyzer_name)
        .with_context(|| format!("missing tokenizer {analyzer_name}"))?;
    let normalized = normalize(value);
    let mut stream = analyzer.token_stream(&normalized);
    let mut terms = Vec::new();
    stream.process(&mut |token| terms.push(Term::from_field_text(field, &token.text)));
    Ok(terms)
}

fn term_or_phrase(terms: Vec<Term>, phrase: bool) -> Option<Box<dyn Query>> {
    match terms.len() {
        0 => None,
        1 => Some(Box::new(TermQuery::new(
            terms.into_iter().next().unwrap(),
            IndexRecordOption::WithFreqsAndPositions,
        ))),
        _ if phrase => Some(Box::new(PhraseQuery::new(terms))),
        _ => Some(Box::new(BooleanQuery::intersection(
            terms
                .into_iter()
                .map(|term| {
                    Box::new(TermQuery::new(
                        term,
                        IndexRecordOption::WithFreqsAndPositions,
                    )) as Box<dyn Query>
                })
                .collect(),
        ))),
    }
}

fn field_query(
    index: &Index,
    general: Option<TField>,
    japanese: Option<TField>,
    value: &str,
    phrase: bool,
) -> Result<Option<Box<dyn Query>>> {
    let mut alternatives = Vec::new();
    if let Some(field) = general {
        if let Some(query) = term_or_phrase(analyze(index, GENERAL_ANALYZER, field, value)?, phrase)
        {
            alternatives.push((TOccur::Should, query));
        }
    }
    if let Some(field) = japanese {
        if let Some(query) =
            term_or_phrase(analyze(index, JAPANESE_ANALYZER, field, value)?, phrase)
        {
            alternatives.push((TOccur::Should, query));
        }
    }
    Ok(match alternatives.len() {
        0 => None,
        1 => alternatives.pop().map(|(_, query)| query),
        _ => Some(Box::new(BooleanQuery::new(alternatives))),
    })
}

fn clause_query(index: &Index, fields: Fields, clause: &Clause) -> Result<Option<Box<dyn Query>>> {
    if clause.field == Field::Path {
        let query = term_or_phrase(
            analyze(index, PATH_ANALYZER, fields.path_search, &clause.value)?,
            clause.phrase,
        );
        return Ok(query);
    }
    let mut weighted = Vec::new();
    let choices: &[(TField, TField, f32)] = match clause.field {
        Field::Any => &[
            (fields.title, fields.title_ja, 4.0),
            (fields.heading, fields.heading_ja, 2.5),
            (fields.body, fields.body_ja, 1.0),
        ],
        Field::Title => &[(fields.title, fields.title_ja, 4.0)],
        Field::Body => &[(fields.body, fields.body_ja, 1.0)],
        Field::Path => unreachable!("path clauses are handled above"),
    };
    for (general, japanese, boost) in choices {
        if let Some(query) = field_query(
            index,
            Some(*general),
            Some(*japanese),
            &clause.value,
            clause.phrase,
        )? {
            weighted.push((
                TOccur::Should,
                Box::new(BoostQuery::new(query, *boost)) as Box<dyn Query>,
            ));
        }
    }
    Ok(match weighted.len() {
        0 => None,
        1 => weighted.pop().map(|(_, query)| query),
        _ => Some(Box::new(BooleanQuery::new(weighted))),
    })
}

fn build_query(index: &Index, fields: Fields, parsed: &ParsedQuery) -> Result<Box<dyn Query>> {
    let mut clauses = vec![(
        TOccur::Must,
        Box::new(TermQuery::new(
            Term::from_field_text(fields.kind, "passage"),
            IndexRecordOption::Basic,
        )) as Box<dyn Query>,
    )];
    let has_required = parsed
        .clauses
        .iter()
        .any(|clause| clause.occur == Occur::Required);
    for clause in &parsed.clauses {
        let query = clause_query(index, fields, clause)?.with_context(|| {
            format!(
                "search clause {:?} contains no indexable text",
                clause.value
            )
        })?;
        let occur = match clause.occur {
            Occur::Excluded => TOccur::MustNot,
            Occur::Required => TOccur::Must,
            Occur::Optional if clause.field != Field::Any => TOccur::Must,
            Occur::Optional if has_required => TOccur::Should,
            Occur::Optional => TOccur::Must,
        };
        clauses.push((occur, query));
    }
    Ok(Box::new(BooleanQuery::new(clauses)))
}

fn string(doc: &TantivyDocument, field: TField) -> Option<String> {
    doc.get_first(field)
        .and_then(|value| value.as_str())
        .map(str::to_owned)
}

fn number(doc: &TantivyDocument, field: TField) -> Option<u64> {
    doc.get_first(field).and_then(|value| value.as_u64())
}

pub fn replace_directory(build: &Path, destination: &Path) -> Result<()> {
    let parent = parent_directory(destination);
    fs::create_dir_all(parent)?;
    ensure_replaceable(destination)?;
    let old = unique_sibling(destination, "old");
    if old.exists() {
        fs::remove_dir_all(&old).context("failed to remove an abandoned lexical index backup")?;
    }
    if destination.exists() {
        fs::rename(destination, &old).context("failed to preserve the previous lexical index")?;
    }
    if let Err(error) = fs::rename(build, destination) {
        if old.exists() {
            let _ = fs::rename(&old, destination);
        }
        return Err(error).context("failed to install the rebuilt lexical index");
    }
    if old.exists() {
        let _ = fs::remove_dir_all(old);
    }
    Ok(())
}

fn ensure_replaceable(destination: &Path) -> Result<()> {
    if !destination.exists() {
        return Ok(());
    }
    if !destination.is_dir() {
        bail!(
            "refusing to replace non-directory search index path {}",
            destination.display()
        );
    }
    if fs::read_dir(destination)?.next().is_none() {
        return Ok(());
    }
    if !is_managed(destination) {
        bail!(
            "refusing to replace unrecognized nonempty search index directory {}",
            destination.display()
        );
    }
    Ok(())
}

fn is_managed(path: &Path) -> bool {
    fs::read_to_string(path.join(MANAGED_MARKER)).is_ok_and(|value| value == MANAGED_MARKER_CONTENT)
}

pub fn mark_managed(path: &Path) -> Result<()> {
    fs::write(path.join(MANAGED_MARKER), MANAGED_MARKER_CONTENT)
        .context("failed to mark the managed lexical index")
}

pub fn recover_directory(destination: &Path) -> Result<()> {
    let parent = parent_directory(destination);
    fs::create_dir_all(parent)?;
    let name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("search-index");
    let old_prefix = format!(".{name}.old.");
    let build_prefix = format!(".{name}.building.");
    let mut old = Vec::new();
    let mut builds = Vec::new();
    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        let Some(entry_name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if entry_name.starts_with(&old_prefix) && is_managed(&entry.path()) {
            old.push(entry.path());
        } else if entry_name.starts_with(&build_prefix) && is_managed(&entry.path()) {
            builds.push(entry.path());
        }
    }
    if !destination.exists() {
        old.sort_by_key(|path| fs::metadata(path).and_then(|value| value.modified()).ok());
        if let Some(last_good) = old.pop() {
            fs::rename(last_good, destination)
                .context("failed to restore the previous lexical index")?;
        }
    }
    for abandoned in old.into_iter().chain(builds) {
        if abandoned.is_dir() {
            fs::remove_dir_all(abandoned)?;
        } else {
            fs::remove_file(abandoned)?;
        }
    }
    Ok(())
}

fn parent_directory(path: &Path) -> &Path {
    // A single relative component has an empty parent rather than no parent. Passing that empty
    // path to create_dir_all/read_dir produces an opaque ENOENT during startup.
    path.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
}

pub fn unique_sibling(destination: &Path, suffix: &str) -> PathBuf {
    let name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("search-index");
    destination.with_file_name(format!(".{name}.{suffix}.{}", std::process::id()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::passage::Passage;
    use crate::search::query::parse;

    fn input(path: &str, id: &str, title: &str, text: &str) -> IndexInput {
        IndexInput {
            path: path.to_owned(),
            blob_id: id.to_owned(),
            mime_type: "text/markdown".to_owned(),
            title: Some(title.to_owned()),
            tags: "検索 research".to_owned(),
            passage: Passage {
                passage_id: id.to_owned(),
                start_byte: 0,
                end_byte: text.len(),
                start_line: 1,
                end_line: 1,
                heading: format!("{title} Breadcrumb"),
                text: text.to_owned(),
                text_hash: id.to_owned(),
            },
            content_kind: "source".to_owned(),
        }
    }

    #[test]
    fn retrieves_stems_width_variants_japanese_and_filters() {
        let directory = tempfile::tempdir().unwrap();
        let index_path = directory.path().join("index");
        let index = LexicalIndex::build(
            &index_path,
            "commit",
            "content",
            &[
                input(
                    "research/rust.md",
                    "one",
                    "Running Search",
                    "Researchers ran with Ｒｕｓｔ. 検索しました。",
                ),
                input(
                    "archive/obsolete.md",
                    "two",
                    "Old",
                    "Running obsolete material.",
                ),
            ],
        )
        .unwrap();

        assert_eq!(
            index.search(&parse("run rust").unwrap(), 10).unwrap()[0].path,
            "research/rust.md"
        );
        assert_eq!(
            index.search(&parse("検索する").unwrap(), 10).unwrap()[0].path,
            "research/rust.md"
        );
        assert_eq!(
            index
                .search(&parse("path:research -obsolete").unwrap(), 10)
                .unwrap()[0]
                .path,
            "research/rust.md"
        );
        assert!(index
            .search(&parse("title:breadcrumb").unwrap(), 10)
            .unwrap()
            .is_empty());
        assert_eq!(
            index
                .search(&parse("breadcrumb").unwrap(), 10)
                .unwrap()
                .len(),
            2
        );
        assert!(index
            .search(&parse("body:search").unwrap(), 10)
            .unwrap()
            .is_empty());
        let allowed = index
            .matching_passages(
                &parse("path:research +検索する -obsolete unrelated-semantic-text").unwrap(),
            )
            .unwrap();
        assert_eq!(
            allowed,
            HashSet::from([("research/rust.md".to_owned(), "one".to_owned())])
        );
    }

    #[test]
    fn hard_filters_keep_identical_passages_scoped_to_their_paths() {
        let directory = tempfile::tempdir().unwrap();
        let index_path = directory.path().join("index");
        let index = LexicalIndex::build(
            &index_path,
            "commit",
            "content",
            &[
                input("research/shared.md", "same", "Shared", "identical"),
                input("private/shared.md", "same", "Shared", "identical"),
            ],
        )
        .unwrap();

        let allowed = index
            .matching_passages(&parse("path:research meaning").unwrap())
            .unwrap();

        assert_eq!(
            allowed,
            HashSet::from([("research/shared.md".to_owned(), "same".to_owned())])
        );
    }

    #[test]
    fn rejects_clauses_that_the_analyzers_reduce_to_nothing() {
        let directory = tempfile::tempdir().unwrap();
        let index_path = directory.path().join("index");
        let index = LexicalIndex::build(
            &index_path,
            "commit",
            "content",
            &[input("note.md", "one", "Title", "body")],
        )
        .unwrap();

        for query in ["path:...", "path:---", "normal +path:..."] {
            let parsed = parse(query).unwrap();
            assert!(index.validate_query(&parsed).is_err(), "accepted {query:?}");
            assert!(index.search(&parsed, 10).is_err(), "searched {query:?}");
        }
    }

    #[test]
    fn restores_an_index_preserved_before_an_interrupted_replace() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("index");
        let old = unique_sibling(&destination, "old");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("marker"), "last good").unwrap();
        mark_managed(&old).unwrap();
        recover_directory(&destination).unwrap();
        assert_eq!(
            fs::read_to_string(destination.join("marker")).unwrap(),
            "last good"
        );
        assert!(!old.exists());
    }

    #[test]
    fn a_default_relative_index_uses_the_working_directory_as_its_parent() {
        assert_eq!(parent_directory(Path::new("search-index")), Path::new("."));
        assert_eq!(
            parent_directory(Path::new("cache/search-index")),
            Path::new("cache")
        );
    }

    #[test]
    fn refuses_to_replace_an_unrecognized_nonempty_directory() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("notes");
        let build = directory.path().join("build");
        fs::create_dir_all(&destination).unwrap();
        fs::create_dir_all(&build).unwrap();
        fs::write(destination.join("important.md"), "keep me").unwrap();
        fs::write(build.join("index"), "replacement").unwrap();
        let decoy = unique_sibling(&destination, "building");
        fs::create_dir_all(&decoy).unwrap();
        fs::write(decoy.join("also-important"), "keep this too").unwrap();

        let error = replace_directory(&build, &destination).unwrap_err();

        assert!(error.to_string().contains("refusing to replace"));
        assert_eq!(
            fs::read_to_string(destination.join("important.md")).unwrap(),
            "keep me"
        );
        assert!(build.exists());
        recover_directory(&destination).unwrap();
        assert!(decoy.exists());
    }

    #[test]
    fn incrementally_updates_changed_paths_without_mutating_the_old_reader() {
        let directory = tempfile::tempdir().unwrap();
        let index_path = directory.path().join("index");
        let original = vec![
            input("research/rust.md", "one", "Rust", "original wording"),
            input("archive/old.md", "two", "Old", "obsolete wording"),
        ];
        let old = LexicalIndex::build(&index_path, "commit-one", "content", &original).unwrap();
        let replacement = vec![input(
            "research/rust.md",
            "three",
            "Rust",
            "replacement wording",
        )];
        old.update(
            "commit-two",
            "content",
            &HashSet::from(["research/rust.md".to_owned(), "archive/old.md".to_owned()]),
            &replacement,
        )
        .unwrap();

        assert_eq!(
            old.search(&parse("original").unwrap(), 10).unwrap().len(),
            1
        );
        let current = LexicalIndex::open(&index_path).unwrap();
        assert_eq!(current.generation, "commit-two");
        assert_eq!(
            current.search(&parse("replacement").unwrap(), 10).unwrap()[0].blob_id,
            "three"
        );
        assert!(current
            .search(&parse("obsolete").unwrap(), 10)
            .unwrap()
            .is_empty());
    }
}
