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
import type { AlarmDefaults, EffectiveAlarmDefaults } from '@/alarms';
import {
    alarmValueProblems,
    readAlarmList,
    readAlarmsIfSet,
    TASK_DATE_ALARM_DEFAULT,
    taskAlarmOf,
    withBuiltInAlarms,
} from '@/alarms';
import { RecurrenceError, expandRule, parseWallClock } from '@/recurrence';
import { taskUuidOf } from '@/task-forest';
import dayjs from 'dayjs';

// The colour an event falls back to when neither it nor its parent names one.
export const DEFAULT_EVENT_COLOR = '#666666';

/// What a category, configured under `categories:` in `.mory/calendars.yaml`, supplies to the
/// events that name it: a default for the same keys an event has.
///
/// How an event is drawn, and when it rings; never when or where it happens -- those stay in the
/// note, which has to say everything about its events on its own.
export interface EventCategory {
    color?: string;
    /// A template for the drawn name, in which `{{name}}` stands for the event's own.
    name?: string;
    /// When its events ring, where the event itself says nothing: alarms as `alarms.ts` reads them.
    /// An empty list is a setting, and silences them.
    ///
    /// Not how the event is drawn, nor when or where it happens: it matters to moried, which rings
    /// them, and to the popup, which says so.
    alarms?: string[];
}

/// The configured categories by id.
export type EventCategories = ReadonlyMap<string, EventCategory>;

/// An event category as configured under `categories:`: its id, and the defaults it supplies.
///
/// Kept as a list rather than a map so the settings show them in the order the file has them.
export interface ConfiguredCategory extends EventCategory {
    id: string;
}

/// The `categories:` block of the calendar configuration, which is hand-written, as a list in the
/// file's order. A category with nothing after its id is one that sets nothing of its own
/// and inherits it all, so it is kept; one that is not a mapping at all is dropped, and the notes
/// naming it are then reported rather than drawn with half a category. `backend/src/alarms.rs`
/// reads the same rule for the alarms a category sets.
///
/// Each entry dropped from an `alarms:` list is said in `problems`, if given, as
/// `categories.<id>.alarms: <what is wrong>`.
export function readCategories(value: unknown, problems?: string[]): ConfiguredCategory[] {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return [];
    }
    const categories: ConfiguredCategory[] = [];
    for (const [id, entry] of Object.entries(value)) {
        if (entry === null) {
            categories.push({ id });
            continue;
        }
        if (typeof entry !== 'object' || Array.isArray(entry)) {
            continue;
        }
        const category: ConfiguredCategory = { id };
        for (const field of ['color', 'name'] as const) {
            const text = (entry as Record<string, unknown>)[field];
            if (typeof text === 'string' && text.trim() !== '') {
                category[field] = text.trim();
            }
        }
        // Set, even to nothing: an empty list silences the category's events, where an empty
        // `alarms:` leaves them to the configuration's.
        const written = (entry as Record<string, unknown>).alarms;
        problems?.push(...alarmValueProblems(written).map((problem) => `categories.${id}.alarms: ${problem}`));
        const alarms = readAlarmsIfSet(written);
        if (alarms !== undefined) {
            category.alarms = alarms;
        }
        categories.push(category);
    }
    return categories;
}

/// The categories by id, as the event derivation takes them.
export function categoryMapOf(categories: readonly ConfiguredCategory[]): EventCategories {
    return new Map(categories.map(({ id, ...defaults }) => [id, defaults]));
}

/// The name an event is drawn with, given its category's template.
///
/// `{{name}}` is the notation `.mory/ai-actions.toml` already uses for `{{input}}`, with the same
/// tolerance for inner whitespace and case, so mory has one way to write a placeholder rather than
/// two. Any other placeholder is left as written, which shows a misspelt one on the calendar.
export function applyNameTemplate(template: string | undefined, name: string): string {
    if (template === undefined) {
        return name;
    }
    // A function rather than `name` itself: a `$&` in an event's name would otherwise be read as
    // a replacement pattern.
    return template.replace(/\{\{\s*name\s*\}\}/gi, () => name);
}

