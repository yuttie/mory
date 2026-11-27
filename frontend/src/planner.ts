// What the Plan view works a day out from: the events on it, the time they leave free within the
// hours worked, and how the day's tasks fill that time in the order they are planned in.
//
// Nothing here is stored. A day plan holds an order and a task its estimate; when each task is
// worked on is poured from those into the free time again at every look, from the present moment
// on today, so a plan that slips moves on by itself rather than standing wrong until it is redrawn.
import dayjs from 'dayjs';
import { isAllDay, type CalendarEvent } from '@/events';
import type { WorkHours } from '@/estimate';

/// A stretch of one day, in minutes from its midnight.
export interface Span {
    start: number;
    end: number;
}

export interface TimedEvent extends Span {
    event: CalendarEvent;
}

export interface DayEvents {
    /// Whole days. They take no time: one says the day is a certain kind of day, not when in it
    /// anything happens, so it is drawn over the day and leaves the hours to the reader.
    allDay: CalendarEvent[];
    /// What happens at a time, cut to the day. Each takes its time from the day's work.
    timed: TimedEvent[];
    /// The tasks' `due_by` and `deadline` that fall on the day. Marks, taking no time.
    taskDates: CalendarEvent[];
}

const DAY = 24 * 60;
const emptyDay = (): DayEvents => ({ allDay: [], timed: [], taskDates: [] });

/// The events of each day from `from` to `to`, both `YYYY-MM-DD` and included. An event is on
/// every day it reaches, and a timed one is cut at each midnight. Its times are the wall clock the
/// calendar draws it at (`toWallClock`).
export function eventsByDay(events: readonly CalendarEvent[], from: string, to: string): Record<string, DayEvents> {
    const days: Record<string, DayEvents> = {};
    const first = dayjs(from);
    const count = dayjs(to).diff(first, 'day') + 1;
    if (!first.isValid() || !(count > 0)) {
        return days;
    }
    const dates = Array.from({ length: count }, (_, index) => first.add(index, 'day'));
    for (const date of dates) {
        days[date.format('YYYY-MM-DD')] = emptyDay();
    }
    const windowEnd = first.add(count, 'day');
    for (const event of events) {
        const start = dayjs(event.start);
        if (!start.isValid()) {
            continue;
        }
        if (event.source === 'task') {
            days[start.format('YYYY-MM-DD')]?.taskDates.push(event);
            continue;
        }
        const whole = isAllDay(event.start);
        // An end as written: a date names the whole of its day, and an event without one is over
        // where it starts -- a moment, which takes no time, or its one day.
        let end = event.end === undefined ? start : dayjs(event.end);
        if (!end.isValid() || end.isBefore(start)) {
            end = start;
        }
        if (whole) {
            const last = end.startOf('day');
            for (let day = start.startOf('day'); !day.isAfter(last) && day.isBefore(windowEnd); day = day.add(1, 'day')) {
                days[day.format('YYYY-MM-DD')]?.allDay.push(event);
            }
            continue;
        }
        for (let day = start.startOf('day'); !day.isAfter(end) && day.isBefore(windowEnd); day = day.add(1, 'day')) {
            const from = Math.max(0, start.diff(day, 'minute'));
            const until = Math.min(DAY, end.diff(day, 'minute'));
            // Not the midnight a day before it ended at: an event ending at 00:00 is not on that day.
            if (until <= 0 && !day.isSame(start.startOf('day'))) {
                continue;
            }
            days[day.format('YYYY-MM-DD')]?.timed.push({ event, start: from, end: Math.max(from, until) });
        }
    }
    for (const day of Object.values(days)) {
        day.timed.sort((a, b) => a.start - b.start || a.end - b.end);
    }
    return days;
}

/// The time free for work: the hours worked, from `from` on where that is later, less what is
/// `busy`. In order, none touching another.
export function freeSpans(work: WorkHours, busy: readonly Span[], from = work.start): Span[] {
    const free: Span[] = [];
    let cursor = Math.max(work.start, from);
    for (const span of [...busy].sort((a, b) => a.start - b.start)) {
        // Over already, or a moment, which takes no time.
        if (span.end <= cursor || span.end <= span.start) {
            continue;
        }
        if (span.start >= work.end) {
            break;
        }
        if (span.start > cursor) {
            free.push({ start: cursor, end: span.start });
        }
        cursor = span.end;
    }
    if (cursor < work.end) {
        free.push({ start: cursor, end: work.end });
    }
    return free;
}

export const minutesIn = (spans: readonly Span[]): number => spans.reduce((sum, span) => sum + span.end - span.start, 0);

export interface FlowItem {
    id: string;
    minutes: number;
}

export interface FlowSegment extends Span {
    id: string;
    /// Which piece of its task this is, from 1, and how many pieces the task is in.
    part: number;
    parts: number;
}

export interface Flow {
    segments: FlowSegment[];
    /// What did not fit, in order: the task and how much of it is left over.
    overflow: FlowItem[];
}

/// The shortest piece a task is cut into, and the shortest stretch one is begun in: less is left
/// as slack rather than given ten minutes of a task before a meeting.
export const MIN_PIECE = 30;

/// `items` laid into `free` in their order, each beginning where the one before ended.
///
/// The order is the reader's and is kept: nothing is moved ahead to fill a stretch better. A task
/// longer than what is left of a stretch is cut there and goes on in the next, unless that would
/// leave either piece under `minPiece`: then the rest of the stretch stays empty. What the day has
/// no room for is `overflow`, for the reader to decide what gives way.
export function flow(items: readonly FlowItem[], free: readonly Span[], minPiece = MIN_PIECE): Flow {
    const segments: FlowSegment[] = [];
    const overflow: FlowItem[] = [];
    let index = 0;
    let cursor = free[0]?.start ?? 0;
    const nextSpan = (): void => {
        index += 1;
        cursor = free[index]?.start ?? 0;
    };
    for (const item of items) {
        let left = item.minutes;
        const pieces: FlowSegment[] = [];
        while (left > 0 && index < free.length) {
            const room = free[index].end - cursor;
            if (left <= room) {
                pieces.push({ id: item.id, start: cursor, end: cursor + left, part: 0, parts: 0 });
                cursor += left;
                left = 0;
                break;
            }
            // Cut so that what goes on later is a piece worth having too.
            const piece = Math.min(room, left - minPiece);
            if (piece >= minPiece) {
                pieces.push({ id: item.id, start: cursor, end: cursor + piece, part: 0, parts: 0 });
                left -= piece;
            }
            nextSpan();
        }
        pieces.forEach((piece, at) => {
            piece.part = at + 1;
            piece.parts = pieces.length;
        });
        segments.push(...pieces);
        if (left > 0) {
            overflow.push({ id: item.id, minutes: left });
        }
    }
    return { segments, overflow };
}

/// `90` minutes from midnight as `01:30`.
export function clockOf(minutes: number): string {
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
