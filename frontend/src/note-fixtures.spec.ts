// The frontend's note expander and the backend's must agree: this requires `eventsFromEntries` to
// draw what `backend/src/note_events.rs` recorded in `notes.json`. See `fixtures/calendar/README.md`.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

// A note without offsets means something different in every zone, so both sides read the fixtures
// in the one the golden names.
beforeAll(() => {
    vi.stubEnv('TZ', golden.zone);
});
afterAll(() => {
    vi.unstubAllEnvs();
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
