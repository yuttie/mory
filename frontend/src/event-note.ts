// Writing a note for an imported event, which is what makes it mory's rather than the feed's.
//
// The note has to stand on its own once written: nothing about it may depend on the calendar still
// being subscribed, or on the feed still carrying the event. So the rule is copied rather than
// referenced, and every iCal property mory has no key for is written into the body as plain text
// instead of being dropped -- a person reading the file later gets everything the feed said.
//
// What is *not* copied is the identity: `ical.uid` stays, because that is what shadows the
// imported original. A note carrying only a uid claims the whole series; one that also carries
// `recurrence_id` claims a single occurrence and leaves the rest of the series imported.

import YAML from 'yaml';

import type { EventOccurrence, ImportedOccurrence, ImportedSeries, MetadataEvent } from '@/api';

export const EVENTS_DIR = '.events/';

/// The tag an imported event is marked with, so it is visible as one in every tag view.
export const ICAL_TAG = 'ical';

export interface EventNote {
    path: string;
    content: string;
}

/// A note describing the whole series, so the rule keeps generating occurrences after conversion.
export function buildSeriesNote(
    occurrence: ImportedOccurrence,
    series: ImportedSeries,
): EventNote {
    const event: MetadataEvent = {
        start: series.start,
        ...(series.end === undefined ? {} : { end: series.end }),
        ...(series.location === undefined ? {} : { location: series.location }),
        ...(series.url === undefined ? {} : { url: series.url }),
        ...(series.note === undefined ? {} : { note: series.note }),
        ...(series.repeat === undefined ? {} : { repeat: series.repeat }),
        ...(series.exclusions?.length ? { exclusions: series.exclusions } : {}),
        ...(series.overrides?.length ? { overrides: series.overrides as EventOccurrence[] } : {}),
        // Dates the rule does not generate -- iCal's RDATE. Dropping them lost the dates *and*
        // hid them, since the note claims the whole series either way.
        ...(series.instances?.length ? { instances: series.instances as EventOccurrence[] } : {}),
        ical: { calendar: occurrence.calendar, uid: occurrence.uid },
    };
    return render(series.name || occurrence.name, event, series.unmapped, null);
}

/// A note describing one occurrence, leaving the rest of the series imported.
///
/// Also the fallback when a feed's rule cannot be said in mory's dialect: rather than writing a
/// rule that means something subtly different, the one occurrence in front of the user is taken.
export function buildOccurrenceNote(
    occurrence: ImportedOccurrence,
    series: ImportedSeries | undefined,
): EventNote {
    const event: MetadataEvent = {
        start: occurrence.start,
        ...(occurrence.end === undefined ? {} : { end: occurrence.end }),
        ...(occurrence.location === undefined ? {} : { location: occurrence.location }),
        ...(occurrence.url === undefined ? {} : { url: occurrence.url }),
        ...(occurrence.note === undefined ? {} : { note: occurrence.note }),
        ical: {
            calendar: occurrence.calendar,
            uid: occurrence.uid,
            recurrence_id: occurrence.recurrence_id,
        },
    };
    const unconvertible = series !== undefined && series.repeat === undefined;
    return render(occurrence.name, event, series?.unmapped, unconvertible ? series : null);
}

/// Whether converting the whole series is even possible.
///
/// It is not when the feed's rule has no equivalent in the `repeat:` dialect, which the backend
/// signals by omitting `repeat` from the series.
export function canConvertSeries(series: ImportedSeries | undefined): boolean {
    return series !== undefined && series.repeat !== undefined;
}

function render(
    name: string,
    event: MetadataEvent,
    unmapped: Record<string, string> | undefined,
    unconvertibleSeries: ImportedSeries | null,
): EventNote {
    const metadata = {
        tags: [ICAL_TAG],
        events: { [name]: event },
    };

    const body: string[] = [];
    if (unconvertibleSeries !== null) {
        body.push(
            'This occurrence was imported on its own: the calendar repeats it with a rule mory '
            + 'cannot express, so converting the whole series would have changed when it happens. '
            + 'The remaining occurrences are still read-only.',
        );
    }
    if (unmapped !== undefined && Object.keys(unmapped).length > 0) {
        body.push('## Imported details');
        body.push(Object.entries(unmapped)
            .map(([key, value]) => `- ${key}: ${value}`)
            .join('\n'));
    }

    // Same shape as `render()` in `task.ts`, so a note written here reads like one written there.
    const frontmatter = '---\n' + YAML.stringify(metadata, { indent: 4 }) + '---\n';
    const heading = `\n# ${name}\n`;
    const rest = body.length === 0 ? '' : `\n${body.join('\n\n')}\n`;
    return { path: eventNotePath(), content: frontmatter + heading + rest };
}

/// `.events/<uuidv4>.md`, the convention `.tasks/` writes.
///
/// A bare UUID, with no slug: nothing in the app writes a name into a path today, and event names
/// here are as often Japanese as not, where slugging would leave nothing but the UUID anyway.
function eventNotePath(): string {
    return `${EVENTS_DIR}${crypto.randomUUID()}.md`;
}
