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

// `dayjs`'s own pattern, which it tries before handing a string to `Date`.
const DAYJS_PARSE =
    /^(\d{4})[-/]?(\d{1,2})?[-/]?(\d{0,2})[Tt\s]*(\d{1,2})?:?(\d{1,2})?:?(\d{1,2})?[.:]?(\d+)?$/;

// What a note leaves to `Date`: an ISO datetime with its offset, or a date before `Z`.
const WITH_OFFSET =
    /^\s*(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?\s*(?:([Zz])|([+-])(\d{2}):?(\d{2}))\s*$/;

/// A datetime a note wrote, as `dayjs` reads it, or `null` where it does not.
///
/// What `dayjs` leaves to `Date` is read here instead, as V8 reads it, and only an ISO datetime
/// with its offset at that: `Date` reads `August 12, 2024` and `9/19/2024` as well, and each engine
/// a set of its own. `dayjs_parse` in `backend/src/note_events.rs` reads the same, so moried rings
/// for what the calendar draws, in any browser.
export function readDatetime(value: unknown): dayjs.Dayjs | null {
    // `unknown`: `dayjs(20240501)` is a valid epoch, and a YAML integer would pass for one.
    if (typeof value !== 'string') {
        return null;
    }
    if (!/z$/i.test(value) && DAYJS_PARSE.test(value)) {
        const parsed = dayjs(value);
        return parsed.isValid() ? parsed : null;
    }
    const m = WITH_OFFSET.exec(value);
    // V8 takes a bare date only before `Z`.
    if (m === null || (m[4] === undefined && m[8] === undefined)) {
        return null;
    }
    const [year, month, day, hour, minute, second] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i] ?? 0));
    const ms = Number((m[7] ?? '0').slice(0, 3).padEnd(3, '0'));
    // V8 holds a day to 31 in any month and rolls the rest over, as `dayjs` does its own; an hour
    // of 24 is only the day's end.
    const endOfDay = hour === 24 && minute === 0 && second === 0 && ms === 0;
    if (month < 1 || month > 12 || day < 1 || day > 31 || (hour > 23 && !endOfDay) || minute > 59 || second > 59) {
        return null;
    }
    const offset = m[8] !== undefined ? 0 : (m[9] === '-' ? -1 : 1) * (Number(m[10]) * 60 + Number(m[11]));
    // `setUTCFullYear` rather than `Date.UTC`, which takes a year below 100 as one in the 1900s.
    const at = new Date(0);
    at.setUTCFullYear(year, month - 1, day);
    at.setUTCHours(hour, minute - offset, second, ms);
    return dayjs(at);
}

function toAnchor(w: WallClock): Date {
    return new Date(Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second));
}

/// A wall clock spelt as the calendar reads it, a part past its range rolled over into the next
/// larger one, as rrule rolls a rule's start: `2024-02-30` is March 1, and `24:00` the next day.
export function formatWallClock(w: WallClock): string {
    return formatAnchor(toAnchor(w), w.hasTime);
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

/// A list in a rule as the dialect means it, whatever the frontmatter held: a single value is a
/// list of one, and `null` or an empty list is no restriction at all. rrule.js takes an empty list
/// as "none of these", which drops the default it would take from `start`, so a monthly rule with
/// `byday: []` came out daily.
function listOf(value: unknown): unknown[] | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    const list = Array.isArray(value) ? value : [value];
    return list.length === 0 ? undefined : list;
}

/// The wall clock in `tz` at the instant `value` names, which carries its offset.
///
/// The zone is read as `dayjs.tz` reads it for each occurrence: a blank one is the reader's own,
/// and one Intl does not know is refused. Intl throws a `RangeError` for it, which out of here
/// would blank the calendar rather than report one rule.
function wallClockIn(value: string, tz: unknown): string {
    // One it cannot read formats as `Invalid Date`, which is no wall clock, and is compared as
    // written.
    const at = readDatetime(value) ?? dayjs(NaN);
    try {
        return at.tz((tz || undefined) as string | undefined).format('YYYY-MM-DD HH:mm:ss');
    }
    catch {
        throw new RecurrenceError(`Unknown timezone "${String(tz)}"`);
    }
}

