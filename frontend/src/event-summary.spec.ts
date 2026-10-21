import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import dayjs from 'dayjs';

import type { ListEntry2 } from '@/api';
import { describeRepeat, summarizeEvent } from '@/event-summary';
import { eventsFromEntries } from '@/events';

import golden from '../../fixtures/calendar/notes.json';

describe('describeRepeat', () => {
    const start = '2026-05-06 10:00';

    it('says how often', () => {
        expect(describeRepeat({ freq: 'daily' }, start)).toBe('Daily');
        expect(describeRepeat({ freq: 'weekly', interval: 1 }, start)).toBe('Weekly');
        expect(describeRepeat({ freq: 'weekly', interval: 3 }, start)).toBe('Every 3 weeks');
        expect(describeRepeat({ freq: 'yearly', interval: 2 }, start)).toBe('Every 2 years');
    });

    it('says on which days and in which months', () => {
        expect(describeRepeat({ freq: 'weekly', byday: ['mon', 'wed'] }, start)).toBe('Weekly on Mon, Wed');
        expect(describeRepeat({ freq: 'weekly', byday: 'fri' }, start)).toBe('Weekly on Fri');
        expect(describeRepeat({ freq: 'monthly', byday: ['3wed'] }, start)).toBe('Monthly on the 3rd Wed');
        expect(describeRepeat({ freq: 'monthly', byday: ['-1fri'] }, start)).toBe('Monthly on the last Fri');
        expect(describeRepeat({ freq: 'monthly', bymonthday: [1, 22, 13, -2] }, start)).toBe('Monthly on the 1st, 22nd, 13th, 2nd last');
        expect(describeRepeat({ freq: 'yearly', bymonth: [1, 7] }, start)).toBe('Yearly in Jan, Jul');
    });

    it('says when it stops', () => {
        expect(describeRepeat({ freq: 'daily', interval: 1, until: '2026-09-26' }, start)).toBe('Daily, until 2026-09-26');
        expect(describeRepeat({ freq: 'weekly', count: 10 }, start)).toBe('Weekly, 10 times');
        expect(describeRepeat({ freq: 'weekly', count: 1 }, start)).toBe('Weekly, 1 time');
    });

    it('says nothing of no rule', () => {
        expect(describeRepeat(undefined, start)).toBeUndefined();
    });

    // The calendar draws nothing from a rule it refuses, and reports it there; describing what
    // could be read of it would say the event happens.
    it('calls a rule the calendar refuses unreadable', () => {
        const refused: unknown[] = [
            null, 'weekly', ['weekly'], {}, { freq: 'hourly' }, { freq: 'constructor' },
            { freq: 'weekly', byday: ['WE'] }, { freq: 'weekly', byday: ['WED'] },
            { freq: 'weekly', byday: ['xyz', 'tue'] }, { freq: 'weekly', byday: ['2mon'] },
            { freq: 'monthly', byday: ['0wed'] },
            { freq: 'weekly', interval: 0 }, { freq: 'weekly', interval: -1 }, { freq: 'weekly', interval: 1.5 },
            { freq: 'weekly', interval: 'twice' }, { freq: 'weekly', interval: 70000 },
            { freq: 'weekly', until: 'next year' }, { freq: 'weekly', until: null, count: 2 },
            { freq: 'weekly', until: '', count: 2 }, { freq: 'weekly', tz: 'Mars/Olympus' },
        ];
        for (const repeat of refused) {
            expect(describeRepeat(repeat, start), JSON.stringify(repeat)).toBe('Unreadable rule');
        }
        expect(describeRepeat({ freq: 'weekly' }, 'nonsense')).toBe('Unreadable rule');
        expect(describeRepeat({ freq: 'weekly' }, 20260506)).toBe('Unreadable rule');
    });

    // A date is never converted between zones, so the calendar draws an all-day rule whatever its
    // zone says.
    it('reads an unknown zone on an all-day rule, as the calendar does', () => {
        expect(describeRepeat({ freq: 'weekly', tz: 'Mars/Olympus' }, '2026-05-06')).toBe('Weekly');
    });
});

