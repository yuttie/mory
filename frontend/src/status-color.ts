// The colour of each task status, for everything that draws one, and the `status_colors:` block of
// `.mory/tasks.yaml` that sets them.

import materialColors from 'vuetify/util/colors';
import YAML from 'yaml';

import { parseEventColor } from '@/event-color';
import { columnOf, hasKey, indentBlock, lineEnding, parsesTo, splice } from '@/frontmatter';
import { STATUS_KINDS, type StatusKind } from '@/task';

// What a status is drawn in where `.mory/tasks.yaml` sets nothing.
export const DEFAULT_STATUS_COLOR: Record<StatusKind, string> = {
    // A paler To do: the same work, not yet committed to.
    backlog: materialColors.blueGrey.lighten4,
    todo: materialColors.blueGrey.base,
    in_progress: materialColors.blue.base,
    waiting: materialColors.amber.base,
    blocked: materialColors.pink.base,
    on_hold: materialColors.indigo.base,
    done: materialColors.green.base,
    canceled: materialColors.shades.black,
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

/// `.mory/tasks.yaml` with its `status_colors:` replaced by `colors`, every other byte left alone:
/// the file is written by hand, comments and all, and nothing else in it is this view's to change.
/// The block goes where the old one was, or at the end; with no colours left, it goes altogether.
///
/// Throws, writing nothing, on a file this cannot read or edit, or when the result would mean
/// anything other than the original with these colours.
export function writeStatusColors(source: string, colors: StatusColors): string {
    const doc = YAML.parseDocument(source);
    if (doc.errors.length > 0) {
        throw new Error(`It is not valid YAML: ${doc.errors[0].message}`);
    }
    const root = doc.contents;
    if (root !== null && !(YAML.isMap(root) && !root.flow)) {
        throw new Error('It must be a block mapping.');
    }
    const before = (doc.toJS() ?? {}) as Record<string, unknown>;
    if ('tasks' in before) {
        throw new Error('It still holds legacy task data; move that to tasks-v1.yaml first.');
    }
    // In the order the statuses are listed, whatever order they were set in.
    const entries = STATUS_KINDS.flatMap((kind) => colors[kind] === undefined ? [] : [[kind, colors[kind]]]);
    const expected = { ...before };
    delete expected.status_colors;
    if (entries.length > 0) {
        expected.status_colors = Object.fromEntries(entries);
    }

    const eol = lineEnding(source);
    const pairs = YAML.isMap(root) ? root.items : [];
    const pair = pairs.find((item) => hasKey(item, 'status_colors'));
    const block = entries.length === 0
        ? ''
        : 'status_colors:' + eol + indentBlock(YAML.stringify(Object.fromEntries(entries), { lineWidth: 0 }), indentStep(source, pairs), eol);

    let edited: string;
    if (pair?.key.range === undefined || pair.key.range === null) {
        if (block === '') {
            return source;
        }
        const body = source.trimEnd();
        edited = (body === '' ? '' : body + eol) + block + eol;
    }
    else {
        const from = pair.key.range[0];
        const value = YAML.isNode(pair.value) ? pair.value : null;
        // A block mapping's range runs on through the line break after it; a flow one's does not.
        let to = value?.range ? value.range[1] : pair.key.range[1];
        while (to > from && /\s/.test(source[to - 1])) {
            to -= 1;
        }
        if (block === '') {
            // The whole lines it took, so no blank line is left where it was.
            const lineStart = source.lastIndexOf('\n', from - 1) + 1;
            const lineEnd = source.indexOf('\n', to);
            edited = splice(source, lineStart, lineEnd === -1 ? source.length : lineEnd + 1, '');
        }
        else {
            edited = splice(source, from, to, block);
        }
    }
    if (!parsesTo(edited, expected)) {
        throw new Error('Saving the colours would change other settings in it.');
    }
    return edited;
}

// The author's indentation step, from the first block mapping they nested, or the app's own.
function indentStep(source: string, pairs: YAML.Pair<unknown, unknown>[]): number {
    for (const pair of pairs) {
        if (YAML.isScalar(pair.key) && pair.key.range && YAML.isMap(pair.value) && !pair.value.flow && pair.value.range) {
            return columnOf(source, pair.value.range[0]) - columnOf(source, pair.key.range[0]);
        }
    }
    return 4;
}

function isStatusKind(kind: unknown): kind is StatusKind {
    return typeof kind === 'string' && Object.hasOwn(DEFAULT_STATUS_COLOR, kind);
}
