# Instructions for Agents

## Project overview

`mory` is a personal, single-user notes app: a Rust/axum backend (`backend/`, crate `moried`)
serving notes as files in a Git repository, and a Vue 3 / Vuetify frontend (`frontend/`).

Layout of the tracked sources:

- `backend/src/main.rs` — the server: routes, handlers, the `v2` module, and `models`.
- `backend/src/ical.rs` — parsing subscribed iCal feeds and expanding their recurrences.
- `fixtures/calendar/` — iCal feeds both components expand, and the golden the differential test
  compares them against.
- `backend/src/tests.rs` — in-crate tests, with Git repository fixtures.
- `frontend/src/` — `views/` (routed screens), `components/`, `stores/` (Pinia), `api.ts`
  (backend client), `idb.ts` (IndexedDB cache), `*.spec.ts` (tests next to their subject).

Everything else in the working directory is untracked scratch. Ignore it.

## Philosophy

Three constraints decide most design questions here; `README.md` has the full rationale.

- **The notes must outlive the app.** Every note stays readable and editable with a plain text
  editor and Git alone. A feature that works only through the web app is the wrong shape.
- **Single-user by design.** No multi-user, sharing, or collaboration features; adding any is
  out of scope.
- **The repository is the only source of truth.** No database holds primary data. A database
  may hold only disposable data, such as a cache.

When these instructions do not settle a choice, prefer the option that keeps the notes usable
on their own.

## Build and test

Run commands in the component's own directory (`backend/` or `frontend/`).

- Frontend: `npm run dev`, `npm run build`, `npm run test` (vitest), `npm run lint`.
  Type-check with `npx vue-tsc --noEmit`.
- Backend: `cargo build`, `cargo test`, `cargo clippy`. `bacon` is configured for watch runs.
- Backend tests live in-module (`#[cfg(test)] mod tests`), not in `tests/` — the crate is a
  binary, so an integration test could not import it.
- Neither `npm run lint` nor `vue-tsc` is clean today. Compare the counts before and after your
  change instead of expecting zero.

## Coding standards

### Code style guidelines

- Use a four-space indent, never tabs.
- Leave no trailing whitespace at the end of a line. Keep it only where it carries meaning,
  such as the two spaces that force a line break in Markdown.
- Always brace control-flow bodies, even single statements: never `if (x) y();`.
- Terminate every frontend statement with a semicolon; never rely on automatic insertion.
- Add a trailing comma wherever the syntax allows one, so the next entry is a one-line diff.
- Comment *why*, not *what* — the tracked sources explain decisions and constraints, not syntax.

### Commits

- Follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`.
    - Derive `scope` from the path of what you touched, dropping the `src` component and the
      file extension. Use the most specific scope that is still accurate. For example:
        - `refactor(backend): ...`
        - `fix(backend/example_module): ...`
        - `feat(frontend/views/Home): ...`
        - `feat(frontend/api): ...`
    - Use `feat` for user-facing changes, in either the frontend or the backend. The type
      decides how git-cliff groups the commit in `CHANGELOG.md`.
    - In the subject and body, record any numbers you measured when they matter to the change.
- Past commit messages are a useful model, but the rules in this file always win.
- Small, focused commits, made as the work proceeds. Never one large commit at the end.
- Every commit must build and stand on its own. Verify before committing. A reviewer should
  be able to read any single commit and understand it without the ones after it.
- Split a commit that needs "and" to describe it; merge one too small to stand alone.
- Do not commit, push, or open a pull request unless asked. If asked to commit while on the
  default branch, create a branch first.

## Architecture decisions

These follow from the philosophy above; keep them intact.

- Notes are Markdown files with YAML frontmatter. `tags`, `events`, and `task` are validated
  against `frontend/src/metadata-schema.json`; tasks and calendar entries are derived from that
  frontmatter, never stored as separate records.
- Structure comes from the file paths. The note, task, and tag trees are derived from paths at
  read time rather than stored.
- The backend keeps a SQLite cache of the file listing, keyed by the commit it describes. It is
  disposable: delete it and it rebuilds.
- `GET /v2/entries` serves the listing together with its commit ID, and serves only the changes
  when given `since`.
- The frontend files store (`frontend/src/stores/files.ts`) is the single entry point for file
  operations. Every consumer reads the one shared listing from it; nothing calls the entries API
  or IndexedDB directly.
- External calendars are subscribed in `.mory/calendars.yaml` and served by
  `GET /v2/imported-events`. Their events are read-only and never stored: they are a live view of
  someone else's calendar, so the repository is deliberately not their home. Converting one writes
  an ordinary note under `.events/`, which then shadows the imported original by `ical.uid` — or by
  `uid` and `recurrence_id` together, when the note claims a single occurrence.

## The `events:` frontmatter

An event is a base occurrence (`start`), a list of occurrences (`instances`, or its older spelling
`times`), or a rule (`repeat`) with adjustments to what it generates — and may be more than one of
those at once. Alongside `end`, `finished`, `color` and `note`:

- `repeat` — `freq` (`daily`/`weekly`/`monthly`/`yearly`), `interval`, `byday`, `bymonthday`,
  `bymonth`, `wkst`, `tz`, and at most one of `until` or `count`.
- `exclusions` — occurrences to remove. `overrides` — entries carrying `at` plus the changed keys.
  `instances` — occurrences with their own `start`.
- `location`, `url`, `name` (overrides the map key for one occurrence), and `ical` provenance.

Three details are easy to get wrong:

- **Weekdays are three letters** (`wed`), not iCal's two (`WE`), and may carry an ordinal:
  `3wed` is the third Wednesday, `-1fri` the last Friday. Ordinals need `freq: monthly` or
  `yearly`. This is what separates "the third Wednesday of each month" from "every three weeks on
  Wednesday" (`freq: weekly, interval: 3`).
- **Datetimes carry their offset**, as a task's `completed_at` does, and dates are bare. The one
  exception is `repeat.tz`, an IANA zone name: a zone maps a date to an offset, so expanding a rule
  across a daylight-saving change needs the name and no offset can stand in for it.
- **Adjustments match by instant, not by string.** `2020-01-30 10:00:00-08:00` and
  `2020-01-30 10:00` are the same moment spelled two ways.

`<v-calendar>` cannot parse an offset — its regex has no offset group and it *throws* on a miss — so
`frontend/src/events.ts` converts every datetime to naive local wall clock before it reaches the
view. Nothing in the derivation may throw for the same reason: it runs inside a computed, so one
bad value in one note would blank the whole calendar. Frontmatter is whatever the file said, so
values are type-checked rather than trusted.

Both sides expand with `rrule` — the crate in `backend/src/ical.rs`, rrule.js in
`frontend/src/recurrence.ts` — but sharing a library is not the same as agreeing. Conversion is
where the two swap places, and a disagreement is invisible afterwards, because the note claims the
series and the imported original stops being drawn. `fixtures/calendar/` and
`frontend/src/differential.spec.ts` exist to compare them; both expanders passed their own tests
while disagreeing about nearly every feed there. Change either one and run it.
