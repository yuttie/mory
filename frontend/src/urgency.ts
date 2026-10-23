import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

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

// One formatter a zone, kept. dayjs's `tz()` formats through `toLocaleString`, which builds a
// formatter on every call: 15-23 µs each in Firefox and Chromium, against 1.5 µs to format with
// one kept, and the Tasks tab of the Files view converted over a thousand dates at each opening.
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(zone: string): Intl.DateTimeFormat {
    let formatter = zoneFormatters.get(zone);
    if (formatter === undefined) {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: zone,
            era: 'short',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
            hourCycle: 'h23',
        });
        zoneFormatters.set(zone, formatter);
    }
    return formatter;
}

// The zone's wall clock at an instant, as the milliseconds since the epoch that clock reads in UTC.
function wallClockOf(instant: number, zone: string): number {
    // Past the instants a `Date` holds, the formatter throws, and this runs inside computeds.
    if (!(Math.abs(instant) <= 8.64e15)) {
        return NaN;
    }
    const fields: Record<string, number> = {};
    let bc = false;
    for (const part of zoneFormatter(zone).formatToParts(instant)) {
        if (part.type === 'era') {
            bc = part.value.startsWith('B');
        }
        else if (part.type !== 'literal') {
            fields[part.type] = Number(part.value);
        }
    }
    // `setUTCFullYear` rather than `Date.UTC`, which reads the years 0-99 as 1900-1999.
    const clock = new Date(0);
    clock.setUTCFullYear(bc ? 1 - fields.year : fields.year, fields.month - 1, fields.day);
    clock.setUTCHours(fields.hour, fields.minute, fields.second, ((instant % 1000) + 1000) % 1000);
    return clock.valueOf();
}

// How far the zone's wall clock is ahead of UTC at an instant, in milliseconds.
function zoneOffset(instant: number, zone: string): number {
    return wallClockOf(instant, zone) - instant;
}

// Date-only limits last through their local day; availability starts at midnight.
export function localInstant(wall: string, zone: string): number {
    return instantOfWallClock(dayjs.utc(wall).valueOf(), zone);
}

// The instant a wall clock, given as `wallClockOf` gives it, reads in the zone.
function instantOfWallClock(local: number, zone: string): number {
    const offsets = [...new Set([-2, 0, 2].map((days) => zoneOffset(local + days * DAY, zone)))];
    const matches = offsets.map((offset) => local - offset).filter((instant) => wallClockOf(instant, zone) === local);
    // Pick the first repeated clock time; a missing time moves forward by the gap.
    return matches.length > 0 ? Math.min(...matches) : local - zoneOffset(local - DAY, zone);
}

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
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]{1,3})?)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(text)) {
        return undefined;
    }
    const clock = text.slice(11).match(/^([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?/);
    if (!clock || Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3] ?? 0) > 59) {
        return undefined;
    }
    const instant = Date.parse(text.replace(' ', 'T'));
    const date = text.slice(0, 10);
    const canonical = new Date(`${date}T00:00:00Z`);
    return Number.isFinite(instant) && Number.isFinite(canonical.valueOf()) && canonical.toISOString().slice(0, 10) === date ? instant : undefined;
}

export function urgencyOf(task: UrgencyTask, tags: readonly string[] = [], settings: TaskSettings = {}, now = Date.now(), zone = dayjs.tz.guess()): Urgency {
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
    return [...values].sort(compareUrgency)[0] ?? urgencyOf({});
}
export function isUrgent(urgency: Urgency): boolean {
    return URGENCY_ORDER[urgency.level] >= URGENCY_ORDER.urgent;
}
