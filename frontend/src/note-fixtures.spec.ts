// The frontend's note expander and the backend's must agree.
//
// moried rings event alarms as Web Push, so it expands notes itself, in
// `backend/src/note_events.rs`. An alarm at a time the calendar does not show is the disagreement
// `differential.spec.ts` exists to catch between feeds and notes, now between two readers of the
// same note. `backend/src/tests.rs` (`note_fixtures_draw_as_recorded`) records what the backend
// draws of every note in `fixtures/calendar/notes/` and `converted/`, with the metadata it parsed
// out of each; this requires `eventsFromEntries` to draw the same from that same metadata.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import dayjs from 'dayjs';

import type { ListEntry2 } from '@/api';
import { eventsFromEntries } from '@/events';

import golden from '../../fixtures/calendar/notes.json';

interface RecordedNote {
    metadata: ListEntry2['metadata'];
    drawn: string[];
}

const notes = golden.notes as unknown as Record<string, RecordedNote>;
const window = golden.window as { from: string; to: string };

// Node's `process`, which the app's types leave out: bringing Node's in would retype `setTimeout`
// across the app.
const { env } = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
    .process;

// A note without offsets means something different in every zone, so both sides read the fixtures
// in the one the golden names. `Date` reads `TZ` each time it converts, so setting it here is
// enough, and each spec file runs in a process of its own.
const originalZone = env.TZ;
beforeAll(() => {
    env.TZ = golden.zone;
});
afterAll(() => {
    env.TZ = originalZone;
});

/// `start  name` for everything that starts inside the window, in order -- what `drawn_in_window`
/// computes on the backend's side.
function drawn(path: string, note: RecordedNote): string[] {
    const entry: ListEntry2 = {
        path,
        size: 1,
        mime_type: 'text/markdown',
        metadata: note.metadata,
        title: null,
        time: '2024-05-01T00:00:00+00:00',
    };
    const from = dayjs(window.from).valueOf();
    const to = dayjs(window.to).endOf('day').valueOf();
    return eventsFromEntries([entry], window).events
        .filter((event) => {
            const start = dayjs(event.start).valueOf();
            return start >= from && start <= to;
        })
        .map((event) => `${event.start}  ${event.name}`)
        .sort();
}

it('runs in the zone the golden was recorded in', () => {
    expect(dayjs('2024-07-01 00:00').utcOffset()).toBe(-7 * 60);
    expect(dayjs('2024-01-01 00:00').utcOffset()).toBe(-8 * 60);
});

it('records every note fixture', () => {
    const onDisk = Object.keys(import.meta.glob([
        '../../fixtures/calendar/notes/*.md',
        '../../fixtures/calendar/converted/*.md',
    ])).map((path) => path.replace('../../fixtures/calendar/', ''));
    expect(Object.keys(notes).sort(), 'regenerate with UPDATE_CALENDAR_GOLDEN=1').toEqual(onDisk.sort());
});

describe.each(Object.keys(notes))('%s', (path) => {
    it('draws what the backend draws', () => {
        expect(drawn(path, notes[path])).toEqual(notes[path].drawn);
    });
});
