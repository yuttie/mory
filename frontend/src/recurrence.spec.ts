import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { EventRepeat } from '@/api';
import { RecurrenceError, expandRule, parseWallClock, readDatetime, readRule } from '@/recurrence';

describe('parseWallClock', () => {
    it('reads a date, a datetime, and seconds', () => {
        expect(parseWallClock('2015-06-25')).toMatchObject({ day: 25, hasTime: false });
        expect(parseWallClock('2015-06-25 10:00')).toMatchObject({ hour: 10, hasTime: true });
        expect(parseWallClock('2015-06-25 10:00:30')).toMatchObject({ second: 30 });
    });

    // The offset records which one applied that day; the wall clock is what a rule repeats.
    it('ignores a trailing offset rather than shifting the time', () => {
        expect(parseWallClock('2015-06-25 10:00:00-07:00')).toMatchObject({ hour: 10, day: 25 });
        expect(parseWallClock('2015-06-25 10:00:00+09:00')).toMatchObject({ hour: 10, day: 25 });
        expect(parseWallClock('2015-06-25T10:00:00Z')).toMatchObject({ hour: 10, day: 25 });
    });

    it('rejects what it cannot read', () => {
        expect(parseWallClock('not a time')).toBeNull();
        expect(parseWallClock('25/06/2015')).toBeNull();
    });
});

describe('a day none of a rule\'s months has', () => {
    // rrule.js looked for one until the year 9999, seconds a time for a daily rule.
    it('is refused at once, from either end of the month', () => {
        for (const bymonthday of [[30], [31, -30], [-31]]) {
            const began = performance.now();
            expect(() => expandRule(
                { freq: 'daily', bymonth: [2], bymonthday } as EventRepeat, '2024-01-01 09:00', '2026-01-01', '2026-12-31',
            ), JSON.stringify(bymonthday)).toThrow(RecurrenceError);
            expect(performance.now() - began).toBeLessThan(100);
        }
        expect(() => expandRule(
            { freq: 'yearly', bymonth: [4, 6, 9, 11], bymonthday: [31] } as EventRepeat, '2024-01-01 09:00', '2026-01-01', '2026-12-31',
        )).toThrow(RecurrenceError);
    });

    it('is no reason to refuse a day another of them has', () => {
        expect(expandRule(
            { freq: 'yearly', bymonth: [2, 4], bymonthday: [30, 31] } as EventRepeat, '2024-01-01 09:00', '2024-01-01', '2025-12-31',
        )).toEqual(['2024-04-30 09:00', '2025-04-30 09:00']);
        expect(expandRule(
            { freq: 'yearly', bymonth: [2], bymonthday: [29] } as EventRepeat, '2024-01-01 09:00', '2024-01-01', '2028-12-31',
        )).toEqual(['2024-02-29 09:00', '2028-02-29 09:00']);
    });
});

