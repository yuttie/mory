import { wallClockOf, zoneOffset } from '@/zone';

export type Importance = 'low' | 'medium' | 'high';
export const IMPORTANCE_ORDER: Record<Importance, number> = { low: 0, medium: 1, high: 2 };
export function readImportance(value: unknown): Importance | undefined {
    if (value === 'low' || value === 'medium' || value === 'high') {
        return value;
    }
    return typeof value === 'number' ? ({ 1: 'low', 2: 'low', 4: 'medium', 5: 'high' } as Record<number, Importance>)[value] : undefined;
}

export function leadTimeDays(value: unknown): number | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const match = /^([0-9]+) *(weeks?|days?|w|d)$/.exec(value.trim());
    if (!match) {
        return undefined;
    }
    const days = Number(match[1]) * (match[2].startsWith('w') ? 7 : 1);
    return Number.isSafeInteger(days) ? days : undefined;
}

export interface TaskSettings {
    default_lead_time?: string;
    lead_time_by_tag?: Record<string, string>;
}

export function readTaskSettings(value: unknown): { settings: TaskSettings; problems: string[] } {
    const settings: TaskSettings = {};
    const problems: string[] = [];
    if (value === null || value === undefined) {
        return { settings, problems };
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
        return { settings, problems: ['Task settings must be a mapping.'] };
    }
    const root = value as Record<string, unknown>;
    if ('tasks' in root) {
        return { settings, problems: ['Legacy task data found in .mory/tasks.yaml; move it to tasks-v1.yaml. Settings ignored.'] };
    }
    if (root.default_lead_time !== undefined) {
        if (leadTimeDays(root.default_lead_time) !== undefined) {
            settings.default_lead_time = root.default_lead_time as string;
        }
        else {
            problems.push('Invalid default_lead_time; use whole days or weeks, such as 7d or 2w.');
        }
    }
    if (root.lead_time_by_tag !== undefined) {
        if (typeof root.lead_time_by_tag !== 'object' || root.lead_time_by_tag === null || Array.isArray(root.lead_time_by_tag)) {
            problems.push('lead_time_by_tag must be a mapping.');
        }
        else {
            settings.lead_time_by_tag = {};
            for (const [tag, lead] of Object.entries(root.lead_time_by_tag)) {
                if (leadTimeDays(lead) !== undefined) {
                    settings.lead_time_by_tag[tag] = lead as string;
                }
                else {
                    problems.push(`Invalid lead time for tag ${tag}.`);
                }
            }
        }
    }
    return { settings, problems };
}

export interface UrgencyTask {
    status?: { kind: string };
    lead_time?: unknown;
    available_from?: unknown;
    start_at?: unknown;
    due_by?: unknown;
    deadline?: unknown;
}

export type UrgencyLevel = 'none' | 'calm' | 'notice' | 'urgent' | 'target_missed' | 'overdue';
export const URGENCY_ORDER: Record<UrgencyLevel, number> = { none: 0, calm: 1, notice: 2, urgent: 3, target_missed: 4, overdue: 5 };
export const URGENCY_LABEL: Record<UrgencyLevel, string> = { none: 'None', calm: 'Calm', notice: 'Notice', urgent: 'Urgent', target_missed: 'Target missed', overdue: 'Overdue' };
export interface Urgency {
    level: UrgencyLevel;
    slack_ratio: number | null;
    reference: string | null;
    actionable: boolean;
    short_window: boolean;
}

export function resolvedLeadTime(task: UrgencyTask, tags: readonly string[], settings: TaskSettings = {}): number {
    const own = leadTimeDays(task.lead_time);
    if (own !== undefined) {
        return own;
    }
    const tagged = (Array.isArray(tags) ? tags : []).filter((tag) => typeof tag === 'string').map((tag) => leadTimeDays(settings.lead_time_by_tag?.[tag])).filter((days): days is number => days !== undefined);
    return tagged.length > 0 ? Math.max(...tagged) : leadTimeDays(settings.default_lead_time) ?? 7;
}

