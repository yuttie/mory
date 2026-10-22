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

    // The calendar stops at whichever comes first.
    it('says both when it stops at a date and after a count', () => {
        expect(describeRepeat({ freq: 'weekly', until: '2026-07-31', count: 5 }, start))
            .toBe('Weekly, until 2026-07-31, at most 5 times');
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

    // rrule draws a day only when it is both, and a reader would take "on the Mon, 1st" for either.
    it('says the days of the month a rule falls on, and which weekday each must be', () => {
        expect(describeRepeat({ freq: 'monthly', byday: ['mon'], bymonthday: [1] }, start)).toBe('Monthly on the 1st if a Mon');
        expect(describeRepeat({ freq: 'monthly', byday: ['mon', 'fri'], bymonthday: [13] }, start))
            .toBe('Monthly on the 13th if a Mon or Fri');
        expect(describeRepeat({ freq: 'monthly', byday: ['1mon', '2tue', '-1fri'], bymonthday: [1, 2, -1] }, start))
            .toBe('Monthly on the 1st, 2nd, last if the 1st Mon, 2nd Tue or last Fri');
        expect(describeRepeat({ freq: 'yearly', byday: ['fri'], bymonthday: [13], bymonth: [10] }, start))
            .toBe('Yearly on the 13th if a Fri in Oct');
    });

    // As the calendar refuses them, and moried with it.
    it('calls a rule unreadable whose count is not a whole number from one', () => {
        for (const count of ['3', ' 2 ', 'abc', true, -1, 1.5, '1.5', '0', '', false, 0, [3], 4294967296]) {
            expect(describeRepeat({ freq: 'weekly', count }, start), JSON.stringify(count)).toBe('Unreadable rule');
        }
        expect(describeRepeat({ freq: 'weekly', count: null }, start)).toBe('Weekly');
        expect(describeRepeat({ freq: 'weekly', count: 4294967295 }, start)).toBe('Weekly, 4294967295 times');
    });

    it('says only the days and months the calendar can meet', () => {
        expect(describeRepeat({ freq: 'monthly', bymonthday: [1, 32] }, start)).toBe('Monthly on the 1st');
        expect(describeRepeat({ freq: 'monthly', bymonthday: [0, 15] }, start)).toBe('Monthly on the 15th');
        expect(describeRepeat({ freq: 'yearly', bymonth: [5, 13, '7'] }, start)).toBe('Yearly in May');
        // Naming plain weekdays too, a rule draws only the days both name.
        expect(describeRepeat({ freq: 'monthly', byday: ['mon', 'tue', '1mon'] }, start)).toBe('Monthly on the 1st Mon');
        expect(describeRepeat({ freq: 'yearly', byday: ['20mon'] }, start)).toBe('Yearly on the 20th Mon');
    });

    // As the calendar refuses them, and moried with it.
    it('calls a rule unreadable that counts a weekday where moried cannot', () => {
        for (const repeat of [
            { freq: 'daily', byday: ['2mon'] }, { freq: 'weekly', byday: ['2mon'] },
            { freq: 'monthly', byday: ['-5fri'] }, { freq: 'yearly', byday: ['-53mon'] },
            { freq: 'weekly', byday: [['mon']] }, { freq: 'weekly', byday: 1 },
        ]) {
            expect(describeRepeat(repeat, start), JSON.stringify(repeat)).toBe('Unreadable rule');
        }
        expect(describeRepeat({ freq: 'monthly', byday: ['5fri'] }, start)).toBe('Monthly on the 5th Fri');
        expect(describeRepeat({ freq: 'yearly', byday: ['-52mon'] }, start)).toBe('Yearly on the 52nd last Mon');
    });

    // rrule drops a day of the month that is neither positive nor negative, and with all of them
    // gone, takes no day from the start either.
    it('says when a rule falls on every day of each period', () => {
        expect(describeRepeat({ freq: 'monthly', bymonthday: [0] }, start)).toBe('Monthly on every day');
        expect(describeRepeat({ freq: 'yearly', bymonthday: ['x'], bymonth: [1] }, start)).toBe('Yearly on every day in Jan');
        expect(describeRepeat({ freq: 'daily', bymonthday: [0] }, start)).toBe('Daily');
    });

    it('calls a rule that can never be met unreadable', () => {
        const never: unknown[] = [
            { freq: 'weekly', count: 0 },
            { freq: 'monthly', bymonthday: [32] }, { freq: 'monthly', bymonthday: ['15'] },
            { freq: 'monthly', bymonthday: [1.5] }, { freq: 'yearly', bymonth: [13] },
            { freq: 'yearly', bymonth: ['3'] }, { freq: 'monthly', byday: ['6wed'] },
            { freq: 'yearly', byday: ['54wed'] }, { freq: 'yearly', bymonth: [1], byday: ['6mon'] },
            { freq: 'monthly', byday: ['mon', '1fri'] },
        ];
        for (const repeat of never) {
            expect(describeRepeat(repeat, start), JSON.stringify(repeat)).toBe('Unreadable rule');
        }
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

    // +05:45 is Nepal's alone, so the reader's zone, wherever the suite runs, is another: the
    // wall clock as written would be the wrong answer.
    it('shows a start that carries an offset in the reader\'s zone', () => {
        for (const start of ['2026-10-21 10:00:00+05:45', '2026-10-21 10:00+05:45']) {
            const text = summarizeEvent({ start }).start?.text;
            expect(text, start).toBe(dayjs(start).format('YYYY-MM-DD HH:mm'));
            expect(text, start).not.toBe('2026-10-21 10:00');
            expect(summarizeEvent({ instances: [{ start }] }).start?.text, start).toBe(text);
        }
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

    // It runs inside a computed, where one value that throws blanks the whole tab.
    it('never throws, whatever the frontmatter holds', () => {
        const values: unknown[] = [
            undefined, null, true, false, 0, -1, 1.5, 70000, Number.MAX_SAFE_INTEGER, '', ' ', 'x', '3',
            'WE', '0wed', '-6fri', 'Mars/Olympus', 'constructor', '2024-05-01', '2024-01-32 25:00',
            '2024-05-01 10:00:00+05:45', [], [null], [{}], [[]], ['15'], [0], [32], ['WE', 'mon'], {},
        ];
        const rule = { freq: 'monthly', byday: ['mon'], bymonthday: [1], bymonth: [5], until: '2025-05-01', tz: 'Asia/Tokyo' };
        for (const key of [...Object.keys(rule), 'interval', 'wkst', 'count', 'start']) {
            for (const value of values) {
                const repeat = { ...rule, [key]: value };
                for (const start of key === 'start' ? [value] : ['2024-05-01 10:00', '2024-05-01']) {
                    expect(() => summarizeEvent({ start, repeat, instances: [{ start: value }] }), `${key}: ${JSON.stringify(value)}`)
                        .not.toThrow();
                }
            }
            expect(() => summarizeEvent({ start: '2024-05-01', repeat: values })).not.toThrow();
        }
    });

    it('reads nothing from what is not an event', () => {
        expect(summarizeEvent(undefined)).toEqual({});
        expect(summarizeEvent(null)).toEqual({});
        expect(summarizeEvent([])).toEqual({});
        expect(summarizeEvent({ start: 20240501 })).toEqual({});
        expect(summarizeEvent({ instances: [null, 3] })).toEqual({});
    });
});

describe('summarizeEvent for a rule in another zone', () => {
    // The rule's wall clock is in `tz`; the reader is in Los Angeles.
    beforeAll(() => {
        vi.stubEnv('TZ', 'America/Los_Angeles');
    });
    afterAll(() => {
        vi.unstubAllEnvs();
    });

    // `fixtures/calendar/notes/zones.md`, "Tokyo morning": 09:00 in Tokyo is 16:00 the day before.
    it('puts its start where the calendar does, in the reader\'s zone', () => {
        const summary = summarizeEvent({
            start: '2024-03-04 09:00',
            repeat: { freq: 'weekly', byday: ['mon'], tz: 'Asia/Tokyo', until: '2024-03-26' },
        });
        expect(summary.start).toEqual({ text: '2024-03-03 16:00', instant: dayjs('2024-03-03 16:00').valueOf() });
        expect(summary.repeats).toBe('Weekly on Mon, until 2024-03-26');
    });

    // "Until with an offset": 12:00 UTC is 21:00 in Tokyo, the wall clock each occurrence there is
    // compared with, and 05:00 in Los Angeles.
    it('reads an until with an offset into the rule\'s zone, and shows it in the reader\'s', () => {
        expect(describeRepeat({ freq: 'daily', tz: 'Asia/Tokyo', until: '2024-04-04 12:00:00+00:00' }, '2024-04-01 20:00'))
            .toBe('Daily, until 2024-04-04 05:00');
    });
});

describe('summarizeEvent for a rule without a zone', () => {
    // Read in Tokyo, where an offset of -07:00 moves a time by sixteen hours.
    beforeAll(() => {
        vi.stubEnv('TZ', 'Asia/Tokyo');
    });
    afterAll(() => {
        vi.unstubAllEnvs();
    });

    // A rule repeats the wall clock it is anchored at, and the offset only records which one
    // applied that day; a one-off start names an instant.
    it('draws its start\'s wall clock as written, where a one-off is converted', () => {
        const start = '2024-05-01 10:00:00-07:00';
        expect(summarizeEvent({ start, repeat: { freq: 'weekly' } }).start?.text).toBe('2024-05-01 10:00');
        expect(summarizeEvent({ start }).start?.text).toBe('2024-05-02 02:00');
    });

    // Without a zone to read it into, the calendar compares occurrences with `until`'s wall clock.
    it('shows an until with an offset as the calendar compares it', () => {
        expect(describeRepeat({ freq: 'daily', until: '2024-05-03 10:00:00-07:00' }, '2024-05-01 09:00'))
            .toBe('Daily, until 2024-05-03 10:00');
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

    // The starts the calendar draws for one event, earliest first.
    function starts(path: string, name: string, detail: Record<string, unknown>): string[] {
        const entry: ListEntry2 = {
            path,
            size: 1,
            mime_type: 'text/markdown',
            metadata: { events: { [name]: detail } } as unknown as ListEntry2['metadata'],
            title: null,
            time: '2024-05-01T00:00:00+00:00',
        };
        return eventsFromEntries([entry], golden.window).events
            .map((event) => event.start)
            .sort((a, b) => dayjs(a).valueOf() - dayjs(b).valueOf());
    }

    function drawn(path: string, name: string, detail: Record<string, unknown>): number {
        return starts(path, name, detail).length;
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

    // A start off its rule's pattern is not drawn, since rrule begins at the first day the rule
    // meets; Starts still says it, since nothing is expanded, and it comes before that day.
    it('puts a rule\'s start where the calendar draws the first occurrence, or before it', () => {
        for (const [path, note] of Object.entries(golden.notes)) {
            const events = (note.metadata as { events?: Record<string, unknown> } | null)?.events ?? {};
            for (const [name, detail] of Object.entries(events)) {
                if (typeof detail !== 'object' || detail === null || !('start' in detail) || !('repeat' in detail)) {
                    continue;
                }
                const { start, repeat } = detail as Record<string, unknown>;
                const summary = summarizeEvent({ start, repeat });
                if (summary.start === undefined) {
                    continue;
                }
                const drawn = starts(path, name, { start, repeat });
                if (drawn.includes(summary.start.text)) {
                    expect(summary.start.text, `${path}: ${name}`).toBe(drawn[0]);
                }
                else {
                    expect(summary.start.instant, `${path}: ${name}`).toBeLessThan(dayjs(drawn[0]).valueOf());
                }
            }
        }
    });

    // The fixtures hold no rule rrule reads otherwise than it is written, so these are held to the
    // calendar here, over eleven years: long enough for a rule to meet any day it can.
    it('calls unreadable exactly the rules rrule reads as meeting nothing', () => {
        const window = { from: '2024-01-01', to: '2034-12-31' };
        const rules: Record<string, unknown>[] = [
            { freq: 'weekly', count: 0 }, { freq: 'weekly', count: '3' }, { freq: 'weekly', count: -1 },
            { freq: 'weekly', count: 'abc' }, { freq: 'monthly', bymonthday: [32] },
            { freq: 'monthly', bymonthday: ['15'] }, { freq: 'monthly', bymonthday: [1, 32] },
            { freq: 'monthly', bymonthday: [0] }, { freq: 'monthly', bymonthday: [-31] },
            { freq: 'yearly', bymonth: [13] }, { freq: 'yearly', bymonth: ['3'] }, { freq: 'yearly', bymonth: [5, 13] },
            { freq: 'monthly', byday: ['5fri'] }, { freq: 'monthly', byday: ['6wed'] }, { freq: 'monthly', byday: ['-5mon'] },
            { freq: 'yearly', byday: ['53mon'] }, { freq: 'yearly', byday: ['54mon'] },
            { freq: 'yearly', bymonth: [1], byday: ['5mon'] }, { freq: 'yearly', bymonth: [1], byday: ['6mon'] },
            { freq: 'monthly', byday: ['mon', '1mon'] }, { freq: 'monthly', byday: ['mon', '1fri'] },
            { freq: 'daily', byday: ['6mon'], count: 3 },
        ];
        for (const repeat of rules) {
            const entry: ListEntry2 = {
                path: 'a.md',
                size: 1,
                mime_type: 'text/markdown',
                metadata: { events: { Rule: { start: '2024-05-01 09:00', repeat } } } as unknown as ListEntry2['metadata'],
                title: null,
                time: '2024-05-01T00:00:00+00:00',
            };
            const drawn = eventsFromEntries([entry], window).events.length;
            expect(
                summarizeEvent({ start: '2024-05-01 09:00', repeat }).repeats === 'Unreadable rule',
                JSON.stringify(repeat),
            ).toBe(drawn === 0);
        }
    });
});
