//! Tests for the file-entry cache.
//!
//! The backend is a binary-only crate, so `tests/` would have nothing to import; this is a
//! crate-root submodule instead, which reaches every private item directly.
//!
//! Every fixture commit is made at an **explicitly chosen timestamp**. Attribution is the thing
//! under test, and an assertion against the ambient clock — or against whatever the developer's
//! global gitconfig supplies as a signature — would be flaky and machine-dependent.

use std::path::Path;

use git2::{Index, IndexEntry, IndexTime, Oid, Repository, Signature, Time};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use std::str::FromStr;
use tempfile::TempDir;

/// A throwaway git repository built commit by commit at times the test chooses.
///
/// Trees are built through an in-memory `Index`, the same way the request handlers do, so no
/// working tree or checkout is ever involved.
pub struct RepoFixture {
    _dir: TempDir,
    pub repo: Repository,
}

/// One file's desired content in a commit: `Some` writes it, `None` deletes it.
pub type FileChange<'a> = (&'a str, Option<&'a str>);

impl RepoFixture {
    pub fn new() -> Self {
        let dir = tempfile::tempdir().expect("failed to create a temporary directory");
        let repo = Repository::init(dir.path()).expect("failed to init the fixture repository");
        Self { _dir: dir, repo }
    }

    /// Commit `changes` onto `parents`, updating `ref_name`, stamped at `secs` / `offset_minutes`.
    ///
    /// The tree starts from the first parent's tree (empty for a root commit) and applies
    /// `changes` on top. For a merge, that models "take the first parent's side, then apply what
    /// the merge actually resolved to" — which lets a test express both a clean merge and a
    /// conflict resolution.
    pub fn commit_at(
        &self,
        ref_name: &str,
        parents: &[Oid],
        changes: &[FileChange],
        secs: i64,
        offset_minutes: i32,
        message: &str,
    ) -> Oid {
        let parent_commits: Vec<_> = parents
            .iter()
            .map(|oid| self.repo.find_commit(*oid).expect("unknown parent commit"))
            .collect();

        let mut index = Index::new().expect("failed to create an in-memory index");
        if let Some(first) = parent_commits.first() {
            let tree = first.tree().expect("failed to read the first parent's tree");
            index.read_tree(&tree).expect("failed to load the parent tree");
        }

        for (path, content) in changes {
            match content {
                Some(content) => {
                    let blob_oid = self
                        .repo
                        .blob(content.as_bytes())
                        .expect("failed to write a blob");
                    let entry = IndexEntry {
                        ctime: IndexTime::new(0, 0),
                        mtime: IndexTime::new(0, 0),
                        dev: 0,
                        ino: 0,
                        mode: 0o100644,
                        uid: 0,
                        gid: 0,
                        file_size: 0,
                        id: blob_oid,
                        flags: 0,
                        flags_extended: 0,
                        path: path.as_bytes().into(),
                    };
                    index.add(&entry).expect("failed to add an index entry");
                }
                None => {
                    index
                        .remove(Path::new(path), 0)
                        .expect("failed to remove an index entry");
                }
            }
        }

        let tree_oid = index
            .write_tree_to(&self.repo)
            .expect("failed to write the tree");
        let tree = self.repo.find_tree(tree_oid).expect("failed to find the tree");

        // An explicit signature, never `repo.signature()`: the ambient gitconfig must not reach
        // these assertions.
        let when = Time::new(secs, offset_minutes);
        let signature = Signature::new("Fixture", "fixture@example.invalid", &when)
            .expect("failed to build a signature");

        let parent_refs: Vec<&git2::Commit> = parent_commits.iter().collect();
        self.repo
            .commit(
                Some(ref_name),
                &signature,
                &signature,
                message,
                &tree,
                &parent_refs,
            )
            .expect("failed to commit")
    }

    /// A second handle on the same repository, shaped the way the cache functions take it.
    pub fn handle(&self) -> std::sync::Arc<std::sync::Mutex<Repository>> {
        let repo = Repository::open(self.repo.path()).expect("failed to reopen the fixture repo");
        std::sync::Arc::new(std::sync::Mutex::new(repo))
    }

    /// Point HEAD at `ref_name`, so code under test that reads `repo.head()` sees it.
    pub fn set_head(&self, ref_name: &str) {
        self.repo.set_head(ref_name).expect("failed to set HEAD");
    }

