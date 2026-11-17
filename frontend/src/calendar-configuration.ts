// `.mory/calendars.yaml` as the web app reads and writes it.
//
// The file is written by hand as well as by the settings, and moried reads it too, so what one
// reader leaves out the other must leave out alike, and neither may leave a value out unannounced:
// it would look set and do nothing. Every such value is said, by where it is, and the health page
// and the Calendar list them. `backend/src/main.rs` leaves out the same subscriptions moried cannot
// read, `backend/src/calendar_config.rs` finds the same values unread, and
// `fixtures/calendar/configurations.yaml` holds the two to each other.
//
// What happens to a value left out on the next save depends on what it is. A subscription is kept
// as written, wherever it stood: it holds a feed's address and the id converted notes name it by,
// which the settings could not give back, and a reader who wrote `enabled: off` meant it. So is a
// `calendars:` that is not a list, with the subscriptions it would hold left alone. Anything else
// not read is dropped, as the alarms that are not alarms always were, and said to be first.

import YAML from 'yaml';

import type { AlarmDefaults } from '@/alarms';
import { readAlarmDefaults, writeAlarmDefaults } from '@/alarms';
import { MORIED_SCALARS, stringifyWithFlowAlarms } from '@/frontmatter';
import type { ConfiguredCategory, TaskDateColors } from '@/events';
import { readCategories, UNKNOWN_KEY } from '@/events';

export interface CalendarSubscription {
    id: string;
    name: string;
    url: string;
    color?: string;
    enabled: boolean;
    /// What the calendar holds, in the user's words: whose events they are, and which of them are
    /// the user's own. The web app only keeps it; the MCP tools hand it to the model, which has
    /// only the calendar's id and name to go on otherwise.
    description?: string;
}

/// A value the web app does not read, by where it is in the file, and whether the next save of the
/// settings keeps it as written or drops it.
export interface UnreadValue {
    at: string;
    message: string;
    kept: boolean;
}

/// An entry of `calendars:` that is not a subscription, as written, and how many of the
/// subscriptions read came before it, which is where a save puts it back.
export interface HeldSubscription {
    after: number;
    entry: unknown;
}

export interface CalendarConfiguration {
    subscriptions: CalendarSubscription[];
    held: HeldSubscription[];
    /// `calendars:` as written when it is not a list, which leaves no subscription read, and
    /// `undefined` otherwise.
    heldCalendars?: unknown;
    taskDateColors: TaskDateColors;
    alarmDefaults: AlarmDefaults;
    categories: ConfiguredCategory[];
    unread: UnreadValue[];
}

const TOP_LEVEL_KEYS = ['calendars', 'task_dates', 'alarms', 'categories'];
const SUBSCRIPTION_KEYS = ['id', 'name', 'url', 'color', 'enabled', 'description'];
const TASK_DATE_KEYS = ['due_by', 'deadline'] as const;