describe('readDatetime', () => {
    const iso = (value: unknown) => readDatetime(value)?.toISOString() ?? null;

    it('reads what dayjs reads itself, in the reader\'s zone', () => {
        vi.stubEnv('TZ', 'Asia/Tokyo');
        try {
            expect(iso('2024-05-01 10:00')).toBe('2024-05-01T01:00:00.000Z');
            expect(iso('2024-5-1')).toBe('2024-04-30T15:00:00.000Z');
            expect(iso('2024/08/13 11:00')).toBe('2024-08-13T02:00:00.000Z');
            // `dayjs` rolls a day past its month's end over.
            expect(iso('2024-02-30 10:00')).toBe('2024-03-01T01:00:00.000Z');
        }
        finally {
            vi.unstubAllEnvs();
        }
    });

    it('reads an ISO datetime with its offset as V8 does, in any engine', () => {
        expect(iso('2024-05-01T10:00:00+09:00')).toBe('2024-05-01T01:00:00.000Z');
        expect(iso('2024-05-01 10:00 -0700')).toBe('2024-05-01T17:00:00.000Z');
        expect(iso('2024-05-01T10:00:00.1234Z')).toBe('2024-05-01T10:00:00.123Z');
        expect(iso('2024-05-13Z')).toBe('2024-05-13T00:00:00.000Z');
        // A day to 31 rolls over, as `dayjs` rolls its own; an hour of 24 is the day's end.
        expect(iso('2024-02-30T10:00+09:00')).toBe('2024-03-01T01:00:00.000Z');
        expect(iso('2024-05-14 24:00+09:00')).toBe('2024-05-14T15:00:00.000Z');
        expect(iso('0099-01-01T00:00Z')).toBe('0099-01-01T00:00:00.000Z');
    });

    it('refuses what V8 refuses of one', () => {
        for (const value of [
            '2024-01-32T10:00+09:00', '2024-13-01T10:00Z', '2024-02-00T10:00Z',
            '2024-05-14 24:01+09:00', '2024-05-14 10:60Z', '2024-05-14 10:00:60Z',
            // A bare date only before `Z`.
            '2024-05-12+09:00',
        ]) {
            expect(readDatetime(value), value).toBeNull();
        }
    });

    // Each engine's `Date` reads its own set of these, and moried none.
    it('refuses what only `Date` would read', () => {
        for (const value of ['August 12, 2024 10:00', '9/19/2024 11:00', '11', '2024-09-26 10:00 ', 'Thu, 01 May 2024 10:00:00 GMT']) {
            expect(readDatetime(value), value).toBeNull();
        }
    });

    it('refuses what is not text, which `dayjs` would take for an epoch', () => {
        expect(readDatetime(20240501)).toBeNull();
        expect(readDatetime(null)).toBeNull();
    });
});

