// The one reading of an event's `color:`, for everything that draws one and everything that checks
// one before saving it.
//
// A colour is free text, in a note and in `.mory/calendars.yaml` alike, and the views accept two
// kinds: a Vuetify palette name such as `light-green`, and anything `Color` parses. The views
// used to hold this inline, twice, while the settings checked colours with `Color` alone -- which
// throws on every hyphenated palette name, so `light-green` drew on the calendar and was refused
// by the settings.

import Color from 'color';
import materialColors from 'vuetify/util/colors';

type ParsedColor = ReturnType<typeof Color>;

/// The colour a `color:` value names, or `null` when it names none.
///
/// Never throws: this runs inside a view's render, where one typo would otherwise blank the whole
/// view rather than mis-colour one event.
export function parseEventColor(value: unknown): ParsedColor | null {
    if (typeof value !== 'string') {
        return null;
    }
    // The palette is keyed in camel case: `light-green` is `lightGreen`.
    const key = value.replace(/-./g, (match) => match[1].toUpperCase());
    const palette = Object.hasOwn(materialColors, key)
        ? (materialColors as Record<string, { base?: string }>)[key]
        : undefined;
    try {
        // Checked before `Color`, so `blue` is the palette's blue, as it always was, and not CSS's.
        return Color(palette?.base ?? value);
    }
    catch {
        return null;
    }
}
