// When an alarm rings, as a note, a category or `.mory/calendars.yaml` writes it.
//
// The twin of `backend/src/alarms.rs`, which is what actually rings them: moried sends each alarm as
// a Web Push, because a service worker cannot wake itself, so it has to read the same grammar. This
// side only reads, describes and checks it, so that the app can show what a note says and flag what
// moried would drop. `fixtures/calendar/notes/alarms.md` holds the two to each other, and
// `Spec`'s `Display` there is `formatAlarm` here: change either one and run both halves.
//
// An alarm is a string of one of two spellings:
//
//   * an offset from the start, `[+-]N unit`: `-10m`, `+1h`, `-2 days`, `0m`. The units are
//     `w d h m s` and `weeks days hours minutes seconds`. The sign is required unless N is 0, so
//     that a bare `10m` is reported rather than read as "ten minutes after".
//   * a time on the start's day, `[[+-]N d|w ]HH:MM`: `09:00`, `-1d 18:00`.
//
// `d` and `w` count calendar days and take whole numbers; `h m s` count elapsed time and may be
// decimal. No alarm is more than a year from its start.

import YAML from 'yaml';

/// One alarm, read.
export type AlarmSpec =
    /// Whole calendar days from the start, keeping its wall clock.
    | { kind: 'days'; days: number }
    /// Elapsed time from the start.
    | { kind: 'elapsed'; ms: number }
    /// A time of day on the start's date, moved by whole days.
    | { kind: 'at'; days: number; hour: number; minute: number };

export type AlarmParse = { spec: AlarmSpec } | { error: string };

// The furthest from its start an alarm may be set, which keeps what a note can make the scheduler
// look ahead bounded.
const MAX_DAYS = 366;
const MAX_SHIFT_SECONDS = MAX_DAYS * 86_400;

// `[0-9]`, as in the Rust twin, where `\d` would be any Unicode digit.
const DAYS = /^([+-]?)([0-9]+) *(weeks?|days?|w|d)$/;
const ELAPSED = /^([+-]?)([0-9]+(?:\.[0-9]+)?) *(hours?|minutes?|seconds?|h|m|s)$/;
const CLOCK = /^(?:([+-]?)([0-9]+) *(weeks?|days?|w|d) +)?([0-9]{2}):([0-9]{2})$/;

// `1` or `-1` for the sign written, which is required unless the amount is zero.
function signOf(text: string, written: string, isZero: boolean): number | { error: string } {
    if (written === '-') {
        return -1;
    }
    if (written === '+' || isZero) {
        return 1;
    }
    return { error: `${JSON.stringify(text)} needs a sign: -${text} is before the start, +${text} after it` };
}

// `-0m` is zero; `-0` is a value `toEqual` tells from it.
const nonNegativeZero = (n: number) => (n === 0 ? 0 : n);

const TOO_FAR = (text: string) => ({ error: `${JSON.stringify(text)} is more than a year from the start` });

// A signed count of whole days, as `-2 days` and `+1w` say it, for the offset and for the day prefix
// of a time of day alike. The sign is checked before the size, as in the Rust twin.
function wholeDays(text: string, written: string, count: string, unit: string): number | { error: string } {
    const days = Number(count) * (unit.startsWith('w') ? 7 : 1);
    const sign = signOf(text, written, days === 0);
    if (typeof sign !== 'number') {
        return sign;
    }
    return days > MAX_DAYS ? TOO_FAR(text) : nonNegativeZero(sign * days);
}

/// Reads one alarm.
export function parseAlarm(written: string): AlarmParse {
    const text = written.trim();

    let parts = DAYS.exec(text);
    if (parts !== null) {
        const days = wholeDays(text, parts[1], parts[2], parts[3]);
        return typeof days === 'number' ? { spec: { kind: 'days', days } } : days;
    }

    parts = ELAPSED.exec(text);
    if (parts !== null) {
        const amount = Number(parts[2]);
        const perUnit = { h: 3_600, m: 60, s: 1 }[parts[3][0] as 'h' | 'm' | 's'];
        const sign = signOf(text, parts[1], amount === 0);
        if (typeof sign !== 'number') {
            return sign;
        }
        if (amount * perUnit > MAX_SHIFT_SECONDS) {
            return TOO_FAR(text);
        }
        return { spec: { kind: 'elapsed', ms: nonNegativeZero(sign * Math.round(amount * perUnit * 1000)) } };
    }

    parts = CLOCK.exec(text);
    if (parts !== null) {
        let days = 0;
        if (parts[2] !== undefined) {
            const counted = wholeDays(text, parts[1], parts[2], parts[3]);
            if (typeof counted !== 'number') {
                return counted;
            }
            days = counted;
        }
        const hour = Number(parts[4]);
        const minute = Number(parts[5]);
        if (hour > 23 || minute > 59) {
            return { error: `${JSON.stringify(text)} is not a time of day` };
        }
        return { spec: { kind: 'at', days, hour, minute } };
    }

    return {
        error: `${JSON.stringify(text)} is neither an offset such as -10m nor a time such as `
            + '09:00 or -1d 18:00',
    };
}