// What `backend/src/note_events.rs` holds an interval and a count in, which the two must agree on.
const MAX_INTERVAL = 65535;
const MAX_COUNT = 4294967295;

/// A rule as the calendar reads it, before any window is asked of it.
///
/// `expandRule` starts from this, so a view that only describes a rule -- the Files view, which
/// expands nothing -- can refuse exactly what the calendar refuses. One mistake is met later, in
/// the calendar as anywhere: a `tz` that Intl does not know, which only converting an occurrence
/// with it finds (`inReaderZone`).
export interface RecurrenceRule {
    /// The rule, built, to ask for occurrences.
    rrule: RRule;
    /// The wall clock the rule is anchored at: `start` as written, any offset dropped.
    start: WallClock;
    /// The zone that wall clock is in, as written; absent when it is the reader's.
    tz: unknown;
    /// `until` as each occurrence is compared with it: a wall clock in the rule's own frame. A date
    /// stays a date here, though the comparison takes in the whole day.
    until?: WallClock;
}

/// `repeat` anchored at `start`, or a `RecurrenceError` for a rule the calendar refuses.
export function readRule(repeat: unknown, start: unknown): RecurrenceRule {
    if (typeof repeat !== 'object' || repeat === null) {
        throw new RecurrenceError('repeat must be a mapping of rule fields');
    }
    const rule = repeat as { [K in keyof EventRepeat]?: unknown };
    const anchorStart = parseWallClock(start);
    if (anchorStart === null) {
        throw new RecurrenceError(`Unusable start "${String(start)}"`);
    }

    // Frontmatter is whatever the file said, so the lists are read rather than trusted: a
    // `TypeError` out of here would blank the whole calendar.
    const byday = listOf(rule.byday);
    const bymonthday = listOf(rule.bymonthday);
    const bymonth = listOf(rule.bymonth);

    if (byday !== undefined && rule.freq === 'weekly' && byday.some((day) => hasOrdinal(String(day)))) {
        // "the third Wednesday" needs a period longer than a week to count within.
        throw new RecurrenceError('An ordinal weekday means nothing under freq: weekly');
    }

    // Only text, and only a frequency's own name: JavaScript makes the key `daily` of `[daily]`,
    // and moried refuses it.
    if (typeof rule.freq !== 'string' || !Object.hasOwn(FREQUENCIES, rule.freq)) {
        throw new RecurrenceError(`Unknown frequency ${JSON.stringify(rule.freq)}`);
    }
    const options: ConstructorParameters<typeof RRule>[0] = {
        freq: FREQUENCIES[rule.freq as EventRepeat['freq']],
        dtstart: toAnchor(anchorStart),
    };
    // Blank is no interval, as it is for the other fields. Anything else that is not a whole number
    // from one to what the backend's `u16` holds is not a rule: rrule.js never finishes expanding
    // one, and a loop here freezes the page where a throw would only blank the calendar.
    const interval = rule.interval;
    if (interval !== undefined && interval !== null) {
        if (typeof interval !== 'number' || !Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) {
            throw new RecurrenceError(`interval must be a whole number from 1 to ${MAX_INTERVAL}, not ${JSON.stringify(interval)}`);
        }
        options.interval = interval;
    }
    if (byday !== undefined) {
        options.byweekday = byday.map((day) => toWeekday(String(day)));
    }
    if (bymonthday !== undefined) {
        options.bymonthday = bymonthday as number[];
    }
    if (bymonth !== undefined) {
        options.bymonth = bymonth as number[];
    }
    // A name that is no weekday is ignored, as moried ignores it, and so are the names every object
    // answers to: `toString` handed rrule.js a function as the week's start, which it never finished
    // expanding, freezing the page.
    if (typeof rule.wkst === 'string' && Object.hasOwn(WEEKDAYS, rule.wkst)) {
        options.wkst = WEEKDAYS[rule.wkst];
    }
    // Blank is no limit, as for the other fields. Anything else that is not a whole number from one
    // to what the backend's `u32` holds is not a rule: rrule.js read `'3'` as three, `three` as
    // one, and a negative or fractional count as no limit at all, and moried rang for none.
    const count = rule.count;
    if (count !== undefined && count !== null) {
        if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
            throw new RecurrenceError(`count must be a whole number from 1 to ${MAX_COUNT}, not ${JSON.stringify(count)}`);
        }
        options.count = count;
    }
    let resolvedUntil: WallClock | undefined;
    if (rule.until !== undefined) {
        const until = parseWallClock(rule.until);
        if (until === null) {
            throw new RecurrenceError(`Unusable until "${String(rule.until)}"`);
        }
        // `until` is compared against occurrences in the rule's own frame, so an offset on it is
        // read rather than ignored -- unlike `start`, whose offset only records which one applied.
        // Both are the same wall clock here once the offset has been resolved into `tz`.
        const written = rule.until as string;
        const bounded = rule.tz !== undefined && until.hasTime && HAS_OFFSET.test(written)
            ? parseWallClock(wallClockIn(written, rule.tz))
            : until;
        const resolved = bounded ?? until;
        resolvedUntil = resolved;
        // A date-only `until` includes the whole day.
        options.until = resolved.hasTime
            ? toAnchor(resolved)
            : toAnchor({ ...resolved, hour: 23, minute: 59, second: 59, hasTime: true });
    }

    // rrule throws plain `Error`s for a rule it will not build. Those are a note's mistake, so they
    // are reported like any other, never allowed out of the derivation to blank the view.
    let rrule: RRule;
    try {
        rrule = new RRule(options);
    }
    catch (error) {
        throw new RecurrenceError(
            error instanceof Error ? error.message : 'the rule could not be built');
    }
    return { rrule, start: anchorStart, tz: rule.tz, ...(resolvedUntil === undefined ? {} : { until: resolvedUntil }) };
}

