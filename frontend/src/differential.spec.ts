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
import dayjs from 'dayjs';
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

/// What a reader sees in `span`: name, start and end, in order.
///
/// Only what starts inside the span, in the reader's zone, is compared. The backend widens a window
/// by a day either side, not knowing the reader's zone, so what it returns at the edges is more
/// than the note is asked for.
function shapeOf(events: readonly CalendarEvent[], span: { from: string; to: string }): string[] {
    const from = dayjs(span.from).valueOf();
    const to = dayjs(span.to).endOf('day').valueOf();
    return [...events]
        .filter((event) => {
            const start = dayjs(event.start).valueOf();
            return start >= from && start <= to;
        })
        .sort((a, b) => a.start.localeCompare(b.start))
        .map(shapeOfOne);
}

function shapeOfOne(event: CalendarEvent): string {
    return `${event.start} .. ${event.end ?? '-'}  ${event.name}`;
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
        const imported = shapeOf(mergeImported([], feed.events), window);

        // ...and after: the note the button writes, read back the way any note is.
        const note = buildSeriesNote(feed.events[0], series);
        const { events, errors } = eventsFromEntries([noteEntry(note.content)], window);

        expect(errors, 'a converted note should raise nothing').toEqual([]);
        expect(shapeOf(events, window)).toEqual(imported);
    });

    // How much a view asks for must not change what it is given for a day: Home asks for three
    // days and the calendar for three months. Asking for years, as above, hides every way of
    // losing an occurrence at the edge of a window -- moved into it from outside, or read in the
    // wrong zone -- and this expander has lost occurrences both ways.
    it('finds each occurrence in a window of its own day', () => {
        const note = noteEntry(buildSeriesNote(feed.events[0], feed.series[uids[0]]).content);
        for (const occurrence of mergeImported([], feed.events)) {
            const day = { from: occurrence.start.slice(0, 10), to: occurrence.start.slice(0, 10) };
            const { events } = eventsFromEntries([note], day);

            expect(events.map(shapeOfOne)).toContain(shapeOfOne(occurrence));
        }
    });
});