/// A category id and its ancestors, nearest first: `a/b/c`, `a/b`, `a`.
///
/// Categories nest by path, as notes and tags do, so a finer kind of event is written as a child of
/// the kind it belongs to and falls back on what that one says.
export function categoryLineage(id: string): string[] {
    const lineage = [id];
    for (let slash = id.lastIndexOf('/'); slash > 0; slash = id.lastIndexOf('/', slash - 1)) {
        lineage.push(id.slice(0, slash));
    }
    return lineage;
}

/// Whether an event is in a hidden category, or in one nested under a hidden category.
export function isInHiddenCategory(
    categoryId: string | undefined,
    hidden: ReadonlySet<string> | undefined,
): boolean {
    if (categoryId === undefined || hidden === undefined || hidden.size === 0) {
        return false;
    }
    return categoryLineage(categoryId).some((id) => hidden.has(id));
}

/// The defaults the category `id` supplies, or `null` when no category of that id is configured.
///
/// Each field comes from the nearest of the id and its ancestors that sets it, so `meeting/1on1`
/// can change the colour and keep `meeting`'s template. The id itself must be configured, even with
/// nothing of its own: were an ancestor enough, `meeting/1no1` would quietly draw as a meeting and
/// the typo would never be reported. Ancestors need not be.
export function resolveCategory(id: string, categories: EventCategories): EventCategory | null {
    if (!categories.has(id)) {
        return null;
    }
    const resolved: EventCategory = {};
    for (const ancestor of categoryLineage(id)) {
        const category = categories.get(ancestor);
        resolved.color ??= category?.color;
        resolved.name ??= category?.name;
        resolved.alarms ??= category?.alarms;
    }
    return resolved;
}

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
    /// Where the event came from. An imported one has no note behind it and cannot be edited; a
    /// task deadline has one, but belongs to the task view rather than to the note.
    source: 'note' | 'ical' | 'task';
    /// The note that declares it; absent for an imported event, which is what the popup keys on.
    notePath?: string;
    /// The task whose date this is, for `source: 'task'` alone.
    taskId?: string;
    /// Which of the task's dates it is, for `source: 'task'` alone.
    taskDate?: TaskDate;
    /// Identity, for an imported event and for a note that claims one.
    calendar?: string;
    uid?: string;
    recurrenceId?: string;
    /// The category the note names, configured or not. Not `category`, for the reason `timed` is
    /// absent: v-calendar reads a property of that name in its category mode.
    categoryId?: string;
    /// What it rings at, as `backend/src/alarms.rs` resolves it: the occurrence's own list, then the
    /// event's, then its category's, then the configuration's, then the built-in. Alarms as written,
    /// the ones that are not alarms left out. Never set for an imported event, which has none of
    /// its own to ring.
    alarms?: string[];
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

