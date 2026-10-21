// What the Files view's Events tab says of an event: when it starts and how it repeats, as the note
// declares it. Nothing is expanded, so a rule that never ends costs no more than one that does.
//
// Frontmatter is whatever the file said, so every value is type-checked rather than trusted, and
// what cannot be read is left unsaid: the Calendar and the Health view report it. A rule is the
// exception. One the calendar refuses, or reads as naming what can never be met, draws nothing, so
// it is called unreadable rather than described from the parts that could be read, which would
// say the event happens. The rest are described as the calendar's rrule reads them, which is not
// always as they are written.

import dayjs from 'dayjs';

import { occurrencesOf } from '@/api';
import type { MetadataEvent } from '@/api';
import { toWallClock } from '@/events';
import { RecurrenceError, readRule, ruleStart, termsOf } from '@/recurrence';
import type { RuleTerms, WeekdayName } from '@/recurrence';

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

const WEEKDAYS: Record<WeekdayName, string> = {
    sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// What Repeats says of a rule the calendar refuses, or reads as one that can never be met.
const UNREADABLE = 'Unreadable rule';

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

// A rule in words, or `null` for one the calendar draws nothing from: one it refuses, by the same
// reading `expandRule` starts from, or one that names what can never be met. Either is called
// unreadable, never described as a rule that happens.
function wordsOf(value: unknown, start: unknown): string | null {
    let terms: RuleTerms;
    try {
        const rule = readRule(value, start);
        // Converting the start meets a zone Intl does not know, as the calendar meets it converting
        // the first occurrence it draws.
        ruleStart(rule);
        terms = termsOf(rule);
    }
    catch (error) {
        if (error instanceof RecurrenceError) {
            return null;
        }
        throw error;
    }
    if (terms.never) {
        return null;
    }
    const repeat = value as Record<string, unknown> & { freq: keyof typeof FREQUENCIES };
    const [every, unit] = FREQUENCIES[repeat.freq];
    // `readRule` has refused any interval but a whole number from one.
    const interval = repeat.interval;
    let text = typeof interval === 'number' && interval > 1 ? `Every ${interval} ${unit}` : every;

    const days = terms.weekdays.map(({ weekday, ordinal: n }) =>
        n === undefined ? WEEKDAYS[weekday] : `${ordinal(n)} ${WEEKDAYS[weekday]}`);
    const monthDays = terms.monthDays.map(ordinal);
    // "the 3rd Wed" and "the 1st", but "Mon" alone.
    const on = [...days, ...monthDays];
    if (on.length > 0) {
        text += on.some((day) => /^\d|^last/.test(day)) ? ` on the ${on.join(', ')}` : ` on ${on.join(', ')}`;
    }
    else if (terms.everyDay && repeat.freq !== 'daily') {
        text += ' on every day';
    }
    if (terms.months.length > 0) {
        text += ` in ${terms.months.map((month) => MONTHS[month - 1]).join(', ')}`;
    }

    if (typeof repeat.until === 'string' && repeat.until.trim() !== '') {
        text += `, until ${toWallClock(repeat.until)}`;
    }
    else if (terms.count !== undefined) {
        text += `, ${plural(terms.count, 'time')}`;
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
