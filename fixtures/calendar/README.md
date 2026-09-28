# Calendar fixtures

iCalendar feeds that both components expand, and the golden file recording what the backend makes
of them.

They exist for one test, in two halves. `backend/src/tests.rs` expands every `.ics` here and
compares the result against `expansion.json`; `frontend/src/differential.spec.ts` reads that same
file, converts each series to a note exactly as the app does, re-expands it, and asserts the
occurrences match.

That crossing is the point. Each expander was already tested alone, and both passed while
disagreeing with each other on almost every feed here — which is what a reader sees the instant
they press "Convert to note", because the note then claims the series and the imported original
stops being drawn. A disagreement is invisible until something compares the two.

Every feed is expanded over one wide window, except a feed about the window itself, which names
its own in `OWN_WINDOWS` in `backend/src/tests.rs`; the golden records it beside that feed, and
the frontend re-expands over the same. Keep its other occurrences more than a day clear of it: the
backend widens a window by a day either side, and the note's expansion does not.

Regenerate the golden with:

    cd backend && UPDATE_CALENDAR_GOLDEN=1 cargo test calendar_fixtures
