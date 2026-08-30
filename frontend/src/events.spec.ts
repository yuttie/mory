import { describe, expect, it, vi } from 'vitest';

import dayjs from 'dayjs';

import type { ListEntry2, MetadataEvent } from '@/api';
import type { ImportedOccurrence } from '@/api';
import {
    DEFAULT_EVENT_COLOR,
    DEFAULT_IMPORTED_COLOR,
    eventsFromEntries,
    mergeImported,
    normalizeEndTime,
    toWallClock,
} from '@/events';

// Wide enough that a test only constrains expansion when it says so.
const ANY_WINDOW = { from: '2000-01-01', to: '2039-12-31' };
const derive = (entries: ListEntry2[], window = ANY_WINDOW) =>
    eventsFromEntries(entries, window);

function entry(
    path: string,
    events: Record<string, MetadataEvent> | null,
    options: Partial<ListEntry2> = {},
): ListEntry2 {
    return {
        path,
        size: 1,
        mime_type: 'text/markdown',
        metadata: events === null ? null : { tags: [], events },
        title: null,
        time: '2024-05-01T12:00:00+00:00',
        ...options,
    };
}

describe('normalizeEndTime', () => {
    it('leaves a missing end missing', () => {
        expect(normalizeEndTime(undefined, '2024-05-01 10:00')).toBeUndefined();
    });

    it('adds a short-form duration to the start', () => {
        expect(normalizeEndTime('+90m', '2024-05-01 10:00')).toBe('2024-05-01 11:30');
        expect(normalizeEndTime('+1.5h', '2024-05-01 10:00')).toBe('2024-05-01 11:30');
        expect(normalizeEndTime('+2d', '2024-05-01 10:00')).toBe('2024-05-03 10:00');
    });

    it('adds a long-form duration, case-insensitively', () => {
        expect(normalizeEndTime('+2 hours', '2024-05-01 10:00')).toBe('2024-05-01 12:00');
        expect(normalizeEndTime('+1 Day', '2024-05-01 10:00')).toBe('2024-05-02 10:00');
    });

    it('keeps an absolute datetime as the author spelled it', () => {
        expect(normalizeEndTime('2024-05-01 11:00', '2024-05-01 10:00'))
            .toBe('2024-05-01 11:00');
    });

    it('gives a bare time of day the start date', () => {
        expect(normalizeEndTime('11:00', '2024-05-01 10:00')).toBe('2024-05-01 11:00');
    });

    it('rolls a bare time to the next day when it would precede the start', () => {
        expect(normalizeEndTime('01:00', '2024-05-01 22:00')).toBe('2024-05-02 01:00');
    });

    it('reports an unusable end as null', () => {
        expect(normalizeEndTime('not a time', '2024-05-01 10:00')).toBeNull();
    });
});

