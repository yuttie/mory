// The colour of each task status, for everything that draws one.

import materialColors from 'vuetify/util/colors';

import type { StatusKind } from '@/task';

const STATUS_COLOR: Record<StatusKind, string> = {
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

/// The colour of a status, or `undefined` when `kind` is none.
///
/// Takes what the note said rather than a `StatusKind`: frontmatter is whatever the file holds, and
/// a lookup by an unchecked key would find `toString` and the rest of an object's prototype.
export function statusColor(kind: unknown): string | undefined {
    return typeof kind === 'string' && Object.hasOwn(STATUS_COLOR, kind)
        ? STATUS_COLOR[kind as StatusKind]
        : undefined;
}

/// A card's ground for a status: its colour, faint over the theme's surface, so that the text and
/// the date cues drawn in their own colours stay legible. Opaque, so a card drawn inside another of
/// the same status shows no seam.
export function statusGround(kind: unknown): string | undefined {
    const color = statusColor(kind);
    return color === undefined ? undefined : `color-mix(in srgb, ${color} 12%, rgb(var(--v-theme-surface)))`;
}
