import { describe, expect, it } from 'vitest';

import {
    alarmProblems,
    BUILT_IN_ALARMS,
    describeAlarmList,
    describeAlarmText,
    formatAlarm,
    parseAlarm,
    readAlarmDefaults,
    readAlarmList,
    readAlarmsIfSet,
    readTaskAlarms,
    TASK_DATE_ALARM_DEFAULT,
    taskAlarmOf,
    stringifyWithFlowAlarms,
    withBuiltInAlarms,
    writeAlarmDefaults,
} from '@/alarms';

import grammar from '../../fixtures/calendar/alarm-grammar.json';

// The grammar's cases are the fixture's, which `backend/src/alarms.rs` reads too: it is what rings
// them.

function canonical(text: string): string {
    const parsed = parseAlarm(text);
    if (!('spec' in parsed)) {
        throw new Error(`${text}: ${parsed.error}`);
    }
    return formatAlarm(parsed.spec);
}

describe('parseAlarm', () => {
    it('spells an alarm one way, however it was written', () => {
        for (const [written, spelt] of grammar.canonical) {
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
        for (const text of [...grammar.refused, ...grammar.tooFar]) {
            expect('error' in parseAlarm(text), JSON.stringify(text)).toBe(true);
        }
        for (const text of grammar.tooFar) {
            const parsed = parseAlarm(text);
            expect('error' in parsed && parsed.error, text).toContain('more than a year');
        }
        // A year is as far as an alarm goes.
        for (const text of grammar.atTheLimit) {
            expect('spec' in parseAlarm(text), text).toBe(true);
        }
    });

    it('reads a zero as zero, however it is signed', () => {
        expect(parseAlarm('-0m')).toEqual({ spec: { kind: 'elapsed', ms: 0 } });
        expect(parseAlarm('-0d')).toEqual({ spec: { kind: 'days', days: 0 } });
        expect(parseAlarm('-0d 09:00')).toEqual({ spec: { kind: 'at', days: 0, hour: 9, minute: 0 } });
    });
});

describe('alarmProblems', () => {
    it('says a sentence for each entry that is not an alarm, in the order written', () => {
        expect(alarmProblems([])).toEqual([]);
        expect(alarmProblems(['-10m', ' 09:00 ', '-1d 18:00'])).toEqual([]);

        const problems = alarmProblems(['-10m', 'soon', '10m', '0m']);
        expect(problems).toHaveLength(2);
        expect(problems[0]).toContain('"soon"');
        expect(problems[1]).toContain('needs a sign');
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

describe('describeAlarmList', () => {
    it('says a list in words, and an empty one as never', () => {
        expect(describeAlarmList(['-10m', '0m'])).toBe('Rings 10 minutes before, at the start');
        expect(describeAlarmList(['-1d 18:00'])).toBe('Rings the day before at 18:00');
        expect(describeAlarmList([])).toBe('Never rings');
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

describe('readAlarmsIfSet', () => {
    it('tells a value that is not set from an empty list, which is a setting', () => {
        expect(readAlarmsIfSet(undefined)).toBeUndefined();
        expect(readAlarmsIfSet(null)).toBeUndefined();
        expect(readAlarmsIfSet([])).toEqual([]);
        expect(readAlarmsIfSet(['-10m', 'bogus'])).toEqual(['-10m']);
        expect(readAlarmsIfSet('09:00')).toEqual(['09:00']);
        // Set, but to nothing usable: an entry that is not an alarm is dropped and the list stands.
        expect(readAlarmsIfSet(5)).toEqual([]);
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

describe('withBuiltInAlarms', () => {
    it('fills each kind the file leaves unset, and keeps one it sets, even to nothing', () => {
        expect(withBuiltInAlarms(undefined)).toEqual(BUILT_IN_ALARMS);
        expect(withBuiltInAlarms({})).toEqual(BUILT_IN_ALARMS);
        expect(withBuiltInAlarms({ timed: [], dueBy: ['09:00'] })).toEqual({
            timed: [],
            allDay: [],
            dueBy: ['09:00'],
            deadline: [],
        });
    });

    it('hands out lists of its own, so that changing one does not change the built-in', () => {
        withBuiltInAlarms(undefined).timed.push('-5m');
        expect(BUILT_IN_ALARMS.timed).toEqual(['0m']);
        expect(withBuiltInAlarms(undefined).timed).toEqual(['0m']);
    });
});

describe('taskAlarmOf', () => {
    it('reads the list of one date as written, from a mapping only', () => {
        expect(taskAlarmOf({ due_by: ['09:00'], deadline: null }, 'due_by')).toEqual(['09:00']);
        expect(taskAlarmOf({ due_by: ['09:00'] }, 'deadline')).toBeUndefined();
        for (const alarms of [undefined, null, 5, '-1h', ['-1h']]) {
            expect(taskAlarmOf(alarms, 'due_by')).toBeUndefined();
        }
    });

    it('is told where each date finds its default by TASK_DATE_ALARM_DEFAULT', () => {
        expect(TASK_DATE_ALARM_DEFAULT).toEqual({ due_by: 'dueBy', deadline: 'deadline' });
    });
});

describe('readTaskAlarms', () => {
    it('reads the alarms of each date a task sets, dropping what is not an alarm', () => {
        expect(readTaskAlarms({ due_by: ['09:00', 'bogus'], deadline: '-1d 18:00' }))
            .toEqual({ due_by: ['09:00'], deadline: ['-1d 18:00'] });
    });

    it('keeps an empty list, which silences, and leaves a date that is empty or missing out', () => {
        expect(readTaskAlarms({ due_by: [], deadline: null })).toEqual({ due_by: [] });
        expect(readTaskAlarms({ other: ['-1h'] })).toBeUndefined();
        expect(readTaskAlarms({})).toBeUndefined();
    });

    it('takes anything but a mapping as setting nothing', () => {
        for (const value of [undefined, null, 5, '-1h', ['-1h']]) {
            expect(readTaskAlarms(value)).toBeUndefined();
        }
    });
});

describe('stringifyWithFlowAlarms', () => {
    it('writes a list under alarms on the line that names it, and nothing else that way', () => {
        expect(stringifyWithFlowAlarms({
            tags: ['a', 'b'],
            task: { alarms: { due_by: ['09:00'], deadline: [] }, scheduled_dates: ['2026-09-28'] },
            alarms: { timed: ['-10m', '0m'] },
            categories: { meeting: { alarms: ['-1h'] } },
        }, { indent: 4 })).toBe(`tags:
    - a
    - b
task:
    alarms:
        due_by: [09:00]
        deadline: []
    scheduled_dates:
        - 2026-09-28
alarms:
    timed: [-10m, 0m]
categories:
    meeting:
        alarms: [-1h]
`);
    });
});

describe('writeAlarmDefaults', () => {
    it('writes the kinds that are set, in the file\'s spelling and order', () => {
        const block = writeAlarmDefaults({ deadline: [], timed: ['-10m'], allDay: ['09:00'] });
        expect(block).toEqual({ timed: ['-10m'], all_day: ['09:00'], deadline: [] });
        expect(Object.keys(block)).toEqual(['timed', 'all_day', 'deadline']);
        expect(writeAlarmDefaults({})).toEqual({});
    });
});