describe('expandRule', () => {
    it('expands a daily rule inside the window only', () => {
        expect(expandRule({ freq: 'daily' }, '2024-05-01 09:00', '2024-05-03', '2024-05-05'))
            .toEqual(['2024-05-03 09:00', '2024-05-04 09:00', '2024-05-05 09:00']);
    });

    it('keeps the interval phase anchored at the start, not at the window', () => {
        // Every 3 days from the 1st: 1, 4, 7, 10, 13. A window opening on the 5th must not
        // restart the count there.
        expect(expandRule({ freq: 'daily', interval: 3 }, '2024-05-01', '2024-05-05', '2024-05-14'))
            .toEqual(['2024-05-07', '2024-05-10', '2024-05-13']);
    });

    it('counts a count from the series start, not from the window', () => {
        // Five occurrences exist: 1, 2, 3, 4, 5. The window sees the tail of them and no more.
        expect(expandRule({ freq: 'daily', count: 5 }, '2024-05-01', '2024-05-03', '2024-05-31'))
            .toEqual(['2024-05-03', '2024-05-04', '2024-05-05']);
    });

    it('honours until, including a date-only one covering the whole day', () => {
        expect(expandRule(
            { freq: 'daily', until: '2024-05-03' }, '2024-05-01 09:00', '2024-05-01', '2024-05-31',
        )).toEqual(['2024-05-01 09:00', '2024-05-02 09:00', '2024-05-03 09:00']);
    });

    it('expands the third Wednesday of each month', () => {
        expect(expandRule(
            { freq: 'monthly', byday: ['3wed'] }, '2024-05-01', '2024-05-01', '2024-07-31',
        )).toEqual(['2024-05-15', '2024-06-19', '2024-07-17']);
    });

    it('expands every three weeks on Wednesday, the other reading', () => {
        expect(expandRule(
            { freq: 'weekly', interval: 3, byday: ['wed'] },
            '2024-05-01', '2024-05-01', '2024-06-30',
        )).toEqual(['2024-05-01', '2024-05-22', '2024-06-12']);
    });

    it('expands the last Friday of each month from a negative ordinal', () => {
        expect(expandRule(
            { freq: 'monthly', byday: ['-1fri'] }, '2024-05-01', '2024-05-01', '2024-07-31',
        )).toEqual(['2024-05-31', '2024-06-28', '2024-07-26']);
    });

    it('rejects an ordinal weekday under freq: weekly', () => {
        expect(() => expandRule(
            { freq: 'weekly', byday: ['3wed'] }, '2024-05-01', '2024-05-01', '2024-05-31',
        )).toThrow(RecurrenceError);
    });

    // dayjs('2026-01-31').add(1, 'month') is 2026-02-28, so a naive monthly loop would drift to
    // the 28th and stay there. RFC 5545 skips the month instead.
    it('skips months that have no such day rather than clamping into them', () => {
        expect(expandRule({ freq: 'monthly' }, '2024-01-31', '2024-01-01', '2024-06-30'))
            .toEqual(['2024-01-31', '2024-03-31', '2024-05-31']);
    });

    it('skips non-leap years for a February 29 yearly series', () => {
        expect(expandRule({ freq: 'yearly' }, '2024-02-29', '2024-01-01', '2033-12-31'))
            .toEqual(['2024-02-29', '2028-02-29', '2032-02-29']);
    });

    it('lets wkst change which occurrences a multi-week interval produces', () => {
        const rule: EventRepeat = { freq: 'weekly', interval: 2, byday: ['sun', 'mon'] };
        const monday = expandRule({ ...rule, wkst: 'mon' }, '2024-05-05', '2024-05-05', '2024-05-21');
        const sunday = expandRule({ ...rule, wkst: 'sun' }, '2024-05-05', '2024-05-05', '2024-05-21');
        expect(monday).not.toEqual(sunday);
    });

    it('ignores a wkst that names no weekday, whatever it names', () => {
        const rule: EventRepeat = { freq: 'weekly', interval: 2, byday: ['sun', 'mon'] };
        const unset = expandRule(rule, '2024-05-05', '2024-05-05', '2024-05-21');
        // `toString` and `constructor` are names every object answers to.
        for (const wkst of ['toString', 'constructor', 'WE', 'foo', 3]) {
            expect(expandRule({ ...rule, wkst } as unknown as EventRepeat, '2024-05-05', '2024-05-05', '2024-05-21'))
                .toEqual(unset);
        }
    });

    it('selects days of the month, counting negatives from its end', () => {
        expect(expandRule(
            { freq: 'monthly', bymonthday: [1, -1] }, '2024-05-01', '2024-05-01', '2024-06-30',
        )).toEqual(['2024-05-01', '2024-05-31', '2024-06-01', '2024-06-30']);
    });

    it('restricts a yearly rule to named months', () => {
        expect(expandRule(
            { freq: 'yearly', bymonth: [3, 11], bymonthday: [1] },
            '2024-03-01', '2024-01-01', '2025-12-31',
        )).toEqual(['2024-03-01', '2024-11-01', '2025-03-01', '2025-11-01']);
    });

    it('reads an empty list as no restriction rather than as none of these', () => {
        // The 6th of each month, as with no list at all; rrule.js alone would give every day.
        for (const list of ['byday', 'bymonthday'] as const) {
            expect(expandRule(
                { freq: 'monthly', [list]: [], count: 3 }, '2024-05-06', '2024-01-01', '2024-12-31',
            ), list).toEqual(['2024-05-06', '2024-06-06', '2024-07-06']);
        }
        expect(expandRule(
            { freq: 'yearly', bymonth: [], count: 2 }, '2024-05-06', '2024-01-01', '2025-12-31',
        )).toEqual(['2024-05-06', '2025-05-06']);
    });

    it('reads a single value as a list of one, and null as no list', () => {
        const rule = (byday: unknown) => ({ freq: 'weekly', byday, count: 2 }) as unknown as EventRepeat;
        expect(expandRule(rule('wed'), '2024-05-06', '2024-01-01', '2024-12-31'))
            .toEqual(['2024-05-08', '2024-05-15']);
        expect(expandRule(rule(null), '2024-05-06', '2024-01-01', '2024-12-31'))
            .toEqual(['2024-05-06', '2024-05-13']);
        expect(expandRule(
            { freq: 'monthly', byday: '3wed', count: 2 } as unknown as EventRepeat,
            '2024-05-06', '2024-01-01', '2024-12-31',
        )).toEqual(['2024-05-15', '2024-06-19']);
    });

    it('rejects a weekday it cannot read, rather than throwing out of the calendar', () => {
        expect(() => expandRule(
            { freq: 'weekly', byday: 5 } as unknown as EventRepeat, '2024-05-06', '2024-05-01', '2024-05-31',
        )).toThrow(RecurrenceError);
    });

    it('rejects an unusable start, until or timezone', () => {
        expect(() => expandRule({ freq: 'daily' }, 'nonsense', '2024-05-01', '2024-05-31'))
            .toThrow(RecurrenceError);
        expect(() => expandRule(
            { freq: 'daily', until: 'nonsense' }, '2024-05-01', '2024-05-01', '2024-05-31',
        )).toThrow(RecurrenceError);
        expect(() => expandRule(
            { freq: 'daily', tz: 'Mars/Olympus' }, '2024-05-01 09:00', '2024-05-01', '2024-05-02',
        )).toThrow(RecurrenceError);
    });
});

