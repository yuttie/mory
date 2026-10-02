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

// Where a reading of one alarm stops, with what to tell whoever wrote it. It is thrown inside
// `parseAlarm` and caught there, so that each step reads as the value it gives and not as a value or
// a refusal to hand up: `parseAlarm` itself never throws.
class Refusal extends Error {}

// `1` or `-1` for the sign written, which is required unless the amount is zero.
function signOf(text: string, written: string, isZero: boolean): number {
    if (written === '-') {
        return -1;
    }
    if (written === '+' || isZero) {
        return 1;
    }
    throw new Refusal(`${JSON.stringify(text)} needs a sign: -${text} is before the start, +${text} after it`);
}

// `-0m` is zero; `-0` is a value `toEqual` tells from it.
const nonNegativeZero = (n: number) => (n === 0 ? 0 : n);

const tooFar = (text: string) => new Refusal(`${JSON.stringify(text)} is more than a year from the start`);

// A signed count of whole days, as `-2 days` and `+1w` say it, for the offset and for the day prefix
// of a time of day alike. The sign is checked before the size, as in the Rust twin.
function wholeDays(text: string, written: string, count: string, unit: string): number {
    const days = Number(count) * (unit.startsWith('w') ? 7 : 1);
    const sign = signOf(text, written, days === 0);
    if (days > MAX_DAYS) {
        throw tooFar(text);
    }
    return nonNegativeZero(sign * days);
}

function readSpec(text: string): AlarmSpec {
    let parts = DAYS.exec(text);
    if (parts !== null) {
        return { kind: 'days', days: wholeDays(text, parts[1], parts[2], parts[3]) };
    }

    parts = ELAPSED.exec(text);
    if (parts !== null) {
        const amount = Number(parts[2]);
        const perUnit = { h: 3_600, m: 60, s: 1 }[parts[3][0] as 'h' | 'm' | 's'];
        const sign = signOf(text, parts[1], amount === 0);
        if (amount * perUnit > MAX_SHIFT_SECONDS) {
            throw tooFar(text);
        }
        return { kind: 'elapsed', ms: nonNegativeZero(sign * Math.round(amount * perUnit * 1000)) };
    }

    parts = CLOCK.exec(text);
    if (parts !== null) {
        const days = parts[2] === undefined ? 0 : wholeDays(text, parts[1], parts[2], parts[3]);
        const hour = Number(parts[4]);
        const minute = Number(parts[5]);
        if (hour > 23 || minute > 59) {
            throw new Refusal(`${JSON.stringify(text)} is not a time of day`);
        }
        return { kind: 'at', days, hour, minute };
    }

    throw new Refusal(
        `${JSON.stringify(text)} is neither an offset such as -10m nor a time such as 09:00 or -1d 18:00`);
}

