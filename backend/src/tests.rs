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
    assert!(tables.contains(&"ical_cache".to_string()));
}

/// A fetched feed survives a write and comes back through the reader, like any handler-owned cache.
#[tokio::test]
async fn a_fetched_feed_round_trips_through_the_cache() {
    let dir = TempDir::new().expect("failed to create a temporary directory");
    let (reader, writer) = test_cache_pools(&dir).await;

    sqlx::query(
        "INSERT INTO ical_cache (url, body, etag, last_modified, created_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind("https://example.invalid/basic.ics")
    .bind("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")
    .bind(Some("\"abc\""))
    .bind(None::<String>)
    .bind(1_700_000_000_i64)
    .execute(&writer)
    .await
    .expect("the writer pool must accept a feed");

    let (body, etag): (String, Option<String>) =
        sqlx::query_as("SELECT body, etag FROM ical_cache WHERE url = ?")
            .bind("https://example.invalid/basic.ics")
            .fetch_one(&reader)
            .await
            .expect("the reader pool must see it");
    assert!(body.starts_with("BEGIN:VCALENDAR"));
    assert_eq!(etag.as_deref(), Some("\"abc\""));
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

// ---------------------------------------------------------------------------
// T7 — iCalendar parsing and expansion
//
// The fixtures are cut down from two feeds fetched live: Google's public "Rust releases" calendar,
// which happens to exercise TZID, RRULE, EXDATE and RECURRENCE-ID at once, and 日本の祝日, which is
// all-day throughout.
// ---------------------------------------------------------------------------

use chrono::{DateTime, FixedOffset};

fn window(from: &str, to: &str) -> (DateTime<FixedOffset>, DateTime<FixedOffset>) {
    crate::ical::parse_window(from, to).expect("the window should parse")
}

fn calendar_of(events: &str) -> icalendar::Calendar {
    let ics = format!(
        "BEGIN:VCALENDAR\r\nPRODID:-//Test//EN\r\nVERSION:2.0\r\nX-WR-TIMEZONE:Asia/Tokyo\r\n{events}END:VCALENDAR\r\n"
    );
    crate::ical::parse_calendar(&ics).expect("the fixture should parse")
}

fn starts(expansion: &crate::ical::Expansion) -> Vec<String> {
    expansion.events.iter().map(|e| e.start.clone()).collect()
}

const RUST_SERIES: &str = "\
BEGIN:VEVENT\r
DTSTART;TZID=America/Los_Angeles:20150625T100000\r
DTEND;TZID=America/Los_Angeles:20150625T110000\r
RRULE:FREQ=WEEKLY;INTERVAL=6;BYDAY=TH\r
EXDATE;TZID=America/Los_Angeles:20200130T100000\r
UID:poms@google.com\r
SUMMARY:Rust release\r
END:VEVENT\r
";

#[test]
fn a_timed_event_keeps_its_own_offset() {
    let calendar = calendar_of(
        "BEGIN:VEVENT\r\nDTSTART;TZID=America/Los_Angeles:20150625T100000\r\n\
         DTEND;TZID=America/Los_Angeles:20150625T110000\r\nUID:one@example\r\n\
         SUMMARY:Once\r\nEND:VEVENT\r\n",
    );
    let (from, to) = window("2015-06-01", "2015-07-01");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    // 10:00 in Los Angeles in June is -07:00, and the offset travels with the value.
    assert_eq!(starts(&expansion), vec!["2015-06-25 10:00:00-07:00"]);
    assert_eq!(expansion.events[0].end.as_deref(), Some("2015-06-25 11:00:00-07:00"));
    assert_eq!(expansion.events[0].name, "Once");
}

#[test]
fn an_all_day_event_spans_one_day_not_two() {
    // DTEND is exclusive in iCal -- the 12th for a holiday on the 11th -- and mory's is inclusive.
    let calendar = calendar_of(
        "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20210211\r\nDTEND;VALUE=DATE:20210212\r\n\
         UID:holiday@example\r\nSUMMARY:建国記念の日\r\nDESCRIPTION:祝日\r\nEND:VEVENT\r\n",
    );
    let (from, to) = window("2021-02-01", "2021-02-28");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    assert_eq!(starts(&expansion), vec!["2021-02-11"]);
    assert_eq!(expansion.events[0].end.as_deref(), Some("2021-02-11"));
    assert_eq!(expansion.events[0].note.as_deref(), Some("祝日"));
}

#[test]
fn a_duration_stands_in_for_a_missing_end() {
    let calendar = calendar_of(
        "BEGIN:VEVENT\r\nDTSTART;TZID=Asia/Tokyo:20240501T090000\r\nDURATION:PT1H30M\r\n\
         UID:dur@example\r\nSUMMARY:Meeting\r\nEND:VEVENT\r\n",
    );
    let (from, to) = window("2024-05-01", "2024-05-02");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    assert_eq!(expansion.events[0].end.as_deref(), Some("2024-05-01 10:30:00+09:00"));
}

#[test]
fn a_rule_is_expanded_into_the_window_only() {
    let calendar = calendar_of(RUST_SERIES);
    let (from, to) = window("2015-06-01", "2015-10-01");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    // Every six weeks on a Thursday, from 2015-06-25.
    assert_eq!(
        starts(&expansion),
        vec![
            "2015-06-25 10:00:00-07:00",
            "2015-08-06 10:00:00-07:00",
            "2015-09-17 10:00:00-07:00",
        ],
    );
}

#[test]
fn an_exdate_removes_its_occurrence_and_reaches_the_series() {
    let calendar = calendar_of(RUST_SERIES);
    // Wide enough to hold the occurrences either side of the excluded one, so what is missing is
    // visible as a gap rather than as an empty result.
    let (from, to) = window("2019-12-01", "2020-04-01");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    assert_eq!(
        starts(&expansion),
        vec!["2019-12-19 10:00:00-08:00", "2020-03-12 10:00:00-07:00"],
        "2020-01-30 falls on the rule and the EXDATE takes it out",
    );

    // ...and conversion is told, so a converted series keeps the same gap.
    let series = &expansion.series["poms@google.com"];
    assert_eq!(series.exclusions, vec!["2020-01-30 10:00:00-08:00"]);
}

#[test]
fn a_series_with_nothing_in_the_window_is_not_described_at_all() {
    // `series` exists so the popup can convert what is on screen. A feed of hundreds of one-off
    // events would otherwise describe every one of them on every request.
    let calendar = calendar_of(RUST_SERIES);
    // Narrower than the rule's six-week period, so it cannot contain an occurrence.
    let (from, to) = window("2016-01-01", "2016-01-05");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    assert!(expansion.events.is_empty());
    assert!(expansion.series.is_empty());
}

#[test]
fn a_recurrence_id_override_replaces_that_occurrence_only() {
    let calendar = calendar_of(&format!(
        "{RUST_SERIES}\
         BEGIN:VEVENT\r\nDTSTART;TZID=America/Los_Angeles:20150806T100000\r\n\
         DTEND;TZID=America/Los_Angeles:20150806T110000\r\n\
         RECURRENCE-ID;TZID=America/Los_Angeles:20150806T100000\r\n\
         UID:poms@google.com\r\nSUMMARY:Rust release: 1.2 stable\r\nEND:VEVENT\r\n",
    ));
    let (from, to) = window("2015-06-01", "2015-10-01");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    let names: Vec<_> = expansion.events.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, vec!["Rust release", "Rust release: 1.2 stable", "Rust release"]);

    // ...and conversion is told about it, so a converted series keeps the renamed occurrence.
    let series = &expansion.series["poms@google.com"];
    assert_eq!(series.overrides.len(), 1);
    assert_eq!(series.overrides[0].name.as_deref(), Some("Rust release: 1.2 stable"));
}

/// A converted series carries every override, not only those the window happened to show.
///
/// Regression: these were collected while walking the occurrences inside the window, so converting
/// the Rust series from a June 2015 view wrote one override and silently dropped the renamed 1.2
/// and 1.3 releases -- the very titles that made those occurrences worth keeping.
#[test]
fn a_series_carries_every_override_whatever_the_window_shows() {
    let calendar = calendar_of(&format!(
        "{RUST_SERIES}\
         BEGIN:VEVENT\r\nDTSTART;TZID=America/Los_Angeles:20150806T100000\r\n\
         DTEND;TZID=America/Los_Angeles:20150806T110000\r\n\
         RECURRENCE-ID;TZID=America/Los_Angeles:20150806T100000\r\n\
         UID:poms@google.com\r\nSUMMARY:Rust release: 1.2 stable\r\nEND:VEVENT\r\n\
         BEGIN:VEVENT\r\nDTSTART;TZID=America/Los_Angeles:20150917T100000\r\n\
         DTEND;TZID=America/Los_Angeles:20150917T110000\r\n\
         RECURRENCE-ID;TZID=America/Los_Angeles:20150917T100000\r\n\
         UID:poms@google.com\r\nSUMMARY:Rust release: 1.3 stable\r\nEND:VEVENT\r\n",
    ));

    // A window holding only the first occurrence, as a June 2015 month view would.
    let (from, to) = window("2015-06-01", "2015-06-30");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    assert_eq!(starts(&expansion).len(), 1, "only June is drawn");

    let overrides = &expansion.series["poms@google.com"].overrides;
    let names: Vec<_> = overrides.iter().filter_map(|o| o.name.as_deref()).collect();
    assert_eq!(names, vec!["Rust release: 1.2 stable", "Rust release: 1.3 stable"]);
    // Named in the series' own zone, so they line up with the occurrences they replace.
    assert_eq!(overrides[0].at, "2015-08-06 10:00:00-07:00");
}

#[test]
fn a_cancelled_override_removes_its_occurrence() {
    // Google deletes a single occurrence this way as readily as with an EXDATE.
    let calendar = calendar_of(&format!(
        "{RUST_SERIES}\
         BEGIN:VEVENT\r\nDTSTART;TZID=America/Los_Angeles:20150806T100000\r\n\
         RECURRENCE-ID;TZID=America/Los_Angeles:20150806T100000\r\n\
         STATUS:CANCELLED\r\nUID:poms@google.com\r\nSUMMARY:Rust release\r\nEND:VEVENT\r\n",
    ));
    let (from, to) = window("2015-06-01", "2015-10-01");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    assert_eq!(
        starts(&expansion),
        vec!["2015-06-25 10:00:00-07:00", "2015-09-17 10:00:00-07:00"],
    );

    // Both ways of deleting an occurrence reach the series as an exclusion, and a series carries
    // all of them rather than only the ones the current window happens to cover -- converting it
    // has to describe the whole series, not the part being looked at.
    let exclusions = &expansion.series["poms@google.com"].exclusions;
    assert_eq!(exclusions.len(), 2, "the fixture's own EXDATE, plus the cancelled occurrence");
    assert!(exclusions.iter().any(|e| e.starts_with("2015-08-06")), "{exclusions:?}");
    assert!(exclusions.iter().any(|e| e.starts_with("2020-01-30")), "{exclusions:?}");
}

#[test]
fn every_occurrence_carries_a_recurrence_id() {
    // Not only the ones the feed marks: a note converted from one occurrence records this to say
    // which occurrence it claims, and without it a rule-generated occurrence could never be
    // shadowed.
    let calendar = calendar_of(RUST_SERIES);
    let (from, to) = window("2015-06-01", "2015-10-01");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    for event in &expansion.events {
        assert_eq!(event.recurrence_id, event.start);
        assert_eq!(event.uid, "poms@google.com");
        assert_eq!(event.calendar, "cal");
    }
}

#[test]
fn a_rule_becomes_the_dialect_including_its_week_start() {
    // Google emits WKST=SU on nearly every weekly rule with an interval, while rrule defaults to
    // Monday. Dropping it would import a rule that means something else.
    let calendar = calendar_of(
        "BEGIN:VEVENT\r\nDTSTART;TZID=America/Los_Angeles:20150625T100000\r\n\
         RRULE:FREQ=WEEKLY;INTERVAL=6;BYDAY=TH;WKST=SU\r\nUID:w@example\r\n\
         SUMMARY:Rust release\r\nEND:VEVENT\r\n",
    );
    let (from, to) = window("2015-06-01", "2015-07-01");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    let repeat = expansion.series["w@example"].repeat.as_ref().expect("expressible");
    assert_eq!(repeat.freq, "weekly");
    assert_eq!(repeat.interval, Some(6));
    assert_eq!(repeat.byday, vec!["thu"]);
    assert_eq!(repeat.wkst.as_deref(), Some("sun"));
    // The zone, by name: the series crosses a daylight-saving change, which an offset cannot say.
    assert_eq!(repeat.tz.as_deref(), Some("America/Los_Angeles"));
}

#[test]
fn an_ordinal_weekday_survives_the_round_trip() {
    let calendar = calendar_of(
        "BEGIN:VEVENT\r\nDTSTART;TZID=Asia/Tokyo:20240501T090000\r\n\
         RRULE:FREQ=MONTHLY;BYDAY=3WE\r\nUID:nth@example\r\nSUMMARY:Third Wednesday\r\n\
         END:VEVENT\r\n",
    );
    let (from, to) = window("2024-05-01", "2024-05-31");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    assert_eq!(
        expansion.series["nth@example"].repeat.as_ref().unwrap().byday,
        vec!["3wed"],
    );
    assert_eq!(starts(&expansion), vec!["2024-05-15 09:00:00+09:00"]);
}

#[test]
fn a_rule_the_dialect_cannot_say_is_reported_as_no_rule() {
    // BYSETPOS is mostly an Outlook and Apple shape; Google writes "last Monday" as BYDAY=-1MO,
    // which the ordinal prefix does cover. Returning no rule is what makes conversion fall back to
    // listing the occurrences instead of writing a rule that means something else.
    let calendar = calendar_of(
        "BEGIN:VEVENT\r\nDTSTART;TZID=Asia/Tokyo:20240501T090000\r\n\
         RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1\r\nUID:pos@example\r\n\
         SUMMARY:Last weekday\r\nEND:VEVENT\r\n",
    );
    let (from, to) = window("2024-05-01", "2024-05-31");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    assert!(expansion.series["pos@example"].repeat.is_none());
    // The occurrences are still drawn, because rrule expands what the dialect cannot describe.
    assert_eq!(starts(&expansion), vec!["2024-05-31 09:00:00+09:00"]);
}

#[test]
fn properties_mory_has_no_key_for_are_kept_for_the_note_body() {
    let calendar = calendar_of(
        "BEGIN:VEVENT\r\nDTSTART;TZID=Asia/Tokyo:20240501T090000\r\nUID:un@example\r\n\
         SUMMARY:Meeting\r\nLOCATION:Room 401\r\nORGANIZER:mailto:someone@example.com\r\n\
         TRANSP:OPAQUE\r\nDTSTAMP:20240401T000000Z\r\nEND:VEVENT\r\n",
    );
    let (from, to) = window("2024-05-01", "2024-05-02");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    let series = &expansion.series["un@example"];
    assert_eq!(series.location.as_deref(), Some("Room 401"));
    assert!(series.unmapped.contains_key("organizer"));
    assert!(series.unmapped.contains_key("transp"));
    // Noise git already records, or that a mapped key covers, is not spilled into the body.
    assert!(!series.unmapped.contains_key("dtstamp"));
    assert!(!series.unmapped.contains_key("location"));
}

#[test]
fn a_feed_using_a_non_iana_timezone_is_reported_rather_than_dropped_silently() {
    // Outlook writes Windows zone names and defines them in a VTIMEZONE block, which the IANA
    // lookup cannot use.
    let calendar = calendar_of(
        "BEGIN:VEVENT\r\nDTSTART;TZID=W. Europe Standard Time:20240501T090000\r\n\
         RRULE:FREQ=DAILY\r\nUID:win@example\r\nSUMMARY:Outlook\r\nEND:VEVENT\r\n",
    );
    let (from, to) = window("2024-05-01", "2024-05-03");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    assert!(expansion.events.is_empty());
    assert_eq!(expansion.warnings.len(), 1);
    assert!(expansion.warnings[0].contains("win@example"));
}

#[test]
fn a_window_is_read_as_whole_days_and_must_not_run_backwards() {
    let (from, to) = window("2024-05-01", "2024-05-01");
    // A day either side of the requested range: the range names dates, occurrences are instants,
    // and each feed anchors its own in its own zone. Erring wide costs a few rows; erring narrow
    // clipped the first day of every month view of a Japanese calendar.
    assert_eq!(from.to_rfc3339(), "2024-04-30T00:00:00+00:00");
    assert_eq!(to.to_rfc3339(), "2024-05-03T00:00:00+00:00");

    assert!(crate::ical::parse_window("2024-05-02", "2024-05-01").is_err());
    assert!(crate::ical::parse_window("nonsense", "2024-05-01").is_err());
}

// ---------------------------------------------------------------------------
// T8 — which URLs a calendar feed may be fetched from
// ---------------------------------------------------------------------------

fn fetchable(url: &str) -> bool {
    crate::v2::is_fetchable_feed_url(&reqwest::Url::parse(url).expect("a parseable URL"))
}

#[test]
fn a_public_https_calendar_is_fetchable() {
    assert!(fetchable("https://calendar.google.com/calendar/ical/x/public/basic.ics"));
    assert!(fetchable("https://www.google.com/calendar/ical/x/public/basic.ics"));
    assert!(fetchable("https://outlook.office365.com/owa/calendar/x/calendar.ics"));
    // A trailing dot is the same host, written absolutely.
    assert!(fetchable("https://calendar.google.com./x.ics"));
}

#[test]
fn only_https_is_fetchable() {
    assert!(!fetchable("http://calendar.google.com/x.ics"));
    assert!(!fetchable("file:///etc/passwd"));
    assert!(!fetchable("ftp://example.com/x.ics"));
}

/// The addresses a redirect could otherwise be used to reach.
///
/// This is the check a redirect hop goes through, which is why redirects can be followed at all --
/// Google hands out `www.google.com/calendar/ical/...` links that 302 to `calendar.google.com`.
#[test]
fn loopback_private_and_link_local_addresses_are_not_fetchable() {
    for url in [
        "https://127.0.0.1/x.ics",
        "https://localhost/x.ics",
        "https://LOCALHOST/x.ics",
        "https://box.localhost/x.ics",
        "https://printer.local/x.ics",
        "https://metadata.internal/x.ics",
        "https://169.254.169.254/latest/meta-data/",
        "https://10.0.0.1/x.ics",
        "https://192.168.1.1/x.ics",
        "https://172.16.0.1/x.ics",
        "https://0.0.0.0/x.ics",
        "https://[::1]/x.ics",
        "https://[fe80::1]/x.ics",
        "https://[fc00::1]/x.ics",
        // An IPv4-mapped address is the same host in a v6 spelling; `is_loopback` is false for it.
        "https://[::ffff:127.0.0.1]/x.ics",
        "https://[::ffff:10.0.0.1]/x.ics",
        // Carrier-grade NAT.
        "https://100.64.0.1/x.ics",
    ] {
        assert!(!fetchable(url), "{url} must not be fetchable");
    }
}

#[test]
fn a_public_address_literal_is_still_fetchable() {
    // Only the private ranges are excluded, not addresses written as literals.
    assert!(fetchable("https://93.184.216.34/x.ics"));
    assert!(fetchable("https://[2606:2800:220:1:248:1893:25c8:1946]/x.ics"));
}

/// Every occurrence of a series lasts as long as the event does, not until the first one's end.
///
/// Regression: the length was measured from the occurrence being emitted rather than from DTSTART,
/// so `occurrence + (DTEND - occurrence)` collapsed back to DTEND for every occurrence -- and every
/// occurrence after the first ended *before* it started.
#[test]
fn every_occurrence_of_a_series_keeps_the_events_own_length() {
    let calendar = calendar_of(
        "BEGIN:VEVENT\r\nDTSTART;TZID=Asia/Tokyo:20240501T090000\r\n\
         DTEND;TZID=Asia/Tokyo:20240501T100000\r\nRRULE:FREQ=DAILY\r\nUID:t@example\r\n\
         SUMMARY:Daily\r\nEND:VEVENT\r\n",
    );
    let (from, to) = window("2024-05-01", "2024-05-03");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    for day in ["2024-05-01", "2024-05-02", "2024-05-03"] {
        let event = expansion
            .events
            .iter()
            .find(|e| e.start.starts_with(day))
            .unwrap_or_else(|| panic!("{day} should be drawn"));
        assert_eq!(event.end.as_deref(), Some(format!("{day} 10:00:00+09:00").as_str()));
    }
    for event in &expansion.events {
        assert!(event.end.as_deref().unwrap() > event.start.as_str(), "{event:?}");
    }
}

#[test]
fn a_multi_day_all_day_series_keeps_its_span_on_every_occurrence() {
    // DTEND is exclusive, so 20240101..20240103 is the 1st and 2nd inclusive.
    let calendar = calendar_of(
        "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20240101\r\nDTEND;VALUE=DATE:20240103\r\n\
         RRULE:FREQ=WEEKLY;BYDAY=MO\r\nUID:a@example\r\nSUMMARY:Two-day\r\nEND:VEVENT\r\n",
    );
    let (from, to) = window("2024-01-01", "2024-01-20");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    let spans: Vec<_> = expansion
        .events
        .iter()
        .map(|e| (e.start.as_str(), e.end.as_deref().unwrap()))
        .collect();
    assert!(spans.contains(&("2024-01-08", "2024-01-09")), "{spans:?}");
    assert!(spans.contains(&("2024-01-15", "2024-01-16")), "{spans:?}");
}

/// An override that moves an occurrence is drawn where it moved to.
///
/// Regression: only the *shape* of the replacement's DTSTART was read, never its time, so a meeting
/// moved from 10:00 to 16:00 was drawn at 10:00 and given the new end -- a one-hour meeting shown
/// as a seven-hour block, disagreeing with the note that converting it would write.
#[test]
fn an_override_that_moves_an_occurrence_is_drawn_at_its_new_time() {
    let calendar = calendar_of(&format!(
        "{RUST_SERIES}\
         BEGIN:VEVENT\r\nDTSTART;TZID=America/Los_Angeles:20150806T160000\r\n\
         DTEND;TZID=America/Los_Angeles:20150806T170000\r\n\
         RECURRENCE-ID;TZID=America/Los_Angeles:20150806T100000\r\n\
         UID:poms@google.com\r\nSUMMARY:Moved to the afternoon\r\nEND:VEVENT\r\n",
    ));
    let (from, to) = window("2015-08-01", "2015-08-31");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    let moved = expansion.events.iter().find(|e| e.name == "Moved to the afternoon").unwrap();
    assert_eq!(moved.start, "2015-08-06 16:00:00-07:00");
    assert_eq!(moved.end.as_deref(), Some("2015-08-06 17:00:00-07:00"));
    // The occurrence it replaces is still what identifies it.
    assert_eq!(moved.recurrence_id, "2015-08-06 10:00:00-07:00");

    // ...and the note conversion would write agrees with what is drawn.
    let override_ = &expansion.series["poms@google.com"].overrides[0];
    assert_eq!(override_.at, "2015-08-06 10:00:00-07:00");
    assert_eq!(override_.start.as_deref(), Some("2015-08-06 16:00:00-07:00"));
}

/// An all-day series is not given a timezone, because a date is not an instant.
///
/// Regression: `X-WR-TIMEZONE` anchoring made `to_repeat` write `tz: Asia/Tokyo` onto a series
/// whose `start` is a bare date. The reader then converted midnight-in-Tokyo into its own zone and
/// every date in an imported holiday feed moved a day for anyone west of it.
#[test]
fn an_all_day_series_carries_no_timezone() {
    let calendar = calendar_of(
        "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20240506\r\nDTEND;VALUE=DATE:20240507\r\n\
         RRULE:FREQ=WEEKLY;BYDAY=MO\r\nUID:ad@example\r\nSUMMARY:Holiday\r\nEND:VEVENT\r\n",
    );
    let (from, to) = window("2024-05-01", "2024-05-31");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    let repeat = expansion.series["ad@example"].repeat.as_ref().expect("expressible");
    assert_eq!(repeat.tz, None);

    // ...while a timed series in the same feed still names its zone.
    let timed = calendar_of(
        "BEGIN:VEVENT\r\nDTSTART;TZID=America/Los_Angeles:20240506T100000\r\n\
         RRULE:FREQ=WEEKLY\r\nUID:t@example\r\nSUMMARY:Timed\r\nEND:VEVENT\r\n",
    );
    let (from, to) = window("2024-05-01", "2024-05-31");
    let timed = crate::ical::expand(&timed, "cal", from, to);
    assert_eq!(
        timed.series["t@example"].repeat.as_ref().unwrap().tz.as_deref(),
        Some("America/Los_Angeles"),
    );
}

/// `BYMONTHDAY=-1` survives, rather than reading back as no restriction at all.
///
/// Regression: rrule splits BYMONTHDAY into positive and negative lists when it validates and
/// exposes a getter only for the positive one, so "the last day of the month" silently became
/// "every month" -- and the note claimed the whole series, hiding the occurrences it had lost.
#[test]
fn a_negative_month_day_survives_the_round_trip() {
    let calendar = calendar_of(
        "BEGIN:VEVENT\r\nDTSTART;TZID=Asia/Tokyo:20240131T090000\r\n\
         RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=5\r\nUID:neg@example\r\n\
         SUMMARY:Month end\r\nEND:VEVENT\r\n",
    );
    let (from, to) = window("2024-01-01", "2024-05-31");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    assert_eq!(
        expansion.series["neg@example"].repeat.as_ref().unwrap().bymonthday,
        vec![-1],
    );
    // Five month-ends, including the leap-year February.
    let days: Vec<_> = expansion.events.iter().map(|e| e.start[..10].to_string()).collect();
    assert_eq!(
        days,
        vec!["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30", "2024-05-31"],
    );
}

/// `UNTIL` is written in the series' own zone, since the reader takes rule values as wall clock.
///
/// Regression: rrule keeps UNTIL in UTC and it was formatted as such, so the cut-off was compared
/// against occurrences in a different frame and the series gained or lost its final occurrence.
#[test]
fn until_is_written_in_the_series_own_zone() {
    let calendar = calendar_of(
        "BEGIN:VEVENT\r\nDTSTART;TZID=Asia/Tokyo:20260101T160000\r\n\
         RRULE:FREQ=DAILY;UNTIL=20260105T070000Z\r\nUID:u@example\r\n\
         SUMMARY:Bounded\r\nEND:VEVENT\r\n",
    );
    let (from, to) = window("2026-01-01", "2026-01-10");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    // 07:00Z is 16:00 JST, the last occurrence.
    assert_eq!(
        expansion.series["u@example"].repeat.as_ref().unwrap().until.as_deref(),
        Some("2026-01-05 16:00:00+09:00"),
    );
}

/// A cancelled override is spelled like the occurrence it removes, so the exclusion matches.
///
/// Regression: a timed RECURRENCE-ID was reduced to a bare date, which matched no occurrence once
/// converted -- so the deleted occurrence came back, and was reported as a bad adjustment too.
#[test]
fn a_cancelled_override_is_excluded_at_its_own_time() {
    let calendar = calendar_of(&format!(
        "{RUST_SERIES}\
         BEGIN:VEVENT\r\nDTSTART;TZID=America/Los_Angeles:20150806T100000\r\n\
         RECURRENCE-ID;TZID=America/Los_Angeles:20150806T100000\r\n\
         STATUS:CANCELLED\r\nUID:poms@google.com\r\nSUMMARY:Rust release\r\nEND:VEVENT\r\n",
    ));
    let (from, to) = window("2015-06-01", "2015-10-01");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    let exclusions = &expansion.series["poms@google.com"].exclusions;
    assert!(
        exclusions.contains(&"2015-08-06 10:00:00-07:00".to_string()),
        "a timed cancellation keeps its time: {exclusions:?}",
    );
}

/// An override with no base series keeps its own time and end.
///
/// Regression: both arms of the formatting reduced it to a bare date, so a 90-minute meeting drew
/// in the all-day row with no end at all -- and the null end then threw in the client.
#[test]
fn an_orphan_override_keeps_its_time() {
    let calendar = calendar_of(
        "BEGIN:VEVENT\r\nDTSTART;TZID=Asia/Tokyo:20240513T150000\r\n\
         DTEND;TZID=Asia/Tokyo:20240513T163000\r\n\
         RECURRENCE-ID;TZID=Asia/Tokyo:20240513T100000\r\n\
         UID:orphan@example\r\nSUMMARY:Moved standup\r\nEND:VEVENT\r\n",
    );
    let (from, to) = window("2024-05-01", "2024-05-31");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    assert_eq!(expansion.events.len(), 1);
    let event = &expansion.events[0];
    assert!(event.start.contains("15:00"), "{}", event.start);
    assert!(event.end.as_deref().unwrap().contains("16:30"), "{:?}", event.end);
}

/// An override whose length is a DURATION reaches the note as a time, not as `PT90M`.
#[test]
fn an_override_duration_is_resolved_before_it_reaches_the_note() {
    let calendar = calendar_of(&format!(
        "{RUST_SERIES}\
         BEGIN:VEVENT\r\nDTSTART;TZID=America/Los_Angeles:20150806T100000\r\n\
         DURATION:PT90M\r\n\
         RECURRENCE-ID;TZID=America/Los_Angeles:20150806T100000\r\n\
         UID:poms@google.com\r\nSUMMARY:Longer one\r\nEND:VEVENT\r\n",
    ));
    let (from, to) = window("2015-08-01", "2015-08-31");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    let end = expansion.series["poms@google.com"].overrides[0].end.as_deref().unwrap();
    assert_eq!(end, "2015-08-06 11:30:00-07:00", "not the raw iCal spelling");
}

/// A hostile DURATION cannot take the request down.
#[test]
fn an_absurd_duration_is_refused_rather_than_panicking() {
    let calendar = calendar_of(
        "BEGIN:VEVENT\r\nDTSTART;TZID=Asia/Tokyo:20240501T090000\r\n\
         DURATION:P999999999999D\r\nUID:boom@example\r\nSUMMARY:Overflow\r\nEND:VEVENT\r\n",
    );
    let (from, to) = window("2024-05-01", "2024-05-02");
    let expansion = crate::ical::expand(&calendar, "cal", from, to);

    // The event still appears; only its end is unusable.
    assert_eq!(expansion.events.len(), 1);
    assert_eq!(expansion.events[0].end, None);
}
