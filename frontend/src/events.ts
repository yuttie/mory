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

import type {
    EventFields,
    EventIcal,
    EventOccurrence,
    ImportedOccurrence,
    ListEntry2,
    MetadataEvent,
} from '@/api';
import { occurrencesOf, validateEvent } from '@/api';
import { RecurrenceError, expandRule, parseWallClock } from '@/recurrence';
import dayjs from 'dayjs';

// The colour an event falls back to when neither it nor its parent names one.
export const DEFAULT_EVENT_COLOR = '#666666';

// What the views hand to `<v-calendar>`, and what `Home.vue` filters by day.
//
// Note that `timed` is not a field here on purpose: v-calendar reads a property of that name off
// the object it is given, and would take one of ours as an instruction.
export interface CalendarEvent {
    name: string;
    start: string;
    end?: string;
    finished?: boolean;
    color: string;
    note?: string;
    location?: string;
    url?: string;
    /// Where the event came from. An imported one has no note behind it and cannot be edited.
    source: 'note' | 'ical';
    /// The note that declares it; absent for an imported event, which is what the popup keys on.
    notePath?: string;
    /// Identity, for an imported event and for a note that claims one.
    calendar?: string;
    uid?: string;
    recurrenceId?: string;
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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/// Whether a value names a whole day rather than a moment. The shape *is* the all-day flag, in the
/// feed and in the note alike, so it has to survive every transformation.
function isDateOnly(value: string): boolean {
    return DATE_ONLY.test(value.trim());
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
        const end = dayjs(start).add(amount, unit);
        // A whole-day event stays whole days: giving its end a midnight would make the same data
        // render all-day on its own and timed once a rule expands it.
        return isDateOnly(start) ? end.format('YYYY-MM-DD') : formatDateTime(end);
    }
}

// One occurrence, resolved against whatever its parent event supplies.
//
// `time` and `parent` are read, never written: these objects belong to the files store's shared
// listing, and the inline versions of this code assigned the normalized end straight back into
// them.
// `parent` carries `ical` as well as the display fields, because the claim on an imported event
// belongs to the event as a whole rather than to any one of its occurrences.
type EventParent = EventFields & { ical?: EventIcal };

function buildOccurrence(
    time: EventOccurrence,
    parent: EventParent,
    eventName: string,
    entry: ListEntry2,
    errors: EventError[],
): CalendarEvent | null {
    // `typeof` first: `dayjs(20240501)` is a valid epoch, so a YAML integer would pass the
    // validity check and then fail as a string later, inside the view.
    if (typeof time.start !== 'string' || !dayjs(time.start).isValid()) {
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
        start: toWallClock(time.start),
        end: normalizedEnd === undefined ? undefined : toWallClock(normalizedEnd),
        finished: time.finished,
        color: time.color || parent.color || DEFAULT_EVENT_COLOR,
        note: time.note || parent.note,
        location: time.location || parent.location,
        url: time.url || parent.url,
        source: 'note',
        notePath: entry.path,
        ...(parent.ical === undefined
            ? {}
            : {
                calendar: parent.ical.calendar,
                uid: parent.ical.uid,
                recurrenceId: parent.ical.recurrence_id,
            }),
    };
    return validateEvent(event) ? event : null;
}

/// The instant a wall-clock or offset-bearing datetime names, for comparing two spellings of it.
///
/// `2020-01-30 10:00:00-08:00` and `2020-01-30 10:00` are the same moment written two ways, and the
/// importer will not spell an exclusion the way a hand-edited note does. Comparing the strings
/// would report a mismatch that is not there.
/// A list from whatever the frontmatter held, which need not have been a list.
function asArray<T>(value: T[] | undefined): T[] {
    return Array.isArray(value) ? value : [];
}

