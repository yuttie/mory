import { describe, expect, it } from 'vitest';

import dayjs from 'dayjs';

import { describeRepeat, summarizeEvent } from '@/event-summary';

describe('describeRepeat', () => {
    it('says how often', () => {
        expect(describeRepeat({ freq: 'daily' })).toBe('Daily');
        expect(describeRepeat({ freq: 'weekly', interval: 1 })).toBe('Weekly');
        expect(describeRepeat({ freq: 'weekly', interval: 3 })).toBe('Every 3 weeks');
        expect(describeRepeat({ freq: 'yearly', interval: 2 })).toBe('Every 2 years');
    });

    it('says on which days and in which months', () => {
        expect(describeRepeat({ freq: 'weekly', byday: ['mon', 'wed'] })).toBe('Weekly on Mon, Wed');
        expect(describeRepeat({ freq: 'weekly', byday: 'fri' })).toBe('Weekly on Fri');
        expect(describeRepeat({ freq: 'monthly', byday: ['3wed'] })).toBe('Monthly on the 3rd Wed');
        expect(describeRepeat({ freq: 'monthly', byday: ['-1fri'] })).toBe('Monthly on the last Fri');
        expect(describeRepeat({ freq: 'monthly', bymonthday: [1, 22, 13, -2] })).toBe('Monthly on the 1st, 22nd, 13th, 2nd last');
        expect(describeRepeat({ freq: 'yearly', bymonth: [1, 7] })).toBe('Yearly in Jan, Jul');
    });

    it('says when it stops', () => {
        expect(describeRepeat({ freq: 'daily', interval: 1, until: '2026-09-26' })).toBe('Daily, until 2026-09-26');
        expect(describeRepeat({ freq: 'weekly', count: 10 })).toBe('Weekly, 10 times');
        expect(describeRepeat({ freq: 'weekly', count: 1 })).toBe('Weekly, 1 time');
    });

    it('says nothing of what is not a rule', () => {
        expect(describeRepeat(undefined)).toBeUndefined();
        expect(describeRepeat(null)).toBeUndefined();
        expect(describeRepeat('weekly')).toBeUndefined();
        expect(describeRepeat({ freq: 'hourly' })).toBeUndefined();
        expect(describeRepeat({ freq: 'constructor' })).toBeUndefined();
    });

    it('leaves out what it cannot read, and reads the rest', () => {
        expect(describeRepeat({ freq: 'weekly', interval: 'two', byday: ['xyz', 'tue'], bymonth: [13] })).toBe('Weekly on Tue');
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
