// The two expanders must agree.
//
// A feed is expanded by the Rust `rrule` crate in `backend/src/ical.rs`; a *converted note* is
// expanded by rrule.js in `frontend/src/recurrence.ts`, through the `repeat:` dialect the backend
// writes. Conversion is exactly where the two swap places, so any disagreement shows up as events
// moving the instant a reader presses "Convert to note" -- and stays invisible, because the note
// then claims the series and the imported original is no longer drawn to compare against.
//
// Each expander was already covered on its own, and both passed while disagreeing about almost
// every feed in `fixtures/calendar/`. Nothing but a test that crosses the boundary can see it.
//
// The backend's half of this lives in `backend/src/tests.rs` (`calendar_fixtures_expand_as
// _recorded`), which writes the golden this reads.

import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

import type { ImportedOccurrence, ImportedSeries, MetadataEvent } from '@/api';
import { buildSeriesNote, canConvertSeries } from '@/event-note';
import { eventsFromEntries, mergeImported } from '@/events';
import type { CalendarEvent } from '@/events';

import golden from '../../fixtures/calendar/expansion.json';

interface Feed {
    events: ImportedOccurrence[];
    series: Record<string, ImportedSeries>;
}

const feeds = golden.feeds as unknown as Record<string, Feed>;
const window = golden.window as { from: string; to: string };

function noteEntry(content: string) {
    const match = /^---\n([\s\S]*?)\n?---\n/.exec(content);
    const metadata = YAML.parse(match![1]) as { events: Record<string, MetadataEvent> };
    return {
        path: '.events/converted.md',
        size: content.length,
        mime_type: 'text/markdown',
        metadata: { tags: ['ical'], events: metadata.events },
        title: null,
        time: '2024-05-01T00:00:00+00:00',
    };
}

/// What a reader sees: name, start and end, in order.
function shapeOf(events: readonly CalendarEvent[]): string[] {
    return [...events]
        .sort((a, b) => a.start.localeCompare(b.start))
        .map((event) => `${event.start} .. ${event.end ?? '-'}  ${event.name}`);
}

describe.each(Object.keys(feeds))('%s', (name) => {
    const feed = feeds[name];
    const uids = [...new Set(feed.events.map((event) => event.uid))];

    it('has exactly one series, as the fixture intends', () => {
        expect(uids).toHaveLength(1);
    });

    it('converts to a note that renders the same occurrences', () => {
        const uid = uids[0];
        const series = feed.series[uid];
        expect(canConvertSeries(series), 'the fixture should be convertible whole').toBe(true);

        // What the calendar draws before conversion.
        const imported = shapeOf(mergeImported([], feed.events));

        // ...and after: the note the button writes, read back the way any note is.
        const note = buildSeriesNote(feed.events[0], series);
        const { events, errors } = eventsFromEntries([noteEntry(note.content)], window);

        expect(errors, 'a converted note should raise nothing').toEqual([]);
        expect(shapeOf(events)).toEqual(imported);
    });
});