// rrule's weekdays in its own order, Monday first.
const WEEKDAY_NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export type WeekdayName = typeof WEEKDAY_NAMES[number];

/// What a rule draws on, as rrule reads the values `readRule` lets through.
///
/// rrule reads some of them otherwise than they are written, and the schema refuses most of those
/// while the calendar draws them all the same. A view that describes a rule without expanding it
/// has to follow rrule rather than the text: `bymonth: [13]` draws nothing.
export interface RuleTerms {
    /// The weekdays it draws on, each with the ordinal it counts if any; empty for any weekday.
    weekdays: { weekday: WeekdayName; ordinal?: number }[];
    /// The days of the month it draws on, negative ones counted from its end; empty for any.
    monthDays: number[];
    /// `bymonthday` names days, but none rrule keeps. That leaves the rule no day of its own and
    /// takes none from its start either, so it draws on every day of each period.
    everyDay: boolean;
    /// The months it draws in, from 1; empty for any.
    months: number[];
    /// How many occurrences it stops after; absent for no limit.
    count?: number;
    /// It draws nothing, whatever its start: a value it names can never be met.
    never: boolean;
}

export function termsOf(rule: RecurrenceRule): RuleTerms {
    // What `readRule` handed rrule, before rrule's own reading.
    const options = rule.rrule.origOptions;

    // `readRule` lets through only a whole number from one.
    const count = options.count ?? undefined;

    // rrule matches a month or a day of the month by strict equality, so only a whole number of the
    // right size is ever met: not `'3'`, not 13.
    const isWhole = (value: unknown, limit: number): value is number =>
        typeof value === 'number' && Number.isInteger(value) && value !== 0 && Math.abs(value) <= limit;
    const monthList = options.bymonth as unknown[] | undefined;
    const months = (monthList ?? []).filter((month) => isWhole(month, 12) && month > 0) as number[];
    // Of the days of the month, rrule keeps only what compares as positive or negative. Dropping all
    // of them leaves no restriction, not an empty one.
    const dayList = options.bymonthday as unknown[] | undefined;
    const kept = (dayList ?? []).filter((day) => (day as number) > 0 || (day as number) < 0);
    const monthDays = kept.filter((day) => isWhole(day, 31)) as number[];

    // rrule counts an ordinal within a month, or within the year when a yearly rule names no month,
    // and drops it under a shorter period: `2mon` under `freq: daily` is every Monday. Naming plain
    // weekdays as well, a rule draws only the days both name.
    const counts = options.freq === Frequency.MONTHLY || options.freq === Frequency.YEARLY;
    const named = ((options.byweekday ?? []) as RRuleWeekday[]).map((day) => ({
        weekday: WEEKDAY_NAMES[day.weekday],
        ...(counts && day.n !== undefined ? { ordinal: day.n } : {}),
    }));
    const plain = named.filter((day) => day.ordinal === undefined);
    const ordinals = named.filter((day) => day.ordinal !== undefined);
    const last = options.freq === Frequency.YEARLY && monthList === undefined ? 53 : 5;
    const met = ordinals.filter((day) => Math.abs(day.ordinal ?? 0) <= last
        && (plain.length === 0 || plain.some((each) => each.weekday === day.weekday)));
    const weekdays = ordinals.length > 0 ? met : plain;

    return {
        weekdays,
        monthDays,
        everyDay: dayList !== undefined && kept.length === 0,
        months,
        ...(count === undefined ? {} : { count }),
        never: (named.length > 0 && weekdays.length === 0)
            || (kept.length > 0 && monthDays.length === 0)
            || (monthList !== undefined && months.length === 0),
    };
}

