// Reading a time zone's wall clock, which urgency and recurrence both convert through.

// One formatter a zone, kept. dayjs's `tz()` formats through `toLocaleString`, which builds a
// formatter on every call: 15-23 µs each in Firefox and Chromium, against 1.5 µs to format with
// one kept, and the Tasks tab of the Files view converted over a thousand dates at each opening.
// A zone Intl does not know throws a `RangeError` here, as it did from `tz()`.
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
export function wallClockOf(instant: number, zone: string): number {
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
export function zoneOffset(instant: number, zone: string): number {
    return wallClockOf(instant, zone) - instant;
}
