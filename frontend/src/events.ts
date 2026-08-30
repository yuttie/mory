// The one place an `events:` frontmatter block becomes something a view can draw.
//
// This lived twice, inline, in `Calendar.vue` and `Home.vue` -- byte-identical apart from the
// error collection, which only the calendar kept. Two copies of a parser for a hand-written file
// format is one copy too many: a note that renders in one view and not the other is the failure
// that shape invites, and there was no way to test either copy without mounting a component.
//
// The rules the format actually has, none of which are obvious from the schema alone:
//
//   * `end` is optional, and may be a duration (`+90m`), an absolute datetime, or a bare time of
//     day that belongs to the start's date -- rolling to the next day when it would precede it.
//   * an event is a base occurrence (`start`), a list of them (`instances`, or its older spelling
//     `times`), or both; the map key names it, and the same note may declare several.
//   * a rule (`repeat`) generates occurrences, which `exclusions` removes from, `overrides`
//     changes, and `instances` adds to.
//   * anything invalid is reported and skipped, never fatal. A typo in one note must not blank
//     the calendar.
//
// Every time this emits is naive local wall clock. `<v-calendar>` parses with a regex that has no
// offset group and *throws* on a string it cannot read, so one offset-bearing datetime reaching
// `:events` would take down the whole calendar rather than lose one event.

import type { EventFields, EventOccurrence, ListEntry2, MetadataEvent } from '@/api';
import { occurrencesOf, validateEvent } from '@/api';
import { RecurrenceError, expandRule } from '@/recurrence';
import dayjs from 'dayjs';

// The colour an event falls back to when neither it nor its parent names one.
export const DEFAULT_EVENT_COLOR = '#666666';

// What the views hand to `<v-calendar>`, and what `Home.vue` filters by day.
export interface CalendarEvent {
    name: string;
    start: string;
    end?: string;
    finished?: boolean;
    color: string;
    note?: string;
    notePath: string;
}

// `[property, offending value, event name, note path, note title]` -- the shape `Calendar.vue`
// renders in its error alert, kept as a tuple so that view needs no changes.
export type EventError = [string, unknown, string, string, string | null];

/// The span a view is drawing. A rule may be open-ended, so expansion is always bounded.
export interface EventWindow {
    from: string;
    to: string;
}

export interface DerivedEvents {
    events: CalendarEvent[];
    errors: EventError[];
}

const DURATION_SHORT = /^\+([\d.]+) *(y|M|w|d|h|m|s|ms)$/;
const DURATION_LONG =
    /^\+([\d.]+) *(years?|months?|weeks?|days?|hours?|minutes?|seconds?|milliseconds?)$/i;

// Seconds are dropped when they are zero, so a hand-written `10:00` round-trips as `10:00`.
function formatDateTime(datetime: dayjs.Dayjs): string {
    if (datetime.second() === 0) {
        return datetime.format('YYYY-MM-DD HH:mm');
    }
    else {
        return datetime.format('YYYY-MM-DD HH:mm:ss');
    }
}

/// `undefined` when there is no end, `null` when the value is unusable.
export function normalizeEndTime(
    end: string | undefined,
    start: string,
): string | undefined | null {
    if (end === undefined) {
        return undefined;
    }

    const match = DURATION_SHORT.exec(end) || DURATION_LONG.exec(end);
    if (match === null) {
        // Not a duration.
        if (dayjs(end).isValid()) {
            // Already a datetime this parses; keep the author's spelling.
            return end;
        }
        else {
            // A bare time of day belongs to the start's date -- or the next one, when taking it
            // literally would put the end before the start.
            const prefixedEnd = dayjs(start).format('YYYY-MM-DD') + ' ' + end;
            const parsedEnd = dayjs(prefixedEnd);
            if (parsedEnd.isValid()) {
                if (parsedEnd.isAfter(start)) {
                    return prefixedEnd;
                }
                else {
                    return formatDateTime(parsedEnd.add(1, 'day'));
                }
            }
            else {
                return null;
            }
        }
    }
    else {
        const amount = parseFloat(match[1]);
        const unit = match[2] as dayjs.ManipulateType;
        return formatDateTime(dayjs(start).add(amount, unit));
    }
}

// One occurrence, resolved against whatever its parent event supplies.
//
// `time` and `parent` are read, never written: these objects belong to the files store's shared
// listing, and the inline versions of this code assigned the normalized end straight back into
// them.
function buildOccurrence(
    time: EventOccurrence,
    parent: EventFields,
    eventName: string,
    entry: ListEntry2,
    errors: EventError[],
): CalendarEvent | null {
    if (time.start === undefined || !dayjs(time.start).isValid()) {
        errors.push(['start', time.start, eventName, entry.path, entry.title]);
        return null;
    }

    const normalizedEnd = normalizeEndTime(time.end ?? parent.end, time.start);
    if (normalizedEnd === null) {
        errors.push(['end', time.end, eventName, entry.path, entry.title]);
        return null;
    }

    const event: CalendarEvent = {
        name: time.name || eventName,
        start: time.start,
        end: normalizedEnd,
        finished: time.finished,
        color: time.color || parent.color || DEFAULT_EVENT_COLOR,
        note: time.note || parent.note,
        notePath: entry.path,
    };
    return validateEvent(event) ? event : null;
}

/// The instant a wall-clock or offset-bearing datetime names, for comparing two spellings of it.
///
/// `2020-01-30 10:00:00-08:00` and `2020-01-30 10:00` are the same moment written two ways, and the
/// importer will not spell an exclusion the way a hand-edited note does. Comparing the strings
/// would report a mismatch that is not there.
function instantOf(value: string): number | null {
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed.valueOf() : null;
}

