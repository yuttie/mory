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
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection, SqlitePool, SqlitePoolOptions};
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

/// The reader/writer pool pair the server builds, over one temporary database file.
///
/// `sqlite::memory:` cannot stand in here: each connection to it gets its own private database, so
/// a reader pool would see nothing a writer pool wrote regardless of permissions, and the very
/// thing under test would be invisible.
async fn test_cache_pools(dir: &TempDir) -> (SqlitePool, SqlitePool) {
    let url = format!("sqlite://{}", dir.path().join("cache.sqlite").display());
    let opts = SqliteConnectOptions::from_str(&url)
        .expect("failed to parse the cache database URL")
        .create_if_missing(true);

    let mut writer_conn = SqliteConnection::connect_with(&opts.clone().read_only(false))
        .await
        .expect("failed to open the writer connection");
    crate::init_cache_database(&mut writer_conn)
        .await
        .expect("failed to initialise the cache schema");

    let writer = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts.clone().read_only(false))
        .await
        .expect("failed to open the writer pool");
    let reader = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(opts.read_only(true))
        .await
        .expect("failed to open the reader pool");
    (reader, writer)
}

async fn insert_openai_row(pool: &SqlitePool, hash: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO openai_cache (request_hash, request_data, response_data, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(request_hash) DO UPDATE SET
             response_data = excluded.response_data,
             created_at = excluded.created_at;",
    )
    .bind(hash)
    .bind("{}")
    .bind("{}")
    .bind(0_i64)
    .execute(pool)
    .await
    .map(|_| ())
}

