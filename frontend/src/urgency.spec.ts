import { describe, expect, it, vi } from 'vitest';
import fixtures from '../../fixtures/urgency/cases.json';
import { isWrittenTaskDate, leadTimeDays, localInstant, readTaskSettings, taskInstant, urgencyOf, readImportance, mostUrgent } from '@/urgency';

describe('shared urgency fixtures', () => {
    for (const test of fixtures.cases) {
        it(test.name, () => {
            // With the process in the case's zone too, as the reader's browser is: a conversion that
            // leans on the process's own zone goes wrong only there, as dayjs's `tz()` read the end of
            // a day in Recife an hour off only when it ran in Recife.
            vi.stubEnv('TZ', test.zone);
            try {
                const { settings } = readTaskSettings(test.settings);
                const result = urgencyOf(test.task, test.tags, settings, Date.parse(test.now), test.zone);
                expect({ ...result, slack_ratio: null }).toEqual({ ...test.expected, slack_ratio: null });
                if (test.expected.slack_ratio === null) {
                    expect(JSON.parse(JSON.stringify(result)).slack_ratio).toBeNull();
                }
                else {
                    expect(result.slack_ratio).toBeCloseTo(test.expected.slack_ratio, 9);
                }
            }
            finally {
                vi.unstubAllEnvs();
            }
        });
    }
    for (const test of fixtures.grammar) {
        it(`lead time ${JSON.stringify(test.value)}`, () => {
            expect(leadTimeDays(test.value) ?? null).toBe(test.days);
        });
    }
    for (const test of fixtures.importance) {
        it(`importance ${JSON.stringify(test.value)}`, () => {
            expect(readImportance(test.value) ?? null).toBe(test.expected);
        });
    }
    it('ignores legacy settings and reports malformed values', () => {
        expect(readTaskSettings({ tasks: { backlog: [] } }).problems).toHaveLength(1);
        expect(readTaskSettings({ default_lead_time: '-7d' }).settings).toEqual({});
    });
    it('accepts named importance and reads the transition mapping', () => {
        expect([1, 2, 3, 4, 5, 'low', 'medium', 'high', null].map(readImportance)).toEqual(['low', 'low', undefined, 'medium', 'high', 'low', 'medium', 'high', undefined]);
    });
    it('takes the most urgent descendant and smallest ratio', () => {
        const a = urgencyOf({ deadline: '2026-10-15' }, [], {}, Date.parse('2026-10-04T00:00:00Z'), 'Asia/Tokyo');
        const b = urgencyOf({ due_by: '2026-10-01' }, [], {}, Date.parse('2026-10-04T00:00:00Z'), 'Asia/Tokyo');
        expect(mostUrgent([a, b])).toEqual(b);
    });
    it('keeps the sign of infinite slack internally when sorting zero-day leads', () => {
        const now = Date.parse('2026-10-04T00:00:00Z');
        const zero = urgencyOf({ deadline: '2026-10-01', lead_time: '0d' }, [], {}, now, 'Asia/Tokyo');
        const finite = urgencyOf({ deadline: '2026-10-01', lead_time: '7d' }, [], {}, now, 'Asia/Tokyo');
        expect(zero.slack_ratio).toBe(-Infinity);
        expect(mostUrgent([finite, zero])).toEqual(zero);
    });
});

