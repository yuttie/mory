// What the Files view's Events tab says of an event: when it starts and how it repeats, as the note
// declares it. Nothing is expanded, so a rule that never ends costs no more than one that does.
//
// Frontmatter is whatever the file said, so every value is type-checked rather than trusted, and
// what cannot be read is left unsaid: the Calendar and the Health view report it. A rule is the
// exception. One the calendar refuses draws nothing, so it is called unreadable rather than
// described from the parts that could be read, which would say the event happens.

import dayjs from 'dayjs';

import { occurrencesOf } from '@/api';
import type { MetadataEvent } from '@/api';
import { toWallClock } from '@/events';
import { RecurrenceError, readRule, ruleStart } from '@/recurrence';

// A start as the calendar draws it, in the reader's zone, with the instant to sort it by.
export interface EventStart {
    text: string;
    instant: number;
}

export interface EventSummary {
    // The earliest start it writes, its own or that of an occurrence it lists.
    start?: EventStart;
    // How it happens more than once: by its rule, and on how many dates it lists.
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

// What Repeats says of a rule the calendar refuses.
const UNREADABLE = 'Unreadable rule';

// As `recurrence.ts` reads one: `wed`, `3wed`, `-1fri`.
const BYDAY = /^(-?\d+)?(sun|mon|tue|wed|thu|fri|sat)$/;

export function summarizeEvent(detail: unknown): EventSummary {
    if (!isRecord(detail)) {
        return {};
    }
    const event = detail as MetadataEvent;
    // The calendar reads a rule only beside the `start` it is anchored at: an event without one
    // draws the dates it lists, whatever its rule says. `null` is a rule it refuses, which draws
    // nothing, its own start included.
    const rule = event.start === undefined || event.repeat === undefined
        ? undefined
        : wordsOf(event.repeat, event.start);
    const base = rule === null ? undefined : startOf(event.start);
    const listed = occurrencesOf(event).filter(isRecord).map((occurrence) => startOf(occurrence.start));
    let first: EventStart | undefined;
    for (const start of [base, ...listed]) {
        if (start !== undefined && (first === undefined || start.instant < first.instant)) {
            first = start;
        }
    }
    // The days it falls on apart from what its rule makes, each once: a morning and an afternoon
    // session are one date. A rule's own start is the first date it makes.
    const days = new Set<string>();
    for (const start of rule === undefined ? [base, ...listed] : listed) {
        if (start !== undefined) {
            days.add(start.text.slice(0, 'YYYY-MM-DD'.length));
        }
    }
    let repeats: string | undefined;
    if (rule === undefined) {
        repeats = days.size > 1 ? `On ${days.size} dates` : undefined;
    }
    else if (rule === null) {
        repeats = days.size === 0 ? UNREADABLE : `${UNREADABLE}, and ${plural(days.size, 'date')}`;
    }
    else {
        repeats = days.size === 0 ? rule : `${rule}, and ${plural(days.size, 'more date')}`;
    }
    return {
        ...(first === undefined ? {} : { start: first }),
        ...(repeats === undefined ? {} : { repeats }),
    };
}

// A rule in words, anchored at `start`; "Unreadable rule" for one the calendar refuses, and
// `undefined` for none at all.
export function describeRepeat(repeat: unknown, start: unknown): string | undefined {
    return repeat === undefined ? undefined : wordsOf(repeat, start) ?? UNREADABLE;
}

// A rule in words, or `null` for one the calendar refuses: the same reading `expandRule` starts
// from, so that what the calendar reports is never described as a rule it draws.
function wordsOf(value: unknown, start: unknown): string | null {
    try {
        // Converting the start meets a zone Intl does not know, as the calendar meets it converting
        // the first occurrence it draws.
        ruleStart(readRule(value, start));
    }
    catch (error) {
        if (error instanceof RecurrenceError) {
            return null;
        }
        throw error;
    }
    const repeat = value as Record<string, unknown> & { freq: keyof typeof FREQUENCIES };
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
