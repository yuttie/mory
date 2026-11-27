import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@/events';
import { clockOf, eventsByDay, flow, freeSpans, minutesIn } from '@/planner';

const WORK = { start: 9 * 60, end: 18 * 60 };
const event = (name: string, start: string, end?: string, source: CalendarEvent['source'] = 'note'): CalendarEvent => ({ name, start, end, color: '#000', source });
const h = (hours: number) => hours * 60;

describe('eventsByDay', () => {
    it('tells whole days, timed events and task dates apart', () => {
        const days = eventsByDay([
            event('Trip', '2026-12-01', '2026-12-02'),
            event('Meeting', '2026-12-01 12:00', '2026-12-01 13:00'),
            event('Report', '2026-12-01 17:00', undefined, 'task'),
        ], '2026-12-01', '2026-12-03');
        expect(days['2026-12-01'].allDay.map(({ name }) => name)).toEqual(['Trip']);
        expect(days['2026-12-02'].allDay.map(({ name }) => name)).toEqual(['Trip']);
        expect(days['2026-12-03'].allDay).toEqual([]);
        expect(days['2026-12-01'].timed.map(({ start, end }) => [start, end])).toEqual([[h(12), h(13)]]);
        expect(days['2026-12-01'].taskDates.map(({ name }) => name)).toEqual(['Report']);
    });

    it('cuts a timed event at each midnight and orders a day by start', () => {
        const days = eventsByDay([
            event('Late', '2026-12-01 22:00', '2026-12-02 02:00'),
            event('Early', '2026-12-02 01:00', '2026-12-02 01:30'),
            event('To midnight', '2026-12-01 23:00', '2026-12-02 00:00'),
        ], '2026-12-01', '2026-12-02');
        expect(days['2026-12-01'].timed.map(({ event: { name }, start, end }) => [name, start, end])).toEqual([['Late', h(22), h(24)], ['To midnight', h(23), h(24)]]);
        expect(days['2026-12-02'].timed.map(({ event: { name }, start, end }) => [name, start, end])).toEqual([['Late', 0, h(2)], ['Early', 60, 90]]);
    });

    it('takes an event without an end, or with one before its start, as a moment', () => {
        const days = eventsByDay([event('Ping', '2026-12-01 10:00'), event('Odd', '2026-12-01 11:00', '2026-12-01 09:00')], '2026-12-01', '2026-12-01');
        expect(days['2026-12-01'].timed.map(({ start, end }) => [start, end])).toEqual([[h(10), h(10)], [h(11), h(11)]]);
    });

    it('holds only the days asked for and skips a start that is no date', () => {
        const days = eventsByDay([event('Before', '2026-11-30 10:00', '2026-11-30 11:00'), event('Bad', 'soon')], '2026-12-01', '2026-12-01');
        expect(days).toEqual({ '2026-12-01': { allDay: [], timed: [], taskDates: [] } });
        expect(eventsByDay([], '2026-12-02', '2026-12-01')).toEqual({});
    });
});

describe('freeSpans', () => {
    it('is the hours worked less what is busy, overlaps merged', () => {
        expect(freeSpans(WORK, [{ start: h(12), end: h(13) }, { start: h(12.5), end: h(14) }, { start: h(8), end: h(9.5) }, { start: h(17), end: h(20) }]))
            .toEqual([{ start: h(9.5), end: h(12) }, { start: h(14), end: h(17) }]);
        expect(freeSpans(WORK, [])).toEqual([WORK]);
        expect(freeSpans(WORK, [{ start: 0, end: h(24) }])).toEqual([]);
    });

    it('starts from the present on today', () => {
        expect(freeSpans(WORK, [{ start: h(12), end: h(13) }], h(12.5))).toEqual([{ start: h(13), end: h(18) }]);
        expect(freeSpans(WORK, [], h(19))).toEqual([]);
        expect(minutesIn(freeSpans(WORK, [{ start: h(12), end: h(13) }], h(10)))).toBe(h(7));
    });

    it('ignores a moment', () => {
        expect(freeSpans(WORK, [{ start: h(10), end: h(10) }])).toEqual([WORK]);
    });
});

describe('flow', () => {
    // Three hours free, a meeting, then the afternoon.
    const free = [{ start: h(9), end: h(12) }, { start: h(13), end: h(18) }];
    const A = { id: 'A', minutes: 60 };
    const B = { id: 'B', minutes: 60 };
    const C = { id: 'C', minutes: 60 };
    const D = { id: 'D', minutes: 180 };
    const laid = (items: typeof A[], spans = free) => flow(items, spans).segments.map(({ id, start, end }) => `${id} ${clockOf(start)}-${clockOf(end)}`);

    it('keeps the order it is given', () => {
        expect(laid([A, B, C, D])).toEqual(['A 09:00-10:00', 'B 10:00-11:00', 'C 11:00-12:00', 'D 13:00-16:00']);
        expect(laid([D, A, B, C])).toEqual(['D 09:00-12:00', 'A 13:00-14:00', 'B 14:00-15:00', 'C 15:00-16:00']);
    });

    it('cuts a task that does not fit and goes on with it after the event', () => {
        expect(laid([A, D, B, C])).toEqual(['A 09:00-10:00', 'D 10:00-12:00', 'D 13:00-14:00', 'B 14:00-15:00', 'C 15:00-16:00']);
        expect(flow([A, D], free).segments.filter(({ id }) => id === 'D').map(({ part, parts }) => [part, parts])).toEqual([[1, 2], [2, 2]]);
    });

    it('says what the day has no room for', () => {
        const only = [{ start: h(9), end: h(12) }];
        expect(flow([A, B, C, D], only)).toMatchObject({ overflow: [{ id: 'D', minutes: 180 }] });
        expect(flow([A, D, B], only).overflow).toEqual([{ id: 'D', minutes: 60 }, { id: 'B', minutes: 60 }]);
        expect(flow([A], [])).toEqual({ segments: [], overflow: [A] });
    });

    it('leaves a stretch too short to begin in, or to leave a piece worth having, empty', () => {
        const short = { id: 'S', minutes: 45 };
        // 20 minutes before the meeting: nothing is begun there.
        expect(laid([{ id: 'X', minutes: 160 }, D])).toEqual(['X 09:00-11:40', 'D 13:00-16:00']);
        // 45 minutes cannot be cut into two pieces of 30.
        expect(laid([{ id: 'X', minutes: 150 }, short])).toEqual(['X 09:00-11:30', 'S 13:00-13:45']);
        // 70 minutes into 50 free: 40 now, so that 30 are left for later.
        expect(laid([{ id: 'X', minutes: 130 }, { id: 'Y', minutes: 70 }])).toEqual(['X 09:00-11:10', 'Y 11:10-11:50', 'Y 13:00-13:30']);
    });

    it('gives a task that takes no time no place', () => {
        expect(flow([{ id: 'Z', minutes: 0 }, A], free)).toEqual({ segments: [{ id: 'A', start: h(9), end: h(10), part: 1, parts: 1 }], overflow: [] });
    });
});
