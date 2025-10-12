## [Unreleased]

### 🚀 Features

- [**breaking**] Add `commit` column to `entry` table for multi-version support
  - The `entry` table now uses a composite primary key `(commit, path)` instead of just `path`
  - This allows multiple versions of entry sets to coexist in the cache database
  - Enables smaller insertion transactions and atomic switching of entry sets
  - **Migration required:** Delete `cache.sqlite` to allow it to be recreated with the new schema

## [1.5.1] - 2025-09-12

### 🐛 Bug Fixes

- *(backend)* Add support for gzip and brotli compression, use rustls for TLS
- *(backend/Dockerfile)* Add missing "ca-certificates" package

### 🚜 Refactor

- *(backend)* Prefix debug!() with tracing::
- *(backend)* Use tracing::error! for logging errors instead of tracing::debug!
- *(backend)* Preserve error chains by replacing .map_err() with .context()

### ⚙️ Miscellaneous Tasks

- *(backend)* Allow all trace verbosity levels at compile time

## [1.5.0] - 2025-09-11

### 🚀 Features

- [**breaking**] Give better name to env var of session expiry minutes
- *(backend/OpenAI API)* Add OpenAI API response caching to reduce costs and improve performance (#184)
- *(views/TasksNext)* Add automatic task title assessment feature with ancestor context using OpenAI API (#183)

## [1.4.1] - 2025-08-27

### 🐛 Bug Fixes

- *(docker)* Update image for production stage due to compiled binary requiring glibc-2.39

## [1.4.0] - 2025-08-17

### 🚀 Features

- *(api)* Support tree-structured response via ?format=tree
- *(api)* Add provisional endpoints for retrieving tasks and events

## [1.3.1] - 2025-08-09

### 🐛 Bug Fixes

- *(CORS)* Allow If-None-Match header in requests

### ⚙️ Miscellaneous Tasks

- *(changelog)* Correct style of old entries so that they match current one

## [1.3.0] - 2025-08-07

### 🚀 Features

- Optimize cache update by directly modify database without creating Vec<ListEntry> on memory
- Perform delta update on cacheed file entries whenever possible
- [**breaking**] Use SQLite database for storing file entries cache
- *(v2)* Add `HEAD /v2/files/*path`
- *(v2)* Add `GET /v2/files/*path`
- Add new API endpoint for searching with `git grep`
- Add a new route `/commit_id`, which returns the commit ID pointed by HEAD
- Cache the results of image size reduction
- Improve the input file format detection of `magick` command by specifying a temporary file as input
- Implement image size reduction
- Extract titles as well as metadata

### 🐛 Bug Fixes

- Relax timeout for database unlock to accommodate long-running exclusive transactions
- Ensure atomic update of file entries cache to resolve race condition
- Handle last modified time for files created by copy or rename
- Simplify logic and handle cases where identical blobs exist at different paths
- *(Dockerfile)* Fix warnings
- *(Dockerfile)* Install `git` command
- Fix warnings
- Install `imagemagick` and `inkscape` in production-stage container
- Use `convert` instead of `magick` for better backward compatibility
- Return an original version if conversion failed

### 🚜 Refactor

- *(mutex)* Replace tokio::sync::Mutex with std::sync::Mutex for git2::Repository
- Optimize rebuilding entries cache from scratch eliminating intermediate Vec<ListEntry>
- Collect_recent_file_ops()): Eliminate unnecessary time conversion
- Rename variables following previous function rename
- Store metadata as JSON strings in cache database for better usability
- Remove unused imports
- Rename collect_latest_ops() to collect_recent_file_ops()
- Remove Arc around AppState
- Eliminate nested pattern matching in entry update logic by merging inner match arms into outer match's
- Extract MIME-guessing logic from functions into new function
- Extract file entry collecting logic from get_notes() into new function
- Use remove() to streamline entry updates and avoid redundant state tracking
- Make comment more precise
- Add type annotation
- Inline found variable and simplify matching logic
- Extract ListEntry creation logic from get_notes() into new function
- Add comment describing our current assumption
- Improve comment
- Extract updating logic for cached repository file entry list
- Extract logic to collect latest operations on files from get_notes() handler
- *(main)* Change return type to Result<()>
- Remove unnecessary .unwrap()
- Extract shared blob lookup & response logic into helper functions
- Prefix Axum extractors with `extract::`
- Move HEAD commit ID endpoint to API v2 with new name
- Use tokio::process::Command instead of std::process::Command
- Remove debug print

### 🎨 Styling

- *(Cargo.toml)* Sort dependencies

### ⚙️ Miscellaneous Tasks

- Update dependencies
- Remove unused dependencies
- Remove unused `rmp-serde` dependency after migrating cache to SQLite
- Add bacon.toml

## [1.2.0] - 2024-09-13

- Disable trace and debug level logs in release builds for performance
- Extract titles as well as metadata
- Upgrade dependencies to their latest versions

## [1.1.0] - 2024-08-14

- Upgrade dependencies to their latest versions
- Relax size limit of file upload (from 8 MiB to 16 MiB)
- Fix Docker container build problem
- Save cached entries to a cache file

## [1.0.0] - 2022-12-23

- Remove openssl from dependencies
- Upgrade rust-argon2 to v1.0.0
- Disable compression
- Apply rate limiting to /login
- Replace warp with axum 
- Update Rust edition to 2021
- Configurable session duration (via MORIED_SESSION_DURATION)

## [0.4.0] - 2020-12-31

- Brush up Docker image