/// A handler-owned cache is writable through `cache_db_writer` and not through `cache_db`.
///
/// Regression: every handler-owned cache write used to go through the read-only reader pool, fail
/// with "attempt to write a readonly database", and be swallowed by a `debug!`. `openai_cache` was
/// therefore empty in production while `entry` -- written by `cache_manager_task`, which holds its
/// own connection -- was full. The asserted failure below is the whole point of the second pool.
#[tokio::test]
async fn handler_owned_caches_are_writable_only_through_the_writer_pool() {
    let dir = TempDir::new().expect("failed to create a temporary directory");
    let (reader, writer) = test_cache_pools(&dir).await;

    let denied = insert_openai_row(&reader, "through-the-reader").await;
    assert!(denied.is_err(), "the reader pool must refuse a write");

    insert_openai_row(&writer, "through-the-writer")
        .await
        .expect("the writer pool must accept a write");

    // Read it back through the reader, which is what a handler actually serves from.
    let cached: i64 = sqlx::query_scalar("SELECT count(*) FROM openai_cache")
        .fetch_one(&reader)
        .await
        .expect("failed to count the cached rows");
    assert_eq!(cached, 1);
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

/// Sync the cache to `head` from whatever it currently holds, the way the server would.
async fn sync_to(
    conn: &mut SqliteConnection,
    fixture: &RepoFixture,
    head: Oid,
) -> anyhow::Result<()> {
    let base: Option<String> = sqlx::query_scalar("SELECT value FROM cache_state WHERE key = 'commit_id';")
        .fetch_optional(&mut *conn)
        .await
        .unwrap_or(None);
    let state = match base.and_then(|id| Oid::from_str(&id).ok()) {
        Some(base) if base == head => crate::CacheState::Fresh(head),
        Some(base) if fixture.repo.find_commit(base).is_ok() => {
            crate::CacheState::Behind { base, head }
        }
        _ => crate::CacheState::Cold(head),
    };
    crate::sync_cache_to(conn, fixture.handle(), state).await
}

/// Sync from an empty cache, the full-rebuild path.
async fn cold_sync(conn: &mut SqliteConnection, fixture: &RepoFixture, head: Oid) {
    crate::sync_cache_to(conn, fixture.handle(), crate::CacheState::Cold(head))
        .await
        .expect("cold sync failed");
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
    cold_sync(&mut conn, &fixture, head).await;

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
    cold_sync(&mut conn, &fixture, head).await;

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
    cold_sync(&mut conn, &fixture, head).await;
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

// ---------------------------------------------------------------------------
// T5 — the single-generation schema
// ---------------------------------------------------------------------------

#[tokio::test]
async fn the_entry_table_holds_one_row_per_path() {
    // The previous schema keyed rows by (commit_id, path) and copied every row forward on each
    // commit, so the table grew without bound -- 75,873 rows for a 2,170-entry listing. `path`
    // is now the primary key, so a second rebuild cannot accumulate anything.
    let fixture = RepoFixture::new();
    let first = fixture.commit_at(
        "refs/heads/main",
        &[],
        &[("a.md", Some("a0")), ("b.md", Some("b0"))],
        1_000,
        0,
        "base",
    );
    fixture.set_head("refs/heads/main");

    let mut conn = test_cache_db().await;
    sync_to(&mut conn, &fixture, first).await.expect("first rebuild failed");
    assert_eq!(cached_paths(&mut conn).await, vec!["a.md", "b.md"]);

    // A second commit, then a full rebuild over the same table.
    let second = fixture.commit_at(
        "refs/heads/main",
        &[first],
        &[("a.md", Some("a1")), ("c.md", Some("c0"))],
        2_000,
        0,
        "more",
    );
    sync_to(&mut conn, &fixture, second).await.expect("second rebuild failed");

    assert_eq!(cached_paths(&mut conn).await, vec!["a.md", "b.md", "c.md"]);
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM entry;")
        .fetch_one(&mut conn)
        .await
        .unwrap();
    assert_eq!(rows, 3, "a rebuild must replace the generation, not add one");
}

#[tokio::test]
async fn a_rebuild_drops_paths_that_no_longer_exist() {
    let fixture = RepoFixture::new();
    let first = fixture.commit_at(
        "refs/heads/main",
        &[],
        &[("keep.md", Some("k")), ("gone.md", Some("g"))],
        1_000,
        0,
        "base",
    );
    let second = fixture.commit_at("refs/heads/main", &[first], &[("gone.md", None)], 2_000, 0, "rm");
    fixture.set_head("refs/heads/main");

    let mut conn = test_cache_db().await;
    sync_to(&mut conn, &fixture, first).await.unwrap();
    assert_eq!(cached_paths(&mut conn).await, vec!["gone.md", "keep.md"]);

    sync_to(&mut conn, &fixture, second).await.unwrap();
    assert_eq!(cached_paths(&mut conn).await, vec!["keep.md"]);
}

#[tokio::test]
async fn cached_rows_carry_the_blob_id_and_never_a_null_metadata() {
    let fixture = RepoFixture::new();
    let head = fixture.commit_at(
        "refs/heads/main",
        &[],
        &[
            ("with-meta.md", Some("---\ntags: [x]\n---\n\n# Titled\n")),
            ("plain.md", Some("no frontmatter, no heading\n")),
        ],
        1_000,
        0,
        "base",
    );
    fixture.set_head("refs/heads/main");

    let mut conn = test_cache_db().await;
    sync_to(&mut conn, &fixture, head).await.unwrap();

    let rows: Vec<(String, String, String, Option<String>)> =
        sqlx::query_as("SELECT path, blob_id, metadata, title FROM entry ORDER BY path;")
            .fetch_all(&mut conn)
            .await
            .unwrap();
    assert_eq!(rows.len(), 2);

    for (path, blob_id, metadata, _) in &rows {
        // The blob id must be the one actually in HEAD's tree: it is what lets a cold sync tell
        // an unchanged path from a changed one without any commit to diff against.
        let entry = fixture
            .repo
            .find_commit(head)
            .unwrap()
            .tree()
            .unwrap()
            .get_path(Path::new(path))
            .unwrap();
        assert_eq!(blob_id, &entry.id().to_string(), "{path} has the wrong blob id");

        // `metadata` is declared NOT NULL and absent metadata is stored as the JSON text "null",
        // which is what the row mapper's `serde_json::from_str` expects. A SQL NULL here would
        // panic it.
        assert!(!metadata.is_empty());
        serde_json::from_str::<Option<serde_yaml::Value>>(metadata)
            .expect("metadata must be valid JSON");
    }

    let (_, _, plain_meta, plain_title) = &rows[0];
    assert_eq!(plain_meta, "null");
    assert_eq!(plain_title.as_deref(), None);
}

// ---------------------------------------------------------------------------
// T4 — sync change sets
// ---------------------------------------------------------------------------

async fn cached_commit(conn: &mut SqliteConnection) -> Option<String> {
    sqlx::query_scalar("SELECT value FROM cache_state WHERE key = 'commit_id';")
        .fetch_optional(&mut *conn)
        .await
        .unwrap()
}

async fn time_of(conn: &mut SqliteConnection, path: &str) -> i64 {
    sqlx::query_scalar("SELECT time FROM entry WHERE path = ?;")
        .bind(path)
        .fetch_one(&mut *conn)
        .await
        .unwrap_or_else(|_| panic!("{path} is not in the cache"))
}

#[tokio::test]
async fn a_fast_forward_touches_only_what_changed() {
    let fixture = RepoFixture::new();
    let first = fixture.commit_at(
        "refs/heads/main",
        &[],
        &[("a.md", Some("a0")), ("b.md", Some("b0"))],
        1_000,
        0,
        "base",
    );
    fixture.set_head("refs/heads/main");
    let mut conn = test_cache_db().await;
    sync_to(&mut conn, &fixture, first).await.unwrap();

    let second = fixture.commit_at(
        "refs/heads/main",
        &[first],
        &[("a.md", Some("a1")), ("c.md", Some("c0"))],
        2_000,
        0,
        "edit a, add c",
    );
    sync_to(&mut conn, &fixture, second).await.unwrap();

    assert_eq!(cached_paths(&mut conn).await, vec!["a.md", "b.md", "c.md"]);
    assert_eq!(time_of(&mut conn, "a.md").await, 2_000);
    assert_eq!(time_of(&mut conn, "c.md").await, 2_000);
    // Untouched, so it keeps the time it was authored at.
    assert_eq!(time_of(&mut conn, "b.md").await, 1_000);
    assert_eq!(cached_commit(&mut conn).await.as_deref(), Some(second.to_string().as_str()));
}

#[tokio::test]
async fn a_deletion_drops_the_row() {
    let fixture = RepoFixture::new();
    let first = fixture.commit_at(
        "refs/heads/main",
        &[],
        &[("keep.md", Some("k")), ("gone.md", Some("g"))],
        1_000,
        0,
        "base",
    );
    fixture.set_head("refs/heads/main");
    let mut conn = test_cache_db().await;
    sync_to(&mut conn, &fixture, first).await.unwrap();

    let second =
        fixture.commit_at("refs/heads/main", &[first], &[("gone.md", None)], 2_000, 0, "rm");
    sync_to(&mut conn, &fixture, second).await.unwrap();

    assert_eq!(cached_paths(&mut conn).await, vec!["keep.md"]);
}

#[tokio::test]
async fn a_rewritten_history_with_the_same_tree_is_free() {
    // This is the property the whole force-push argument rests on. `diff_tree_to_tree` does not
    // care whether two commits share history, so a rewrite that preserves the tree -- a squash, a
    // reworded amend, a rebase that changed nothing -- produces an empty change set and costs one
    // tree comparison, not a rebuild.
    let fixture = RepoFixture::new();
    let base = fixture.commit_at("refs/heads/main", &[], &[("a.md", Some("a0"))], 1_000, 0, "base");
    let a = fixture.commit_at("refs/heads/main", &[base], &[("a.md", Some("a1"))], 2_000, 0, "edit");
    let head = fixture.commit_at("refs/heads/main", &[a], &[("b.md", Some("b0"))], 3_000, 0, "add b");
    fixture.set_head("refs/heads/main");

    let mut conn = test_cache_db().await;
    sync_to(&mut conn, &fixture, head).await.unwrap();
    let times_before = (time_of(&mut conn, "a.md").await, time_of(&mut conn, "b.md").await);

    // Squash the same content onto `base`: a different commit, unreachable from the old head,
    // with a byte-identical tree.
    let squashed = fixture.commit_at(
        "refs/heads/rewritten",
        &[base],
        &[("a.md", Some("a1")), ("b.md", Some("b0"))],
        9_000,
        0,
        "squashed",
    );
    assert_eq!(
        fixture.repo.find_commit(squashed).unwrap().tree_id(),
        fixture.repo.find_commit(head).unwrap().tree_id(),
        "the fixture must produce an identical tree for this test to mean anything",
    );

    sync_to(&mut conn, &fixture, squashed).await.unwrap();

    // The label moved; nothing else did. The squash commit carries `a.md` and `b.md`, so on a
    // fast-forward they would be re-attributed -- but a rewritten history authored no content
    // here, and stamping the rewrite's time on every file it happened to carry is exactly the
    // churn the TREESAME rule exists to avoid.
    assert_eq!(cached_commit(&mut conn).await.as_deref(), Some(squashed.to_string().as_str()));
    assert_eq!(cached_paths(&mut conn).await, vec!["a.md", "b.md"]);
    assert_eq!(
        (time_of(&mut conn, "a.md").await, time_of(&mut conn, "b.md").await),
        times_before,
    );
}

#[tokio::test]
async fn a_rewritten_history_with_a_different_tree_syncs_by_tree_diff() {
    let fixture = RepoFixture::new();
    let base = fixture.commit_at(
        "refs/heads/main",
        &[],
        &[("a.md", Some("a0")), ("b.md", Some("b0"))],
        1_000,
        0,
        "base",
    );
    let head = fixture.commit_at(
        "refs/heads/main",
        &[base],
        &[("a.md", Some("a1")), ("c.md", Some("c0"))],
        2_000,
        0,
        "edit",
    );
    fixture.set_head("refs/heads/main");
    let mut conn = test_cache_db().await;
    sync_to(&mut conn, &fixture, head).await.unwrap();
    assert_eq!(cached_paths(&mut conn).await, vec!["a.md", "b.md", "c.md"]);

    // A diverged branch: `c.md` never existed there, `a.md` has different content.
    let other = fixture.commit_at(
        "refs/heads/other",
        &[base],
        &[("a.md", Some("a2"))],
        3_000,
        0,
        "diverged",
    );
    sync_to(&mut conn, &fixture, other).await.unwrap();

    assert_eq!(cached_paths(&mut conn).await, vec!["a.md", "b.md"]);
    assert_eq!(time_of(&mut conn, "a.md").await, 3_000);
    assert_eq!(time_of(&mut conn, "b.md").await, 1_000);
}

#[tokio::test]
async fn a_cold_sync_reuses_rows_whose_blob_is_unchanged() {
    // When the cached commit's object is gone -- force-push then gc -- there is no tree to diff
    // against, so the sync reconciles HEAD's tree against the stored blob ids instead. Rows whose
    // content is unchanged must be left completely alone, which is what makes a cold sync cheap
    // rather than a full rebuild.
    let fixture = RepoFixture::new();
    let base = fixture.commit_at(
        "refs/heads/main",
        &[],
        &[("stable.md", Some("s")), ("edited.md", Some("e0"))],
        1_000,
        0,
        "base",
    );
    let head = fixture.commit_at(
        "refs/heads/main",
        &[base],
        &[("edited.md", Some("e1"))],
        2_000,
        0,
        "edit",
    );
    fixture.set_head("refs/heads/main");

    let mut conn = test_cache_db().await;
    sync_to(&mut conn, &fixture, head).await.unwrap();

    // Mark the untouched row so it is possible to tell whether the sync rewrote it.
    sqlx::query("UPDATE entry SET time = 424242 WHERE path = 'stable.md';")
        .execute(&mut conn)
        .await
        .unwrap();

    // Forget which commit the rows describe, which is what losing the base object to a gc looks
    // like: the rows survive, but there is no commit left to diff against.
    sqlx::query("DELETE FROM cache_state WHERE key = 'commit_id';")
        .execute(&mut conn)
        .await
        .unwrap();
    crate::sync_cache_to(&mut conn, fixture.handle(), crate::CacheState::Cold(head))
        .await
        .unwrap();

    assert_eq!(
        time_of(&mut conn, "stable.md").await,
        424_242,
        "an unchanged blob must not be re-read, re-parsed or re-attributed",
    );
    assert_eq!(time_of(&mut conn, "edited.md").await, 2_000);
    assert_eq!(cached_commit(&mut conn).await.as_deref(), Some(head.to_string().as_str()));
}

#[tokio::test]
async fn a_cold_sync_drops_rows_that_are_no_longer_in_head() {
    let fixture = RepoFixture::new();
    let head = fixture.commit_at("refs/heads/main", &[], &[("a.md", Some("a"))], 1_000, 0, "base");
    fixture.set_head("refs/heads/main");

    let mut conn = test_cache_db().await;
    sync_to(&mut conn, &fixture, head).await.unwrap();

    // A row for a path that HEAD does not contain, as a force-push to an older state would leave.
    sqlx::query(
        "INSERT INTO entry VALUES ('stale.md', 'deadbeef', 1, 'text/markdown', 'null', NULL, 1, 0);",
    )
    .execute(&mut conn)
    .await
    .unwrap();
    sqlx::query("DELETE FROM cache_state WHERE key = 'commit_id';")
        .execute(&mut conn)
        .await
        .unwrap();

    crate::sync_cache_to(&mut conn, fixture.handle(), crate::CacheState::Cold(head))
        .await
        .unwrap();

    assert_eq!(cached_paths(&mut conn).await, vec!["a.md"]);
}

#[tokio::test]
async fn a_file_reverted_to_earlier_content_still_gets_the_newer_time() {
    // Found by comparing an incremental sync against a full rebuild on the real repository: one
    // row out of 2,170 disagreed. The blob was byte-identical at both endpoints, so the tree diff
    // reported nothing, but the file had been edited and reverted in between and its recorded
    // time stayed at the older edit. `git log -1 -- <path>` reports the revert's time, and so
    // must the cache.
    let fixture = RepoFixture::new();
    let base = fixture.commit_at(
        "refs/heads/main",
        &[],
        &[("note.md", Some("original")), ("other.md", Some("x"))],
        1_000,
        0,
        "base",
    );
    fixture.set_head("refs/heads/main");

    let mut conn = test_cache_db().await;
    sync_to(&mut conn, &fixture, base).await.unwrap();
    assert_eq!(time_of(&mut conn, "note.md").await, 1_000);

    // Edit it, then put the original content back.
    let edited =
        fixture.commit_at("refs/heads/main", &[base], &[("note.md", Some("edited"))], 2_000, 0, "edit");
    let reverted = fixture.commit_at(
        "refs/heads/main",
        &[edited],
        &[("note.md", Some("original"))],
        3_000,
        0,
        "revert",
    );
    assert_eq!(
        fixture.blob_at(reverted, "note.md"),
        fixture.blob_at(base, "note.md"),
        "the point of this test is that the endpoints are identical",
    );

    sync_to(&mut conn, &fixture, reverted).await.unwrap();

    assert_eq!(
        time_of(&mut conn, "note.md").await,
        3_000,
        "the revert authored this content and must own its time",
    );
    // A file untouched across the window keeps its original time, as before.
    assert_eq!(time_of(&mut conn, "other.md").await, 1_000);
}

#[tokio::test]
async fn a_file_added_then_deleted_within_the_window_is_not_resurrected() {
    // `paths_touched_since` is deliberately liberal, so a path that came and went inside the
    // window is in the touched set but absent from HEAD. It must not be inserted.
    let fixture = RepoFixture::new();
    let base = fixture.commit_at("refs/heads/main", &[], &[("keep.md", Some("k"))], 1_000, 0, "base");
    fixture.set_head("refs/heads/main");
    let mut conn = test_cache_db().await;
    sync_to(&mut conn, &fixture, base).await.unwrap();

    let added =
        fixture.commit_at("refs/heads/main", &[base], &[("temp.md", Some("t"))], 2_000, 0, "add");
    let removed =
        fixture.commit_at("refs/heads/main", &[added], &[("temp.md", None)], 3_000, 0, "rm");
    sync_to(&mut conn, &fixture, removed).await.unwrap();

    assert_eq!(cached_paths(&mut conn).await, vec!["keep.md"]);
}

#[tokio::test]
async fn syncing_to_a_commit_the_cache_already_describes_does_nothing() {
    // A mutation nudges the writer, and the read that follows nudges again from the same reading
    // taken before the first sync landed. Both name a commit the cache has since reached, so the
    // second must be a no-op rather than redoing the diff and rewriting rows.
    let fixture = RepoFixture::new();
    let head = fixture.commit_at("refs/heads/main", &[], &[("a.md", Some("a"))], 1_000, 0, "base");
    fixture.set_head("refs/heads/main");

    let mut conn = test_cache_db().await;
    sync_to(&mut conn, &fixture, head).await.unwrap();

    // A marker that a redundant sync would overwrite.
    sqlx::query("UPDATE entry SET time = 424242 WHERE path = 'a.md';")
        .execute(&mut conn)
        .await
        .unwrap();

    // Replay a stale request naming a commit already reached.
    crate::sync_cache_to(&mut conn, fixture.handle(), crate::CacheState::Cold(head))
        .await
        .unwrap();

    assert_eq!(time_of(&mut conn, "a.md").await, 424_242);
}