// How long an occurrence lasts, carried from the base event to the ones a rule generates.
//
// A duration is reapplied per occurrence; an absolute end is turned into the gap it describes, so
// a series does not inherit the first occurrence's literal end date.
function durationOf(detail: MetadataEvent): string | undefined {
    if (detail.end === undefined || detail.start === undefined) {
        return detail.end;
    }
    if (detail.end.startsWith('+')) {
        return detail.end;
    }
    const start = instantOf(detail.start);
    const end = instantOf(detail.end);
    if (start === null || end === null || end < start) {
        return detail.end;
    }
    return `+${end - start}ms`;
}

function expandSeries(
    eventName: string,
    detail: MetadataEvent,
    entry: ListEntry2,
    window: EventWindow,
    into: CalendarEvent[],
    errors: EventError[],
): void {
    const start = detail.start as string;
    const repeat = detail.repeat!;

    let generated: string[];
    try {
        generated = expandRule(repeat, start, window.from, window.to);
    }
    catch (error) {
        if (error instanceof RecurrenceError) {
            errors.push(['repeat', error.message, eventName, entry.path, entry.title]);
            return;
        }
        throw error;
    }

    // Both sides are keyed by instant, so an adjustment may be written with or without an offset
    // and still find the occurrence it names.
    const excluded = new Map<number, string>();
    for (const exclusion of detail.exclusions ?? []) {
        const instant = instantOf(exclusion);
        if (instant === null) {
            errors.push(['exclusions', exclusion, eventName, entry.path, entry.title]);
            continue;
        }
        excluded.set(instant, exclusion);
    }

    const overrides = new Map<number, EventOccurrence>();
    for (const override of detail.overrides ?? []) {
        const instant = override.at === undefined ? null : instantOf(override.at);
        if (instant === null) {
            errors.push(['at', override.at, eventName, entry.path, entry.title]);
            continue;
        }
        overrides.set(instant, override);
    }

    const matched = new Set<number>();
    const parent: EventFields = { ...detail, end: durationOf(detail) };
    for (const occurrence of generated) {
        const instant = instantOf(occurrence);
        if (instant === null) {
            continue;
        }
        if (excluded.has(instant)) {
            matched.add(instant);
            continue;
        }
        const override = overrides.get(instant);
        if (override !== undefined) {
            matched.add(instant);
        }
        const event = buildOccurrence(
            { ...override, at: undefined, start: occurrence },
            parent,
            eventName,
            entry,
            errors,
        );
        if (event !== null) {
            into.push(event);
        }
    }

    // An adjustment landing on no occurrence is almost always a mistyped date, and doing nothing
    // silently is how that survives. Only reported for adjustments inside the window: outside it
    // there is nothing to match by construction.
    const from = instantOf(window.from);
    const to = instantOf(window.to);
    if (from === null || to === null) {
        return;
    }
    const reportUnmatched = (instant: number, property: string, spelling: string) => {
        if (!matched.has(instant) && instant >= from && instant <= to) {
            errors.push([property, spelling, eventName, entry.path, entry.title]);
        }
    };
    for (const [instant, spelling] of excluded) {
        reportUnmatched(instant, 'exclusions', spelling);
    }
    for (const [instant, override] of overrides) {
        reportUnmatched(instant, 'at', override.at as string);
    }
}

function eventsOfEntry(
    eventName: string,
    detail: MetadataEvent,
    entry: ListEntry2,
    window: EventWindow,
    into: CalendarEvent[],
    errors: EventError[],
): void {
    const push = (occurrence: EventOccurrence, parent: EventFields) => {
        const event = buildOccurrence(occurrence, parent, eventName, entry, errors);
        if (event !== null) {
            into.push(event);
        }
    };

    // A base occurrence and a list of occurrences are no longer alternatives: a rule is anchored at
    // `start` and may still list occurrences it does not generate. An event that has only a list
    // contributes nothing here, which is what makes the two shapes compose rather than conflict.
    const occurrences = occurrencesOf(detail);
    if (detail.start === undefined && occurrences.length === 0) {
        // Names no occurrence at all, which the schema rejects too. Reported rather than dropped:
        // silently ignoring it is how a typo becomes an event that is simply missing.
        errors.push(['start', detail.start, eventName, entry.path, entry.title]);
        return;
    }
    if (detail.start !== undefined) {
        if (detail.repeat !== undefined) {
            expandSeries(eventName, detail, entry, window, into, errors);
        }
        else {
            push(detail, {});
        }
    }
    for (const occurrence of occurrences) {
        push(occurrence, detail);
    }
}

/// Every event declared by every entry in the listing, expanded over `window`.
export function eventsFromEntries(
    entries: readonly ListEntry2[],
    window: EventWindow,
): DerivedEvents {
    const events: CalendarEvent[] = [];
    const errors: EventError[] = [];

    for (const entry of entries) {
        const metadata = entry.metadata;
        if (metadata === null) {
            continue;
        }
        if (!Object.hasOwn(metadata, 'events')) {
            continue;
        }
        const declared = metadata.events;
        if (typeof declared !== 'object' || declared === null) {
            continue;
        }

        for (const [eventName, detail] of Object.entries(declared)) {
            if (typeof detail === 'object' && detail !== null) {
                eventsOfEntry(eventName, detail, entry, window, events, errors);
            }
        }
    }

    return { events, errors };
}
