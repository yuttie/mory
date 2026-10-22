// What the Files view's Events tab says of an event: when it starts and how it repeats, as the note
// declares it. Nothing is expanded, so a rule that never ends costs no more than one that does.
//
// Starts is therefore the earliest start the note writes, placed where the calendar would draw it,
// and not always the first occurrence the calendar draws: rrule begins a rule at the first day it
// meets, so a rule whose start falls off its own pattern -- the third Wednesday, anchored on the
// first -- draws nothing at that start.
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
import { RecurrenceError, readDatetime, readRule, ruleStart, ruleUntil, termsOf } from '@/recurrence';
import type { RuleTerms, WeekdayName } from '@/recurrence';

// A start where the calendar would draw it, in the reader's zone, with the instant to sort it by.
export interface EventStart {
    text: string;
    instant: number;
}

export interface EventSummary {
    // The earliest start it writes, its own or that of an occurrence it lists, which a rule
    // anchored off its own pattern does not draw.
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
    // draws the dates it lists, whatever its rule says. `null` is a rule it draws nothing from,
    // its own start included.
    const series = event.start === undefined || event.repeat === undefined
        ? undefined
        : seriesOf(event.repeat, event.start);
    // A rule's start is read as the rule reads it, a one-off's as `buildOccurrence` does.
    const base = series === undefined ? startOf(event.start) : series?.start;
    const listed = occurrencesOf(event).filter(isRecord).map((occurrence) => startOf(occurrence.start));
    let first: EventStart | undefined;
    for (const start of [base, ...listed]) {
        if (start !== undefined && (first === undefined || start.instant < first.instant)) {
            first = start;
        }
    }
    // The days it falls on apart from what its rule makes, each once: a morning and an afternoon
    // session are one date. A rule's own start is the rule's, not a date apart, and the rule may
    // not even draw it.
    const days = new Set<string>();
    for (const start of series === undefined ? [base, ...listed] : listed) {
        if (start !== undefined) {
            days.add(start.text.slice(0, 'YYYY-MM-DD'.length));
        }
    }
    let repeats: string | undefined;
    if (series === undefined) {
        repeats = days.size > 1 ? `On ${days.size} dates` : undefined;
    }
    else if (series === null) {
        repeats = days.size === 0 ? UNREADABLE : `${UNREADABLE}, and ${plural(days.size, 'date')}`;
    }
    else {
        repeats = days.size === 0 ? series.words : `${series.words}, and ${plural(days.size, 'more date')}`;
    }
    return {
        ...(first === undefined ? {} : { start: first }),
        ...(repeats === undefined ? {} : { repeats }),
    };
}

// A rule in words, anchored at `start`; "Unreadable rule" for one the calendar draws nothing from,
// and `undefined` for none at all.
export function describeRepeat(repeat: unknown, start: unknown): string | undefined {
    return repeat === undefined ? undefined : seriesOf(repeat, start)?.words ?? UNREADABLE;
}

// A rule in words, with its start as the calendar puts it.
interface Series {
    words: string;
    start: EventStart;
}

// A rule in words, or `null` for one the calendar draws nothing from: one it refuses, by the same
// reading `expandRule` starts from, or one that names what can never be met. Either is called
// unreadable, never described as a rule that happens.
function seriesOf(value: unknown, start: unknown): Series | null {
    let first: string;
    let until: string | undefined;
    let terms: RuleTerms;
    try {
        const rule = readRule(value, start);
        // Where the calendar would draw the start, which is where it meets a zone Intl does not
        // know, converting the first occurrence.
        first = ruleStart(rule);
        until = ruleUntil(rule);
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
    const counted = terms.weekdays.some((day) => day.ordinal !== undefined);
    if (monthDays.length > 0 && days.length > 0) {
        // rrule draws the days both name, not either: the 1st when it is a Monday.
        text += ` on the ${monthDays.join(', ')} if ${counted ? 'the' : 'a'} ${alternatives(days)}`;
    }
    else if (monthDays.length > 0) {
        text += ` on the ${monthDays.join(', ')}`;
    }
    else if (days.length > 0) {
        // "the 3rd Wed", but "Mon" alone.
        text += counted ? ` on the ${days.join(', ')}` : ` on ${days.join(', ')}`;
    }
    if (terms.months.length > 0) {
        text += ` in ${terms.months.map((month) => MONTHS[month - 1]).join(', ')}`;
    }

    // The schema allows one of `until` and `count`, but the calendar stops at whichever comes
    // first, and says so here rather than leave one out.
    if (until !== undefined) {
        text += `, until ${until}`;
    }
    if (terms.count !== undefined) {
        text += until === undefined ? `, ${plural(terms.count, 'time')}` : `, at most ${plural(terms.count, 'time')}`;
    }
    return { words: text, start: { text: first, instant: dayjs(first).valueOf() } };
}

function startOf(value: unknown): EventStart | undefined {
    // As the calendar reads it, and not as `Date` might.
    if (typeof value !== 'string' || readDatetime(value) === null) {
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

// `Mon`, `Mon or Tue`, `Mon, Tue or Wed`.
function alternatives(items: string[]): string {
    return items.length > 1 ? `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}` : items.join('');
}

function plural(n: number, noun: string): string {
    return n === 1 ? `${n} ${noun}` : `${n} ${noun}s`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