describe('eventsFromEntries', () => {
    it('derives a single event, defaulting the colour', () => {
        const { events, errors } = derive([
            entry('a.md', { Standup: { start: '2024-05-01 09:00', end: '+15m' } }),
        ]);

        expect(errors).toEqual([]);
        expect(events).toEqual([{
            name: 'Standup',
            start: '2024-05-01 09:00',
            end: '2024-05-01 09:15',
            finished: undefined,
            color: DEFAULT_EVENT_COLOR,
            note: undefined,
            location: undefined,
            url: undefined,
            source: 'note',
            notePath: 'a.md',
        }]);
    });

    it('derives every occurrence of a times list', () => {
        const { events } = derive([
            entry('a.md', {
                Offsite: {
                    color: 'red',
                    times: [{ start: '2024-05-01 09:00' }, { start: '2024-06-01 09:00' }],
                },
            }),
        ]);

        expect(events.map((e) => e.start)).toEqual(['2024-05-01 09:00', '2024-06-01 09:00']);
        expect(events.every((e) => e.color === 'red')).toBe(true);
    });

    it('lets an occurrence override its parent colour, note and end', () => {
        const { events } = derive([
            entry('a.md', {
                Series: {
                    end: '+1h',
                    color: 'red',
                    note: 'parent',
                    times: [
                        { start: '2024-05-01 09:00' },
                        { start: '2024-05-02 09:00', end: '+2h', color: 'blue', note: 'child' },
                    ],
                },
            }),
        ]);

        expect(events[0]).toMatchObject({ end: '2024-05-01 10:00', color: 'red', note: 'parent' });
        expect(events[1]).toMatchObject({ end: '2024-05-02 11:00', color: 'blue', note: 'child' });
    });

    it('reports an invalid start and keeps the other events', () => {
        const { events, errors } = derive([
            entry('a.md', {
                Broken: { start: 'nonsense' },
                Fine: { start: '2024-05-01 09:00' },
            }, { title: 'A note' }),
        ]);

        expect(events.map((e) => e.name)).toEqual(['Fine']);
        expect(errors).toEqual([['start', 'nonsense', 'Broken', 'a.md', 'A note']]);
    });

    it('reports an invalid end and keeps the other events', () => {
        const { events, errors } = derive([
            entry('a.md', {
                Broken: { start: '2024-05-01 09:00', end: 'nonsense' },
                Fine: { start: '2024-05-01 09:00' },
            }),
        ]);

        expect(events.map((e) => e.name)).toEqual(['Fine']);
        expect(errors).toEqual([['end', 'nonsense', 'Broken', 'a.md', null]]);
    });

    it('ignores entries with no metadata and notes with no events', () => {
        const { events, errors } = derive([
            entry('image.png', null),
            entry('plain.md', {}),
            { ...entry('nokey.md', {}), metadata: { tags: [] } },
        ]);

        expect(events).toEqual([]);
        expect(errors).toEqual([]);
    });

    it('reads the newer instances spelling as well as times', () => {
        const { events } = derive([
            entry('a.md', { Offsite: { instances: [{ start: '2024-05-01 09:00' }] } }),
        ]);

        expect(events.map((e) => e.start)).toEqual(['2024-05-01 09:00']);
    });

    // The old shapes were alternatives -- `start` XOR `times` -- so this could not be said at all.
    it('derives a base occurrence and its listed occurrences together', () => {
        const { events } = derive([
            entry('a.md', {
                Series: {
                    start: '2024-05-01 09:00',
                    end: '+1h',
                    instances: [{ start: '2024-06-01 09:00' }],
                },
            }),
        ]);

        expect(events.map((e) => e.start)).toEqual(['2024-05-01 09:00', '2024-06-01 09:00']);
        expect(events.map((e) => e.end)).toEqual(['2024-05-01 10:00', '2024-06-01 10:00']);
    });

    it('lets an occurrence rename itself, as a renamed occurrence of a series does', () => {
        const { events } = derive([
            entry('a.md', {
                'Rust release': {
                    instances: [
                        { start: '2024-05-01 09:00' },
                        { start: '2024-06-01 09:00', name: 'Rust release: 1.2 stable' },
                    ],
                },
            }),
        ]);

        expect(events.map((e) => e.name)).toEqual(['Rust release', 'Rust release: 1.2 stable']);
    });

    // `dayjs(undefined)` is *now* and reports itself valid, so a list-only event that fell through
    // to the single-occurrence branch used to render a phantom event at the current time.
    it('reports an event that names no occurrence rather than inventing one', () => {
        const { events, errors } = derive([
            entry('a.md', { Nameless: { color: 'red' } }),
        ]);

        expect(events).toEqual([]);
        expect(errors).toEqual([['start', undefined, 'Nameless', 'a.md', null]]);
    });

    it('expands a rule, bounded by the window', () => {
        const { events } = derive([
            entry('a.md', {
                Standup: { start: '2024-05-01 09:00', end: '+15m', repeat: { freq: 'daily' } },
            }),
        ], { from: '2024-05-03', to: '2024-05-05' });

        expect(events.map((e) => e.start))
            .toEqual(['2024-05-03 09:00', '2024-05-04 09:00', '2024-05-05 09:00']);
        // A duration end is reapplied to each occurrence rather than copied from the first.
        expect(events.map((e) => e.end))
            .toEqual(['2024-05-03 09:15', '2024-05-04 09:15', '2024-05-05 09:15']);
    });

    it('carries an absolute end across as the gap it describes', () => {
        const { events } = derive([
            entry('a.md', {
                Long: {
                    start: '2024-05-01 09:00',
                    end: '2024-05-01 11:30',
                    repeat: { freq: 'daily' },
                },
            }),
        ], { from: '2024-05-02', to: '2024-05-02' });

        expect(events).toMatchObject([{ start: '2024-05-02 09:00', end: '2024-05-02 11:30' }]);
    });

    it('removes the occurrences named by exclusions', () => {
        const { events, errors } = derive([
            entry('a.md', {
                Standup: {
                    start: '2024-05-01 09:00',
                    repeat: { freq: 'daily' },
                    exclusions: ['2024-05-02 09:00'],
                },
            }),
        ], { from: '2024-05-01', to: '2024-05-03' });

        expect(events.map((e) => e.start)).toEqual(['2024-05-01 09:00', '2024-05-03 09:00']);
        expect(errors).toEqual([]);
    });

    // The importer will not spell an exclusion the way a hand-edited note does.
    it('matches an adjustment by instant, not by spelling', () => {
        const { events, errors } = derive([
            entry('a.md', {
                Standup: {
                    start: '2024-05-01 09:00',
                    repeat: { freq: 'daily' },
                    exclusions: [dayjs('2024-05-02 09:00').format()],
                },
            }),
        ], { from: '2024-05-01', to: '2024-05-03' });

        expect(events.map((e) => e.start)).toEqual(['2024-05-01 09:00', '2024-05-03 09:00']);
        expect(errors).toEqual([]);
    });

    it('applies an override to the occurrence it names', () => {
        const { events } = derive([
            entry('a.md', {
                Standup: {
                    start: '2024-05-01 09:00',
                    end: '+15m',
                    repeat: { freq: 'daily' },
                    overrides: [{ at: '2024-05-02 09:00', name: 'Retro', color: 'red' }],
                },
            }),
        ], { from: '2024-05-01', to: '2024-05-02' });

        expect(events.map((e) => e.name)).toEqual(['Standup', 'Retro']);
        expect(events[1]).toMatchObject({ start: '2024-05-02 09:00', color: 'red' });
    });

    it('adds instances the rule does not generate', () => {
        const { events } = derive([
            entry('a.md', {
                Standup: {
                    start: '2024-05-01 09:00',
                    repeat: { freq: 'weekly' },
                    instances: [{ start: '2024-05-03 14:00', name: 'Extra' }],
                },
            }),
        ], { from: '2024-05-01', to: '2024-05-07' });

        expect(events.map((e) => [e.name, e.start]))
            .toEqual([['Standup', '2024-05-01 09:00'], ['Extra', '2024-05-03 14:00']]);
    });

    it('reports an adjustment inside the window that lands on no occurrence', () => {
        const { errors } = derive([
            entry('a.md', {
                Standup: {
                    start: '2024-05-01 09:00',
                    repeat: { freq: 'daily' },
                    exclusions: ['2024-05-02 17:30'],
                },
            }),
        ], { from: '2024-05-01', to: '2024-05-03' });

        expect(errors).toEqual([['exclusions', '2024-05-02 17:30', 'Standup', 'a.md', null]]);
    });

    it('stays quiet about an adjustment outside the window', () => {
        const { errors } = derive([
            entry('a.md', {
                Standup: {
                    start: '2024-05-01 09:00',
                    repeat: { freq: 'daily' },
                    exclusions: ['2025-01-01 09:00'],
                },
            }),
        ], { from: '2024-05-01', to: '2024-05-03' });

        expect(errors).toEqual([]);
    });

    it('reports an unusable rule instead of dropping the event silently', () => {
        const { events, errors } = derive([
            entry('a.md', {
                Standup: {
                    start: '2024-05-01 09:00',
                    repeat: { freq: 'weekly', byday: ['3wed'] },
                },
            }),
        ], { from: '2024-05-01', to: '2024-05-31' });

        expect(events).toEqual([]);
        expect(errors[0][0]).toBe('repeat');
    });

    // `<v-calendar>` throws on a string its regex cannot read, and its regex has no offset group.
    it('never emits an offset, whatever the note was written with', () => {
        const { events } = derive([
            entry('a.md', {
                Series: {
                    start: '2015-06-25 10:00:00-07:00',
                    end: '+1h',
                    repeat: { freq: 'weekly', byday: ['thu'], tz: 'America/Los_Angeles' },
                },
            }),
        ], { from: '2015-06-25', to: '2015-07-10' });

        expect(events.length).toBeGreaterThan(0);
        for (const event of events) {
            expect(event.start).not.toMatch(/[+-]\d{2}:?\d{2}$/);
            expect(event.end).not.toMatch(/[+-]\d{2}:?\d{2}$/);
        }
    });

    // The listing these entries come from is shared by every view, and the inline versions of this
    // code wrote the normalized end straight back into it.
    it('does not mutate the entries it reads', () => {
        const entries = [
            entry('a.md', {
                Single: { start: '2024-05-01 09:00', end: '+1h' },
                Multiple: { end: '+2h', times: [{ start: '2024-05-02 09:00' }] },
                Series: {
                    start: '2024-05-01 09:00',
                    end: '+1h',
                    repeat: { freq: 'daily' },
                    exclusions: ['2024-05-02 09:00'],
                    overrides: [{ at: '2024-05-03 09:00', name: 'Moved' }],
                },
            }),
        ];
        const before = structuredClone(entries);

        derive(entries);

        expect(entries).toEqual(before);
    });
});

