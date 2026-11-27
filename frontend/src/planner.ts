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

// Which day a moment is on, counted in dates rather than in time gone by: a day the clocks change
// on is 23 or 25 hours long, and is still one day.
const dayNumber = (moment: dayjs.Dayjs): number => Date.UTC(moment.year(), moment.month(), moment.date()) / 86_400_000;

/// The events of each day from `from` to `to`, both `YYYY-MM-DD` and included. An event is on
/// every day it reaches, and a timed one is cut at each midnight. Its times are the wall clock the
/// calendar draws it at (`toWallClock`), and are placed by the wall clock as `<v-calendar>` places
/// them, to the minute: on a day the clocks change, ten o'clock is not ten hours after midnight.
export function eventsByDay(events: readonly CalendarEvent[], from: string, to: string): Record<string, DayEvents> {
    const days: Record<string, DayEvents> = {};
    const first = dayjs(from);
    const firstDay = dayNumber(first);
    const count = dayNumber(dayjs(to)) - firstDay + 1;
    if (!first.isValid() || !(count > 0)) {
        return days;
    }
    const dates = Array.from({ length: count }, (_, index) => first.add(index, 'day').format('YYYY-MM-DD'));
    for (const date of dates) {
        days[date] = emptyDay();
    }
    for (const event of events) {
        const start = dayjs(event.start);
        if (!start.isValid()) {
            continue;
        }
        if (event.source === 'task') {
            days[start.format('YYYY-MM-DD')]?.taskDates.push(event);
            continue;
        }
        // An end as written, and an event without one over where it starts -- a moment, which
        // takes no time, or its one day.
        let end = event.end === undefined ? start : dayjs(event.end);
        if (!end.isValid() || end.isBefore(start)) {
            end = start;
        }
        // Counted from the window's first day, so that only the window's days are walked: every
        // event the notes declare without a rule reaches here, whenever it is, and one begun years
        // ago must cost no more than one begun today.
        const startsOn = dayNumber(start) - firstDay;
        const endsOn = dayNumber(end) - firstDay;
        const last = Math.min(count - 1, endsOn);
        if (isAllDay(event.start)) {
            // A whole day's end is inclusive, as `eventEndsAt` reads it.
            for (let index = Math.max(0, startsOn); index <= last; index += 1) {
                days[dates[index]].allDay.push(event);
            }
            continue;
        }
        // A timed event's end is the moment it names, and a date there is the midnight that date
        // begins with: that is where the calendar stops drawing it.
        const startsAt = start.hour() * 60 + start.minute();
        const endsAt = end.hour() * 60 + end.minute();
        for (let index = Math.max(0, startsOn); index <= last; index += 1) {
            // Not on the day whose first moment it ends at, which the calendar leaves it off, unless
            // it is a moment at that midnight.
            if (index === endsOn && endsAt === 0 && index !== startsOn) {
                continue;
            }
            const from = index === startsOn ? startsAt : 0;
            days[dates[index]].timed.push({ event, start: from, end: Math.max(from, index === endsOn ? endsAt : DAY) });
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

/// The shortest piece a task is cut into: less is left as slack rather than given ten minutes of a
/// task before a meeting. A task that fits what is left of a stretch whole is not cut, and is done
/// there however short both are.
export const MIN_PIECE = 30;

/// `items` laid into `free` in their order, each beginning no earlier than the one before ended.
/// `free` is in order and apart, as `freeSpans` gives it.
///
/// The order is the reader's and is kept: nothing is moved ahead to fill a stretch better, even one
/// an earlier task left empty. A task longer than what is left of a stretch is cut there and goes
/// on in the next, but into no piece under `minPiece`, counting what is left for another day: it is
/// cut short of the stretch's end where that keeps the next piece long enough, and not begun in the
/// stretch at all where nothing does, the rest of the stretch staying empty. What the day has no
/// room for is `overflow`, and so is everything after it, for the reader to decide what gives way.
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
