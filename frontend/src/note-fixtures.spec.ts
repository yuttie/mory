// The frontend's note expander and the backend's must agree: this requires `eventsFromEntries` to
// draw, and to resolve the alarms of, what `backend/src/note_events.rs` and `backend/src/alarms.rs`
// recorded in `notes.json`. See `fixtures/calendar/README.md`.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import dayjs from 'dayjs';

import { formatAlarm, parseAlarm, readAlarmDefaults } from '@/alarms';
import type { ListEntry2 } from '@/api';
import type { EventCategories } from '@/events';
import { eventsFromEntries } from '@/events';

import golden from '../../fixtures/calendar/notes.json';

interface RecordedNote {
    metadata: ListEntry2['metadata'];
    drawn: string[];
    alarms: string[];
}

const notes = golden.notes as unknown as Record<string, RecordedNote>;
const window = golden.window as { from: string; to: string };

// What `.mory/calendars.yaml` held, as the backend parsed it, for the notes to be read under. Only
// the alarms of each category are read from it: the golden records nothing else a category sets.
const calendars = golden.calendars as { alarms?: unknown; categories?: Record<string, unknown> };
const categories: EventCategories = new Map(
    Object.entries(calendars.categories ?? {}).flatMap(([id, entry]) => {
        if (entry === null) {
            return [[id, {}]];
        }
        if (typeof entry !== 'object' || Array.isArray(entry)) {
            return [];
        }
        const { alarms } = entry as { alarms?: string[] };
        return [[id, alarms === undefined || alarms === null ? {} : { alarms }]];
    }),
);

// A note without offsets means something different in every zone, so both sides read the fixtures
// in the one the golden names.
beforeAll(() => {
    vi.stubEnv('TZ', golden.zone);
});
afterAll(() => {
    vi.unstubAllEnvs();
});

function entryOf(path: string, note: RecordedNote): ListEntry2 {
    return {
        path,
        size: 1,
        mime_type: 'text/markdown',
        metadata: note.metadata,
        title: null,
        time: '2024-05-01T00:00:00+00:00',
    };
}

/// `start  name` for everything that starts inside the window, in order -- what `drawn_in_window`
/// computes on the backend's side.
function drawn(path: string, note: RecordedNote): string[] {
    const from = dayjs(window.from).valueOf();
    const to = dayjs(window.to).endOf('day').valueOf();
    return eventsFromEntries([entryOf(path, note)], window).events
        .filter((event) => {
            const start = dayjs(event.start).valueOf();
            return start >= from && start <= to;
        })
        .map((event) => `${event.start}  ${event.name}`)
        .sort();
}

/// `start  name  spec|spec` for the same, each alarm spelt as `Spec`'s `Display` spells it -- what
/// `alarms_of_note_fixture` computes on the backend's side.
function alarmsOf(path: string, note: RecordedNote): string[] {
    const from = dayjs(window.from).valueOf();
    const to = dayjs(window.to).endOf('day').valueOf();
    const alarmDefaults = readAlarmDefaults(calendars.alarms);
    return eventsFromEntries([entryOf(path, note)], window, { categories, alarmDefaults }).events
        .filter((event) => {
            const start = dayjs(event.start).valueOf();
            return start >= from && start <= to;
        })
        .map((event) => {
            const specs = (event.alarms ?? []).map((alarm) => {
                const parsed = parseAlarm(alarm);
                return 'spec' in parsed ? formatAlarm(parsed.spec) : `invalid(${alarm})`;
            });
            return `${event.start}  ${event.name}  ${specs.length === 0 ? 'none' : specs.join('|')}`;
        })
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

    it('rings at what the backend rings at', () => {
        expect(alarmsOf(path, notes[path])).toEqual(notes[path].alarms);
    });
});
