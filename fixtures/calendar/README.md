# Calendar fixtures

iCalendar feeds and notes that both components expand, and the golden files recording what the
backend makes of them.

They exist for one comparison, in two halves. `backend/src/tests.rs` expands every `.ics` here and
compares the result against `expansion.json`; `frontend/src/differential.spec.ts` reads that same
file, converts each series to a note exactly as the app does, re-expands it, and asserts the
occurrences match.

That crossing is the point. Each expander was already tested alone, and both passed while
disagreeing with each other on almost every feed here — which is what a reader sees the instant
they press "Convert to note", because the note then claims the series and the imported original
stops being drawn. A disagreement is invisible until something compares the two.

Every feed is expanded over one wide window, and only what starts inside it, in the reader's zone,
is compared: the backend widens a window by a day either side, not knowing the reader's zone.

A wide window hides every way of losing an occurrence at a window's edge, so each side also asks
again for every occurrence it drew, over that occurrence's day alone, and requires it back. A
feed about a window's edge, such as `moved-into-window.ics`, needs nothing more than that.

## Notes

A note is expanded twice as well: by the frontend for the calendar, and by the backend
(`backend/src/note_events.rs`) for event alarms, which moried sends as Web Push at each
occurrence's start. An alarm at a time the calendar does not show is the same disagreement, so the
two are compared the same way.

`notes/` holds notes written by hand, covering the `events:` dialect and the frontend's quirks with
it, and `converted/` the note the app writes for each feed above. `backend/src/tests.rs` expands
every one for a reader in `America/Los_Angeles` and records the result in `notes.json`, with the
metadata it parsed out of each; `frontend/src/note-fixtures.spec.ts` requires `eventsFromEntries`
to draw the same from that metadata. The backend also requires each converted note to draw what
its feed did, which closes the circle: the feed, the frontend's note and the backend's all agree.

Each note's alarms are recorded too, as `alarms`: one `start  name  spec|spec` line for every
occurrence, naming the alarms it rings at and spelling each as `Spec`'s `Display` does, so that
`-1.5h` and `-90 minutes` both read `-90m`. `notes/alarms.md` is about little else.

An occurrence that sets no alarms of its own takes its category's, so the notes are read under
`calendars.yaml`, a stand-in for `.mory/calendars.yaml`, whose parsed contents `notes.json` records
as `calendars`. It sets category alarms only: a `name` template would change the names the golden
records, and a global `timed` or `all_day` every line of it.

`dayjs.tz` resolves an hour that happens twice by the season the reader is in *now*, so a rule
with `tz` whose occurrences fall in such an hour would make the comparison depend on the date it
runs. Keep them out of the fixtures.

## Regenerating

From the repository's root, in this order, since each step reads what the one before wrote:

    (cd backend && UPDATE_CALENDAR_GOLDEN=1 cargo test calendar_fixtures)
    (cd frontend && npx vitest run -u src/differential.spec.ts)
    (cd backend && UPDATE_CALENDAR_GOLDEN=1 cargo test note_fixtures)
