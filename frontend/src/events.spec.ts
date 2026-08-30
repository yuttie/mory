import { describe, expect, it } from 'vitest';

import type { ListEntry2, MetadataEvent } from '@/api';
import {
    DEFAULT_EVENT_COLOR,
    eventsFromEntries,
    normalizeEndTime,
} from '@/events';

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
        const { events, errors } = eventsFromEntries([
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
            notePath: 'a.md',
        }]);
    });

    it('derives every occurrence of a times list', () => {
        const { events } = eventsFromEntries([
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
        const { events } = eventsFromEntries([
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
        const { events, errors } = eventsFromEntries([
            entry('a.md', {
                Broken: { start: 'nonsense' },
                Fine: { start: '2024-05-01 09:00' },
            }, { title: 'A note' }),
        ]);

        expect(events.map((e) => e.name)).toEqual(['Fine']);
        expect(errors).toEqual([['start', 'nonsense', 'Broken', 'a.md', 'A note']]);
    });

    it('reports an invalid end and keeps the other events', () => {
        const { events, errors } = eventsFromEntries([
            entry('a.md', {
                Broken: { start: '2024-05-01 09:00', end: 'nonsense' },
                Fine: { start: '2024-05-01 09:00' },
            }),
        ]);

        expect(events.map((e) => e.name)).toEqual(['Fine']);
        expect(errors).toEqual([['end', 'nonsense', 'Broken', 'a.md', null]]);
    });

    it('ignores entries with no metadata and notes with no events', () => {
        const { events, errors } = eventsFromEntries([
            entry('image.png', null),
            entry('plain.md', {}),
            { ...entry('nokey.md', {}), metadata: { tags: [] } },
        ]);

        expect(events).toEqual([]);
        expect(errors).toEqual([]);
    });

    // The listing these entries come from is shared by every view, and the inline versions of this
    // code wrote the normalized end straight back into it.
    it('does not mutate the entries it reads', () => {
        const entries = [
            entry('a.md', {
                Single: { start: '2024-05-01 09:00', end: '+1h' },
                Multiple: { end: '+2h', times: [{ start: '2024-05-02 09:00' }] },
            }),
        ];
        const before = structuredClone(entries);

        eventsFromEntries(entries);

        expect(entries).toEqual(before);
    });
});