/// Reads one alarm.
export function parseAlarm(written: string): AlarmParse {
    try {
        return { spec: readSpec(written.trim()) };
    }
    catch (error) {
        if (error instanceof Refusal) {
            return { error: error.message };
        }
        throw error;
    }
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

// The units an elapsed time is told in, largest first: how many milliseconds each is, how `formatAlarm`
// spells it and what `describeAlarm` calls it. Whatever none of them divides is milliseconds, which
// no note spells.
const UNITS = [
    { ms: 3_600_000, short: 'h', word: 'hour' },
    { ms: 60_000, short: 'm', word: 'minute' },
    { ms: 1_000, short: 's', word: 'second' },
] as const;

function unitFor(ms: number): { ms: number; short: string; word: string } {
    return UNITS.find((unit) => ms % unit.ms === 0) ?? { ms: 1, short: 'ms', word: 'millisecond' };
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
            if (spec.ms === 0) {
                return '+0m';
            }
            const unit = unitFor(spec.ms);
            return `${signed(spec.ms / unit.ms)}${unit.short}`;
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
    const unit = unitFor(ms);
    return plural(ms / unit.ms, unit.word);
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

/// The alarms a value sets, or `undefined` when it sets none: `null` and a missing key inherit, which
/// is not what an empty list does, since that is a setting and silences. Every place that takes the
/// first of several layers asks this, so that "unset" is one thing.
export function readAlarmsIfSet(value: unknown): string[] | undefined {
    return value === undefined || value === null ? undefined : readAlarmList(value).alarms;
}

/// What is wrong with the entries of an `alarms:` value that are not alarms, a sentence each, for a
/// place that reports them; `[]` when it is not set or every entry is one. Those entries are
/// dropped on reading, so unless someone says so they vanish without the author having been told.
export function alarmValueProblems(value: unknown): string[] {
    if (value === undefined || value === null) {
        return [];
    }
    return readAlarmList(value).invalid.map((entry) => typeof entry === 'string'
        ? alarmProblems([entry])[0]
        : `${JSON.stringify(entry) ?? String(entry)} is not an alarm`);
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

/// `AlarmDefaults` with each kind the file leaves unset filled with its built-in, which is the last
/// layer of every resolution. Asking this one, a reader never repeats the fallback itself.
export type EffectiveAlarmDefaults = Required<AlarmDefaults>;

export function withBuiltInAlarms(defaults: AlarmDefaults | undefined): EffectiveAlarmDefaults {
    return {
        timed: defaults?.timed ?? [...BUILT_IN_ALARMS.timed],
        allDay: defaults?.allDay ?? [...BUILT_IN_ALARMS.allDay],
        dueBy: defaults?.dueBy ?? [...BUILT_IN_ALARMS.dueBy],
        deadline: defaults?.deadline ?? [...BUILT_IN_ALARMS.deadline],
    };
}

// A value that is a mapping, as hand-written YAML has it: not null, and not a list.
function asMapping(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

// `ALARM_DEFAULT_KEYS` as pairs, typed once, for the reading and the writing of the block to share.
const ALARM_DEFAULT_ENTRIES = Object.entries(ALARM_DEFAULT_KEYS) as [keyof AlarmDefaults, string][];

// The lists a mapping holds under the keys `entries` name, for each that is set: an entry is the field
// it is kept in and the key it is written under. What each entry says that is not an alarm goes to
// `report`, with the key, if given.
function readAlarmFields<K extends string>(
    mapping: Record<string, unknown>,
    entries: readonly (readonly [K, string])[],
    report?: (key: string, problem: string) => void,
): Partial<Record<K, string[]>> {
    const fields: Partial<Record<K, string[]>> = {};
    for (const [field, key] of entries) {
        const written = mapping[key];
        for (const problem of alarmValueProblems(written)) {
            report?.(key, problem);
        }
        const set = readAlarmsIfSet(written);
        if (set !== undefined) {
            fields[field] = set;
        }
    }
    return fields;
}

/// The alarms a task sets for its own dates, under `task.alarms`. A date left out takes the
/// configuration's; an empty list silences it.
export interface TaskAlarms {
    due_by?: string[];
    deadline?: string[];
}

/// Which kind of `AlarmDefaults` each of a task's dates takes its alarms from.
export const TASK_DATE_ALARM_DEFAULT = {
    due_by: 'dueBy',
    deadline: 'deadline',
} as const satisfies Record<keyof TaskAlarms, keyof AlarmDefaults>;

/// What `task.alarms` holds for one of the task's dates, as written, which is `undefined` unless
/// `task.alarms` is a mapping. The guard for reading it, wherever it is read.
export function taskAlarmOf(alarms: unknown, field: keyof TaskAlarms): unknown {
    return asMapping(alarms)?.[field];
}

// The dates of a task that have alarms.
const TASK_DATES = Object.keys(TASK_DATE_ALARM_DEFAULT) as (keyof TaskAlarms)[];

/// The alarms a task being edited would write: those of the dates it has, and only a list it set
/// itself, trimmed. The default is not a thing to write, or the date would stop following the
/// settings. A list left behind for a date the task has since lost is not written either, so it is
/// neither compared with the saved task nor checked: it would be dropped on saving.
export function taskAlarmsToWrite(task: {
    due_by: string;
    deadline: string;
    due_by_alarms: readonly string[] | null;
    deadline_alarms: readonly string[] | null;
}): TaskAlarms {
    const alarms: TaskAlarms = {};
    for (const field of TASK_DATES) {
        const list = task[`${field}_alarms`];
        if (task[field] !== '' && list !== null) {
            alarms[field] = list.map((alarm) => alarm.trim());
        }
    }
    return alarms;
}

/// Whether two tasks set the same alarms. A date that sets none takes the default, which is not the
/// same as one that sets an empty list.
export function sameTaskAlarms(a: TaskAlarms, b: TaskAlarms): boolean {
    return TASK_DATES.every((field) => {
        const [x, y] = [a[field], b[field]];
        return x === undefined || y === undefined
            ? x === y
            : x.length === y.length && x.every((alarm, index) => alarm === y[index]);
    });
}

/// `task.alarms` as a note holds it, or `undefined` when it sets none. Hand-written, so whatever is
/// not usable is not there: an entry that is not an alarm is dropped, and a date left empty is not
/// set, which is not the same as an empty list.
export function readTaskAlarms(value: unknown): TaskAlarms | undefined {
    const mapping = asMapping(value);
    if (mapping === undefined) {
        return undefined;
    }
    const alarms: TaskAlarms = readAlarmFields(mapping, TASK_DATES.map((field) => [field, field] as const));
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
    for (const [field, key] of ALARM_DEFAULT_ENTRIES) {
        const alarms = defaults[field];
        if (alarms !== undefined) {
            block[key] = [...alarms];
        }
    }
    return block;
}

/// The `alarms:` block of the calendar configuration, which is hand-written: whatever is not usable
/// is not there. An entry that is not an alarm is dropped from its list, as in a note.
///
/// Each thing dropped is said in `problems`, if given, as `alarms.timed: <what is wrong>`: the file
/// is rewritten whole from what is read, so the next save of anything would erase it unannounced.
export function readAlarmDefaults(value: unknown, problems?: string[]): AlarmDefaults {
    if (value === undefined || value === null) {
        return {};
    }
    const mapping = asMapping(value);
    if (mapping === undefined) {
        problems?.push('alarms: is not a mapping of kinds to the alarms they ring at');
        return {};
    }
    return readAlarmFields(
        mapping,
        ALARM_DEFAULT_ENTRIES,
        (key, problem) => problems?.push(`alarms.${key}: ${problem}`),
    );
}
