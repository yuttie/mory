import { describe, expect, it, vi } from 'vitest';

import dayjs from 'dayjs';

import type { AlarmDefaults } from '@/alarms';
import type { ListEntry2, MetadataEvent } from '@/api';
import type { ImportedOccurrence } from '@/api';
import type { EventCategories } from '@/events';
import {
    DEFAULT_DEADLINE_COLOR,
    DEFAULT_DUE_COLOR,
    DEFAULT_EVENT_COLOR,
    DEFAULT_IMPORTED_COLOR,
    applyNameTemplate,
    categoryLineage,
    eventEndsAt,
    eventsFromEntries,
    isAllDay,
    isInHiddenCategory,
    taskDatesFromEntries,
    mergeImported,
    normalizeEndTime,
    resolveCategory,
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

describe('eventEndsAt', () => {
    const LAST_MOMENT = 'YYYY-MM-DD HH:mm:ss.SSS';

    it('ends a one-day event with the day, not as it begins', () => {
        // The shape the backend sends a one-day imported event in: its inclusive end is the start.
        const end = eventEndsAt({ start: '2026-09-21', end: '2026-09-21' });
        expect(end.format(LAST_MOMENT)).toBe('2026-09-21 23:59:59.999');
        expect(end.isAfter(dayjs('2026-09-21 09:00'))).toBe(true);
    });

    it('ends a multi-day event with its last day', () => {
        expect(eventEndsAt({ start: '2026-09-19', end: '2026-09-23' }).format(LAST_MOMENT))
            .toBe('2026-09-23 23:59:59.999');
    });

    it('takes a date end as the whole day even after a timed start', () => {
        expect(eventEndsAt({ start: '2026-09-21 10:00', end: '2026-09-22' }).format(LAST_MOMENT))
            .toBe('2026-09-22 23:59:59.999');
    });

    it('ends a timed event at the moment it names', () => {
        expect(eventEndsAt({ start: '2026-09-21 10:00', end: '2026-09-21 11:30' })
            .format(LAST_MOMENT)).toBe('2026-09-21 11:30:00.000');
    });

    it('lets an event with no end last until the end of its day', () => {
        expect(eventEndsAt({ start: '2026-09-21 10:00' }).format(LAST_MOMENT))
            .toBe('2026-09-21 23:59:59.999');
        expect(eventEndsAt({ start: '2026-09-21' }).format(LAST_MOMENT))
            .toBe('2026-09-21 23:59:59.999');
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
            alarms: ['0m'],
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

    // The rule is expanded over the whole of the last day, so the check has to cover it too.
    it('reports one on the last day of the window', () => {
        const { errors } = derive([
            entry('a.md', {
                Standup: {
                    start: '2024-05-01 09:00',
                    repeat: { freq: 'daily' },
                    overrides: [{ at: '2024-05-03 17:30', name: 'Retro' }],
                },
            }),
        ], { from: '2024-05-01', to: '2024-05-03' });

        expect(errors).toEqual([['at', '2024-05-03 17:30', 'Standup', 'a.md', null]]);
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

function noteEvent(ical?: { uid: string; recurrence_id?: string; calendar?: string }) {
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

    it('drops the events of a hidden calendar and keeps the rest', () => {
        const merged = mergeImported(
            [],
            [imported(), imported({ calendar: 'family', uid: 'b@example' })],
            { hidden: new Set(['work']) },
        );

        expect(merged).toHaveLength(1);
        expect(merged[0].calendar).toBe('family');
    });

    // Hiding a calendar is a view preference about what it imports; a note converted from it is
    // mory's own event and must stay drawn.
    it('keeps a note converted from a hidden calendar', () => {
        const merged = mergeImported(
            noteEvent({ uid: 'a@example' }),
            [imported()],
            { hidden: new Set(['work']) },
        );

        expect(merged).toHaveLength(1);
        expect(merged[0].source).toBe('note');
    });

    it('drops the note events of a hidden category and keeps the rest', () => {
        const { events } = derive([
            entry('a.md', {
                Sync: { start: '2024-05-01 10:00', category: 'meeting/1on1' },
                Offsite: { start: '2024-05-02', category: 'trip' },
                Lunch: { start: '2024-05-03 12:00' },
            }),
        ]);

        const merged = mergeImported(events, [], { hiddenCategories: new Set(['meeting']) });

        expect(merged.map((event) => event.name)).toEqual(['Offsite', 'Lunch']);
    });

    // The note still claims the series while hidden, or hiding it would put the feed's copy back.
    it('keeps an imported event shadowed by a note in a hidden category', () => {
        const { events } = derive([
            entry('a.md', {
                Standup: {
                    start: '2024-05-01 09:00',
                    category: 'meeting',
                    ical: { calendar: 'work', uid: 'a@example' },
                },
            }),
        ]);

        const merged = mergeImported(events, [imported()], { hiddenCategories: new Set(['meeting']) });

        expect(merged).toEqual([]);
    });
});

// The module's own contract: "anything invalid is reported and skipped, never fatal. A typo in one
// note must not blank the calendar." Derivation runs inside a Vue computed, so anything thrown
// here takes down the whole view -- note events and imported events together.
describe('malformed frontmatter', () => {
    const cases: [string, unknown][] = [
        ['a bare integer start', { start: 20240501 }],
        ['a half-typed date', { start: 2024 }],
        ['a repeat that is not a mapping', { start: '2024-05-01 09:00', repeat: 'daily' }],
        ['an unknown frequency', { start: '2024-05-01 09:00', repeat: { freq: 'fortnightly' } }],
        // Schema-valid: the weekday pattern admits a zero ordinal, but rrule refuses it.
        ['a zero ordinal', { start: '2024-05-01', repeat: { freq: 'monthly', byday: ['0wed'] } }],
        ['an ordinal under freq: weekly', {
            start: '2024-05-01', repeat: { freq: 'weekly', byday: ['3wed'] },
        }],
        ['instances that are not a list', { instances: 5 }],
        ['exclusions that are not a list', {
            start: '2024-05-01 09:00', repeat: { freq: 'daily' }, exclusions: 7,
        }],
        ['an occurrence that is not a mapping', { instances: ['nonsense'] }],
        ['a null end', { start: '2024-05-01 09:00', end: null }],
        ['a non-string name', { start: '2024-05-01 09:00', name: 123 }],
    ];

    for (const [description, event] of cases) {
        it(`survives ${description}`, () => {
            expect(() => derive([entry('a.md', { Broken: event as never })])).not.toThrow();
        });
    }

    it('still derives the good events in a note that also has a broken one', () => {
        const { events } = derive([
            entry('a.md', {
                Broken: { start: 20240501 } as never,
                Fine: { start: '2024-05-01 09:00' },
            }),
        ]);

        expect(events.map((e) => e.name)).toEqual(['Fine']);
    });

    it('never emits a non-string start, whatever the note held', () => {
        const { events } = derive([
            entry('a.md', { Broken: { start: 20240501 } as never }),
        ]);
        for (const event of events) {
            expect(typeof event.start).toBe('string');
        }
    });
});

describe('mergeImported with what the wire may actually carry', () => {
    it('survives an occurrence whose optional fields are absent', () => {
        expect(() => mergeImported([], [{
            calendar: 'work',
            uid: 'a@example',
            recurrence_id: '2024-05-01 09:00:00+09:00',
            name: 'No end',
            start: '2024-05-01 09:00:00+09:00',
        }])).not.toThrow();
    });

    // Regression: the backend serialised these as `null`, the TS type said `?: string`, and
    // `toWallClock(null)` threw out of the calendar's computed.
    it('survives an occurrence whose optional fields are null', () => {
        const merged = mergeImported([], [{
            calendar: 'work',
            uid: 'a@example',
            recurrence_id: '2024-05-01 09:00:00+09:00',
            name: 'Null end',
            start: '2024-05-01 09:00:00+09:00',
            end: null,
            note: null,
            location: null,
            url: null,
        } as never]);

        expect(merged).toHaveLength(1);
        expect(merged[0].end ?? undefined).toBeUndefined();
    });
});

describe('shadowing is scoped to the calendar', () => {
    // A uid is unique within a calendar, not across them, and a shared invite really does carry
    // the same one in two subscriptions.
    it('does not hide the same uid in another calendar', () => {
        const merged = mergeImported(
            noteEvent({ uid: 'shared@example', calendar: 'work' }),
            [imported({ uid: 'shared@example', calendar: 'family', name: 'Family copy' })],
        );

        const stillImported = merged.filter((event) => event.source === 'ical');
        expect(stillImported).toHaveLength(1);
        expect(stillImported[0].name).toBe('Family copy');
    });

    it('still hides the same uid in the calendar it was converted from', () => {
        const merged = mergeImported(
            noteEvent({ uid: 'shared@example', calendar: 'work' }),
            [imported({ uid: 'shared@example', calendar: 'work' })],
        );

        expect(merged.every((event) => event.source === 'note')).toBe(true);
    });
});

describe('an override that moves its occurrence', () => {
    // The moved start is the whole point of such an override; it used to be clobbered by the
    // rule-generated time it replaces.
    it('is expanded at the time it moved to', () => {
        const { events } = derive([
            entry('a.md', {
                Standup: {
                    start: '2024-05-01 09:00',
                    end: '+30m',
                    repeat: { freq: 'daily' },
                    overrides: [{ at: '2024-05-02 09:00', start: '2024-05-02 15:00' }],
                },
            }),
        ], { from: '2024-05-01', to: '2024-05-02' });

        expect(events.map((e) => e.start)).toEqual(['2024-05-01 09:00', '2024-05-02 15:00']);
    });

    // The third Thursday of September 2026 is the 17th; this one moved to the 28th.
    const maintenance = (adjustments: Partial<MetadataEvent>) => entry('a.md', {
        Maintenance: {
            start: '2025-09-18 18:00',
            end: '2025-09-18 22:00',
            repeat: { freq: 'monthly', byday: ['3thu'] },
            overrides: [
                { at: '2026-09-17 18:00', start: '2026-09-28 18:00', end: '2026-09-28 20:00' },
            ],
            ...adjustments,
        },
    });
    const home = { from: '2026-09-28', to: '2026-09-30' };

    // The rule is expanded by where each occurrence was generated, so one moved in from the 17th
    // was never met: Home, asking for three days, lost it while the calendar drew it.
    it('is drawn when it moves into the window from outside it', () => {
        const { events, errors } = derive([maintenance({})], home);

        expect(events.map((e) => [e.start, e.end]))
            .toEqual([['2026-09-28 18:00', '2026-09-28 20:00']]);
        expect(errors).toEqual([]);
    });

    it('stays excluded when the occurrence it moves is', () => {
        const { events, errors } = derive([maintenance({ exclusions: ['2026-09-17 18:00'] })], home);

        expect(events).toEqual([]);
        expect(errors).toEqual([]);
    });

    it('is reported when it moves an occurrence the rule does not generate', () => {
        const { events, errors } = derive([maintenance({
            overrides: [{ at: '2026-09-16 18:00', start: '2026-09-28 18:00' }],
        })], home);

        expect(events).toEqual([]);
        expect(errors).toEqual([['at', '2026-09-16 18:00', 'Maintenance', 'a.md', null]]);
    });

    // A window with no occurrence of its own reads an unknown zone without complaint, so the
    // problem first shows while looking for the slot this one moved from. It is the rule's.
    it('reports an unknown zone met while looking for its slot under repeat', () => {
        const { events, errors } = derive([maintenance({
            repeat: { freq: 'monthly', byday: ['3thu'], tz: 'Mars/Olympus' },
        })], home);

        expect(events).toEqual([]);
        expect(errors).toEqual(
            [['repeat', 'Unknown timezone "Mars/Olympus"', 'Maintenance', 'a.md', null]]);
    });
});

describe('an all-day series', () => {
    // Milliseconds gave each occurrence a midnight, so the same data rendered all-day without a
    // rule and timed with one -- and drifted an hour across a daylight-saving change.
    it('keeps dates as dates on every occurrence', () => {
        const { events } = derive([
            entry('a.md', {
                Holiday: {
                    start: '2026-03-01',
                    end: '2026-03-03',
                    repeat: { freq: 'weekly' },
                },
            }),
        ], { from: '2026-03-01', to: '2026-03-20' });

        for (const event of events) {
            expect(event.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(event.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
        expect(events.map((e) => [e.start, e.end])).toEqual([
            ['2026-03-01', '2026-03-03'],
            ['2026-03-08', '2026-03-10'],
            ['2026-03-15', '2026-03-17'],
        ]);
    });

    // A date is not an instant; converting midnight-in-a-zone into the reader's moves the date.
    it('is not shifted by a timezone a note happens to carry', () => {
        vi.stubEnv('TZ', 'America/Los_Angeles');
        const { events } = derive([
            entry('a.md', {
                Holiday: {
                    start: '2026-08-01',
                    repeat: { freq: 'daily', tz: 'Asia/Tokyo' },
                },
            }),
        ], { from: '2026-08-01', to: '2026-08-03' });

        expect(events.map((e) => e.start)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
        vi.unstubAllEnvs();
    });
});

describe('a rule in a zone other than the reader\'s', () => {
    // Los Angeles's 17:00 on the 27th is Tokyo's 09:00 on the 28th. The window used to be read as
    // Los Angeles wall clock, so a Tokyo reader lost the 28th and was given the 1st.
    const daily = (adjustments: Partial<MetadataEvent> = {}) => entry('a.md', {
        Standup: {
            start: '2026-09-01 17:00:00-07:00',
            repeat: { freq: 'daily', tz: 'America/Los_Angeles' },
            ...adjustments,
        },
    });
    const home = { from: '2026-09-28', to: '2026-09-30' };

    it('draws what falls in the window in the reader\'s zone', () => {
        vi.stubEnv('TZ', 'Asia/Tokyo');
        const { events } = derive([daily()], home);

        expect(events.map((e) => e.start))
            .toEqual(['2026-09-28 09:00', '2026-09-29 09:00', '2026-09-30 09:00']);
        vi.unstubAllEnvs();
    });

    it('matches an exclusion on the window\'s first day rather than reporting it', () => {
        vi.stubEnv('TZ', 'Asia/Tokyo');
        const { events, errors } = derive(
            [daily({ exclusions: ['2026-09-27 17:00:00-07:00'] })], home);

        expect(events.map((e) => e.start)).toEqual(['2026-09-29 09:00', '2026-09-30 09:00']);
        expect(errors).toEqual([]);
        vi.unstubAllEnvs();
    });
});

describe('event categories', () => {
    const categories = new Map([
        ['meeting', { color: '#1565c0', name: '[MTG] {{name}}' }],
        ['trip', { color: '#2e7d32' }],
    ]);
    const categorised = (entries: ListEntry2[], window = ANY_WINDOW) =>
        eventsFromEntries(entries, window, { categories });

    it('gives an event its category colour and name', () => {
        const { events, errors } = categorised([
            entry('a.md', { 'Weekly sync': { start: '2024-05-01 10:00', category: 'meeting' } }),
        ]);

        expect(errors).toEqual([]);
        expect(events).toEqual([expect.objectContaining({
            name: '[MTG] Weekly sync',
            color: '#1565c0',
            categoryId: 'meeting',
        })]);
    });

    it('yields to a colour the occurrence or the event names', () => {
        const { events } = categorised([
            entry('a.md', {
                Offsite: {
                    category: 'trip',
                    color: 'orange',
                    instances: [
                        { start: '2024-05-01' },
                        { start: '2024-06-01', color: 'red' },
                    ],
                },
                Onsite: { start: '2024-07-01', category: 'trip' },
            }),
        ]);

        expect(events.map((e) => e.color)).toEqual(['orange', 'red', '#2e7d32']);
    });

    it('leaves the name alone when the category has no template', () => {
        const { events } = categorised([
            entry('a.md', { Offsite: { start: '2024-05-01', category: 'trip' } }),
        ]);

        expect(events[0].name).toBe('Offsite');
    });

    it('wraps the name an occurrence renames itself to', () => {
        const { events } = categorised([
            entry('a.md', {
                Standup: {
                    category: 'meeting',
                    start: '2024-05-01 09:00',
                    repeat: { freq: 'daily' },
                    overrides: [{ at: '2024-05-02 09:00', name: 'Retro' }],
                },
            }),
        ], { from: '2024-05-01', to: '2024-05-02' });

        expect(events.map((e) => e.name)).toEqual(['[MTG] Standup', '[MTG] Retro']);
        expect(events.every((e) => e.color === '#1565c0' && e.categoryId === 'meeting'))
            .toBe(true);
    });

    it('draws an event whose category is not configured, and reports it', () => {
        const { events, errors } = categorised([
            entry('a.md', { 'Weekly sync': { start: '2024-05-01 10:00', category: 'meetnig' } }),
        ]);

        expect(events).toEqual([expect.objectContaining({
            name: 'Weekly sync',
            color: DEFAULT_EVENT_COLOR,
            categoryId: 'meetnig',
        })]);
        expect(errors).toEqual([['category', 'meetnig', 'Weekly sync', 'a.md', null]]);
    });

    it('reports a category that is not text, and draws the event without one', () => {
        const { events, errors } = categorised([
            entry('a.md', {
                'Weekly sync': { start: '2024-05-01 10:00', category: ['meeting'] as unknown as string },
            }),
        ]);

        expect(events).toHaveLength(1);
        expect(events[0].categoryId).toBeUndefined();
        expect(errors).toEqual([['category', ['meeting'], 'Weekly sync', 'a.md', null]]);
    });

    it('reads an empty category as none', () => {
        const { events, errors } = categorised([
            entry('a.md', {
                'Weekly sync': { start: '2024-05-01 10:00', category: null as unknown as string },
            }),
        ]);

        expect(errors).toEqual([]);
        expect(events[0].categoryId).toBeUndefined();
    });

    // Before the configuration has loaded every category would look unknown, and the calendar
    // would flash an error for each of them.
    it('records the category but neither applies nor checks it without a configuration', () => {
        const { events, errors } = derive([
            entry('a.md', { 'Weekly sync': { start: '2024-05-01 10:00', category: 'meeting' } }),
        ]);

        expect(errors).toEqual([]);
        expect(events).toEqual([expect.objectContaining({
            name: 'Weekly sync',
            color: DEFAULT_EVENT_COLOR,
            categoryId: 'meeting',
        })]);
    });
});

describe('nested categories', () => {
    const categories = new Map([
        ['meeting', { color: '#1565c0', name: '[MTG] {{name}}' }],
        ['meeting/1on1', { color: '#6a1b9a' }],
        ['meeting/1on1/skip', {}],
        ['work/review', { name: 'Review: {{name}}' }],
    ]);

    it('lists an id and its ancestors, nearest first', () => {
        expect(categoryLineage('a/b/c')).toEqual(['a/b/c', 'a/b', 'a']);
        expect(categoryLineage('meeting')).toEqual(['meeting']);
    });

    it('takes each field from the nearest category that sets it', () => {
        expect(resolveCategory('meeting/1on1', categories))
            .toEqual({ color: '#6a1b9a', name: '[MTG] {{name}}' });
        expect(resolveCategory('meeting/1on1/skip', categories))
            .toEqual({ color: '#6a1b9a', name: '[MTG] {{name}}' });
    });

    it('does not need an ancestor to be configured', () => {
        expect(resolveCategory('work/review', categories)).toEqual({ name: 'Review: {{name}}' });
    });

    // An ancestor alone would draw `meeting/1no1` as a meeting, and the typo would go unseen.
    it('hides a category with its ancestor, and not with its descendant', () => {
        const hidden = new Set(['meeting']);
        expect(isInHiddenCategory('meeting', hidden)).toBe(true);
        expect(isInHiddenCategory('meeting/1on1', hidden)).toBe(true);
        expect(isInHiddenCategory('meetings', hidden)).toBe(false);
        expect(isInHiddenCategory('meeting', new Set(['meeting/1on1']))).toBe(false);
        expect(isInHiddenCategory(undefined, hidden)).toBe(false);
    });

    it('needs the id itself to be configured', () => {
        expect(resolveCategory('meeting/1no1', categories)).toBeNull();

        const { events, errors } = eventsFromEntries([
            entry('a.md', { Sync: { start: '2024-05-01 10:00', category: 'meeting/1no1' } }),
        ], ANY_WINDOW, { categories });
        expect(events[0]).toMatchObject({ name: 'Sync', color: DEFAULT_EVENT_COLOR });
        expect(errors).toEqual([['category', 'meeting/1no1', 'Sync', 'a.md', null]]);
    });

    it('draws a nested category with what it inherits', () => {
        const { events } = eventsFromEntries([
            entry('a.md', { Sync: { start: '2024-05-01 10:00', category: 'meeting/1on1' } }),
        ], ANY_WINDOW, { categories });

        expect(events[0]).toMatchObject({
            name: '[MTG] Sync',
            color: '#6a1b9a',
            categoryId: 'meeting/1on1',
        });
    });
});

describe('applyNameTemplate', () => {
    it('accepts the placeholder with inner whitespace and in any case', () => {
        expect(applyNameTemplate('[MTG] {{ name }}', 'Sync')).toBe('[MTG] Sync');
        expect(applyNameTemplate('{{NAME}} (1:1)', 'Sync')).toBe('Sync (1:1)');
        expect(applyNameTemplate('{{name}} / {{name}}', 'Sync')).toBe('Sync / Sync');
    });

    it('keeps a replacement pattern in the name literally', () => {
        expect(applyNameTemplate('[MTG] {{name}}', 'Pay $& back')).toBe('[MTG] Pay $& back');
    });

    it('leaves any other placeholder as written', () => {
        expect(applyNameTemplate('{{nmae}} {{location}}', 'Sync')).toBe('{{nmae}} {{location}}');
    });

    it('returns the name when there is no template', () => {
        expect(applyNameTemplate(undefined, 'Sync')).toBe('Sync');
    });
});

describe('taskDatesFromEntries', () => {
    const UUID_A = '11111111-1111-4111-8111-111111111111';
    const UUID_B = '22222222-2222-4222-8222-222222222222';

    function taskEntry(
        uuid: string,
        task: Record<string, unknown> | null,
        options: Partial<ListEntry2> = {},
    ): ListEntry2 {
        return {
            path: `.tasks/${uuid}.md`,
            size: 1,
            mime_type: 'text/markdown',
            metadata: task === null ? { tags: [] } : { tags: [], task },
            title: 'Submit the paper',
            time: '2024-05-01T12:00:00+00:00',
            ...options,
        };
    }

    const taskDates = (entries: ListEntry2[], window = ANY_WINDOW) =>
        taskDatesFromEntries(entries, window);

    it('draws a deadline as a one-off event named after the task', () => {
        const { events, errors } = taskDates([
            taskEntry(UUID_A, { status: { kind: 'todo' }, deadline: '2026-03-04' }),
        ]);

        expect(errors).toEqual([]);
        expect(events).toEqual([{
            name: 'Submit the paper',
            start: '2026-03-04',
            finished: false,
            color: DEFAULT_DEADLINE_COLOR,
            source: 'task',
            taskDate: 'deadline',
            notePath: `.tasks/${UUID_A}.md`,
            taskId: UUID_A,
            alarms: [],
        }]);
    });

    it('keeps a deadline with a time of day timed, and drops its offset', () => {
        vi.stubEnv('TZ', 'Asia/Tokyo');
        const { events } = taskDates([
            taskEntry(UUID_A, { status: { kind: 'todo' }, deadline: '2026-03-04 23:59+00:00' }),
        ]);

        expect(events.map((e) => e.start)).toEqual(['2026-03-05 08:59']);
        vi.unstubAllEnvs();
    });

    it('ignores an entry that is not a task, or a task with neither date', () => {
        const { events, errors } = taskDates([
            entry('notes/a.md', { Meeting: { start: '2026-03-04 10:00' } }),
            taskEntry(UUID_A, { status: { kind: 'todo' } }),
            taskEntry(UUID_B, null),
        ]);

        expect(events).toEqual([]);
        expect(errors).toEqual([]);
    });

    it('marks a finished task, so the view fades its deadline', () => {
        const { events } = taskDates([
            taskEntry(UUID_A, {
                status: { kind: 'done', completed_at: '2026-03-01 10:00+09:00' },
                deadline: '2026-03-04',
            }),
            taskEntry(UUID_B, {
                status: { kind: 'canceled', canceled_at: '2026-03-01 10:00+09:00' },
                deadline: '2026-03-05',
            }),
        ]);

        expect(events.map((e) => e.finished)).toEqual([true, true]);
    });

    // The last minute of the window's last day in Tokyo, which is where it is read: east of +09:00
    // it is already April, and rightly left out.
    it('keeps only the deadlines inside the window', () => {
        vi.stubEnv('TZ', 'Asia/Tokyo');
        const { events } = taskDates([
            taskEntry(UUID_A, { status: { kind: 'todo' }, deadline: '2026-02-28' }),
            taskEntry(UUID_B, { status: { kind: 'todo' }, deadline: '2026-03-31 23:59+09:00' }),
        ], { from: '2026-03-01', to: '2026-03-31' });

        expect(events.map((e) => e.taskId)).toEqual([UUID_B]);
        vi.unstubAllEnvs();
    });

    it('reports an unusable deadline rather than dropping it silently', () => {
        const { events, errors } = taskDates([
            taskEntry(UUID_A, { status: { kind: 'todo' }, deadline: 20260304 }),
            taskEntry(UUID_B, { status: { kind: 'todo' }, deadline: 'next Friday' }),
        ]);

        expect(events).toEqual([]);
        expect(errors).toEqual([
            ['deadline', 20260304, 'Submit the paper', `.tasks/${UUID_A}.md`, 'Submit the paper'],
            ['deadline', 'next Friday', 'Submit the paper', `.tasks/${UUID_B}.md`, 'Submit the paper'],
        ]);
    });

    it('falls back to the path when the task has no title', () => {
        const { events } = taskDates([
            taskEntry(UUID_A, { status: { kind: 'todo' }, deadline: '2026-03-04' }, { title: null }),
        ]);

        expect(events.map((e) => e.name)).toEqual([`.tasks/${UUID_A}.md`]);
    });

    it('draws a due date in its own colour, beside the deadline of the same task', () => {
        const { events } = taskDates([
            taskEntry(UUID_A, {
                status: { kind: 'todo' },
                due_by: '2026-03-01',
                deadline: '2026-03-04',
            }),
        ]);

        expect(events.map((e) => [e.taskDate, e.start, e.color])).toEqual([
            ['due_by', '2026-03-01', DEFAULT_DUE_COLOR],
            ['deadline', '2026-03-04', DEFAULT_DEADLINE_COLOR],
        ]);
        // Both point at the same task, which is what makes the pair readable as a run-up.
        expect(new Set(events.map((e) => e.taskId))).toEqual(new Set([UUID_A]));
    });

    it('reports an unusable due date under its own field name', () => {
        const { events, errors } = taskDates([
            taskEntry(UUID_A, { status: { kind: 'todo' }, due_by: 'sometime' }),
        ]);

        expect(events).toEqual([]);
        expect(errors).toEqual([
            ['due_by', 'sometime', 'Submit the paper', `.tasks/${UUID_A}.md`, 'Submit the paper'],
        ]);
    });
    it('draws a task date in the colour the configuration names', () => {
        const { events } = taskDatesFromEntries([
            taskEntry(UUID_A, {
                status: { kind: 'todo' },
                due_by: '2026-03-01',
                deadline: '2026-03-04',
            }),
        ], ANY_WINDOW, { colorOf: { due_by: '#0d47a1' } });

        // Only what is configured is overridden; the rest keeps its default.
        expect(events.map((e) => e.color)).toEqual(['#0d47a1', DEFAULT_DEADLINE_COLOR]);
    });
});

describe('event alarms', () => {
    // The same configuration and notes as `each_step_of_the_precedence_wins_over_those_after_it` in
    // `backend/src/alarms.rs`, which rings by what this resolves.
    const categories: EventCategories = new Map([
        ['meeting', { color: 'red', alarms: ['-10m'] }],
        ['meeting/1on1', { alarms: ['-15m', '0m'] }],
        ['meeting/standup', { color: 'blue' }],
        ['meeting/quiet', { alarms: [] }],
        ['unset', {}],
        ['kin/child', { alarms: ['-2h'] }],
        ['kin/child/grandchild', {}],
        ['a/b/c', { alarms: ['-1h'] }],
        ['a/b/c/d', {}],
    ]);
    const alarmDefaults: AlarmDefaults = { timed: ['-5m'], allDay: ['-1d 18:00'] };

    /// What each event rings at, by name; the same name twice keeps the later.
    function ringing(
        events: Record<string, MetadataEvent>,
        options: { categories?: EventCategories; alarmDefaults?: AlarmDefaults } = {},
    ): Record<string, string[] | undefined> {
        const derived = eventsFromEntries([entry('a.md', events)], ANY_WINDOW, options);
        // A category that is not configured is reported, and is not what these are about.
        expect(derived.errors.filter(([property]) => property !== 'category')).toEqual([]);
        return Object.fromEntries(derived.events.map((event) => [event.name, event.alarms]));
    }

    it('rings at the start of a timed event and never for an all-day one, as before', () => {
        expect(ringing({
            Timed: { start: '2024-05-06 09:00' },
            Day: { start: '2024-05-07' },
            Offset: { start: '2024-05-08 09:00:00+09:00' },
        })).toEqual({ Timed: ['0m'], Day: [], Offset: ['0m'] });
    });

    it('takes each step of the precedence over those after it', () => {
        const at = (n: number) => `2024-05-06 09:${String(n).padStart(2, '0')}`;
        expect(ringing({
            'Own list': { start: at(0), category: 'meeting', alarms: ['-1m'] },
            'Own list silences': { start: at(1), category: 'meeting', alarms: [] },
            'The event\'s list': { start: at(3), category: 'meeting/1on1', alarms: ['-1h'] },
            'A category': { start: at(4), category: 'meeting' },
            'A nested category': { start: at(5), category: 'meeting/1on1' },
            'A category that sets none': { start: at(6), category: 'meeting/standup' },
            'A category that silences': { start: at(7), category: 'meeting/quiet' },
            'A category with nothing': { start: at(8), category: 'unset' },
            'A category misspelt': { start: at(9), category: 'meeting/1no1' },
            'A category not configured': { start: at(11), category: 'nowhere' },
            'A parent that is not configured': { start: at(12), category: 'kin' },
            'Through two ancestors': { start: at(13), category: 'kin/child/grandchild' },
            'Past an ancestor that is not configured': { start: at(14), category: 'a/b/c/d' },
            'A configured id without its parents': { start: at(15), category: 'a/b' },
            'No category': { start: at(16) },
            'An all-day one': { start: '2024-05-06' },
            'An all-day one in a category': { start: '2024-05-07', category: 'meeting' },
            'An all-day one with its own': { start: '2024-05-08', alarms: ['09:00'] },
        } as Record<string, MetadataEvent>, { categories, alarmDefaults })).toEqual({
            'Own list': ['-1m'],
            'Own list silences': [],
            'The event\'s list': ['-1h'],
            'A category': ['-10m'],
            'A nested category': ['-15m', '0m'],
            'A category that sets none': ['-10m'],
            'A category that silences': [],
            'A category with nothing': ['-5m'],
            'A category misspelt': ['-5m'],
            'A category not configured': ['-5m'],
            'A parent that is not configured': ['-5m'],
            'Through two ancestors': ['-2h'],
            'Past an ancestor that is not configured': ['-1h'],
            'A configured id without its parents': ['-5m'],
            'No category': ['-5m'],
            'An all-day one': ['-1d 18:00'],
            'An all-day one in a category': ['-10m'],
            'An all-day one with its own': ['09:00'],
        });
    });

    it('takes the configuration for a kind it sets, an empty list silencing it', () => {
        const events = { Timed: { start: '2024-05-06 09:00' }, Day: { start: '2024-05-07' } };
        expect(ringing(events, { alarmDefaults: { timed: [], allDay: ['09:00'] } }))
            .toEqual({ Timed: [], Day: ['09:00'] });
        // A kind it leaves out is the built-in one.
        expect(ringing(events, { alarmDefaults: { allDay: ['09:00'] } }))
            .toEqual({ Timed: ['0m'], Day: ['09:00'] });
    });

    it('reads a single string as a list of one and leaves an empty value to inherit', () => {
        expect(ringing({
            Single: { start: '2024-05-06 09:00', alarms: '-1h' },
            Empty: { start: '2024-05-06 10:00', alarms: null as unknown as string[] },
        }, { alarmDefaults })).toEqual({ Single: ['-1h'], Empty: ['-5m'] });
    });

    it('keeps an alarm as written, trimmed, whichever way it is spelt', () => {
        expect(ringing({
            Spelt: { start: '2024-05-06 09:00', alarms: [' -90 minutes ', '+1 hour', '-1d 18:00'] },
        })).toEqual({ Spelt: ['-90 minutes', '+1 hour', '-1d 18:00'] });
    });

    it('lets an override and an instance set their own, and inherit the event\'s otherwise', () => {
        const derived = eventsFromEntries([entry('a.md', {
            Standup: {
                start: '2024-05-06 09:00',
                repeat: { freq: 'daily', count: 3 },
                alarms: ['-10m'],
                overrides: [
                    { at: '2024-05-07 09:00', alarms: [] },
                    { at: '2024-05-08 09:00', location: 'Room 2' },
                ],
            },
            Class: {
                alarms: ['-30m'],
                instances: [
                    { start: '2024-05-10 14:00' },
                    { start: '2024-05-11 14:00', alarms: ['0m'] },
                    { start: '2024-05-12 14:00', alarms: null as unknown as string[] },
                ],
            },
        })], ANY_WINDOW);
        expect(derived.errors).toEqual([]);
        expect(derived.events.map((event) => `${event.start}  ${event.name}  ${event.alarms}`).sort())
            .toEqual([
                '2024-05-06 09:00  Standup  -10m',
                '2024-05-07 09:00  Standup  ',
                '2024-05-08 09:00  Standup  -10m',
                '2024-05-10 14:00  Class  -30m',
                '2024-05-11 14:00  Class  0m',
                '2024-05-12 14:00  Class  -30m',
            ]);
    });

    it('takes the shape of a start from how the calendar reads it', () => {
        for (const [start, allDay] of [
            ['2024-05-06', true], ['2024-05-06 09:00', false], ['2024-05-06 09:00:30', false],
            ['2024-5-2', true], ['2024-05', true], ['2024-05-03T10', true], ['2024-5-1 10:00', false],
            ['2024/05/04 10:00', false],
        ] as [string, boolean][]) {
            expect(isAllDay(start), start).toBe(allDay);
        }
    });

    describe('reports what is not an alarm', () => {
        const derive = (events: Record<string, MetadataEvent>) =>
            eventsFromEntries([entry('a.md', events, { title: 'A note' })], ANY_WINDOW);

        it('once for each entry, under the property that holds it', () => {
            const { events, errors } = derive({
                Spoilt: { start: '2024-05-06 09:00', alarms: ['-5m', '10m', 'soon', 7] as unknown as string[] },
            });
            expect(errors).toEqual([
                ['alarms', '10m', 'Spoilt', 'a.md', 'A note'],
                ['alarms', 'soon', 'Spoilt', 'a.md', 'A note'],
                ['alarms', 7, 'Spoilt', 'a.md', 'A note'],
            ]);
            // The rest stand, and the event is drawn.
            expect(events.map((event) => event.alarms)).toEqual([['-5m']]);
        });

        it('once for an event however many occurrences it generates', () => {
            const { events, errors } = derive({
                Daily: {
                    start: '2024-05-06 09:00',
                    repeat: { freq: 'daily', count: 5 },
                    alarms: ['10m'],
                },
            });
            expect(events).toHaveLength(5);
            expect(errors).toEqual([['alarms', '10m', 'Daily', 'a.md', 'A note']]);
        });

        it('for an override and an instance where it is written, and for a value that is no list', () => {
            const { errors } = derive({
                Series: {
                    start: '2024-05-06 09:00',
                    repeat: { freq: 'daily', count: 3 },
                    overrides: [{ at: '2024-05-07 09:00', alarms: ['1h'] }],
                    instances: [{ start: '2024-05-10 09:00', alarms: ['2h'] }],
                },
                Mapping: { start: '2024-05-06 10:00', alarms: { at: '-1h' } as unknown as string[] },
                Number: { start: '2024-05-06 11:00', alarms: 5 as unknown as string[] },
            });
            expect(errors.map(([property, value, name]) => `${property} ${JSON.stringify(value)} ${name}`))
                .toEqual([
                    'alarms "1h" Series',
                    'alarms "2h" Series',
                    'alarms {"at":"-1h"} Mapping',
                    'alarms 5 Number',
                ]);
        });

        it('for nothing that is not set, or silences', () => {
            expect(derive({
                None: { start: '2024-05-06 09:00' },
                Empty: { start: '2024-05-06 10:00', alarms: null as unknown as string[] },
                Silenced: { start: '2024-05-06 11:00', alarms: [] },
            }).errors).toEqual([]);
        });
    });
});

describe('task date alarms', () => {
    const UUID = '11111111-1111-4111-8111-111111111111';
    const task = (fields: Record<string, unknown>, title: string | null = 'Write'): ListEntry2 => ({
        path: `.tasks/${UUID}.md`,
        size: 1,
        mime_type: 'text/markdown',
        metadata: { tags: [], task: { status: { kind: 'todo' }, ...fields } },
        title,
        time: '2024-05-01T12:00:00+00:00',
    });
    const dates = (entries: ListEntry2[], alarmDefaults?: AlarmDefaults) =>
        taskDatesFromEntries(entries, ANY_WINDOW, { alarmDefaults });
    const ringing = (derived: ReturnType<typeof dates>) =>
        derived.events.map((event) => `${event.taskDate} ${event.alarms}`);

    it('rings by the task\'s own list, then the configuration, and otherwise not at all', () => {
        const both = { due_by: '2024-05-10', deadline: '2024-05-15 17:00' };
        const config = { dueBy: ['09:00'], deadline: ['-1d 18:00', '-2h'] };
        expect(ringing(dates([task(both)]))).toEqual(['due_by ', 'deadline ']);
        expect(ringing(dates([task(both)], config)))
            .toEqual(['due_by 09:00', 'deadline -1d 18:00,-2h']);
        expect(ringing(dates([task({ ...both, alarms: { due_by: ['-2h'], deadline: [] } })], config)))
            .toEqual(['due_by -2h', 'deadline ']);
        // A single string, and a date left empty, which inherits.
        expect(ringing(dates([task({ ...both, alarms: { due_by: '-1d 18:00', deadline: null } })], config)))
            .toEqual(['due_by -1d 18:00', 'deadline -1d 18:00,-2h']);
        // Neither a list for both nor anything but a mapping is a task's own.
        expect(ringing(dates([task({ ...both, alarms: ['-1h'] })], config)))
            .toEqual(['due_by 09:00', 'deadline -1d 18:00,-2h']);
    });

    it('never rings for a task that is over, and says so', () => {
        const done = task({ due_by: '2024-05-10', alarms: { due_by: ['-1h'] } });
        done.metadata!.task = { ...done.metadata!.task as object, status: { kind: 'done' } };
        expect(ringing(dates([done], { dueBy: ['09:00'] }))).toEqual(['due_by ']);
    });

    it('reports what is not an alarm, once for each date', () => {
        const { events, errors } = dates([task({
            due_by: '2024-05-10',
            deadline: '2024-05-15',
            alarms: { due_by: ['-1h', '10m'], deadline: 'soon' },
        })]);
        expect(errors).toEqual([
            ['alarms', '10m', 'Write', `.tasks/${UUID}.md`, 'Write'],
            ['alarms', 'soon', 'Write', `.tasks/${UUID}.md`, 'Write'],
        ]);
        expect(events.map((event) => event.alarms)).toEqual([['-1h'], []]);
    });
});

describe('an overrides list written by hand', () => {
    // Frontmatter is whatever the file said, and this runs inside a computed: one element that is
    // not a mapping must not throw, or the whole calendar goes blank for one note.
    const series = (overrides: unknown[]) => eventsFromEntries([entry('a.md', {
        Standup: {
            start: '2024-05-06 09:00',
            repeat: { freq: 'daily', count: 3 },
            overrides: overrides as never,
        },
    })], ANY_WINDOW);

    it('skips an element that is not a mapping, and reports it', () => {
        for (const bad of [null, 'text', 5, true, ['2024-05-07 09:00']]) {
            let derived: ReturnType<typeof series> | undefined;
            expect(() => {
                derived = series([bad, { at: '2024-05-07 09:00', name: 'Retro' }]);
            }, JSON.stringify(bad)).not.toThrow();
            expect(derived?.errors, JSON.stringify(bad)).toEqual([['overrides', bad, 'Standup', 'a.md', null]]);
            expect(derived?.events.map((event) => `${event.start}  ${event.name}`).sort(), JSON.stringify(bad))
                .toEqual(['2024-05-06 09:00  Standup', '2024-05-07 09:00  Retro', '2024-05-08 09:00  Standup']);
        }
    });

    it('still reports an override that names no occurrence', () => {
        expect(series([{ name: 'No at' }]).errors).toEqual([['at', undefined, 'Standup', 'a.md', null]]);
    });
});
