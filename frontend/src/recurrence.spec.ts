import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { EventRepeat } from '@/api';
import { RecurrenceError, expandRule, parseWallClock } from '@/recurrence';

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