function imported(over: Partial<ImportedOccurrence> = {}): ImportedOccurrence {
    return {
        calendar: 'work',
        uid: 'a@example',
        recurrence_id: '2024-05-01 09:00:00+09:00',
        name: 'Standup',
        start: '2024-05-01 09:00:00+09:00',
        end: '2024-05-01 09:15:00+09:00',
        ...over,
    };
}

function noteEvent(ical?: { uid: string; recurrence_id?: string }) {
    const { events } = derive([
        entry('a.md', {
            Standup: {
                start: '2024-05-01 09:00',
                ...(ical === undefined ? {} : { ical: { calendar: 'work', ...ical } }),
            },
        }),
    ]);
    return events;
}

describe('toWallClock', () => {
    // `<v-calendar>` parses with a regex that has no offset group and throws on a miss, so this is
    // the guard between every datetime the app stores and the calendar that draws it.
    it('drops an offset, showing the instant in the reader zone', () => {
        vi.stubEnv('TZ', 'UTC');
        expect(toWallClock('2015-06-25 10:00:00-07:00')).toBe('2015-06-25 17:00');
        vi.unstubAllEnvs();
    });

    it('leaves a bare wall clock and a bare date exactly as written', () => {
        expect(toWallClock('2024-05-01 09:00')).toBe('2024-05-01 09:00');
        expect(toWallClock('2024-05-01')).toBe('2024-05-01');
    });

    it('returns anything it cannot read untouched, for the error path to report', () => {
        expect(toWallClock('not a time')).toBe('not a time');
    });
});

