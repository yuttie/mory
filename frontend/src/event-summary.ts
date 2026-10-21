// What the Files view's Events tab says of an event note: when its events start, how they repeat,
// and when one of them next happens.
//
// Frontmatter is whatever the file said, so every value is type-checked rather than trusted, and
// what cannot be read is left unsaid: the Calendar and the Health view report it.

import dayjs from 'dayjs';

import { occurrencesOf } from '@/api';
import type { ListEntry2, MetadataEvent } from '@/api';
import { eventEndsAt, eventsFromEntries, toWallClock } from '@/events';

// A start as the calendar draws it, in the reader's zone, with the instant to sort it by.
export interface EventStart {
    text: string;
    instant: number;
}

export interface EventsSummary {
    // The earliest start the note writes, of a rule or of an occurrence it lists.
    start?: EventStart;
    // How each event that repeats does, those that do not left out.
    repeats?: string;
}

const FREQUENCIES: Record<string, [string, string]> = {
    daily: ['Daily', 'days'],
    weekly: ['Weekly', 'weeks'],
    monthly: ['Monthly', 'months'],
    yearly: ['Yearly', 'years'],
};

const WEEKDAYS: Record<string, string> = {
    sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// As `recurrence.ts` reads one: `wed`, `3wed`, `-1fri`.
const BYDAY = /^(-?\d+)?(sun|mon|tue|wed|thu|fri|sat)$/;

export function summarizeEvents(declared: unknown): EventsSummary {
    if (!isRecord(declared)) {
        return {};
    }
    let first: EventStart | undefined;
    const repeats: string[] = [];
    for (const detail of Object.values(declared)) {
        if (!isRecord(detail)) {
            continue;
        }
        const event = detail as MetadataEvent;
        const listed = occurrencesOf(event).filter(isRecord);
        for (const value of [event.start, ...listed.map((occurrence) => occurrence.start)]) {
            const start = startOf(value);
            if (start !== undefined && (first === undefined || start.instant < first.instant)) {
                first = start;
            }
        }
        const dates = listed.filter((occurrence) => startOf(occurrence.start) !== undefined).length;
        const rule = describeRepeat(event.repeat);
        if (rule !== undefined) {
            repeats.push(dates > 0 ? `${rule}, and ${plural(dates, 'more date')}` : rule);
        }
        else if (dates > 0) {
            // A list of occurrences is the other way an event happens more than once.
            const all = dates + (startOf(event.start) === undefined ? 0 : 1);
            if (all > 1) {
                repeats.push(`On ${all} dates`);
            }
        }
    }
    return {
        ...(first === undefined ? {} : { start: first }),
        ...(repeats.length === 0 ? {} : { repeats: repeats.join('; ') }),
    };
}

// A rule in words, or `undefined` for one that is not a rule the calendar expands.
export function describeRepeat(repeat: unknown): string | undefined {
    if (!isRecord(repeat) || typeof repeat.freq !== 'string' || !Object.hasOwn(FREQUENCIES, repeat.freq)) {
        return undefined;
    }
    const [every, unit] = FREQUENCIES[repeat.freq];
    const interval = repeat.interval;
    let text = typeof interval === 'number' && Number.isInteger(interval) && interval > 1
        ? `Every ${interval} ${unit}`
        : every;

    const days = listOf(repeat.byday)
        .map((day) => BYDAY.exec(String(day)))
        .filter((match) => match !== null)
        .map((match) => match[1] === undefined ? WEEKDAYS[match[2]] : `${ordinal(Number(match[1]))} ${WEEKDAYS[match[2]]}`);
    const monthDays = listOf(repeat.bymonthday)
        .filter((day) => typeof day === 'number' && Number.isInteger(day) && day !== 0)
        .map((day) => ordinal(day as number));
    const months = listOf(repeat.bymonth)
        .filter((month) => typeof month === 'number' && Number.isInteger(month) && month >= 1 && month <= 12)
        .map((month) => MONTHS[(month as number) - 1]);
    // "the 3rd Wed" and "the 1st", but "Mon" alone.
    const on = [...days, ...monthDays];
    if (on.length > 0) {
        text += on.some((day) => /^\d|^last/.test(day)) ? ` on the ${on.join(', ')}` : ` on ${on.join(', ')}`;
    }
    if (months.length > 0) {
        text += ` in ${months.join(', ')}`;
    }

    if (typeof repeat.until === 'string' && repeat.until.trim() !== '') {
        text += `, until ${toWallClock(repeat.until)}`;
    }
    else if (typeof repeat.count === 'number' && Number.isInteger(repeat.count) && repeat.count > 0) {
        text += `, ${plural(repeat.count, 'time')}`;
    }
    return text;
}

// When each note's events next happen, by its path: the earliest occurrence not over yet, one under
// way included. A rule is expanded over the year ahead alone, as it may never end; a date the note
// lists is taken however far ahead it is.
export function nextOccurrences(entries: readonly ListEntry2[], now: number): Map<string, EventStart> {
    const today = dayjs(now);
    const { events } = eventsFromEntries(entries, {
        from: today.format('YYYY-MM-DD'),
        to: today.add(1, 'year').format('YYYY-MM-DD'),
    });
    const next = new Map<string, EventStart>();
    for (const event of events) {
        if (event.notePath === undefined || eventEndsAt(event).valueOf() < now) {
            continue;
        }
        const instant = dayjs(event.start).valueOf();
        const known = next.get(event.notePath);
        if (known === undefined || instant < known.instant) {
            next.set(event.notePath, { text: event.start, instant });
        }
    }
    return next;
}

function startOf(value: unknown): EventStart | undefined {
    // `typeof` first: `dayjs(20240501)` is a valid epoch, as `buildOccurrence` says.
    if (typeof value !== 'string' || !dayjs(value).isValid()) {
        return undefined;
    }
    const text = toWallClock(value);
    return { text, instant: dayjs(text).valueOf() };
}

// As `recurrence.ts` reads a list in a rule: a single value is a list of one.
function listOf(value: unknown): unknown[] {
    if (value === undefined || value === null) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

// `1st`, `22nd`, `13th`; counted from the end, `last` and `2nd last`.
function ordinal(n: number): string {
    if (n === -1) {
        return 'last';
    }
    if (n < 0) {
        return `${ordinal(-n)} last`;
    }
    const tens = n % 100;
    const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
    return `${n}${suffix}`;
}

function plural(n: number, noun: string): string {
    return n === 1 ? `${n} ${noun}` : `${n} ${noun}s`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
