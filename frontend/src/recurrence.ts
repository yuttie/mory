// Expanding a `repeat:` rule into the occurrences it generates.
//
// This is an adapter onto rrule, not an implementation. Hand-writing the expansion looks
// approachable and is not: the rule's phase is anchored at `start` rather than at the window, a
// `count` is counted from the series start and cannot be evaluated inside a window, RFC 5545 skips
// invalid dates where `dayjs.add(1, 'month')` clamps them (Jan 31 + 1 month is Feb 28, so a naive
// monthly loop drifts permanently), and the week a `WKST` starts on decides which occurrences an
// interval greater than one produces. The backend expands the same feeds with the Rust `rrule`
// crate, so sharing the semantics is also what keeps a converted note rendering where the imported
// event did.
//
// Everything here works in *wall clock*, which is what a recurrence rule actually repeats: "10:00
// every third Wednesday" stays 10:00 across a daylight-saving change. Wall-clock times are carried
// through rrule anchored to UTC -- the conventional way to keep it from applying a local offset --
// and only converted to the reader's zone at the end, when `tz` says which zone the wall clock
// belongs to.

import { Frequency, RRule, Weekday as RRuleWeekday } from 'rrule';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

import type { EventRepeat } from '@/api';

dayjs.extend(utc);
dayjs.extend(timezone);

// A datetime as the author wrote it: date, optional time, optional trailing offset.
//
// The offset is deliberately ignored. `2015-06-25 10:00:00-07:00` says "10:00, in a zone that was
// at -07:00 that day" -- the wall clock is the part a rule repeats, and the offset is a record of
// which one applied then, not an instruction to shift the time.
const WALL_CLOCK =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?$/;

export interface WallClock {
    year: number;
    month: number;   // 1-12
    day: number;
    hour: number;
    minute: number;
    second: number;
    hasTime: boolean;
}

export function parseWallClock(value: unknown): WallClock | null {
    // `unknown`, not `string`: frontmatter is whatever the file said, and a bare `start: 20240501`
    // is a YAML integer. `dayjs` calls that a valid epoch, so a type check upstream is not enough.
    if (typeof value !== 'string') {
        return null;
    }
    const m = WALL_CLOCK.exec(value.trim());
    if (m === null) {
        return null;
    }
    return {
        year: Number(m[1]),
        month: Number(m[2]),
        day: Number(m[3]),
        hour: m[4] === undefined ? 0 : Number(m[4]),
        minute: m[5] === undefined ? 0 : Number(m[5]),
        second: m[6] === undefined ? 0 : Number(m[6]),
        hasTime: m[4] !== undefined,
    };
}

function toAnchor(w: WallClock): Date {
    return new Date(Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second));
}

function formatAnchor(anchor: Date, hasTime: boolean): string {
    const p = (n: number) => String(n).padStart(2, '0');
    const date =
        `${anchor.getUTCFullYear()}-${p(anchor.getUTCMonth() + 1)}-${p(anchor.getUTCDate())}`;
    if (!hasTime) {
        return date;
    }
    const time = `${p(anchor.getUTCHours())}:${p(anchor.getUTCMinutes())}`;
    return anchor.getUTCSeconds() === 0 ? `${date} ${time}` : `${date} ${time}:${p(anchor.getUTCSeconds())}`;
}

const FREQUENCIES: Record<EventRepeat['freq'], Frequency> = {
    daily: Frequency.DAILY,
    weekly: Frequency.WEEKLY,
    monthly: Frequency.MONTHLY,
    yearly: Frequency.YEARLY,
};

const WEEKDAYS: Record<string, RRuleWeekday> = {
    sun: RRule.SU, mon: RRule.MO, tue: RRule.TU, wed: RRule.WE,
    thu: RRule.TH, fri: RRule.FR, sat: RRule.SA,
};

// `wed`, `3wed`, `-1fri`. The ordinal picks that weekday within the period.
const BYDAY = /^(-?\d+)?(sun|mon|tue|wed|thu|fri|sat)$/;

const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/;

export class RecurrenceError extends Error {}

function toWeekday(value: string): RRuleWeekday {
    const m = BYDAY.exec(value);
    if (m === null) {
        throw new RecurrenceError(`Unknown weekday "${value}"`);
    }
    const weekday = WEEKDAYS[m[2]];
    if (m[1] === undefined) {
        return weekday;
    }
    const ordinal = Number(m[1]);
    if (!Number.isInteger(ordinal) || ordinal === 0) {
        // rrule throws on a zero ordinal, and the schema's pattern admits `0wed`.
        throw new RecurrenceError(`"${value}" needs a non-zero ordinal`);
    }
    return weekday.nth(ordinal);
}

function hasOrdinal(value: string): boolean {
    const m = BYDAY.exec(value);
    return m !== null && m[1] !== undefined;
}