describe('readRule', () => {
    function refuses(read: () => unknown): boolean {
        try {
            read();
            return false;
        }
        catch (error) {
            if (error instanceof RecurrenceError) {
                return true;
            }
            throw error;
        }
    }

    // A view that describes a rule from this alone has to refuse what the calendar refuses. An
    // unknown zone is the one exception, met only by converting an occurrence: on dates, as here,
    // nothing is converted.
    it('refuses what expandRule refuses', () => {
        const rules: unknown[] = [
            undefined, null, 'weekly', ['weekly'], {}, { freq: 'hourly' }, { freq: 'constructor' },
            { freq: 'weekly' }, { freq: 'weekly', byday: ['WE'] }, { freq: 'weekly', byday: ['wed', 'WED'] },
            { freq: 'weekly', byday: ['2mon'] }, { freq: 'monthly', byday: ['0wed'] }, { freq: 'monthly', byday: '3wed' },
            { freq: 'weekly', byday: 5 }, { freq: 'weekly', byday: [{}] }, { freq: 'daily', byday: ['2mon'] },
            { freq: 'weekly', interval: 0 }, { freq: 'weekly', interval: -1 }, { freq: 'weekly', interval: 1.5 },
            { freq: 'weekly', interval: 'twice' }, { freq: 'weekly', interval: 70000 }, { freq: 'weekly', interval: null },
            { freq: 'weekly', until: 'next year' }, { freq: 'weekly', until: null, count: 2 }, { freq: 'weekly', until: '' },
            { freq: 'weekly', until: 20240601 }, { freq: 'weekly', until: '2024-05-31' },
            { freq: 'daily', tz: 'Mars/Olympus', until: '2024-05-03 10:00:00+09:00' },
            { freq: 'daily', tz: 'Mars/Olympus', count: 2 }, { freq: 'weekly', count: 0 }, { freq: 'weekly', count: '3' },
            { freq: 'monthly', bymonthday: [32] }, { freq: 'monthly', bymonthday: ['15'] }, { freq: 'yearly', bymonth: [13] },
        ];
        for (const repeat of rules) {
            for (const start of ['2024-05-01', 'nonsense', 20240501]) {
                expect(
                    refuses(() => readRule(repeat, start)),
                    `${JSON.stringify(repeat)} at ${start}`,
                ).toBe(refuses(() => expandRule(repeat as EventRepeat, start as string, '2024-05-01', '2024-06-30')));
            }
        }
    });

    it('reads the start the rule is anchored at as written, without its offset', () => {
        expect(readRule({ freq: 'weekly' }, '2024-05-01 10:00:00-07:00').start)
            .toMatchObject({ year: 2024, month: 5, day: 1, hour: 10, hasTime: true });
    });
});