    /// The blob content at `path` in `commit`, or `None` when the path is absent.
    pub fn blob_at(&self, commit: Oid, path: &str) -> Option<String> {
        let commit = self.repo.find_commit(commit).ok()?;
        let tree = commit.tree().ok()?;
        let entry = tree.get_path(Path::new(path)).ok()?;
        let blob = self.repo.find_blob(entry.id()).ok()?;
        Some(String::from_utf8_lossy(blob.content()).into_owned())
    }
}

/// An in-memory cache database with the schema already applied.
pub async fn test_cache_db() -> SqliteConnection {
    let opts = SqliteConnectOptions::from_str("sqlite::memory:")
        .expect("failed to parse the in-memory database URL");
    let mut conn = SqliteConnection::connect_with(&opts)
        .await
        .expect("failed to open an in-memory database");
    crate::init_cache_database(&mut conn)
        .await
        .expect("failed to initialise the cache schema");
    conn
}

// ---------------------------------------------------------------------------
// T1 — the fixture harness itself
// ---------------------------------------------------------------------------

#[test]
fn fixture_builds_a_linear_history_with_chosen_times() {
    let fixture = RepoFixture::new();

    let base = fixture.commit_at(
        "refs/heads/main",
        &[],
        &[("a.md", Some("a0")), ("b.md", Some("b0"))],
        1_000,
        540,
        "base",
    );
    let second = fixture.commit_at(
        "refs/heads/main",
        &[base],
        &[("a.md", Some("a1"))],
        2_000,
        540,
        "touch a",
    );
    fixture.set_head("refs/heads/main");

    // The times are exactly what the test asked for, not the wall clock.
    let base_commit = fixture.repo.find_commit(base).unwrap();
    assert_eq!(base_commit.time().seconds(), 1_000);
    assert_eq!(base_commit.time().offset_minutes(), 540);

    // The second commit carries the first as its parent, and the tree accumulated rather than
    // being replaced: `b.md` survives even though only `a.md` was named.
    let second_commit = fixture.repo.find_commit(second).unwrap();
    assert_eq!(second_commit.parent_count(), 1);
    assert_eq!(second_commit.parent_id(0).unwrap(), base);
    assert_eq!(fixture.blob_at(second, "a.md").as_deref(), Some("a1"));
    assert_eq!(fixture.blob_at(second, "b.md").as_deref(), Some("b0"));

    // HEAD resolves, which is all the code under test asks of a repository.
    let head = fixture.repo.head().unwrap().peel_to_commit().unwrap().id();
    assert_eq!(head, second);
}

#[test]
fn fixture_builds_branches_and_merges() {
    let fixture = RepoFixture::new();

    let base = fixture.commit_at(
        "refs/heads/main",
        &[],
        &[("shared.md", Some("v0")), ("only-on-side.md", Some("v0"))],
        1_000,
        0,
        "base",
    );
    let a = fixture.commit_at(
        "refs/heads/main",
        &[base],
        &[("shared.md", Some("v1"))],
        2_000,
        0,
        "main touches shared",
    );
    let b = fixture.commit_at(
        "refs/heads/side",
        &[base],
        &[("only-on-side.md", Some("v1"))],
        3_000,
        0,
        "side touches only-on-side",
    );
    // The merge result: main's `shared.md` plus side's `only-on-side.md`.
    let m = fixture.commit_at(
        "refs/heads/main",
        &[a, b],
        &[("only-on-side.md", Some("v1"))],
        4_000,
        0,
        "merge side",
    );
    fixture.set_head("refs/heads/main");

    let merge = fixture.repo.find_commit(m).unwrap();
    assert_eq!(merge.parent_count(), 2);
    assert_eq!(merge.parent_id(0).unwrap(), a);
    assert_eq!(merge.parent_id(1).unwrap(), b);

    // The merge is TREESAME to `b` at `only-on-side.md` and to `a` at `shared.md` — the exact
    // shape the merge-attribution rules in 1.5 are distinguished by.
    assert_eq!(fixture.blob_at(m, "only-on-side.md"), fixture.blob_at(b, "only-on-side.md"));
    assert_eq!(fixture.blob_at(m, "shared.md"), fixture.blob_at(a, "shared.md"));
    assert_ne!(fixture.blob_at(m, "only-on-side.md"), fixture.blob_at(a, "only-on-side.md"));
}

