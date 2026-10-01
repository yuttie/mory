import { describe, expect, it } from 'vitest';

import {
    BUILT_IN_ALARMS,
    describeAlarmText,
    formatAlarm,
    parseAlarm,
    readAlarmDefaults,
    readAlarmList,
} from '@/alarms';

// The same cases as the tests in `backend/src/alarms.rs`, which is what rings them.

function canonical(text: string): string {
    const parsed = parseAlarm(text);
    if (!('spec' in parsed)) {
        throw new Error(`${text}: ${parsed.error}`);
    }
    return formatAlarm(parsed.spec);
}

describe('parseAlarm', () => {
    it('reads an offset with a sign, a number and a unit', () => {
        for (const [written, spelt] of [
            ['-10m', '-10m'], ['+1h', '+1h'], ['-2 days', '-2d'], ['-1w', '-7d'], ['0m', '+0m'],
            ['-0s', '+0m'], ['+0d', '+0d'], ['-1.5h', '-90m'], ['-90 minutes', '-90m'],
            ['-30seconds', '-30s'], ['-1 hour', '-1h'], ['-0.5s', '-500ms'], [' -10m ', '-10m'],
        ]) {
            expect(canonical(written), written).toBe(spelt);
        }
    });

    it('refuses an offset without a sign, rather than reading it as after', () => {
        const parsed = parseAlarm('10m');
        expect('error' in parsed && parsed.error).toContain('needs a sign');
        expect('error' in parseAlarm('1d 09:00')).toBe(true);
        // Zero is neither before nor after.
        expect('spec' in parseAlarm('0m')).toBe(true);
        expect('spec' in parseAlarm('0d 09:00')).toBe(true);
    });

    it('refuses what is not an alarm', () => {
        for (const text of [
            '', 'm', '-m', '-10', '-10x', '-10M', '-10 Minutes', '- 10m', '--10m', '-1.5d', '-0.5w',
            '-1.d', '-1.0d', '0.0w', '-.5h', '-1e3s', '-٣m', '9:00', '09:0', '24:00', '09:60',
            '09:00:00', '-1d09:00', '1.5d 09:00', '-1h 09:00', '0900', '-100w', '-367d', '-8785h',
            '+99999999s', '-1d 09:00 -1d',
        ]) {
            expect('error' in parseAlarm(text), JSON.stringify(text)).toBe(true);
        }
        // A year is as far as an alarm goes.
        expect('spec' in parseAlarm('-366d')).toBe(true);
        expect('spec' in parseAlarm('-52w')).toBe(true);
    });

    it('reads a time on the start day, moved by whole days', () => {
        for (const [written, spelt] of [
            ['09:00', '09:00'], ['-1d 18:00', '-1d 18:00'], ['+1 day 08:30', '+1d 08:30'],
            ['-1w 09:00', '-7d 09:00'], ['0d 09:00', '09:00'], ['-2 weeks 00:00', '-14d 00:00'],
        ]) {
            expect(canonical(written), written).toBe(spelt);
        }
    });

    it('reads a zero as zero, however it is signed', () => {
        expect(parseAlarm('-0m')).toEqual({ spec: { kind: 'elapsed', ms: 0 } });
        expect(parseAlarm('-0d')).toEqual({ spec: { kind: 'days', days: 0 } });
        expect(parseAlarm('-0d 09:00')).toEqual({ spec: { kind: 'at', days: 0, hour: 9, minute: 0 } });
    });
});

describe('describeAlarmText', () => {
    it('says an alarm in words', () => {
        for (const [written, said] of [
            ['0m', 'at the start'], ['+0d', 'at the start'],
            ['-10m', '10 minutes before'], ['-1m', '1 minute before'], ['+1h', '1 hour after'],
            ['-90m', '90 minutes before'], ['-1.5h', '90 minutes before'], ['-30s', '30 seconds before'],
            ['-2 hours', '2 hours before'], ['-1d', '1 day before'], ['-3d', '3 days before'],
            ['-1w', '1 week before'], ['-2w', '2 weeks before'], ['+10d', '10 days after'],
            ['09:00', 'at 09:00'], ['-1d 18:00', 'the day before at 18:00'],
            ['+1d 08:30', 'the day after at 08:30'], ['-3d 09:00', '3 days before at 09:00'],
            ['-1w 09:00', '1 week before at 09:00'],
        ]) {
            expect(describeAlarmText(written), written).toBe(said);
        }
    });

    it('leaves what is not an alarm as written', () => {
        expect(describeAlarmText('10m')).toBe('10m');
    });
});

describe('readAlarmList', () => {
    it('drops what is not an alarm and keeps the rest as written', () => {
        expect(readAlarmList(['-10m', ' 09:00 ', '-1d 18:00'])).toEqual({
            alarms: ['-10m', '09:00', '-1d 18:00'],
            invalid: [],
        });
        expect(readAlarmList(['-10m', '10m', 5, null, ['-1h'], 'bogus', '-5m'])).toEqual({
            alarms: ['-10m', '-5m'],
            invalid: ['10m', 5, null, ['-1h'], 'bogus'],
        });
    });

    it('reads a single string as a list of one, and anything else as no alarm', () => {
        expect(readAlarmList('-1d 18:00')).toEqual({ alarms: ['-1d 18:00'], invalid: [] });
        expect(readAlarmList([])).toEqual({ alarms: [], invalid: [] });
        expect(readAlarmList('10m')).toEqual({ alarms: [], invalid: ['10m'] });
        expect(readAlarmList(5)).toEqual({ alarms: [], invalid: [5] });
        expect(readAlarmList({ at: '-10m' })).toEqual({ alarms: [], invalid: [{ at: '-10m' }] });
    });
});

describe('readAlarmDefaults', () => {
    it('reads each kind the file sets', () => {
        expect(readAlarmDefaults({
            timed: ['-10m'],
            all_day: '-1d 18:00',
            due_by: ['09:00', 'bogus'],
            deadline: [],
        })).toEqual({
            timed: ['-10m'],
            allDay: ['-1d 18:00'],
            dueBy: ['09:00'],
            deadline: [],
        });
    });

    it('leaves a kind out that is missing or empty, which is not the same as silenced', () => {
        expect(readAlarmDefaults({ timed: null, all_day: undefined })).toEqual({});
        expect(readAlarmDefaults({})).toEqual({});
    });

    it('takes a block that is not a mapping as setting nothing', () => {
        for (const value of [null, undefined, 5, 'timed', ['timed']]) {
            expect(readAlarmDefaults(value)).toEqual({});
        }
        // A value that is there but holds nothing usable is a setting, an empty one.
        expect(readAlarmDefaults({ timed: 5 })).toEqual({ timed: [] });
    });
});

describe('BUILT_IN_ALARMS', () => {
    it('rings a timed event at its start and nothing else', () => {
        expect(BUILT_IN_ALARMS).toEqual({ timed: ['0m'], allDay: [], dueBy: [], deadline: [] });
    });
});