/// The moment an event is over, which is when a view starts drawing it as past.
///
/// An event with no end lasts until the end of the day it starts on.
export function eventEndsAt(event: { start: string; end?: string }): dayjs.Dayjs {
    if (event.end !== undefined) {
        // `end` is inclusive -- `ical.rs` pulls a feed's exclusive DTEND back a day to make it so --
        // and a date names the whole of that day. Parsed as it stands it is the day's first moment,
        // and every event ending on a date was drawn as over from midnight on its own last day.
        return isDateOnly(event.end) ? dayjs(event.end).endOf('day') : dayjs(event.end);
    }
    else {
        return dayjs(event.start).endOf('day');
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

// What an event's `category:` came to: the id it names, and the defaults behind it -- absent when
// that id is not configured, so the event is drawn plainly rather than lost.
//
// Passed beside `parent` rather than on it: the base occurrence's parent carries only `ical`.
interface EventCategoryRef {
    id: string;
    defaults?: EventCategory;
}

// How `<v-calendar>` reads a start `toWallClock` hands it: `parseTimestamp`'s `PARSE_REGEX`, and it
// is timed only with both an hour and a minute. Seconds are ignored, a missing day is the first, and
// a start it does not match is not drawn at all -- so one that matches nothing is never all-day here.
const CALENDAR_PARSE = /^(\d{4})-(\d{1,2})(-(\d{1,2}))?([^\d]+(\d{1,2}))?(:(\d{1,2}))?(:(\d{1,2}))?$/;

/// Whether the calendar draws a start as a whole day, which is what decides the alarms an event
/// rings at when nothing sets them.
export function isAllDay(start: string): boolean {
    const parts = CALENDAR_PARSE.exec(start);
    return parts !== null && !(parts[6] && parts[8]);
}

// What an occurrence rings at, by the first of these that is set: its own `alarms` or its event's
// (`own`, which has already been through `??`), its category's, the configuration's for a timed or
// an all-day one, which is the built-in default where the file sets none. `[]` is a setting and
// silences; `null` is not one.
function resolveAlarms(
    own: unknown,
    category: EventCategoryRef | undefined,
    start: string,
    defaults: EffectiveAlarmDefaults,
): string[] {
    return readAlarmsIfSet(own)
        ?? category?.defaults?.alarms
        ?? (isAllDay(start) ? defaults.allDay : defaults.timed);
}

// Every entry of an `alarms:` value that is not an alarm, reported where it is written: once for the
// event, an override or an instance, and not again for each occurrence that inherits it.
function checkAlarms(
    value: unknown,
    eventName: string,
    entry: ListEntry2,
    errors: EventError[],
): void {
    if (value === undefined || value === null) {
        return;
    }
    for (const invalid of readAlarmList(value).invalid) {
        errors.push(['alarms', invalid, eventName, entry.path, entry.title]);
    }
}

// What a derivation carries from one note to the next: the window it draws, what alarms are
// resolved against, and where the events and the errors it finds go. They travel together through
// every function below, which is why they are one value.
interface Derivation {
    window: EventWindow;
    alarmDefaults: EffectiveAlarmDefaults;
    into: CalendarEvent[];
    errors: EventError[];
}

function derivationOf(window: EventWindow, alarmDefaults: AlarmDefaults | undefined): Derivation {
    return { window, alarmDefaults: withBuiltInAlarms(alarmDefaults), into: [], errors: [] };
}

function buildOccurrence(
    time: EventOccurrence,
    parent: EventParent,
    category: EventCategoryRef | undefined,
    eventName: string,
    entry: ListEntry2,
    { errors, alarmDefaults }: Derivation,
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

    // The template wraps the name as resolved, so a renamed occurrence keeps its category's prefix.
    // A non-string name is handed on untouched, for `validateEvent` to refuse as before.
    const name = time.name || eventName;
    const start = toWallClock(time.start);
    const event: CalendarEvent = {
        name: typeof name === 'string' ? applyNameTemplate(category?.defaults?.name, name) : name,
        start,
        end: normalizedEnd === undefined ? undefined : toWallClock(normalizedEnd),
        finished: time.finished,
        color: time.color || parent.color || category?.defaults?.color || DEFAULT_EVENT_COLOR,
        note: time.note || parent.note,
        location: time.location || parent.location,
        url: time.url || parent.url,
        source: 'note',
        notePath: entry.path,
        // Only a mapping is provenance: `ical:` with nothing after it is null, and read as one
        // that threw inside the computed.
        ...(typeof parent.ical !== 'object' || parent.ical === null || Array.isArray(parent.ical)
            ? {}
            : {
                calendar: parent.ical.calendar,
                uid: parent.ical.uid,
                recurrenceId: parent.ical.recurrence_id,
            }),
        ...(category === undefined ? {} : { categoryId: category.id }),
        alarms: resolveAlarms(time.alarms ?? parent.alarms, category, start, alarmDefaults),
    };
    return validateEvent(event) ? event : null;
}

/// A list from whatever the frontmatter held, which need not have been a list.
function isMapping(value: unknown): value is EventOccurrence {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray<T>(value: T[] | undefined): T[] {
    return Array.isArray(value) ? value : [];
}

/// The instant a wall-clock or offset-bearing datetime names, for comparing two spellings of it.
///
/// `2020-01-30 10:00:00-08:00` and `2020-01-30 10:00` are the same moment written two ways, and the
/// importer will not spell an exclusion the way a hand-edited note does. Comparing the strings
/// would report a mismatch that is not there.
function instantOf(value: unknown): number | null {
    if (typeof value !== 'string') {
        return null;
    }
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed.valueOf() : null;
}

/// The first and last instants of a window, in the reader's zone. A bare date as `to` is that
/// whole day: its midnight would leave out the window's last day.
function boundsOf(window: EventWindow): [number, number] | null {
    const from = instantOf(window.from);
    const to = typeof window.to === 'string' && isDateOnly(window.to)
        ? dayjs(window.to).endOf('day').valueOf()
        : instantOf(window.to);
    return from === null || to === null ? null : [from, to];
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
    category: EventCategoryRef | undefined,
    entry: ListEntry2,
    derivation: Derivation,
): void {
    const { window, into, errors } = derivation;
    const start = detail.start as string;
    const repeat = detail.repeat!;

    // The rule's own mistakes are reported under `repeat` wherever an expansion meets them, and not
    // only the first: an unknown `tz` fails only once there is an occurrence to convert, so a window
    // holding none reads the rule without complaint.
    const expand = (from: string, to: string): string[] | null => {
        try {
            return expandRule(repeat, start, from, to);
        }
        catch (error) {
            if (error instanceof RecurrenceError) {
                errors.push(['repeat', error.message, eventName, entry.path, entry.title]);
                return null;
            }
            throw error;
        }
    };

    const bounds = boundsOf(window);
    if (bounds === null) {
        return;
    }
    const [from, to] = bounds;

    // `expandRule` reads its window as wall clock in the rule's own zone, which is not the reader's
    // when `tz` names another: Los Angeles's 17:00 on the 27th is Tokyo's 09:00 on the 28th, and
    // was lost from a Tokyo window starting on the 28th. So the rule is expanded over two days more
    // either side -- further than any two zones are apart -- and which occurrences the window
    // holds is decided by instant, below.
    const generated = expand(
        dayjs(from).subtract(2, 'day').format('YYYY-MM-DD'),
        dayjs(to).add(2, 'day').format('YYYY-MM-DD'),
    );
    if (generated === null) {
        return;
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
    for (const override of asArray<unknown>(detail.overrides)) {
        // Hand-written, and read inside a computed: an element that is not a mapping is reported
        // and skipped, where dereferencing it would blank the calendar. The backend skips it too.
        if (!isMapping(override)) {
            errors.push(['overrides', override, eventName, entry.path, entry.title]);
            continue;
        }
        checkAlarms(override.alarms, eventName, entry, errors);
        const instant = override.at === undefined ? null : instantOf(override.at);
        if (instant === null) {
            errors.push(['at', override.at, eventName, entry.path, entry.title]);
            continue;
        }
        overrides.set(instant, override);
    }

    // Where each occurrence in the window was generated, keyed by instant.
    const slots = new Map<number, string>();
    for (const occurrence of generated) {
        const instant = instantOf(occurrence);
        if (instant !== null && instant >= from && instant <= to) {
            slots.set(instant, occurrence);
        }
    }

    // The rule is expanded by where each occurrence was generated, so one an override moved into
    // the window from outside it is not among them and is looked for here. `expand_series` in
    // `backend/src/ical.rs` does the same for a feed, and `fixtures/calendar/moved-into-window.ics`
    // holds the two to it: change one, change the other.
    //
    // `checked` holds the slots looked for outside the window, which the report below then covers.
    const checked = new Set<number>();
    for (const [instant, override] of overrides) {
        const moved = instantOf(override.start);
        if (slots.has(instant) || excluded.has(instant)
            || moved === null || moved < from || moved > to) {
            continue;
        }
        checked.add(instant);
        // Only a slot the rule generates, as inside the window; an override naming any other is
        // reported below. Asked over the days either side rather than of the instant alone:
        // `expandRule` reads its window as wall clock in the rule's own zone, which need not be the
        // reader's.
        const day = dayjs(instant);
        const around = expand(
            day.subtract(1, 'day').format('YYYY-MM-DD'),
            day.add(1, 'day').format('YYYY-MM-DD'),
        );
        if (around === null) {
            return;
        }
        if (around.some((occurrence) => instantOf(occurrence) === instant)) {
            slots.set(instant, override.at as string);
        }
    }

    const matched = new Set<number>();
    const parent: EventParent = { ...detail, end: durationOf(detail) };
    for (const [instant, occurrence] of slots) {
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
            category,
            eventName,
            entry,
            derivation,
        );
        if (event !== null) {
            into.push(event);
        }
    }

    // An adjustment landing on no occurrence is almost always a mistyped date, and doing nothing
    // silently is how that survives. Only reported for adjustments inside the window, or checked
    // above: elsewhere there is nothing to match by construction.
    const reportUnmatched = (instant: number, property: string, spelling: string) => {
        if (!matched.has(instant) && (checked.has(instant) || (instant >= from && instant <= to))) {
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

// Which category an event names, and what that category supplies.
//
// A category that is not a string, or names nothing configured, is reported and the event drawn
// without it: losing the event over a typo would be worse than losing its colour, and saying
// nothing is how the typo survives. With no configuration to hand at all -- before it has loaded,
// or when it could not be read -- nothing is reported, since every category would look unknown.
function categoryOf(
    detail: MetadataEvent,
    categories: EventCategories | undefined,
    eventName: string,
    entry: ListEntry2,
    errors: EventError[],
): EventCategoryRef | undefined {
    const id: unknown = detail.category;
    // An empty `category:` is YAML null, and reads as none -- as an empty `color:` does.
    if (id === undefined || id === null) {
        return undefined;
    }
    if (typeof id !== 'string') {
        errors.push(['category', id, eventName, entry.path, entry.title]);
        return undefined;
    }
    if (categories === undefined) {
        return { id };
    }
    const defaults = resolveCategory(id, categories);
    if (defaults === null) {
        errors.push(['category', id, eventName, entry.path, entry.title]);
        return { id };
    }
    return { id, defaults };
}

function eventsOfEntry(
    eventName: string,
    detail: MetadataEvent,
    entry: ListEntry2,
    derivation: Derivation,
    categories: EventCategories | undefined,
): void {
    const { into, errors } = derivation;
    const category = categoryOf(detail, categories, eventName, entry, errors);
    checkAlarms(detail.alarms, eventName, entry, errors);
    const push = (occurrence: EventOccurrence, parent: EventParent) => {
        const event = buildOccurrence(occurrence, parent, category, eventName, entry, derivation);
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
            expandSeries(eventName, detail, category, entry, derivation);
        }
        else {
            push(detail, { ical: detail.ical });
        }
    }
    for (const occurrence of occurrences) {
        checkAlarms(occurrence.alarms, eventName, entry, errors);
        push(occurrence, detail);
    }
}

/// Every event declared by every entry in the listing, expanded over `window`.
///
/// `categories` is the configuration once it has loaded. Without it, an event's category is
/// recorded but neither applied nor checked. `alarmDefaults` is what the configuration says events
/// ring at where nothing else does, and without it they take the built-in default.
export function eventsFromEntries(
    entries: readonly ListEntry2[],
    window: EventWindow,
    options: { categories?: EventCategories; alarmDefaults?: AlarmDefaults } = {},
): DerivedEvents {
    const derivation = derivationOf(window, options.alarmDefaults);

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
                eventsOfEntry(eventName, detail, entry, derivation, options.categories);
            }
        }
    }

    return { events: derivation.into, errors: derivation.errors };
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
///
/// `hidden` names calendars whose imported events are not drawn; `hiddenCategories` names
/// categories whose note events are not.
export function mergeImported(
    noteEvents: readonly CalendarEvent[],
    imported: readonly ImportedOccurrence[],
    options: {
        colorOf?: Map<string, string>;
        hidden?: ReadonlySet<string>;
        hiddenCategories?: ReadonlySet<string>;
    } = {},
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

    // Hidden only after every note event has claimed what it shadows. Dropped any earlier, a note
    // converted from an imported event would take its claim with it, and hiding its category
    // would bring the feed's copy back in its place.
    const merged = noteEvents.filter(
        (event) => !isInHiddenCategory(event.categoryId, options.hiddenCategories));
    for (const occurrence of imported) {
        // Hiding a calendar hides only what it imports. A note converted from it is mory's own
        // event now, and stays drawn like any other note event.
        if (options.hidden?.has(occurrence.calendar)) {
            continue;
        }
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

/// The colour a task deadline falls back to. Deliberately not `DEFAULT_EVENT_COLOR`: a deadline is
/// not an appointment, and reading as one is the whole failure mode of drawing it on a calendar.
export const DEFAULT_DEADLINE_COLOR = '#b3261e';

/// The colour a due date falls back to. A due date is the day the work is wanted; a deadline is
/// the day it cannot pass. Drawing both in the same red would say they carry the same weight.
///
/// Dark enough to carry white text (5.1:1), like the deadline red: the label on the home page
/// fixes its text white, and the calendar's own picker chooses white for both.
export const DEFAULT_DUE_COLOR = '#a35c00';

/// Which of a task's two dates an event stands for.
export type TaskDate = 'due_by' | 'deadline';

// Whether a task is over, and so neither of its dates still stands. Read defensively: `status` is
// frontmatter, so it may be anything at all.
function isSettled(status: unknown): boolean {
    if (typeof status !== 'object' || status === null) {
        return false;
    }
    const kind = (status as { kind?: unknown }).kind;
    return kind === 'done' || kind === 'canceled';
}

const TASK_DATE_COLOR: Record<TaskDate, string> = {
    due_by: DEFAULT_DUE_COLOR,
    deadline: DEFAULT_DEADLINE_COLOR,
};

/// The colours configured for a task's dates, each falling back to the built-in one.
export type TaskDateColors = Partial<Record<TaskDate, string>>;

// One of a task's dates, as an event -- or nothing, when the field is absent.
//
// A date is a moment, not a span, so it becomes a one-off event with no end: all-day when the
// frontmatter names a bare date, timed when it names a time.
function taskDateEvent(
    field: TaskDate,
    task: object,
    uuid: string,
    entry: ListEntry2,
    { window, alarmDefaults, into, errors }: Derivation,
    colors: TaskDateColors,
): void {
    const value = (task as Record<string, unknown>)[field];
    if (value === undefined || value === null) {
        return;
    }

    const name = entry.title ?? entry.path;
    // `typeof` first, for the same reason `buildOccurrence` checks it: a YAML integer is a valid
    // epoch to dayjs and would only fail later, inside the view.
    if (typeof value !== 'string' || !dayjs(value).isValid()) {
        errors.push([field, value, name, entry.path, entry.title]);
        return;
    }

    // The task's own list for this date, which `task.alarms` holds beside the date and not in it.
    // Checked wherever the date is, as the date itself is.
    const own = taskAlarmOf((task as { alarms?: unknown }).alarms, field);
    checkAlarms(own, name, entry, errors);

    // Compared as dates, not as instants: the window's ends are bare dates, so an instant
    // comparison would drop a date late on its last day.
    const start = toWallClock(value);
    const day = start.slice(0, 10);
    if (day < window.from || day > window.to) {
        return;
    }

    const settled = isSettled((task as { status?: unknown }).status);
    into.push({
        name,
        start,
        finished: settled,
        color: colors[field] || TASK_DATE_COLOR[field],
        source: 'task',
        taskDate: field,
        notePath: entry.path,
        taskId: uuid,
        // A task that is over never rings, so it is not shown to.
        alarms: settled
            ? []
            : readAlarmsIfSet(own) ?? alarmDefaults[TASK_DATE_ALARM_DEFAULT[field]],
    });
}

/// Every task due date and deadline in the listing, as events the calendar can draw.
///
/// Nothing here is expanded or repeated: a task has at most one of each, and they live in
/// `task.due_by` and `task.deadline` rather than in an `events:` block, which is why
/// `eventsFromEntries` cannot see them. A task carrying both contributes both, so the run-up to a
/// deadline is visible rather than implied.
///
/// `alarmDefaults` is what the configuration says each date rings at where its task does not say.
export function taskDatesFromEntries(
    entries: readonly ListEntry2[],
    window: EventWindow,
    options: { colorOf?: TaskDateColors; alarmDefaults?: AlarmDefaults } = {},
): DerivedEvents {
    const derivation = derivationOf(window, options.alarmDefaults);
    const colors = options.colorOf ?? {};

    for (const entry of entries) {
        const uuid = taskUuidOf(entry.path);
        if (uuid === null) {
            continue;
        }
        const task = entry.metadata?.task;
        if (typeof task !== 'object' || task === null) {
            continue;
        }
        taskDateEvent('due_by', task, uuid, entry, derivation, colors);
        taskDateEvent('deadline', task, uuid, entry, derivation, colors);
    }

    return { events: derivation.into, errors: derivation.errors };
}