#[test]
fn fixture_records_deletions() {
    let fixture = RepoFixture::new();

    let base = fixture.commit_at(
        "refs/heads/main",
        &[],
        &[("keep.md", Some("k")), ("drop.md", Some("d"))],
        1_000,
        0,
        "base",
    );
    let after = fixture.commit_at(
        "refs/heads/main",
        &[base],
        &[("drop.md", None)],
        2_000,
        0,
        "drop one",
    );

    assert_eq!(fixture.blob_at(after, "keep.md").as_deref(), Some("k"));
    assert_eq!(fixture.blob_at(after, "drop.md"), None);
}

#[tokio::test]
async fn cache_schema_applies_to_an_in_memory_database() {
    let mut conn = test_cache_db().await;

    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;",
    )
    .fetch_all(&mut conn)
    .await
    .expect("failed to list tables");

    assert!(tables.contains(&"cache_state".to_string()));
    assert!(tables.contains(&"entry".to_string()));
    assert!(tables.contains(&"openai_cache".to_string()));
}

// ---------------------------------------------------------------------------
// T6 — extract_metadata
// ---------------------------------------------------------------------------

#[test]
fn extract_metadata_reads_frontmatter_and_title() {
    let (metadata, title) = crate::extract_metadata(b"---\ntags:\n  - one\n  - two\n---\n\n# The Title\n\nBody text.\n", "text/markdown");

    let metadata = metadata.expect("expected frontmatter to be parsed");
    let tags = metadata
        .get("tags")
        .and_then(|tags| tags.as_sequence())
        .expect("expected a tags sequence");
    let tags: Vec<&str> = tags.iter().filter_map(|tag| tag.as_str()).collect();
    assert_eq!(tags, vec!["one", "two"]);

    assert_eq!(title.as_deref(), Some("The Title"));
}

#[test]
fn extract_metadata_returns_none_without_frontmatter() {
    let (metadata, title) = crate::extract_metadata(b"# Just a heading\n\nNo frontmatter here.\n", "text/markdown");
    assert!(metadata.is_none());
    assert_eq!(title.as_deref(), Some("Just a heading"));
}

#[test]
fn extract_metadata_takes_the_first_top_level_h1_only() {
    let (_, title) = crate::extract_metadata(b"## Sub first\n\n# First H1\n\n# Second H1\n", "text/markdown");
    assert_eq!(title.as_deref(), Some("First H1"));
}

#[test]
fn extract_metadata_reports_malformed_yaml_as_an_error_object() {
    // Malformed frontmatter must not fail the whole entry: it is recorded as `{error: ...}` so
    // the file still appears in the listing.
    let (metadata, _) = crate::extract_metadata(b"---\ntags: [unclosed\n---\n\n# Title\n", "text/markdown");
    let metadata = metadata.expect("expected an error object rather than None");
    assert!(
        metadata.get("error").and_then(|e| e.as_str()).is_some(),
        "expected an `error` key, got {:?}",
        metadata,
    );
}

#[test]
fn extract_metadata_bails_out_on_non_utf8_content() {
    // A JPEG header: not UTF-8, so neither metadata nor a title can be extracted.
    let (metadata, title) = crate::extract_metadata(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10], "application/octet-stream");
    assert!(metadata.is_none());
    assert!(title.is_none());
}

#[test]
fn extract_metadata_handles_an_empty_blob() {
    let (metadata, title) = crate::extract_metadata(b"", "text/markdown");
    assert!(metadata.is_none());
    assert!(title.is_none());
}

#[test]
fn extract_metadata_skips_image_blobs_even_when_they_are_valid_utf8() {
    // SVG is an image whose bytes are text, so the UTF-8 guard alone does not stop it. Parsing a
    // multi-megabyte SVG as markdown costs seconds and can never yield anything useful.
    let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"><title># Not a heading</title></svg>";

    let (metadata, title) = crate::extract_metadata(svg, "image/svg+xml");
    assert!(metadata.is_none());
    assert!(title.is_none());

    // The gate is the mime type, not the content: the same bytes under a text type are parsed.
    let markdownish = b"---\ntags: [x]\n---\n\n# Heading\n";
    let (metadata, title) = crate::extract_metadata(markdownish, "image/png");
    assert!(metadata.is_none(), "an image must never be parsed as markdown");
    assert!(title.is_none());
    let (metadata, title) = crate::extract_metadata(markdownish, "text/markdown");
    assert!(metadata.is_some());
    assert_eq!(title.as_deref(), Some("Heading"));
}

