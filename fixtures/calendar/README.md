# Calendar fixtures

iCalendar feeds that both components expand, and the golden file recording what the backend makes
of them.

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

Regenerate the golden with:

    cd backend && UPDATE_CALENDAR_GOLDEN=1 cargo test calendar_fixtures