function isMapping(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isUnsetOrText = (value: unknown) => value === undefined || value === null || typeof value === 'string';

/// One entry of `calendars:` as a subscription, or why it is not one, as `read_subscription` in
/// `backend/src/main.rs` refuses it: not a mapping, an `id` or a `url` that is not text, a `name` or
/// a `color` that is neither text nor empty, or an `enabled` that is not `true` or `false`. Nothing
/// else is a flag: YAML reads `off` and `yes` as text, and an empty `enabled:` as nothing.
export function calendarSubscriptionOf(entry: unknown): CalendarSubscription | string {
    if (!isMapping(entry)) {
        return 'is not a mapping with an id and a url';
    }
    const { id, name, url, color, enabled } = entry;
    if (typeof id !== 'string') {
        return 'has no id that is text';
    }
    const fault = typeof url !== 'string' ? 'has no url that is text'
        : !isUnsetOrText(name) ? 'has a name that is not text'
            : !isUnsetOrText(color) ? 'has a color that is not text'
                : enabled !== undefined && typeof enabled !== 'boolean' ? 'has an enabled that is not true or false'
                    : null;
    if (fault !== null) {
        return `${id}: ${fault}`;
    }
    return {
        id,
        name: typeof name === 'string' ? name : id,
        url: url as string,
        color: typeof color === 'string' ? color : undefined,
        enabled: enabled !== false,
        description: typeof entry.description === 'string' && entry.description.trim() !== ''
            ? entry.description
            : undefined,
    };
}

/// The file's text as moried reads it, for `readCalendarConfiguration`: `id: 017` is text to
/// moried and `name: 0b101` a number, so read the way `yaml` reads YAML otherwise, the two would
/// take and leave out different subscriptions. Throws for text that is not YAML.
export function parseCalendarConfiguration(text: string): unknown {
    return YAML.parse(text, MORIED_SCALARS);
}

/// The text the settings write for what `writeCalendarConfiguration` makes, which moried reads back
/// as the web app does: a name such as `0b101` is quoted, as moried would read it as a number.
export function calendarConfigurationText(document: Record<string, unknown>): string {
    // Lines as long as they were written: folded at 80 columns, a description written by hand as a
    // `|` block would come back from the first save as a `>` one.
    return stringifyWithFlowAlarms(document, { indent: 4, lineWidth: 0 }, MORIED_SCALARS);
}

/// Where each held entry stands once the settings replace the subscriptions read, `previous`, with
/// `next`: after as many of those that stood before it as are still there. Counted as it was read,
/// an entry after a subscription removed would be put back after the next one too. The settings
/// add, change or remove one subscription a save, a changed one in its place, so only a shorter list
/// moves anything, and the one removed is the one `next` no longer holds.
export function heldAfterSave(
    held: readonly HeldSubscription[],
    previous: readonly object[],
    next: readonly object[],
): HeldSubscription[] {
    if (next.length >= previous.length) {
        return [...held];
    }
    const left = new Set(next);
    return held.map(({ after, entry }) => ({
        after: previous.slice(0, after).filter((subscription) => left.has(subscription)).length,
        entry,
    }));
}

/// The id a held entry gives itself, if it is text. A subscription added must not take it: once the
/// entry is mended by hand, two calendars would answer to one id.
export function heldIdOf({ entry }: HeldSubscription): string | undefined {
    return isMapping(entry) && typeof entry.id === 'string' ? entry.id : undefined;
}

/// The file's parsed contents as the settings hold them. Throws for one that is not a mapping, as
/// moried refuses it, since nothing in it can be told from anything else.
export function readCalendarConfiguration(parsed: unknown): CalendarConfiguration {
    if (parsed === undefined || parsed === null) {
        parsed = {};
    }
    if (!isMapping(parsed)) {
        throw new Error('The calendar settings are not a mapping of calendars:, categories: and the rest.');
    }
    const unread: UnreadValue[] = [];
    const dropped = (at: string, message: string) => unread.push({ at, message, kept: false });
    const kept = (at: string, message: string) => unread.push({ at, message, kept: true });

    for (const key of Object.keys(parsed)) {
        if (!TOP_LEVEL_KEYS.includes(key)) {
            dropped(key, UNKNOWN_KEY);
        }
    }

    const subscriptions: CalendarSubscription[] = [];
    const held: HeldSubscription[] = [];
    let heldCalendars: unknown;
    const calendars = parsed.calendars;
    if (Array.isArray(calendars)) {
        calendars.forEach((entry: unknown, index) => {
            const at = `calendars[${index}]`;
            const subscription = calendarSubscriptionOf(entry);
            if (typeof subscription === 'string') {
                held.push({ after: subscriptions.length, entry });
                kept(at, `${subscription}, so the calendar is left out`);
                return;
            }
            subscriptions.push(subscription);
            const record = entry as Record<string, unknown>;
            if (!isUnsetOrText(record.description)) {
                dropped(`${at}.description`, 'is not text');
            }
            for (const key of Object.keys(record)) {
                if (!SUBSCRIPTION_KEYS.includes(key)) {
                    dropped(`${at}.${key}`, UNKNOWN_KEY);
                }
            }
        });
    }
    else if (calendars !== undefined && calendars !== null) {
        heldCalendars = calendars;
        kept('calendars', 'is not a list of subscriptions, so no calendar is read');
    }

    const problems: string[] = [];
    const taskDateColors = readTaskDateColors(parsed.task_dates, problems);
    const alarmDefaults = readAlarmDefaults(parsed.alarms, problems);
    const categories = readCategories(parsed.categories, problems);
    for (const problem of problems) {
        const colon = problem.indexOf(': ');
        dropped(problem.slice(0, colon), problem.slice(colon + 2));
    }

    return { subscriptions, held, heldCalendars, taskDateColors, alarmDefaults, categories, unread };
}

/// The file's contents for what `configuration` holds: every part, so that saving one never drops
/// another, and what was kept as written put back where it stood.
export function writeCalendarConfiguration(
    configuration: Omit<CalendarConfiguration, 'unread' | 'categories'> & { categories: ConfiguredCategory[] | null },
): Record<string, unknown> {
    const written: unknown[] = configuration.subscriptions.map((subscription) => ({
        id: subscription.id,
        name: subscription.name,
        url: subscription.url,
        ...(subscription.color ? { color: subscription.color } : {}),
        enabled: subscription.enabled,
        ...(subscription.description ? { description: subscription.description } : {}),
    }));
    // Back after as many subscriptions as stood before it, or at the end once fewer are left.
    for (const { after, entry } of [...configuration.held].reverse()) {
        written.splice(Math.min(after, written.length), 0, entry);
    }
    const { taskDateColors, alarmDefaults, categories } = configuration;
    return {
        calendars: configuration.heldCalendars ?? written,
        ...(Object.keys(taskDateColors).length > 0 ? { task_dates: { ...taskDateColors } } : {}),
        ...(Object.keys(alarmDefaults).length > 0 ? { alarms: writeAlarmDefaults(alarmDefaults) } : {}),
        ...(categories !== null && categories.length > 0
            ? { categories: Object.fromEntries(categories.map(({ id, ...defaults }) => [id, defaults])) }
            : {}),
    };
}

// Hand-edited YAML, so every value is checked rather than trusted: a colour that is not a string is
// dropped in favour of the default, which is what an absent one means anyway, and said in
// `problems`.
function readTaskDateColors(value: unknown, problems: string[]): TaskDateColors {
    if (!isMapping(value)) {
        if (value !== undefined && value !== null) {
            problems.push('task_dates: is not a mapping of due_by and deadline to colours');
        }
        return {};
    }
    const colors: TaskDateColors = {};
    for (const field of TASK_DATE_KEYS) {
        const color = value[field];
        if (typeof color === 'string' && color.trim() !== '') {
            colors[field] = color.trim();
        }
        else if (!isUnsetOrText(color)) {
            problems.push(`task_dates.${field}: is not a colour`);
        }
    }
    for (const key of Object.keys(value)) {
        if (!(TASK_DATE_KEYS as readonly string[]).includes(key)) {
            problems.push(`task_dates.${key}: ${UNKNOWN_KEY}`);
        }
    }
    return colors;
}