/// The paths the cache holds, sorted.
async fn cached_paths(conn: &mut SqliteConnection) -> Vec<String> {
    let mut paths: Vec<String> = sqlx::query_scalar("SELECT path FROM entry;")
        .fetch_all(&mut *conn)
        .await
        .expect("failed to read cached paths");
    paths.sort();
    paths
}

// ---------------------------------------------------------------------------
// T2 — files introduced by the root commit
// ---------------------------------------------------------------------------

#[tokio::test]
async fn rebuild_includes_a_file_introduced_by_the_root_commit() {
    // The walk attributes a file to the newest commit whose tree differs from a parent's. The
    // root commit has no parents, so a file added there and never touched again was never
    // attributed, and silently never inserted. On the real repository this is why the listing
    // held 2,169 rows for 2,170 files at HEAD.
    let fixture = RepoFixture::new();

    let root = fixture.commit_at(
        "refs/heads/main",
        &[],
        &[("root-only.md", Some("# Only ever in the root commit\n"))],
        1_000,
        0,
        "root",
    );
    let head = fixture.commit_at(
        "refs/heads/main",
        &[root],
        &[("later.md", Some("# Added later\n"))],
        2_000,
        0,
        "later",
    );
    fixture.set_head("refs/heads/main");

    let mut conn = test_cache_db().await;
    crate::rebuild_entries_cache(&mut conn, fixture.handle(), head)
        .await
        .expect("rebuild failed");

    assert_eq!(
        cached_paths(&mut conn).await,
        vec!["later.md".to_string(), "root-only.md".to_string()],
    );
}

#[tokio::test]
async fn rebuild_attributes_the_root_commit_time_to_its_files() {
    let fixture = RepoFixture::new();
    let root = fixture.commit_at(
        "refs/heads/main",
        &[],
        &[("root-only.md", Some("a")), ("touched.md", Some("v0"))],
        1_000,
        540,
        "root",
    );
    let head = fixture.commit_at(
        "refs/heads/main",
        &[root],
        &[("touched.md", Some("v1"))],
        2_000,
        540,
        "touch",
    );
    fixture.set_head("refs/heads/main");

    let mut conn = test_cache_db().await;
    crate::rebuild_entries_cache(&mut conn, fixture.handle(), head)
        .await
        .expect("rebuild failed");

    let rows: Vec<(String, i64, i64)> =
        sqlx::query_as("SELECT path, time, tz_offset FROM entry ORDER BY path;")
            .fetch_all(&mut conn)
            .await
            .expect("failed to read entries");

    assert_eq!(
        rows,
        vec![
            ("root-only.md".to_string(), 1_000, 540 * 60),
            ("touched.md".to_string(), 2_000, 540 * 60),
        ],
    );
}

// ---------------------------------------------------------------------------
// T3 — merge attribution
// ---------------------------------------------------------------------------

/// Build the merge fixture the three candidate rules are distinguished by.
///
/// ```text
///        A ──────── M      A: main, touches `shared.md`          (t=2000)
///       /          /       B: side, touches `only-on-side.md`    (t=3000)
///  base           /        M: the merge itself touches nothing   (t=4000)
///       \        /            but resolves `conflict.md` to a
///        B ──────             value matching neither parent
/// ```
fn merge_fixture() -> (RepoFixture, Oid) {
    let fixture = RepoFixture::new();

    let base = fixture.commit_at(
        "refs/heads/main",
        &[],
        &[
            ("shared.md", Some("v0")),
            ("only-on-side.md", Some("v0")),
            ("conflict.md", Some("base")),
        ],
        1_000,
        0,
        "base",
    );
    let a = fixture.commit_at(
        "refs/heads/main",
        &[base],
        &[("shared.md", Some("v1")), ("conflict.md", Some("a"))],
        2_000,
        0,
        "main side",
    );
    let b = fixture.commit_at(
        "refs/heads/side",
        &[base],
        &[("only-on-side.md", Some("v1")), ("conflict.md", Some("b"))],
        3_000,
        0,
        "branch side",
    );
    // The merge result: main's `shared.md`, side's `only-on-side.md`, and a `conflict.md`
    // resolution that matches neither parent.
    let m = fixture.commit_at(
        "refs/heads/main",
        &[a, b],
        &[("only-on-side.md", Some("v1")), ("conflict.md", Some("merged"))],
        4_000,
        0,
        "merge side",
    );
    fixture.set_head("refs/heads/main");
    (fixture, m)
}