describe('expandRule reading until in the rule\'s zone', () => {
    // 00:30 UTC is 09:30 in Tokyo, which lets a 09:00 occurrence on the 3rd in; read as written,
    // without its offset, it would not.
    beforeAll(() => { vi.stubEnv('TZ', 'Asia/Tokyo'); });
    afterAll(() => { vi.unstubAllEnvs(); });

    const until = '2024-05-03 00:30:00+00:00';

    it('reads a blank zone as the reader\'s, as each occurrence does', () => {
        for (const tz of [null, '']) {
            expect(expandRule(
                { freq: 'daily', tz, until } as unknown as EventRepeat, '2024-05-01 09:00', '2024-05-01', '2024-05-31',
            ), JSON.stringify(tz)).toEqual(['2024-05-01 09:00', '2024-05-02 09:00', '2024-05-03 09:00']);
        }
    });

    // Intl throws a RangeError for a zone it does not know, which used to escape and blank the
    // calendar, all-day series included.
    it('refuses an unknown zone rather than throwing out of the calendar', () => {
        for (const start of ['2024-05-01 09:00', '2024-05-01']) {
            expect(() => expandRule(
                { freq: 'daily', tz: 'Mars/Olympus', until }, start, '2024-05-01', '2024-05-31',
            ), start).toThrow(RecurrenceError);
        }
    });

    // moried reads only a zone's name, and Intl reads more, each browser its own set; `||` read
    // `0` and `false` as the reader's zone.
    it('refuses what is not a zone moried knows, though Intl may', () => {
        for (const tz of [0, false, ['Asia/Tokyo'], 'JST', 'BST', '+09:00', 'GMT+9']) {
            expect(() => expandRule(
                { freq: 'daily', tz, until } as unknown as EventRepeat, '2024-05-01 09:00', '2024-05-01', '2024-05-31',
            ), JSON.stringify(tz)).toThrow(RecurrenceError);
        }
        for (const tz of ['EST', 'Japan', 'asia/TOKYO', 'Etc/GMT-9']) {
            expect(expandRule(
                { freq: 'daily', tz, count: 1 } as unknown as EventRepeat, '2024-05-01 09:00', '2024-05-01', '2024-05-31',
            ), tz).toHaveLength(1);
        }
    });
});

describe('expandRule across a daylight-saving boundary', () => {
    // The case that made `repeat.tz` necessary: America/Los_Angeles is -07:00 in June and -08:00
    // in January, so a wall clock of 10:00 is two different instants. Read from a fixed-offset
    // zone, the converted local time therefore differs on the two sides of the transition -- which
    // an offset stored on `start` could never reproduce.
    const rule: EventRepeat = { freq: 'weekly', byday: ['thu'], tz: 'America/Los_Angeles' };

    // The assertions below name a reader-local clock time, so the reader's zone has to be pinned
    // rather than inherited from whatever machine runs the suite.
    beforeAll(() => { vi.stubEnv('TZ', 'UTC'); });
    afterAll(() => { vi.unstubAllEnvs(); });

    it('shifts the reader-local time across the transition', () => {
        const summer = expandRule(rule, '2015-06-25 10:00:00-07:00', '2015-06-25', '2015-06-25');
        const winter = expandRule(rule, '2015-06-25 10:00:00-07:00', '2020-01-30', '2020-01-30');

        expect(summer).toEqual(['2015-06-25 17:00']);   // 10:00 PDT is 17:00 UTC
        expect(winter).toEqual(['2020-01-30 18:00']);   // 10:00 PST is 18:00 UTC
    });

    it('keeps the wall clock unconverted when no zone is named', () => {
        expect(expandRule(
            { freq: 'weekly', byday: ['thu'] }, '2015-06-25 10:00', '2015-06-25', '2015-06-25',
        )).toEqual(['2015-06-25 10:00']);
    });
});
