// How long a task takes to work on, as `task.estimate` writes it, and the planning settings
// `.mory/tasks.yaml` holds beside the lead times. A lead time is how far ahead of its date a task
// wants starting, in days on the calendar; an estimate is the work itself, in hours and minutes,
// and is what a planned day is filled with. `backend/src/estimate.rs` reads an estimate the same
// way for the MCP tools, held to this by `fixtures/urgency/estimates.json`.

/// The minutes an estimate names: hours, minutes, or both (`3h`, `90m`, `1h 30m`). `undefined` for
/// anything else, a number included: YAML reads `90` as one, and it would not say which unit.
export function estimateMinutes(value: unknown): number | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const match = /^(?:([0-9]+) *h)? *(?:([0-9]+) *m)?$/.exec(value.trim());
    if (!match || (match[1] === undefined && match[2] === undefined)) {
        return undefined;
    }
    const minutes = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
    return Number.isSafeInteger(minutes) ? minutes : undefined;
}

/// Minutes as an estimate is written, for a field to show and a save to write: `90` is `1h 30m`.
export function formatEstimate(minutes: number): string {
    const whole = Math.max(0, Math.round(minutes));
    const hours = Math.floor(whole / 60);
    const rest = whole % 60;
    if (hours === 0) {
        return `${rest}m`;
    }
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/// The hours of a day that work is planned into, as minutes from midnight.
export interface WorkHours {
    start: number;
    end: number;
}

export const DEFAULT_ESTIMATE_MINUTES = 60;
export const DEFAULT_WORK_HOURS: WorkHours = { start: 9 * 60, end: 18 * 60 };

export interface PlanningSettings {
    default_estimate?: string;
    estimate_by_tag?: Record<string, string>;
    work_hours?: WorkHours;
}

/// `09:00-18:00` as the span it names, or `undefined`: both ends on the clock and the end after
/// the start, `24:00` allowed for a day worked to its end.
export function readWorkHours(value: unknown): WorkHours | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const match = /^([0-9]{1,2}):([0-9]{2}) *- *([0-9]{1,2}):([0-9]{2})$/.exec(value.trim());
    if (!match) {
        return undefined;
    }
    const [startHour, startMinute, endHour, endMinute] = match.slice(1).map(Number);
    const start = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;
    if (startMinute > 59 || endMinute > 59 || end > 24 * 60 || start >= end) {
        return undefined;
    }
    return { start, end };
}

/// The planning settings among the task settings, and what is wrong with them. Only the web app
/// reads these: moried plans nothing by the clock, so there is no twin of this in Rust.
export function readPlanningSettings(value: unknown): { settings: PlanningSettings; problems: string[] } {
    const settings: PlanningSettings = {};
    const problems: string[] = [];
    // Not a mapping, or the older model's task data: `readTaskSettings` says so, once.
    if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value) || 'tasks' in value) {
        return { settings, problems };
    }
    const root = value as Record<string, unknown>;
    if (root.default_estimate !== undefined) {
        if (estimateMinutes(root.default_estimate) !== undefined) {
            settings.default_estimate = root.default_estimate as string;
        }
        else {
            problems.push('Invalid default_estimate; use hours and minutes, such as 1h, 30m or 1h 30m.');
        }
    }
    if (root.estimate_by_tag !== undefined) {
        if (typeof root.estimate_by_tag !== 'object' || root.estimate_by_tag === null || Array.isArray(root.estimate_by_tag)) {
            problems.push('estimate_by_tag must be a mapping.');
        }
        else {
            settings.estimate_by_tag = {};
            for (const [tag, estimate] of Object.entries(root.estimate_by_tag)) {
                if (estimateMinutes(estimate) !== undefined) {
                    settings.estimate_by_tag[tag] = estimate as string;
                }
                else {
                    problems.push(`Invalid estimate for tag ${tag}.`);
                }
            }
        }
    }
    if (root.work_hours !== undefined) {
        const hours = readWorkHours(root.work_hours);
        if (hours !== undefined) {
            settings.work_hours = hours;
        }
        else {
            problems.push('Invalid work_hours; use a span of the day, such as 09:00-18:00.');
        }
    }
    return { settings, problems };
}

export interface ResolvedEstimate {
    minutes: number;
    /// Whether the task gives none of its own, so that the minutes are a default's: drawn apart,
    /// since a day filled with them is only as full as the defaults are right.
    assumed: boolean;
}

/// A task's estimate: its own, else the longest set for one of its tags, else the default, else an
/// hour -- the order a lead time is resolved in. Never nothing: a task that took no room could be
/// planned without end on a day already full.
export function resolvedEstimate(estimate: unknown, tags: readonly unknown[], settings: PlanningSettings = {}): ResolvedEstimate {
    const own = estimateMinutes(estimate);
    if (own !== undefined) {
        return { minutes: own, assumed: false };
    }
    const tagged = (Array.isArray(tags) ? tags : [])
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => estimateMinutes(settings.estimate_by_tag?.[tag]))
        .filter((minutes): minutes is number => minutes !== undefined);
    const minutes = tagged.length > 0 ? Math.max(...tagged) : estimateMinutes(settings.default_estimate) ?? DEFAULT_ESTIMATE_MINUTES;
    return { minutes, assumed: true };
}