async fn attributed_times(head: Oid, fixture: &RepoFixture) -> Vec<(String, i64)> {
    let mut conn = test_cache_db().await;
    crate::rebuild_entries_cache(&mut conn, fixture.handle(), head)
        .await
        .expect("rebuild failed");
    sqlx::query_as("SELECT path, time FROM entry ORDER BY path;")
        .fetch_all(&mut conn)
        .await
        .expect("failed to read entries")
}

/// What each candidate rule attributes, so the choice is made against timestamps rather than
/// prose. Rule (B) is asserted below; the other columns record what the rejected rules give.
///
/// | path              | (A) any parent | (B) all parents | (C) first parent |
/// |-------------------|----------------|-----------------|------------------|
/// | `shared.md`       | 4000 (merge)   | 2000 (commit A) | 2000 (commit A)  |
/// | `only-on-side.md` | 4000 (merge)   | 3000 (commit B) | 4000 (merge)     |
/// | `conflict.md`     | 4000 (merge)   | 4000 (merge)    | 4000 (merge)     |
///
/// (B) is what this cache implements: git's TREESAME rule, and what `git log -- <path>` reports.
/// The merge is skipped for a path it did not actually author, and attribution falls through to
/// the commit that did. `conflict.md` stays at the merge -- that resolution really was authored
/// there, which is what separates (B) from simply ignoring merges.
///
/// (A) was the previous behaviour: diffed against *every* parent, so anything changed on either
/// side differed from at least one of them and was attributed to the merge. Merging a year-old
/// branch stamped today's date on every file it touched -- including files it never touched, as
/// `shared.md` shows.
#[tokio::test]
async fn merge_attribution_follows_the_treesame_rule() {
    let (fixture, head) = merge_fixture();
    let times = attributed_times(head, &fixture).await;

    assert_eq!(
        times,
        vec![
            // The merge resolved this into content matching neither parent, so it did author it.
            ("conflict.md".to_string(), 4_000),
            // Authored on the side branch; the merge is TREESAME to it here.
            ("only-on-side.md".to_string(), 3_000),
            // Authored on main; the merge never touched it.
            ("shared.md".to_string(), 2_000),
        ],
        "rule (B): a merge authors only what differs from every parent",
    );
}

/// A merge that is TREESAME to one parent at a path is where the rules diverge, so pin the
/// fixture's shape rather than trusting the diagram above.
#[test]
fn merge_fixture_has_the_shape_the_rules_are_distinguished_by() {
    let (fixture, m) = merge_fixture();
    let commit = fixture.repo.find_commit(m).unwrap();
    let (a, b) = (commit.parent_id(0).unwrap(), commit.parent_id(1).unwrap());

    // TREESAME to A at `shared.md`, and to B at `only-on-side.md`.
    assert_eq!(fixture.blob_at(m, "shared.md"), fixture.blob_at(a, "shared.md"));
    assert_eq!(fixture.blob_at(m, "only-on-side.md"), fixture.blob_at(b, "only-on-side.md"));
    // But different from the *other* parent in each case, which is why rule (A) claims both.
    assert_ne!(fixture.blob_at(m, "shared.md"), fixture.blob_at(b, "shared.md"));
    assert_ne!(fixture.blob_at(m, "only-on-side.md"), fixture.blob_at(a, "only-on-side.md"));
    // And TREESAME to neither at `conflict.md`: the merge genuinely authored that content.
    assert_ne!(fixture.blob_at(m, "conflict.md"), fixture.blob_at(a, "conflict.md"));
    assert_ne!(fixture.blob_at(m, "conflict.md"), fixture.blob_at(b, "conflict.md"));
}