/// The wall-clock occurrences a rule generates that fall within `[from, to]`.
///
/// Returned in the reader's own zone: `repeat.tz` names the zone the rule's wall clock belongs to,
/// and is absent when that is already the reader's.
export function expandRule(
    repeat: EventRepeat,
    start: string,
    from: string,
    to: string,
): string[] {
    if (typeof repeat !== 'object' || repeat === null) {
        throw new RecurrenceError('repeat must be a mapping of rule fields');
    }
    const anchorStart = parseWallClock(start);
    if (anchorStart === null) {
        throw new RecurrenceError(`Unusable start "${start}"`);
    }

    if (repeat.byday !== undefined && repeat.freq === 'weekly' && repeat.byday.some(hasOrdinal)) {
        // "the third Wednesday" needs a period longer than a week to count within.
        throw new RecurrenceError('An ordinal weekday means nothing under freq: weekly');
    }

    const options: ConstructorParameters<typeof RRule>[0] = {
        freq: FREQUENCIES[repeat.freq],
        dtstart: toAnchor(anchorStart),
    };
    if (repeat.interval !== undefined) {
        options.interval = repeat.interval;
    }
    if (repeat.byday !== undefined) {
        options.byweekday = repeat.byday.map(toWeekday);
    }
    if (repeat.bymonthday !== undefined) {
        options.bymonthday = repeat.bymonthday;
    }
    if (repeat.bymonth !== undefined) {
        options.bymonth = repeat.bymonth;
    }
    if (repeat.wkst !== undefined) {
        options.wkst = WEEKDAYS[repeat.wkst];
    }
    if (repeat.count !== undefined) {
        options.count = repeat.count;
    }
    if (repeat.until !== undefined) {
        const until = parseWallClock(repeat.until);
        if (until === null) {
            throw new RecurrenceError(`Unusable until "${repeat.until}"`);
        }
        // `until` is compared against occurrences in the rule's own frame, so an offset on it is
        // read rather than ignored -- unlike `start`, whose offset only records which one applied.
        // Both are the same wall clock here once the offset has been resolved into `tz`.
        const bounded = repeat.tz !== undefined && until.hasTime && HAS_OFFSET.test(repeat.until)
            ? parseWallClock(dayjs(repeat.until).tz(repeat.tz).format('YYYY-MM-DD HH:mm:ss'))
            : until;
        const resolved = bounded ?? until;
        // A date-only `until` includes the whole day.
        options.until = resolved.hasTime
            ? toAnchor(resolved)
            : toAnchor({ ...resolved, hour: 23, minute: 59, second: 59, hasTime: true });
    }

    const windowFrom = parseWallClock(from);
    const windowToRead = parseWallClock(to);
    if (windowFrom === null || windowToRead === null) {
        throw new RecurrenceError('Unusable window');
    }
    // A date-only window end means that whole day, not midnight starting it -- otherwise a window
    // ending on the day of an occurrence drops the occurrence.
    const windowTo = windowToRead.hasTime
        ? windowToRead
        : { ...windowToRead, hour: 23, minute: 59, second: 59, hasTime: true };

    // `between` is inclusive at both ends here, and `count` is still honoured from the series
    // start, which is the reason the rule is never re-anchored to the window.
    // rrule throws plain `Error`s for a rule it will not build -- an unknown frequency, a
    // contradictory combination. Those are a note's mistake, so they are reported like any other,
    // never allowed out of the derivation to blank the view.
    let occurrences: string[];
    try {
        occurrences = new RRule(options)
            .between(toAnchor(windowFrom), toAnchor(windowTo), true)
            .map((anchor) => formatAnchor(anchor, anchorStart.hasTime));
    }
    catch (error) {
        throw new RecurrenceError(
            error instanceof Error ? error.message : 'the rule could not be expanded');
    }

    // A date is not an instant: converting midnight-in-a-zone into the reader's moves the date.
    // The backend no longer writes `tz` for an all-day series, but a hand-written note may.
    if (repeat.tz === undefined || !anchorStart.hasTime) {
        return occurrences;
    }
    return occurrences.map((wallClock) => {
        // An unknown zone reaches Intl and throws a RangeError rather than producing an invalid
        // dayjs, so the failure has to be caught rather than tested for.
        let converted;
        try {
            converted = dayjs.tz(wallClock, repeat.tz);
        }
        catch {
            throw new RecurrenceError(`Unknown timezone "${repeat.tz}"`);
        }
        if (!converted.isValid()) {
            throw new RecurrenceError(`Unknown timezone "${repeat.tz}"`);
        }
        return anchorStart.hasTime
            ? converted.local().format('YYYY-MM-DD HH:mm')
            : converted.local().format('YYYY-MM-DD');
    });
}