describe('summarizeEvent', () => {
    it('takes the earliest start it writes', () => {
        const summary = summarizeEvent({
            start: '2026-05-01 12:00',
            instances: [{ start: '2026-05-08 12:00' }, { start: '2025-02-18 12:00' }],
        });
        expect(summary.start?.text).toBe('2025-02-18 12:00');
        expect(summary.start?.instant).toBe(dayjs('2025-02-18 12:00').valueOf());
        // The older spelling of a list.
        expect(summarizeEvent({ times: [{ start: '2026-03-08' }] }).start?.text).toBe('2026-03-08');
    });

    it('shows a start that carries an offset in the reader\'s zone', () => {
        const start = '2026-10-21 10:00:00+09:00';
        expect(summarizeEvent({ start }).start?.text).toBe(dayjs(start).format('YYYY-MM-DD HH:mm'));
    });

    it('says how it repeats, by its rule and the dates it lists', () => {
        expect(summarizeEvent({ start: '2026-04-10 10:00', repeat: { freq: 'weekly', until: '2026-07-31' } }).repeats)
            .toBe('Weekly, until 2026-07-31');
        expect(summarizeEvent({ start: '2026-01-05', repeat: { freq: 'monthly' }, instances: [{ start: '2026-02-20' }] }).repeats)
            .toBe('Monthly, and 1 more date');
        expect(summarizeEvent({ instances: [{ start: '2026-05-01 12:00' }, { start: '2026-05-08 12:00' }] }).repeats)
            .toBe('On 2 dates');
        expect(summarizeEvent({ start: '2026-03-01', instances: [{ start: '2026-03-08' }] }).repeats).toBe('On 2 dates');
    });

    it('says nothing of a rule without a start, which the calendar draws nothing from', () => {
        const instances = [{ start: '2026-05-01 12:00' }, { start: '2026-05-08 12:00' }];
        expect(summarizeEvent({ repeat: { freq: 'weekly' }, instances }).repeats).toBe('On 2 dates');
        expect(summarizeEvent({ repeat: { freq: 'weekly' }, instances: instances.slice(0, 1) }).repeats).toBeUndefined();
    });

    it('leaves out the start of a rule the calendar refuses, and counts the dates it lists', () => {
        const repeat = { freq: 'weekly', byday: ['WE'] };
        expect(summarizeEvent({ start: '2026-04-01 10:00', repeat })).toEqual({ repeats: 'Unreadable rule' });
        expect(summarizeEvent({
            start: '2026-04-01 10:00',
            repeat,
            instances: [{ start: '2026-05-08 12:00' }, { start: '2026-05-01 12:00' }],
        })).toEqual({
            start: { text: '2026-05-01 12:00', instant: dayjs('2026-05-01 12:00').valueOf() },
            repeats: 'Unreadable rule, and 2 dates',
        });
        // `repeat:` with nothing after it is null, which the calendar refuses too.
        expect(summarizeEvent({ start: '2026-04-01 10:00', repeat: null })).toEqual({ repeats: 'Unreadable rule' });
    });

    it('counts a date it lists twice once', () => {
        expect(summarizeEvent({ start: '2026-11-02 09:00', instances: [{ start: '2026-11-02 13:00' }] }).repeats)
            .toBeUndefined();
    });

    it('says nothing of an event that happens once', () => {
        expect(summarizeEvent({ start: '2026-09-22' })).toEqual({
            start: { text: '2026-09-22', instant: dayjs('2026-09-22').valueOf() },
        });
    });

    it('reads nothing from what is not an event', () => {
        expect(summarizeEvent(undefined)).toEqual({});
        expect(summarizeEvent(null)).toEqual({});
        expect(summarizeEvent([])).toEqual({});
        expect(summarizeEvent({ start: 20240501 })).toEqual({});
        expect(summarizeEvent({ instances: [null, 3] })).toEqual({});
    });
});

describe('summarizeEvent against the calendar\'s fixtures', () => {
    // The notes `note-fixtures.spec.ts` holds the calendar to the backend with, read in the zone
    // both sides read them in.
    beforeAll(() => {
        vi.stubEnv('TZ', golden.zone);
    });
    afterAll(() => {
        vi.unstubAllEnvs();
    });

    function drawn(path: string, name: string, detail: Record<string, unknown>): number {
        const entry: ListEntry2 = {
            path,
            size: 1,
            mime_type: 'text/markdown',
            metadata: { events: { [name]: detail } } as unknown as ListEntry2['metadata'],
            title: null,
            time: '2024-05-01T00:00:00+00:00',
        };
        return eventsFromEntries([entry], golden.window).events.length;
    }

    it('calls unreadable exactly the rules the calendar draws nothing from', () => {
        let rules = 0;
        for (const [path, note] of Object.entries(golden.notes)) {
            const events = (note.metadata as { events?: Record<string, unknown> } | null)?.events ?? {};
            for (const [name, detail] of Object.entries(events)) {
                if (typeof detail !== 'object' || detail === null || !('start' in detail) || !('repeat' in detail)) {
                    continue;
                }
                rules += 1;
                // The rule alone: an end the calendar refuses draws nothing either, rule or none.
                const { start, repeat } = detail as Record<string, unknown>;
                expect(
                    summarizeEvent(detail).repeats?.startsWith('Unreadable rule'),
                    `${path}: ${name}`,
                ).toBe(drawn(path, name, { start, repeat }) === 0);
            }
        }
        expect(rules).toBeGreaterThan(40);
    });
});