function instantOf(value: unknown): number | null {
    if (typeof value !== 'string') {
        return null;
    }
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
    if (typeof detail.end !== 'string' || detail.end.startsWith('+')) {
        return detail.end;
    }
    const start = instantOf(detail.start);
    const end = instantOf(detail.end);
    if (start === null || end === null || end < start) {
        return detail.end;
    }
    // A whole number of days for an all-day series, so its occurrences stay dates. Milliseconds
    // would give each one a midnight -- turning the same data all-day without a rule and timed
    // with one -- and would drift by an hour across a daylight-saving change.
    if (isDateOnly(detail.start)) {
        return `+${Math.round((end - start) / 86_400_000)}d`;
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
    for (const exclusion of asArray(detail.exclusions)) {
        const instant = instantOf(exclusion);
        if (instant === null) {
            errors.push(['exclusions', exclusion, eventName, entry.path, entry.title]);
            continue;
        }
        excluded.set(instant, exclusion);
    }

    const overrides = new Map<number, EventOccurrence>();
    for (const override of asArray(detail.overrides)) {
        const instant = override.at === undefined ? null : instantOf(override.at);
        if (instant === null) {
            errors.push(['at', override.at, eventName, entry.path, entry.title]);
            continue;
        }
        overrides.set(instant, override);
    }

    const matched = new Set<number>();
    const parent: EventParent = { ...detail, end: durationOf(detail) };
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
            // An override may move its occurrence, and its own `start` is the whole point when it
            // does; `occurrence` is only the fallback for one that changes other fields.
            { ...override, at: undefined, start: override?.start ?? occurrence },
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
    const push = (occurrence: EventOccurrence, parent: EventParent) => {
        const event = buildOccurrence(occurrence, parent, eventName, entry, errors);
        if (event !== null) {
            into.push(event);
        }
    };

    // A base occurrence and a list of occurrences are no longer alternatives: a rule is anchored at
    // `start` and may still list occurrences it does not generate. An event that has only a list
    // contributes nothing here, which is what makes the two shapes compose rather than conflict.
    const occurrences = occurrencesOf(detail).filter(
        (occurrence) => typeof occurrence === 'object' && occurrence !== null);
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
            push(detail, { ical: detail.ical });
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

/// A datetime with any offset removed, which is the only form `<v-calendar>` can read.
///
/// Vuetify parses with a regex that has no offset group and *throws* on a string it cannot match,
/// so one offset-bearing value reaching `:events` takes down the whole calendar rather than losing
/// one event. Notes are written with offsets, following the task convention, and the backend emits
/// them too -- so everything crossing into the view goes through here.
export function toWallClock(value: unknown): string {
    const parsed = parseWallClock(value);
    if (parsed === null) {
        // Whatever it was, hand it on as text: the error path reports it, and nothing that reaches
        // the calendar may throw. A `null` from the wire would otherwise take the whole view down.
        return typeof value === 'string' ? value : String(value ?? '');
    }
    const text = value as string;
    const p = (n: number) => String(n).padStart(2, '0');
    const date = `${parsed.year}-${p(parsed.month)}-${p(parsed.day)}`;
    if (!parsed.hasTime) {
        return date;
    }
    // An offset means the value names an instant, so it is shown in the reader's own zone; a bare
    // wall clock is already local and is left exactly as written.
    if (HAS_OFFSET.test(text)) {
        const local = dayjs(text);
        if (local.isValid()) {
            return local.second() === 0
                ? local.format('YYYY-MM-DD HH:mm')
                : local.format('YYYY-MM-DD HH:mm:ss');
        }
    }
    const time = `${p(parsed.hour)}:${p(parsed.minute)}`;
    return parsed.second === 0 ? `${date} ${time}` : `${date} ${time}:${p(parsed.second)}`;
}

const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/;

/// The key a note uses to claim an imported occurrence.
///
/// Scoped to the calendar as well as the uid: a uid is only unique *within* a calendar, and a
/// shared invite genuinely carries the same one in two subscriptions. Keying on the uid alone let
/// a note converted from a work calendar hide the same meeting in a family one, with no note
/// behind it and no way to get it back short of unsubscribing.
function seriesKey(calendar: string | undefined, uid: string): string {
    return `${calendar ?? ''}\u0000${uid}`;
}

function occurrenceKey(calendar: string | undefined, uid: string, recurrenceId: string): string {
    return `${seriesKey(calendar, uid)}@${instantOf(recurrenceId) ?? recurrenceId}`;
}

/// Note events, plus the imported ones no note has claimed.
///
/// A note carrying `ical.uid` shadows the whole series; one that also carries `recurrence_id`
/// shadows only that occurrence and leaves the rest imported. Both are compared by instant, since
/// the note and the feed need not spell the same moment the same way.
export function mergeImported(
    noteEvents: readonly CalendarEvent[],
    imported: readonly ImportedOccurrence[],
    options: { colorOf?: Map<string, string> } = {},
): CalendarEvent[] {
    const wholeSeries = new Set<string>();
    const occurrences = new Set<string>();
    for (const event of noteEvents) {
        if (event.uid === undefined) {
            continue;
        }
        if (event.recurrenceId === undefined) {
            wholeSeries.add(seriesKey(event.calendar, event.uid));
        }
        else {
            occurrences.add(occurrenceKey(event.calendar, event.uid, event.recurrenceId));
        }
    }

    const merged = [...noteEvents];
    for (const occurrence of imported) {
        if (wholeSeries.has(seriesKey(occurrence.calendar, occurrence.uid))) {
            continue;
        }
        if (occurrences.has(
            occurrenceKey(occurrence.calendar, occurrence.uid, occurrence.recurrence_id))) {
            continue;
        }
        // `== null` catches an explicit null as well as an absent field: the wire has carried both,
        // and a null reaching `toWallClock` used to throw out of the calendar's derivation.
        merged.push({
            name: occurrence.name,
            start: toWallClock(occurrence.start),
            end: occurrence.end == null ? undefined : toWallClock(occurrence.end),
            color: options.colorOf?.get(occurrence.calendar) ?? DEFAULT_IMPORTED_COLOR,
            note: occurrence.note ?? undefined,
            location: occurrence.location ?? undefined,
            url: occurrence.url ?? undefined,
            source: 'ical',
            calendar: occurrence.calendar,
            uid: occurrence.uid,
            recurrenceId: occurrence.recurrence_id,
        });
    }
    return merged;
}

/// The colour an imported event falls back to when its calendar names none.
export const DEFAULT_IMPORTED_COLOR = '#8d99ae';
