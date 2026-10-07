// The colour of each task status, for everything that draws one, and the `status_colors:` block of
// `.mory/tasks.yaml` that sets them.

import materialColors from 'vuetify/util/colors';

import { parseEventColor } from '@/event-color';
import { STATUS_KINDS, type StatusKind } from '@/task';

// What a status is drawn in where `.mory/tasks.yaml` sets nothing.
export const DEFAULT_STATUS_COLOR: Record<StatusKind, string> = {
    // A paler To do: the same work, not yet committed to.
    backlog: materialColors.blueGrey.lighten2,
    todo: materialColors.blueGrey.base,
    in_progress: materialColors.blue.base,
    waiting: materialColors.orange.base,
    blocked: materialColors.red.base,
    on_hold: materialColors.purple.base,
    done: materialColors.green.base,
    canceled: materialColors.grey.base,
};

// Colours by status: as `.mory/tasks.yaml` writes them where read from the file, and as CSS where
// resolved for drawing. A status left out takes its default.
export type StatusColors = Partial<Record<StatusKind, string>>;

/// The colour of a status, or `undefined` when `kind` is none.
///
/// Takes what the note said rather than a `StatusKind`: frontmatter is whatever the file holds, and
/// a lookup by an unchecked key would find `toString` and the rest of an object's prototype.
export function statusColor(kind: unknown, configured: StatusColors = {}): string | undefined {
    if (!isStatusKind(kind)) {
        return undefined;
    }
    return configured[kind] ?? DEFAULT_STATUS_COLOR[kind];
}

/// A card's ground for a status: its colour, faint over the theme's surface, so that the text and
/// the date cues drawn in their own colours stay legible. Opaque, so a card drawn inside another of
/// the same status shows no seam.
export function statusGround(kind: unknown, configured: StatusColors = {}): string | undefined {
    const color = statusColor(kind, configured);
    return color === undefined ? undefined : `color-mix(in srgb, ${color} 12%, rgb(var(--v-theme-surface)))`;
}

/// The `status_colors:` a parsed `.mory/tasks.yaml` sets, as written, with what is wrong with any it
/// had to drop. A colour is read as the calendar reads one, so a palette name such as `light-green`
/// is as good as `#8bc34a`; an empty one means the default, as in the calendar's settings.
///
/// A file that is not a mapping, or that still holds legacy task data, sets no colours, and says so
/// through `readTaskSettings` rather than twice.
export function readStatusColors(value: unknown): { colors: StatusColors; problems: string[] } {
    const colors: StatusColors = {};
    const problems: string[] = [];
    if (typeof value !== 'object' || value === null || Array.isArray(value) || 'tasks' in value) {
        return { colors, problems };
    }
    const block = (value as Record<string, unknown>).status_colors;
    if (block === undefined || block === null) {
        return { colors, problems };
    }
    if (typeof block !== 'object' || Array.isArray(block)) {
        return { colors, problems: ['status_colors must be a mapping.'] };
    }
    for (const [kind, color] of Object.entries(block)) {
        if (!isStatusKind(kind)) {
            problems.push(`Unknown status ${kind} in status_colors.`);
        }
        else if (color === null || (typeof color === 'string' && color.trim() === '')) {
            continue;
        }
        else if (typeof color !== 'string' || parseEventColor(color.trim()) === null) {
            problems.push(`Invalid colour for status ${kind}.`);
        }
        else {
            colors[kind] = color.trim();
        }
    }
    return { colors, problems };
}

/// The colours as CSS, ready to draw: `light-green` is the palette's, not something CSS knows.
export function resolveStatusColors(colors: StatusColors): StatusColors {
    const resolved: StatusColors = {};
    for (const kind of STATUS_KINDS) {
        const color = parseEventColor(colors[kind]);
        if (color !== null) {
            resolved[kind] = color.rgb().string();
        }
    }
    return resolved;
}

function isStatusKind(kind: unknown): kind is StatusKind {
    return typeof kind === 'string' && Object.hasOwn(DEFAULT_STATUS_COLOR, kind);
}