const DAY = 86_400_000;

// The instant a wall clock in the zone reads, given as `YYYY-MM-DD HH:mm`, `YYYY-MM-DD HH:mm:ss`
// or `YYYY-MM-DD HH:mm:ss.sss`. `setUTCFullYear` builds it, as `wallClockOf` does, rather than
// `dayjs.utc`, which reads through `Date.UTC` and so takes the years 0-99 as 1900-1999, where the
// Rust twin (`local_instant`) reads them as written.
export function localInstant(wall: string, zone: string): number {
    const parts = /^([0-9]{4})-([0-9]{2})-([0-9]{2}) ([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]{3}))?)?$/.exec(wall);
    if (parts === null) {
        return NaN;
    }
    const [, year, month, day, hours, minutes, seconds = '0', millis = '0'] = parts;
    const clock = new Date(0);
    clock.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
    clock.setUTCHours(Number(hours), Number(minutes), Number(seconds), Number(millis));
    return instantOfWallClock(clock.valueOf(), zone);
}

// A wall clock in the zone, `YYYY-MM-DD HH:mm` or `YYYY-MM-DD HH:mm:ss`, written with the offset
// the zone has then, as a datetime is written in a note. One the zone skips moves forward, as
// `localInstant` reads it, rather than keep the typed clock beside an offset that, paired with it,
// names an hour earlier.
export function withOffset(wall: string, zone: string): string {
    const instant = localInstant(wall, zone);
    const clock = wallClockOf(instant, zone);
    const minutes = Math.round((clock - instant) / 60_000);
    const iso = new Date(clock).toISOString();
    const time = iso.slice(11, wall.length > 16 ? 19 : 16);
    const sign = minutes < 0 ? '-' : '+';
    const hours = String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0');
    return `${iso.slice(0, 10)} ${time}${sign}${hours}:${String(Math.abs(minutes) % 60).padStart(2, '0')}`;
}

// The instant a wall clock, given as `wallClockOf` gives it, reads in the zone.
function instantOfWallClock(local: number, zone: string): number {
    const offsets = [...new Set([-2, 0, 2].map((days) => zoneOffset(local + days * DAY, zone)))];
    const matches = offsets.map((offset) => local - offset).filter((instant) => wallClockOf(instant, zone) === local);
    // Pick the first repeated clock time; a missing time moves forward by the gap.
    return matches.length > 0 ? Math.min(...matches) : local - zoneOffset(local - DAY, zone);
}

// The instant a task date names: a bare date in `zone`, through its last moment with `endOfDay`, a
// datetime at its offset, and a datetime written without one as the wall clock in `zone`, which is
// moried's, as every other reader of a note reads such a time. Notes are written with the offset
// (`isWrittenTaskDate`), but older ones are not, and reading those as no date at all left a
// deadline the calendar draws and the alarms ring out of the task's urgency.
export function taskInstant(value: unknown, zone: string, endOfDay = false): number | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const text = value.trim();
    if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(text)) {
        const canonical = new Date(`${text}T00:00:00Z`);
        if (!Number.isFinite(canonical.valueOf()) || canonical.toISOString().slice(0, 10) !== text) {
            return undefined;
        }
        return localInstant(`${text} ${endOfDay ? '23:59:59.999' : '00:00:00.000'}`, zone);
    }
    const parts = text.match(/^([0-9]{4}-[0-9]{2}-[0-9]{2})[ T]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(\.[0-9]{1,3})?)?(Z|[+-][0-9]{2}:[0-9]{2})?$/);
    if (!parts || Number(parts[2]) > 23 || Number(parts[3]) > 59 || Number(parts[4] ?? 0) > 59) {
        return undefined;
    }
    const [, date, hours, minutes, seconds, fraction, offset] = parts;
    const canonical = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(canonical.valueOf()) || canonical.toISOString().slice(0, 10) !== date) {
        return undefined;
    }
    if (offset === undefined) {
        const millis = (fraction ?? '.').slice(1).padEnd(3, '0');
        return localInstant(`${date} ${hours}:${minutes}:${seconds ?? '00'}.${millis}`, zone);
    }
    const instant = Date.parse(text.replace(' ', 'T'));
    return Number.isFinite(instant) ? instant : undefined;
}