/// What is wrong with a list of alarms as typed: a sentence for each entry that is not one, in the
/// order they were written, and none when every entry is. This is what a box that takes alarms
/// says of its contents, so that what it accepts is what moried will ring.
export function alarmProblems(alarms: readonly string[]): string[] {
    return alarms.flatMap((alarm) => {
        const parsed = parseAlarm(alarm);
        return 'error' in parsed ? [parsed.error] : [];
    });
}

const signed = (n: number) => `${n < 0 ? '-' : '+'}${Math.abs(n)}`;
const clock = (hour: number, minute: number) =>
    `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

/// The spelling both sides settle on, whatever the note wrote: `-1.5h` and `-90 minutes` are both
/// `-90m`. Whole-second amounts take the largest of `h m s` that divides them, and the rest are
/// milliseconds, which no note spells.
export function formatAlarm(spec: AlarmSpec): string {
    switch (spec.kind) {
        case 'days':
            return `${signed(spec.days)}d`;
        case 'elapsed': {
            const ms = spec.ms;
            if (ms === 0) {
                return '+0m';
            }
            if (ms % 3_600_000 === 0) {
                return `${signed(ms / 3_600_000)}h`;
            }
            if (ms % 60_000 === 0) {
                return `${signed(ms / 60_000)}m`;
            }
            if (ms % 1000 === 0) {
                return `${signed(ms / 1000)}s`;
            }
            return `${signed(ms)}ms`;
        }
        case 'at':
            return spec.days === 0
                ? clock(spec.hour, spec.minute)
                : `${signed(spec.days)}d ${clock(spec.hour, spec.minute)}`;
    }
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

// "3 days", or "2 weeks" when it is a whole number of them.
function daysIn(days: number): string {
    return days % 7 === 0 ? plural(days / 7, 'week') : plural(days, 'day');
}

// "90 minutes", in the largest unit that divides the time evenly.
function durationIn(ms: number): string {
    if (ms % 3_600_000 === 0) {
        return plural(ms / 3_600_000, 'hour');
    }
    if (ms % 60_000 === 0) {
        return plural(ms / 60_000, 'minute');
    }
    if (ms % 1000 === 0) {
        return plural(ms / 1000, 'second');
    }
    return plural(ms, 'millisecond');
}

/// What an alarm says, in words: "10 minutes before", "the day before at 18:00".
export function describeAlarm(spec: AlarmSpec): string {
    switch (spec.kind) {
        case 'elapsed':
            if (spec.ms === 0) {
                return 'at the start';
            }
            return `${durationIn(Math.abs(spec.ms))} ${spec.ms < 0 ? 'before' : 'after'}`;
        case 'days':
            if (spec.days === 0) {
                return 'at the start';
            }
            return `${daysIn(Math.abs(spec.days))} ${spec.days < 0 ? 'before' : 'after'}`;
        case 'at': {
            const at = clock(spec.hour, spec.minute);
            if (spec.days === 0) {
                return `at ${at}`;
            }
            const when = Math.abs(spec.days) === 1
                ? `the day ${spec.days < 0 ? 'before' : 'after'}`
                : `${daysIn(Math.abs(spec.days))} ${spec.days < 0 ? 'before' : 'after'}`;
            return `${when} at ${at}`;
        }
    }
}

/// A list of alarms in words: "Rings 10 minutes before, at the start", or "Never rings".
export function describeAlarmList(alarms: readonly string[]): string {
    return alarms.length === 0
        ? 'Never rings'
        : `Rings ${alarms.map(describeAlarmText).join(', ')}`;
}

/// `describeAlarm` of one as written, which is the text itself when it is not an alarm.
export function describeAlarmText(written: string): string {
    const parsed = parseAlarm(written);
    return 'spec' in parsed ? describeAlarm(parsed.spec) : written;
}

/// The alarms an `alarms:` value holds, as written and trimmed, and the entries that were not.
///
/// A list, or a single string for a list of one, as `byday` is read. An entry that is not an alarm
/// is dropped and the rest stand, which is what moried does too; reporting it is the caller's. A
/// value that is neither a string nor a list is one entry that is not an alarm, so it holds none.
/// Not for a value that is not set: `null` and a missing key inherit, and are the caller's to tell
/// from an empty list, which silences.
export function readAlarmList(value: unknown): { alarms: string[]; invalid: unknown[] } {
    const alarms: string[] = [];
    const invalid: unknown[] = [];
    for (const entry of Array.isArray(value) ? value : [value]) {
        if (typeof entry === 'string' && 'spec' in parseAlarm(entry)) {
            alarms.push(entry.trim());
        }
        else {
            invalid.push(entry);
        }
    }
    return { alarms, invalid };
}

/// What an occurrence rings at when nothing says otherwise: at its start if it is timed, and not
/// at all if it is all-day, which is what every note did before alarms could be set. A task's dates
/// have no alarm by default, since a date a task merely has is not an appointment.
export const BUILT_IN_ALARMS = {
    timed: ['0m'],
    allDay: [] as string[],
    dueBy: [] as string[],
    deadline: [] as string[],
} as const;

/// What `alarms:` in `.mory/calendars.yaml` sets for whole kinds of occurrence. A kind the file
/// does not set is `undefined` and takes the built-in default, which is not the same as an empty
/// list: that silences it.
export interface AlarmDefaults {
    /// For an event with a time.
    timed?: string[];
    /// For an all-day event.
    allDay?: string[];
    /// For a task's `due_by`, and for its `deadline`.
    dueBy?: string[];
    deadline?: string[];
}

/// The keys of `alarms:` in the file, by the field they set.
export const ALARM_DEFAULT_KEYS = {
    timed: 'timed',
    allDay: 'all_day',
    dueBy: 'due_by',
    deadline: 'deadline',
} as const satisfies Record<keyof AlarmDefaults, string>;

/// The alarms a task sets for its own dates, under `task.alarms`. A date left out takes the
/// configuration's; an empty list silences it.
export interface TaskAlarms {
    due_by?: string[];
    deadline?: string[];
}

/// `task.alarms` as a note holds it, or `undefined` when it sets none. Hand-written, so whatever is
/// not usable is not there: an entry that is not an alarm is dropped, and a date left empty is not
/// set, which is not the same as an empty list.
export function readTaskAlarms(value: unknown): TaskAlarms | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
    }
    const alarms: TaskAlarms = {};
    for (const field of ['due_by', 'deadline'] as const) {
        const entry = (value as Record<string, unknown>)[field];
        if (entry !== undefined && entry !== null) {
            alarms[field] = readAlarmList(entry).alarms;
        }
    }
    return Object.keys(alarms).length > 0 ? alarms : undefined;
}

/// `YAML.stringify`, with each list under an `alarms:` key written on the line that names it, as a
/// note writes them: `timed: [-10m, 0m]`, and not a list of `- -10m` under it. Nothing else is
/// written in flow style, so the rest of the document keeps the layout it has everywhere.
export function stringifyWithFlowAlarms(value: unknown, options: YAML.ToStringOptions = {}): string {
    const document = new YAML.Document(value);
    YAML.visit(document, {
        Seq(_key, seq, path) {
            const inAlarms = path.some((node) => YAML.isPair(node)
                && YAML.isScalar(node.key) && node.key.value === 'alarms');
            if (inAlarms) {
                seq.flow = true;
            }
        },
    });
    return document.toString({ flowCollectionPadding: false, ...options });
}

/// The `alarms:` block as the file holds it, for a kind that is set: the keys in the file's own
/// spelling and order. The reverse of `readAlarmDefaults`, up to the entries that were not alarms.
export function writeAlarmDefaults(defaults: AlarmDefaults): Record<string, string[]> {
    const block: Record<string, string[]> = {};
    for (const [field, key] of Object.entries(ALARM_DEFAULT_KEYS) as [keyof AlarmDefaults, string][]) {
        const alarms = defaults[field];
        if (alarms !== undefined) {
            block[key] = [...alarms];
        }
    }
    return block;
}

/// The `alarms:` block of the calendar configuration, which is hand-written: whatever is not usable
/// is not there. An entry that is not an alarm is dropped from its list, as in a note.
export function readAlarmDefaults(value: unknown): AlarmDefaults {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return {};
    }
    const defaults: AlarmDefaults = {};
    for (const [field, key] of Object.entries(ALARM_DEFAULT_KEYS) as [keyof AlarmDefaults, string][]) {
        const entry = (value as Record<string, unknown>)[key];
        if (entry !== undefined && entry !== null) {
            defaults[field] = readAlarmList(entry).alarms;
        }
    }
    return defaults;
}