// How a wall clock in a zone becomes an instant, which the Rust twin (`local_instant`) resolves the
// same way: a repeated clock time is its first occurrence, and a missing one moves forward by the
// gap, read with the offset a day before.
describe('local wall clocks', () => {
    const cases: [string, string, string, string][] = [
        ['before a gap', '2026-03-08 01:59:59.999', 'America/New_York', '2026-03-08T06:59:59.999Z'],
        ['in a gap', '2026-03-08 02:30:00.000', 'America/New_York', '2026-03-08T07:30:00.000Z'],
        ['after a gap', '2026-03-08 03:00:00.000', 'America/New_York', '2026-03-08T07:00:00.000Z'],
        ['before a repeat', '2026-11-01 00:59:59.999', 'America/New_York', '2026-11-01T04:59:59.999Z'],
        ['in a repeat', '2026-11-01 01:30:00.000', 'America/New_York', '2026-11-01T05:30:00.000Z'],
        ['after a repeat', '2026-11-01 02:00:00.000', 'America/New_York', '2026-11-01T07:00:00.000Z'],
        ['a missing midnight', '2018-11-04 00:00:00.000', 'America/Sao_Paulo', '2018-11-04T03:00:00.000Z'],
        ['in a gap after midnight', '2018-11-04 00:30:00.000', 'America/Sao_Paulo', '2018-11-04T03:30:00.000Z'],
        ['a repeated end of day', '2019-02-16 23:59:59.999', 'America/Sao_Paulo', '2019-02-17T01:59:59.999Z'],
        ['a repeated hour before midnight', '2019-02-16 23:00:00.000', 'America/Sao_Paulo', '2019-02-17T01:00:00.000Z'],
        ['in a half-hour repeat', '2026-04-05 01:45:00.000', 'Australia/Lord_Howe', '2026-04-04T14:45:00.000Z'],
        ['in a half-hour gap', '2026-10-04 02:15:00.000', 'Australia/Lord_Howe', '2026-10-03T15:45:00.000Z'],
        ['in a skipped day', '2011-12-30 12:00:00.000', 'Pacific/Apia', '2011-12-30T22:00:00.000Z'],
        ['before a skipped day', '2011-12-29 23:59:59.999', 'Pacific/Apia', '2011-12-30T09:59:59.999Z'],
        ['in a gap at UTC', '2026-03-29 01:30:00.000', 'Europe/London', '2026-03-29T01:30:00.000Z'],
        ['in a repeat at UTC', '2026-10-25 01:30:00.000', 'Europe/London', '2026-10-25T00:30:00.000Z'],
        ['without transitions', '2026-10-23 23:59:59.999', 'Asia/Tokyo', '2026-10-23T14:59:59.999Z'],
        ['in UTC', '2026-10-23 00:00:00.000', 'UTC', '2026-10-23T00:00:00.000Z'],
    ];
    for (const [name, wall, zone, expected] of cases) {
        it(`resolves ${name} (${wall} ${zone})`, () => {
            expect(new Date(localInstant(wall, zone)).toISOString()).toBe(expected);
        });
    }

    it('reads a date as its whole local day, where its midnight is missing or its end repeated', () => {
        expect(new Date(taskInstant('2018-11-04', 'America/Sao_Paulo')!).toISOString()).toBe('2018-11-04T03:00:00.000Z');
        expect(new Date(taskInstant('2019-02-16', 'America/Sao_Paulo', true)!).toISOString()).toBe('2019-02-17T01:59:59.999Z');
    });

    // Whatever zone the process is in, and with no end of day to move to, as it is a moment.
    it('reads a datetime without its offset as the wall clock in the zone', () => {
        vi.stubEnv('TZ', 'Pacific/Kiritimati');
        try {
            expect(new Date(taskInstant('2026-10-04 10:00', 'Asia/Tokyo')!).toISOString()).toBe('2026-10-04T01:00:00.000Z');
            expect(new Date(taskInstant('2026-10-04 10:00', 'America/New_York', true)!).toISOString()).toBe('2026-10-04T14:00:00.000Z');
        }
        finally {
            vi.unstubAllEnvs();
        }
    });

    it('holds what is written to a bare date or a datetime carrying its offset', () => {
        for (const value of ['2026-10-04', '2026-10-04 10:00+09:00', '2026-10-04T10:00:00Z', '1000-01-01']) {
            expect(isWrittenTaskDate(value), value).toBe(true);
        }
        for (const value of ['2026-10-04 10:00', '2026-10-04T10:00:00.5', '2026-02-30', '2026-10-04 24:00+09:00', '', 7]) {
            expect(isWrittenTaskDate(value), String(value)).toBe(false);
        }
        // Read by urgency, but not drawn or edited as written: the calendar reads no fraction of a
        // second and no white space before a bare date, an early year as a later one and a bare
        // date in the years 100 to 999 not at all, and the editor's date field reads white space
        // after a bare date as midnight, and an early year in a datetime as a later one too.
        for (const value of [
            '2026-10-04T10:00:00.5Z', ' 2026-12-01', '2026-12-01 ', '0050-01-01', '0050-01-01 10:00+09:00',
            '0100-01-01', '0999-12-31',
        ]) {
            expect(isWrittenTaskDate(value), value).toBe(false);
            expect(taskInstant(value, 'UTC'), value).toBeDefined();
        }
        // The calendar draws one carrying its offset in those years, but no one needs it.
        expect(isWrittenTaskDate('0500-03-01 10:00+09:00')).toBe(false);
    });

    // The window opens at the reference's own wall clock, a lead time of calendar days before.
    it('opens the window from the wall clock of a reference in a repeated hour', () => {
        const now = Date.parse('2026-10-20T00:00:00Z');
        const window = (available: string) => urgencyOf({ deadline: '2026-11-01 01:30:00-05:00', available_from: available, lead_time: '1d' }, [], {}, now, 'America/New_York').short_window;
        expect(window('2026-10-31 01:45:00-04:00')).toBe(true);
        expect(window('2026-10-31 01:15:00-04:00')).toBe(false);
    });

    it('gives the same answer however often it is asked', () => {
        const first = localInstant('2026-11-01 01:30:00.000', 'America/New_York');
        localInstant('2026-11-01 01:30:00.000', 'Europe/London');
        expect(localInstant('2026-11-01 01:30:00.000', 'America/New_York')).toBe(first);
    });
});