describe('mergeImported', () => {
    it('adds imported events beside the note ones', () => {
        const merged = mergeImported(noteEvent(), [imported({ uid: 'other@example' })]);

        expect(merged).toHaveLength(2);
        expect(merged[0].source).toBe('note');
        expect(merged[1].source).toBe('ical');
        expect(merged[1].notePath).toBeUndefined();
    });

    it('strips the offsets the backend sends, which the calendar cannot parse', () => {
        vi.stubEnv('TZ', 'UTC');
        const merged = mergeImported([], [imported()]);

        expect(merged[0].start).toBe('2024-05-01 00:00');
        expect(merged[0].start).not.toMatch(/[+-]\d{2}:?\d{2}$/);
        vi.unstubAllEnvs();
    });

    it('tints an imported event with its calendar colour', () => {
        const colorOf = new Map([['work', '#3f51b5']]);
        expect(mergeImported([], [imported()], { colorOf })[0].color).toBe('#3f51b5');
        expect(mergeImported([], [imported()])[0].color).toBe(DEFAULT_IMPORTED_COLOR);
    });

    // The whole point of converting: the read-only original must stop being drawn.
    it('shadows the whole series for a note carrying only a uid', () => {
        const merged = mergeImported(
            noteEvent({ uid: 'a@example' }),
            [imported(), imported({ recurrence_id: '2024-05-08 09:00:00+09:00' })],
        );

        expect(merged.every((event) => event.source === 'note')).toBe(true);
    });

    it('shadows one occurrence for a note that also carries a recurrence_id', () => {
        const merged = mergeImported(
            noteEvent({ uid: 'a@example', recurrence_id: '2024-05-01 09:00:00+09:00' }),
            [
                imported(),
                imported({
                    recurrence_id: '2024-05-08 09:00:00+09:00',
                    start: '2024-05-08 09:00:00+09:00',
                }),
            ],
        );

        expect(merged).toHaveLength(2);
        expect(merged.filter((event) => event.source === 'ical')).toHaveLength(1);
        expect(merged.find((event) => event.source === 'ical')?.recurrenceId)
            .toBe('2024-05-08 09:00:00+09:00');
    });

    // The note and the feed need not spell the same moment the same way.
    it('matches a claim by instant rather than by spelling', () => {
        const merged = mergeImported(
            noteEvent({ uid: 'a@example', recurrence_id: '2024-05-01T00:00:00Z' }),
            [imported()],
        );

        expect(merged.every((event) => event.source === 'note')).toBe(true);
    });

    it('leaves an imported event alone when a note claims a different series', () => {
        const merged = mergeImported(noteEvent({ uid: 'somewhere-else@example' }), [imported()]);
        expect(merged.filter((event) => event.source === 'ical')).toHaveLength(1);
    });
});