// Whether a value is a task date as one is written: a bare date, or a datetime carrying its offset,
// spelt as every reader of one takes it. What the task editor, the outline and moried's tools write
// (`urgency::is_written`). `taskInstant` reads more, but not every reader does: the calendar
// (`toWallClock`) and the alarms read no fraction of a second and no white space before a bare
// date, and a bare date in the years 0 to 99 as one in the 1900s, and the editor's own date field
// reads a datetime in those years so too, and white space after a bare date as midnight. The
// calendar draws a bare date in the years 100 to 999 nowhere, spelling its year in three digits it
// does not read, and nothing needs a datetime in them either.
export function isWrittenTaskDate(value: unknown): boolean {
    return typeof value === 'string'
        && value.trim() === value
        && !value.startsWith('0')
        && /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[ T][0-9]{2}:[0-9]{2}(?::[0-9]{2})?(?:Z|[+-][0-9]{2}:[0-9]{2}))?$/.test(value)
        && taskInstant(value, 'UTC') !== undefined;
}

// `zone` is the one a bare date is read in, moried's, as `useZoneStore` gives it.
export function urgencyOf(task: UrgencyTask, tags: readonly string[], settings: TaskSettings, now: number, zone: string): Urgency {
    const due = taskInstant(task.due_by, zone, true);
    const deadline = taskInstant(task.deadline, zone, true);
    const available = taskInstant(task.available_from ?? task.start_at, zone);
    const result: Urgency = { level: 'none', slack_ratio: null, reference: null, actionable: available === undefined || available <= now, short_window: false };
    const lead = resolvedLeadTime(task, tags, settings);
    let reference = due === undefined ? deadline : deadline === undefined ? due : Math.min(due, deadline);
    if (reference === undefined || task.status?.kind === 'done' || task.status?.kind === 'canceled') {
        return result;
    }
    const windowReference = reference;
    if (deadline !== undefined && deadline < now) {
        result.level = 'overdue';
        reference = deadline;
    }
    else if (due !== undefined && due < now) {
        result.level = 'target_missed';
        reference = deadline ?? due;
    }
    const ratio = lead === 0 ? (reference === now ? 0 : (reference > now ? Infinity : -Infinity)) : (reference - now) / 86_400_000 / lead;
    if (result.level === 'none') {
        result.level = ratio > 2 ? 'calm' : ratio > 1 ? 'notice' : 'urgent';
    }
    result.slack_ratio = ratio;
    result.reference = new Date(reference).toISOString();
    // Subtract calendar days while retaining the reference's local wall clock across DST.
    const shifted = wallClockOf(windowReference, zone) - lead * DAY;
    // Beyond the dates a `Date` holds, the window is open from the start, as it is in the Rust twin.
    // That includes the two days inside them that `instantOfWallClock` would look past.
    const begins = Math.abs(shifted) <= 8.64e15 - 2 * DAY ? instantOfWallClock(shifted, zone) : -Infinity;
    result.short_window = available !== undefined && available > begins;
    return result;
}

export function compareUrgency(a: Urgency, b: Urgency): number {
    return URGENCY_ORDER[b.level] - URGENCY_ORDER[a.level] || (a.slack_ratio ?? Infinity) - (b.slack_ratio ?? Infinity);
}
export function mostUrgent(values: readonly Urgency[]): Urgency {
    // A task without dates, which no zone reads anything of.
    return [...values].sort(compareUrgency)[0] ?? urgencyOf({}, [], {}, Date.now(), 'UTC');
}
export function isUrgent(urgency: Urgency): boolean {
    return URGENCY_ORDER[urgency.level] >= URGENCY_ORDER.urgent;
}
