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
    let (metadata, title) = crate::extract_metadata(
        b"---\ntags:\n  - one\n  - two\n---\n\n# The Title\n\nBody text.\n",
    );

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
    let (metadata, title) = crate::extract_metadata(b"# Just a heading\n\nNo frontmatter here.\n");
    assert!(metadata.is_none());
    assert_eq!(title.as_deref(), Some("Just a heading"));
}

#[test]
fn extract_metadata_takes_the_first_top_level_h1_only() {
    let (_, title) = crate::extract_metadata(b"## Sub first\n\n# First H1\n\n# Second H1\n");
    assert_eq!(title.as_deref(), Some("First H1"));
}

#[test]
fn extract_metadata_reports_malformed_yaml_as_an_error_object() {
    // Malformed frontmatter must not fail the whole entry: it is recorded as `{error: ...}` so
    // the file still appears in the listing.
    let (metadata, _) = crate::extract_metadata(b"---\ntags: [unclosed\n---\n\n# Title\n");
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
    let (metadata, title) = crate::extract_metadata(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    assert!(metadata.is_none());
    assert!(title.is_none());
}

#[test]
fn extract_metadata_handles_an_empty_blob() {
    let (metadata, title) = crate::extract_metadata(b"");
    assert!(metadata.is_none());
    assert!(title.is_none());
}
