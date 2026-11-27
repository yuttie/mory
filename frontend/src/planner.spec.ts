import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '@/events';
import { clockOf, eventsByDay, flow, freeSpans, minutesIn, MIN_PIECE, type Span } from '@/planner';

const WORK = { start: 9 * 60, end: 18 * 60 };
const event = (name: string, start: string, end?: string, source: CalendarEvent['source'] = 'note'): CalendarEvent => ({ name, start, end, color: '#000', source });
const h = (hours: number) => hours * 60;

// Whole numbers below the one asked for, the same ones on every run (mulberry32), so that what the
// randomized checks find is found again.
function seeded(seed: number): (below: number) => number {
    let state = seed;
    return (below) => {
        state = (state + 0x6D2B79F5) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return Math.floor((((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296) * below);
    };
}

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

    it('puts an event begun before the days asked for, and going on after them, on each of them', () => {
        const days = eventsByDay([
            event('Leave', '2025-12-01', '2027-11-30'),
            event('Watch', '2026-11-30 10:00', '2026-12-03 10:00'),
        ], '2026-12-01', '2026-12-02');
        expect(Object.values(days).map(({ allDay }) => allDay.map(({ name }) => name))).toEqual([['Leave'], ['Leave']]);
        expect(Object.values(days).map(({ timed }) => timed.map(({ start, end }) => [start, end]))).toEqual([[[0, h(24)]], [[0, h(24)]]]);
    });

    // As `<v-calendar>` draws it, which reads a bare date as its midnight wherever the start has a
    // time: only a whole day's end takes in the day it names.
    it('ends a timed event whose end is a date at the midnight that date begins with', () => {
        const days = eventsByDay([event('Overnight', '2026-12-01 22:00', '2026-12-02')], '2026-12-01', '2026-12-02');
        expect(days['2026-12-01'].timed.map(({ start, end }) => [start, end])).toEqual([[h(22), h(24)]]);
        expect(days['2026-12-02'].timed).toEqual([]);
    });

    it('ignores the seconds of a time, as the calendar does', () => {
        const days = eventsByDay([event('Call', '2026-12-01 10:00:30', '2026-12-01 10:45:59')], '2026-12-01', '2026-12-01');
        expect(days['2026-12-01'].timed.map(({ start, end }) => [start, end])).toEqual([[h(10), h(10) + 45]]);
    });

    // The calendar draws a time where the wall clock says it is. Counted as time gone by since
    // midnight, ten o'clock was nine on the day the clocks go forward and eleven on the day they go
    // back, and an event at 23:00 that day was a moment at 24:00.
    describe('on a day the clocks change', () => {
        afterEach(() => {
            vi.unstubAllEnvs();
        });
        const times = (days: ReturnType<typeof eventsByDay>) => Object.fromEntries(Object.entries(days).map(([date, { timed }]) => [date, timed.map(({ event: { name }, start, end }) => [name, start, end])]));

        it('places a time by the wall clock when they go forward', () => {
            vi.stubEnv('TZ', 'America/New_York');
            const days = eventsByDay([
                event('Night', '2026-03-07 23:00', '2026-03-08 04:00'),
                event('Meeting', '2026-03-08 10:00', '2026-03-08 11:00'),
                event('Late', '2026-03-08 23:00', '2026-03-09 01:00'),
            ], '2026-03-07', '2026-03-09');
            expect(times(days)).toEqual({
                '2026-03-07': [['Night', h(23), h(24)]],
                '2026-03-08': [['Night', 0, h(4)], ['Meeting', h(10), h(11)], ['Late', h(23), h(24)]],
                '2026-03-09': [['Late', 0, h(1)]],
            });
        });

        it('places a time by the wall clock when they go back', () => {
            vi.stubEnv('TZ', 'America/New_York');
            const days = eventsByDay([
                event('Meeting', '2026-11-01 10:00', '2026-11-01 11:00'),
                event('Late', '2026-11-01 23:00', '2026-11-02 01:00'),
            ], '2026-11-01', '2026-11-02');
            expect(times(days)).toEqual({
                '2026-11-01': [['Meeting', h(10), h(11)], ['Late', h(23), h(24)]],
                '2026-11-02': [['Late', 0, h(1)]],
            });
        });
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

    it('frees each minute worked that nothing takes, and no other', () => {
        const random = seeded(7);
        for (let round = 0; round < 300; round += 1) {
            const start = random(30) * 30;
            const work = { start, end: Math.min(h(24), start + 30 + random(40) * 30) };
            const busy = Array.from({ length: random(6) }, () => {
                const at = random(h(24) + 1);
                return { start: at, end: Math.min(h(24), at + [0, -10, 15, 30, 60, random(600)][random(6)]) };
            });
            const from = random(2) === 0 ? undefined : random(h(24) + 1);
            const free = freeSpans(work, busy, from);
            const context = JSON.stringify({ work, busy, from, free });
            const first = Math.max(work.start, from ?? work.start);
            const freed = Array.from({ length: h(24) }, (_, minute) => free.some((span) => span.start <= minute && minute < span.end));
            const expected = Array.from({ length: h(24) }, (_, minute) => minute >= first && minute < work.end && !busy.some((span) => span.start <= minute && minute < span.end));
            expect(freed, context).toEqual(expected);
            free.forEach((span, index) => {
                expect(span.end, context).toBeGreaterThan(span.start);
                if (index > 0) {
                    expect(span.start, context).toBeGreaterThan(free[index - 1].end);
                }
            });
        }
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
        // 60 minutes into 45 free is two pieces of 30, and 59 none.
        expect(laid([{ id: 'X', minutes: 135 }, { id: 'Y', minutes: 60 }])).toEqual(['X 09:00-11:15', 'Y 11:15-11:45', 'Y 13:00-13:30']);
        expect(laid([{ id: 'X', minutes: 135 }, { id: 'Y', minutes: 59 }])).toEqual(['X 09:00-11:15', 'Y 13:00-13:59']);
    });

    it('does a task that fits a stretch whole there, however short both are', () => {
        expect(laid([{ id: 'X', minutes: 160 }, { id: 'S', minutes: 15 }])).toEqual(['X 09:00-11:40', 'S 11:40-11:55']);
    });

    // The order is the reader's: a later task waits for an earlier one even where it would fit the
    // stretch that one could not be begun in, and even where that one does not fit the day at all.
    it('moves nothing ahead into a stretch left empty', () => {
        expect(laid([{ id: 'X', minutes: 160 }, D, { id: 'S', minutes: 15 }])).toEqual(['X 09:00-11:40', 'D 13:00-16:00', 'S 16:00-16:15']);
        expect(flow([{ id: 'X', minutes: 50 }, { id: 'S', minutes: 20 }], [{ start: h(9), end: h(9) + 40 }]))
            .toEqual({ segments: [], overflow: [{ id: 'X', minutes: 50 }, { id: 'S', minutes: 20 }] });
    });

    it('gives a task that takes no time no place', () => {
        expect(flow([{ id: 'Z', minutes: 0 }, A], free)).toEqual({ segments: [{ id: 'A', start: h(9), end: h(10), part: 1, parts: 1 }], overflow: [] });
    });

    it('keeps its rules whatever it is given', () => {
        const random = seeded(42);
        const pick = <T>(values: readonly T[]): T => values[random(values.length)];
        for (let round = 0; round < 2000; round += 1) {
            // In order and apart, as `freeSpans` gives them, short ones and empty ones among them.
            const spans: Span[] = [];
            let at = random(120);
            for (let count = random(6); count > 0; count -= 1) {
                const length = pick([0, 5, 29, 30, 31, 45, 59, 60, 61, 90, random(240)]);
                spans.push({ start: at, end: at + length });
                at += length + 1 + random(90);
            }
            const items = Array.from({ length: random(7) }, (_, index) => ({ id: `${index}`, minutes: pick([0, 10, 29, 30, 31, 45, 59, 60, 61, 90, 120, random(400)]) }));
            const minPiece = pick([MIN_PIECE, 15, 1]);
            const { segments, overflow } = flow(items, spans, minPiece);
            const context = JSON.stringify({ spans, items, minPiece });
            segments.forEach((segment, index) => {
                expect(segment.end, context).toBeGreaterThan(segment.start);
                expect(spans.some((span) => span.start <= segment.start && segment.end <= span.end), context).toBe(true);
                if (index > 0) {
                    expect(segment.start, context).toBeGreaterThanOrEqual(segments[index - 1].end);
                    expect(Number(segment.id), context).toBeGreaterThanOrEqual(Number(segments[index - 1].id));
                }
            });
            let overflowing = false;
            for (const item of items) {
                const pieces = segments.filter(({ id }) => id === item.id);
                const left = overflow.find(({ id }) => id === item.id)?.minutes ?? 0;
                expect(minutesIn(pieces) + left, context).toBe(item.minutes);
                expect(pieces.map(({ part, parts }) => [part, parts]), context).toEqual(pieces.map((_, index) => [index + 1, pieces.length]));
                // A task that is cut is cut into pieces worth having, what is left for another day
                // among them.
                if (pieces.length > 1 || (pieces.length > 0 && left > 0)) {
                    expect(Math.min(...pieces.map(({ start, end }) => end - start), left > 0 ? left : Infinity), context).toBeGreaterThanOrEqual(minPiece);
                }
                // Nothing after a task the day has no room for is done before it.
                if (overflowing) {
                    expect(pieces, context).toEqual([]);
                }
                // And the day has no room only where no stretch from where the task could begin
                // takes the whole of it, as the rest would then be done there: without this, a
                // flow that placed nothing, or kept to the first stretch, kept every rule above.
                if (left > 0 && !overflowing) {
                    const after = Math.max(-Infinity, ...segments.filter(({ id }) => Number(id) < Number(item.id)).map(({ end }) => end));
                    expect(spans.every((span) => span.end - Math.max(span.start, after) < item.minutes), context).toBe(true);
                }
                if (left > 0) {
                    overflowing = true;
                }
            }
        }
    });
});
