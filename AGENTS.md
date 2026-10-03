# Instructions for Agents

## Project overview

`mory` is a personal, single-user notes app: a Rust/axum backend (`backend/`, crate `moried`) serving notes as files in a Git repository, and a Vue 3 / Vuetify frontend (`frontend/`).

Layout of the tracked sources:

- `backend/src/main.rs` — the server: routes, handlers, the `v2` module, and `models`.
- `backend/src/ical.rs` — parsing subscribed iCal feeds and expanding their recurrences.
- `backend/src/note_events.rs` — expanding the events a note declares, the Rust twin of `eventsFromEntries`, for event alarms.
- `backend/src/alarms.rs` — when each alarm rings: the `alarms:` grammar, the defaults `.mory/calendars.yaml` sets, and a task's dates.
- `backend/src/tasks.rs` — which notes are in the task tree, and a task's status: the checks the MCP tools and the alarm scheduler share.
- `backend/src/schedule.rs` — which alarms ring in a span of time, from the listing and the calendar configuration.
- `backend/src/push.rs` — event alarms sent as Web Push: the VAPID key, the subscription endpoints, and the loop that asks the schedule once a minute and sends what is due.
- `backend/src/oauth.rs` — the OAuth 2.1 authorization server the MCP endpoint needs.
- `backend/src/mcp/` — the MCP server: `mod.rs` holds the tool router, `frontmatter.rs` the
  in-place frontmatter editor, and the rest the tools grouped by area.
- `fixtures/calendar/` — iCal feeds and notes both components expand, and the goldens the differential tests compare them against.
- `backend/src/tests.rs` — in-crate tests, with Git repository fixtures.
- `frontend/src/` — `views/` (routed screens), `components/`, `stores/` (Pinia), `api.ts` (backend client), `idb.ts` (IndexedDB cache), `*.spec.ts` (tests next to their subject).

Untracked configuration, build artifacts, and scratch files may exist in the working directory. Do not inspect, modify, or commit them unless the task specifically requires it.

## Philosophy

Three constraints decide most design questions here; `README.md` has the full rationale.

- **The notes must outlive the app.** Every note stays readable and editable with a plain text editor and Git alone. A feature that works only through the web app is the wrong shape.
- **Single-user by design.** No multi-user, sharing, or collaboration features; adding any is out of scope.
- **The repository is the only source of truth.** No database holds primary data. A database may hold only disposable data, such as a cache.

When these instructions do not settle a choice, prefer the option that keeps the notes usable on their own.

## Build and test

Run commands in the component's own directory (`backend/` or `frontend/`).

- Frontend: `npm run dev`, `npm run build`, `npm run test` (vitest), `npm run lint`. Type-check with `npx vue-tsc --noEmit`.
- Backend: `cargo build`, `cargo test`, `cargo clippy`. `bacon` is configured for watch runs.
- Backend tests live in-module (`#[cfg(test)] mod tests`), not in `tests/` — the crate is a binary, so an integration test could not import it.
- Neither `npm run lint` nor `vue-tsc` is clean today. Compare the counts before and after your change instead of expecting zero.

## Coding standards

### Code style guidelines

- Use a four-space indent, never tabs.
- Leave no trailing whitespace at the end of a line. Keep it only where it carries meaning, such as the two spaces that force a line break in Markdown.
- Always brace control-flow bodies, even single statements: never `if (x) y();`.
- Terminate every frontend statement with a semicolon; never rely on automatic insertion.
- Add a trailing comma wherever the syntax allows one, so the next entry is a one-line diff.
- Comment *why*, not *what* — the tracked sources explain decisions and constraints, not syntax.

### Commits

- Commit as the work proceeds, without waiting to be asked.
- Small and focused; never one large commit at the end.
- Split a commit that needs "and" to describe it; merge one too small to stand alone.
- Every commit must build and stand on its own.
    - Verify before committing.
    - A reviewer should be able to read any single commit and understand it without the ones after it.
- Never commit directly to the default branch unless the user explicitly asks for it.
    - Create a branch first, and say which branch you created.
- Follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`.
    - Type
        - Choose a type best describing your changes from:
            - `fix`
            - `feat` (only for user-facing changes, in either the frontend or the backend)
            - `build`
            - `chore`
            - `ci`
            - `docs`
            - `style` (source formatting only, such as indentation; not visual or CSS changes, which are `feat` when user-facing and `refactor` otherwise)
            - `refactor`
            - `perf`
            - `test`
        - The type decides how git-cliff groups the commit in `CHANGELOG.md`.
        - Append `!` after the scope for a breaking change: `feat(backend/v2)!: ...`.
    - Scope
        - Derive `scope` from the path of what you touched, dropping the `src` component and the file extension.
        - Use the most specific scope that is still accurate.
    - Examples:
        - `refactor(backend): ...`
        - `fix(backend/ical): ...`
        - `feat(frontend/views/Home): ...`
        - `feat(frontend/api): ...`
- In the subject and body, record any numbers you measured when they matter to the change.
- Wrap the commit body at approximately 72 columns.
- The rules in this file always win. Consult past commit messages only where these rules leave a case ambiguous.
- Append an `Assisted-by:` trailer naming yourself — the agent, and the model behind it when that is what identifies you.
    - Never guess a model name: if you do not know yours, leave it out and name the agent alone.
    - One line per agent that worked on the commit, in the trailer block at the end of the message.
    - If you are a Claude agent and are separately given a trailer string that does not include the model name, complete it by appending your model name.
    - Examples:
        - `Assisted-by: Claude Opus 5`
        - `Assisted-by: Codex GPT-5.6 Sol`
        - `Assisted-by: GitHub Copilot`

### Remote repositories

- Do not push or open a pull request unless asked.
- Do not add `Assisted-by:` trailers, other attribution, or session links to pull-request descriptions.

## Architecture decisions

These follow from the philosophy above; keep them intact.

- Notes are Markdown files with YAML frontmatter. `tags`, `events`, and `task` are validated against `frontend/src/metadata-schema.json`; tasks and calendar entries are derived from that frontmatter, never stored as separate records.
- Structure comes from the file paths. The note, task, and tag trees are derived from paths at read time rather than stored.
- The backend keeps a SQLite cache of the file listing, keyed by the commit it describes. It is disposable: delete it and it rebuilds.
- `GET /v2/entries` serves the listing together with its commit ID, and serves only the changes when given `since`.
- The frontend files store (`frontend/src/stores/files.ts`) is the single entry point for file operations. Every consumer reads the one shared listing from it; nothing calls the entries API or IndexedDB directly.
- A task's `due_by` and `deadline` are drawn as events too, derived from the same listing by `taskDatesFromEntries` in `frontend/src/events.ts` rather than from an `events:` block. Each has its own colour, configurable under `task_dates:` in `.mory/calendars.yaml`.
- An event may name a category (`category: meeting`), configured under `categories:` in `.mory/calendars.yaml` with a default `color`, a `name` template (`[MTG] {{name}}`) and `alarms`. A category changes how an event is drawn and when it rings, never when or where it happens, so the note still says everything about its events on its own. A nested id (`meeting/1on1`) takes each field it leaves unset from its nearest configured ancestor, but must be configured itself, so a misspelt one is reported rather than drawn as its parent. `resolveCategory` in `frontend/src/events.ts` is the one place this is worked out, with one exception: `backend/src/alarms.rs` walks a category's lineage for `alarms` too, because it is moried that rings them. `fixtures/calendar/calendars.yaml` and `notes/alarms.md` hold that second copy to the first.
- Event alarms are Web Push. A service worker cannot wait for an event — Chrome stops one idle for 30 seconds, timers and all — so `backend/src/push.rs` sends each alarm at the time its note asks for and the worker only shows it, saying when the event starts: moried sends the moment, and the worker, which is in the reader's zone and locale, puts it in words. The VAPID key pair is derived from `MORIED_SECRET`, so rotating the secret ends every subscription along with every session. Subscriptions live in `cache.sqlite`, and every page load registers its browser's afresh, so the table is as disposable as the rest of the cache. Production logs at debug and `sqlx` logs every statement there, so the scheduler keeps the listing and the subscriptions in memory: an idle minute must not touch the database. The calendar configuration is read from git, with the listing, whenever a sync says either moved. An alarm before its occurrence is only found if the window the scheduler expands reaches that far, so each reload works out how far any alarm in the listing and the configuration rings (`alarms::Reach`) and widens the window by it.
- Alarm timing has layers, and the first that is set wins. For an event's occurrence: its own `alarms` (an override, an instance, or the event for a lone start), the event's, its category's, the configuration's `alarms.timed` or `alarms.all_day`, then the built-in default — at the start if timed, never if all-day. For a task's date: `task.alarms.due_by` or `.deadline`, then the configuration's `alarms.due_by` or `.deadline`, then nothing; a task that is done or canceled never rings. `[]` silences, and an empty value is not set and inherits, as an empty `category:` does. An entry that is not an alarm is dropped, the rest of the list stands, and the web app reports it: for a note, where the note is drawn, and for `.mory/calendars.yaml`, in the Calendar's error alert, since the next save of anything would erase it unannounced. The grammar's twin is `frontend/src/alarms.ts`, and `fixtures/calendar/` holds the two to each other. `render` in `frontend/src/task.ts` and `writeConfiguration` in `frontend/src/stores/calendars.ts` rewrite whole files from what they hold, so each must carry `alarms` or the next save of anything deletes it.
- External calendars are subscribed in `.mory/calendars.yaml` and served by `GET /v2/imported-events`. Their events are read-only and never stored: they are a live view of someone else's calendar, so the repository is deliberately not their home. Converting one writes an ordinary note under `.events/`, which then shadows the imported original by `ical.uid` — or by `uid` and `recurrence_id` together, when the note claims a single occurrence.

## The MCP server

`moried` serves MCP at `{MORIED_ROOT_PATH}v2/mcp`, so Claude and ChatGPT can reach the notes as a
connector added by URL. It is off unless `MORIED_PUBLIC_URL` is set: without it neither the MCP
route nor the OAuth routes are registered.

Tools call the same internal functions the HTTP handlers call — `search::run_search`,
`find_entry_blob`, `AppState::save_note` and the rest — so an MCP read sees the listing the web
app sees and an MCP write is an ordinary Git commit. When a handler holds logic a tool needs,
extract it rather than writing a second copy; that is why `run_search` and `v2::imported_events`
exist as separate functions from the handlers that call them.

**OAuth artefacts are stateless JWTs** signed with `MORIED_SECRET` and told apart by a `typ`
claim (`mcp_client`, `mcp_code`, `mcp_access`, `mcp_refresh`). A registered `client_id` is itself
a signed JWT carrying that client's redirect URIs, so registration stores nothing. Nothing lands
in `cache.sqlite`, which may hold only disposable data. The price: there is no revocation list,
so cutting a client off before its token expires means rotating `MORIED_SECRET` — which ends the
web session too.

**Frontmatter is edited in place, never regenerated.** `mcp::frontmatter` finds a key's line,
changes that line, and leaves every other byte alone; `serde_yaml` then parses both the intended
result and the edited text, and the edit is refused unless they are the same value. Re-serializing
was measured against the real 952-note corpus and rejected: a `serde_yaml` round-trip reproduces
61 notes byte for byte and a post-processor tuned to the house style reaches 494, because what
the rest lose is comments, block scalars and flow-style entries rather than formatting. The
in-place editor reproduces 951. `tests::frontmatter_edits_a_real_corpus` is that measurement,
ignored by default; point `MORY_CORPUS` at a real repository and run it whenever that module
changes.

A path under `.tasks/` must keep the UUIDv4 naming `entries_to_tree` derives the task tree from,
and `.mory/tasks-v1.yaml` is read-only through MCP — 600 KB of legacy YAML using anchors and aliases
that a rewrite would silently expand into independent copies.

`list_events` does **not** expand recurrence rules: it returns the rule as declared and says so in
the result. It was written when a Rust expander for notes would have had nothing comparing it to the
frontend. `note_events` now has, for event alarms; handing a model computed occurrences instead would
be a change to this tool to make on purpose.

The event categories are returned the same way: as `.mory/calendars.yaml` declares them, never
applied to the events. Resolving them in Rust would be a second copy of `resolveCategory`.

The global `alarms:` block is returned the same way, as declared. Resolving which alarms an event
rings at would be a third copy of the precedence above.

`list_events` does return each task's `due_by` and `deadline` inside the window, under
`task_dates`, because the calendar draws them as events. Nothing there is expanded, but
`task_dates_in_window` is still a second copy of which tasks and values `taskDatesFromEntries`
accepts, in another language: `fixtures/calendar/tasks/` holds it to `taskDatesFromEntries` for
which dates fall in the window, as the note writes them, and which are finished, so change one,
change the other and run both halves. `alarms::task_dates`, which the scheduler rings from, is a
third, and the same fixtures hold it to `taskDatesFromEntries`: which dates ring and what they ring
at, under the configuration's alarms and without. `task_dates_in_window` takes a value's leading
`YYYY-MM-DD` where `dayjs` reads more, such as `2024-8-9` or `2024-02-30`, so the fixtures keep to values
both read. The two Rust sides at least agree with each other about which notes and which fields:
`tasks::task_of` and `tasks::date_texts` decide that, and what is left to each is the test of a
value, the leading `YYYY-MM-DD` for the window and the stricter reading `dayjs` gives for the
scheduler, which also skips a finished task.

## The `events:` frontmatter

An event is a base occurrence (`start`), a list of occurrences (`instances`, or its older spelling `times`), or a rule (`repeat`) with adjustments to what it generates — and may be more than one of those at once. Alongside `end`, `finished`, `color` and `note`:

- `repeat` — `freq` (`daily`/`weekly`/`monthly`/`yearly`), `interval`, `byday`, `bymonthday`, `bymonth`, `wkst`, `tz`, and at most one of `until` or `count`.
- `exclusions` — occurrences to remove. `overrides` — entries carrying `at` plus the changed keys. `instances` — occurrences with their own `start`.
- `location`, `url`, `name` (overrides the map key for one occurrence), and `ical` provenance.
- `category` — a category id from `.mory/calendars.yaml`. It belongs to the event as a whole: overrides and instances cannot change it.
- `alarms` — when it rings: a list of alarms, or one alone, on the event, an override or an instance. See below.

An alarm is a string, one of two spellings: an offset from the start, `[+-]N unit` (`-10m` before it, `+1h` after; `w d h m s` or `weeks days hours minutes seconds`), or a time on the start's day, `[[+-]N d|w ]HH:MM` (`09:00`, `-1d 18:00`). The sign is required unless N is 0, so `10m` is refused, not read as "after". `d` and `w` take whole numbers and move by calendar days in the reader's zone, so `-1d` on a 09:00 event is 09:00 the day before across a daylight-saving change, where `-24h` is not. An all-day event starts at the first moment of its day. No alarm is more than a year from its start.

Three details are easy to get wrong:

- **Weekdays are three letters** (`wed`), not iCal's two (`WE`), and may carry an ordinal: `3wed` is the third Wednesday, `-1fri` the last Friday. Ordinals need `freq: monthly` or `yearly`. This is what separates "the third Wednesday of each month" from "every three weeks on Wednesday" (`freq: weekly, interval: 3`).
- **Datetimes carry their offset**, as a task's `completed_at` does, and dates are bare. The one exception is `repeat.tz`, an IANA zone name: a zone maps a date to an offset, so expanding a rule across a daylight-saving change needs the name and no offset can stand in for it.
- **Adjustments match by instant, not by string.** `2020-01-30 10:00:00-08:00` and `2020-01-30 10:00` are the same moment spelled two ways.

`<v-calendar>` cannot parse an offset — its regex has no offset group and it *throws* on a miss — so `frontend/src/events.ts` converts every datetime to naive local wall clock before it reaches the view. Nothing in the derivation may throw for the same reason: it runs inside a computed, so one bad value in one note would blank the whole calendar. Frontmatter is whatever the file said, so values are type-checked rather than trusted.

Both sides expand with `rrule` — the crate in `backend/src/ical.rs`, rrule.js in `frontend/src/recurrence.ts` — but sharing a library is not the same as agreeing. Conversion is where the two swap places, and a disagreement is invisible afterwards, because the note claims the series and the imported original stops being drawn. `fixtures/calendar/` and `frontend/src/differential.spec.ts` exist to compare them; both expanders passed their own tests while disagreeing about nearly every feed there. Change either one and run it.

A note is expanded twice as well: by `eventsFromEntries` for the calendar, and by `backend/src/note_events.rs` for event alarms, which follows the frontend rule by rule, JavaScript's accidents included — an alarm at a time the calendar does not show is the same disagreement. `fixtures/calendar/notes/`, `converted/` and `frontend/src/note-fixtures.spec.ts` compare the two. Change either one, run both halves, and regenerate as `fixtures/calendar/README.md` says. The same goes for the alarms an occurrence resolves to, which `notes.json` records beside what it draws.