/// A wall clock the rule generates, in the reader's zone: `tz` names the zone it belongs to, and is
/// absent when that is already the reader's.
function inReaderZone(wallClock: string, hasTime: boolean, tz: unknown): string {
    // A date is not an instant: converting midnight-in-a-zone into the reader's moves the date.
    // The backend no longer writes `tz` for an all-day series, but a hand-written note may.
    if (tz === undefined || !hasTime) {
        return wallClock;
    }
    // An unknown zone reaches Intl and throws a RangeError rather than producing an invalid
    // dayjs, so the failure has to be caught rather than tested for.
    let converted;
    try {
        converted = dayjs.tz(wallClock, tz as string);
    }
    catch {
        throw new RecurrenceError(`Unknown timezone "${String(tz)}"`);
    }
    if (!converted.isValid()) {
        throw new RecurrenceError(`Unknown timezone "${String(tz)}"`);
    }
    return converted.local().format('YYYY-MM-DD HH:mm');
}

/// Where the calendar puts the start a rule is anchored at, in the reader's zone: its wall clock,
/// converted as each occurrence is. A start off the rule's own pattern is put there all the same,
/// though rrule generates nothing there.
///
/// A `RecurrenceError` for a zone Intl does not know, which the calendar meets converting the first
/// occurrence it draws.
export function ruleStart(rule: RecurrenceRule): string {
    return inReaderZone(formatAnchor(toAnchor(rule.start), rule.start.hasTime), rule.start.hasTime, rule.tz);
}

/// Where the calendar puts a rule's `until`, in the reader's zone: the wall clock each occurrence is
/// compared with, converted as they are. An offset on it is read only into a `tz`; without one,
/// the wall clock is compared as written. A date stays the date, all of which the rule takes in.
export function ruleUntil(rule: RecurrenceRule): string | undefined {
    if (rule.until === undefined) {
        return undefined;
    }
    const text = formatAnchor(toAnchor(rule.until), rule.until.hasTime);
    return rule.until.hasTime ? inReaderZone(text, rule.start.hasTime, rule.tz) : text;
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
    const rule = readRule(repeat, start);

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
    // start, which is the reason the rule is never re-anchored to the window. What rrule throws
    // while expanding is the note's mistake too, and reported as one.
    let occurrences: string[];
    try {
        occurrences = rule.rrule
            .between(toAnchor(windowFrom), toAnchor(windowTo), true)
            .map((anchor) => formatAnchor(anchor, rule.start.hasTime));
    }
    catch (error) {
        throw new RecurrenceError(
            error instanceof Error ? error.message : 'the rule could not be expanded');
    }
    return occurrences.map((wallClock) => inReaderZone(wallClock, rule.start.hasTime, rule.tz));
}
