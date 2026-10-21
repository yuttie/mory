import { describe, expect, it } from 'vitest';

import dayjs from 'dayjs';

import type { ListEntry2, MetadataEvent } from '@/api';
import { describeRepeat, nextOccurrences, summarizeEvents } from '@/event-summary';

function entry(path: string, events: unknown): ListEntry2 {
    return {
        path,
        size: 0,
        mime_type: 'text/markdown',
        metadata: { tags: [], events: events as Record<string, MetadataEvent> },
        title: null,
        time: '2026-10-01T00:00:00Z',
    };
}

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

describe('summarizeEvents', () => {
    it('takes the earliest start the note writes', () => {
        const summary = summarizeEvents({
            Lecture: { start: '2026-04-10 10:00', repeat: { freq: 'weekly' } },
            Meeting: { instances: [{ start: '2026-05-01 12:00' }, { start: '2025-02-18 12:00' }] },
        });
        expect(summary.start?.text).toBe('2025-02-18 12:00');
        expect(summary.start?.instant).toBe(dayjs('2025-02-18 12:00').valueOf());
    });

    it('shows a start that carries an offset in the reader\'s zone', () => {
        const start = '2026-10-21 10:00:00+09:00';
        expect(summarizeEvents({ Call: { start } }).start?.text).toBe(dayjs(start).format('YYYY-MM-DD HH:mm'));
    });

    it('says how each rule repeats, and on how many other dates the events fall', () => {
        expect(summarizeEvents({
            Lecture: { start: '2026-04-10 10:00', repeat: { freq: 'weekly', until: '2026-07-31' } },
            Holiday: { start: '2026-09-22' },
            Review: { start: '2026-01-05', repeat: { freq: 'monthly' }, instances: [{ start: '2026-02-20' }] },
            Meeting: { instances: [{ start: '2026-05-01 12:00' }, { start: '2026-05-08 12:00' }] },
            Visit: { start: '2026-03-01', instances: [{ start: '2026-03-08' }] },
        }).repeats).toBe('Weekly, until 2026-07-31; Monthly; on 6 other dates');
        expect(summarizeEvents({
            Seminar: { start: '2026-04-06 10:00', repeat: { freq: 'weekly' } },
            Party: { start: '2026-07-31' },
        }).repeats).toBe('Weekly; on 1 other date');
    });

    it('counts the dates of a note\'s events together, each once', () => {
        expect(summarizeEvents({
            'Session 1': { start: '2026-04-10 10:00' },
            'Session 2': { start: '2026-04-17 10:00' },
            'Session 3': { start: '2026-04-24 10:00' },
        }).repeats).toBe('On 3 dates');
        expect(summarizeEvents({
            Opening: { start: '2026-11-02 09:00' },
            Workshop: { instances: [{ start: '2026-11-02 13:00' }, { start: '2026-11-03 13:00' }] },
        }).repeats).toBe('On 2 dates');
        expect(summarizeEvents({
            Morning: { start: '2026-11-02 09:00' },
            Afternoon: { start: '2026-11-02 13:00' },
        }).repeats).toBeUndefined();
    });

    it('says nothing of an event that happens once', () => {
        expect(summarizeEvents({ Holiday: { start: '2026-09-22' } })).toEqual({
            start: { text: '2026-09-22', instant: dayjs('2026-09-22').valueOf() },
        });
    });

    it('reads nothing from what is not events', () => {
        expect(summarizeEvents(undefined)).toEqual({});
        expect(summarizeEvents(null)).toEqual({});
        expect(summarizeEvents([])).toEqual({});
        expect(summarizeEvents({ Broken: null, Number: { start: 20240501 }, Junk: { instances: [null, 3] } })).toEqual({});
    });
});

describe('nextOccurrences', () => {
    const now = dayjs('2026-10-21 12:00').valueOf();

    it('finds the next occurrence of a rule', () => {
        const next = nextOccurrences([
            entry('.events/lecture.md', { Lecture: { start: '2026-04-06 10:00', end: '+90m', repeat: { freq: 'weekly' } } }),
        ], now);
        // 2026-10-21 is a Wednesday, so Monday's is the 26th.
        expect(next.get('.events/lecture.md')?.text).toBe('2026-10-26 10:00');
    });

    it('counts an occurrence under way as the next', () => {
        const next = nextOccurrences([
            entry('.events/today.md', { Workshop: { start: '2026-10-21' } }),
            entry('.events/morning.md', { Standup: { start: '2026-10-21 09:00', end: '+30m' } }),
        ], now);
        expect(next.get('.events/today.md')?.text).toBe('2026-10-21');
        expect(next.has('.events/morning.md')).toBe(false);
    });

    it('has none for what is over', () => {
        const next = nextOccurrences([
            entry('.events/past.md', { Holiday: { start: '2026-09-22' } }),
            entry('.events/ended.md', { Course: { start: '2026-04-06 10:00', repeat: { freq: 'weekly', until: '2026-07-27' } } }),
        ], now);
        expect(next.size).toBe(0);
    });

    it('looks no further than a year ahead for a rule, but takes a date however far', () => {
        const next = nextOccurrences([
            entry('.events/trip.md', { Trip: { start: '2028-01-01' } }),
            entry('.events/reunion.md', { Reunion: { start: '2028-01-01', repeat: { freq: 'yearly' } } }),
        ], now);
        expect(next.get('.events/trip.md')?.text).toBe('2028-01-01');
        expect(next.has('.events/reunion.md')).toBe(false);
    });
});
