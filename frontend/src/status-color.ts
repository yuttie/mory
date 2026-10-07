// The colour of each task status, for everything that draws one, and the `status_colors:` block of
// `.mory/tasks.yaml` that sets them.

import materialColors from 'vuetify/util/colors';
import YAML from 'yaml';

import { parseEventColor } from '@/event-color';
import { columnOf, hasKey, indentBlock, lineEnding, sameValue, splice } from '@/frontmatter';
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

// A change to the colours: a colour to set, or `null` for the default again. A status left out is
// left as the file has it.
export type StatusColorEdits = Partial<Record<StatusKind, string | null>>;

/// `.mory/tasks.yaml` with `edits` made to its `status_colors:`, every other byte left alone: the
/// file is written by hand, comments and all, and only the entries edited are this view's to
/// change. An entry is changed where it is, keeping a comment after it; a new one goes after the
/// last, or into a new block after the other settings; with no entries left, the block goes, with
/// whatever comments it held.
///
/// Throws, writing nothing, on a file this cannot read or edit, or when the result would mean
/// anything other than the original with these edits.
export function writeStatusColors(source: string, edits: StatusColorEdits): string {
    // A byte-order mark is no part of the YAML, and goes back where it was.
    const bom = source.startsWith('﻿') ? '﻿' : '';
    const text = source.slice(bom.length);
    const doc = YAML.parseDocument(text);
    if (doc.errors.length > 0) {
        throw new Error(`It is not valid YAML: ${doc.errors[0].message}`);
    }
    const root = doc.contents;
    if (root !== null && !(YAML.isMap(root) && !root.flow)) {
        throw new Error('It must be a block mapping.');
    }
    const before = valueOf(doc);
    if (before === undefined) {
        throw new Error('It could not be read.');
    }
    if ('tasks' in before) {
        throw new Error('It still holds legacy task data; move that to tasks-v1.yaml first.');
    }
    const old = before.status_colors;
    const colors: Record<string, unknown> = isMapping(old) ? { ...old } : {};
    const kinds = STATUS_KINDS.filter((kind) => edits[kind] !== undefined);
    for (const kind of kinds) {
        if (edits[kind] === null) {
            delete colors[kind];
        }
        else {
            colors[kind] = edits[kind];
        }
    }
    const expected = { ...before };
    delete expected.status_colors;
    if (Object.keys(colors).length > 0) {
        expected.status_colors = colors;
    }
    if (sameValue(before, expected)) {
        return source;
    }

    const eol = lineEnding(text);
    const pairs = YAML.isMap(root) ? root.items : [];
    const pair = pairs.find((item) => hasKey(item, 'status_colors'));
    const block = pair?.value;
    let edited: string;
    if (pair === undefined) {
        edited = insertBlock(text, YAML.isMap(root) ? root : null, colors, eol);
    }
    else if (YAML.isMap(block) && !block.flow && Object.keys(colors).length > 0 && block.items.every((item) => YAML.isScalar(item.key) && item.key.range)) {
        edited = editEntries(text, block, kinds.map((kind) => [kind, edits[kind] as string | null]), eol);
    }
    else {
        edited = replacePair(text, pair, colors, indentStep(text, pairs), eol);
    }
    if (!sameValue(valueOf(YAML.parseDocument(edited)), expected)) {
        throw new Error('It is written in a way this cannot edit in place; change status_colors: in it by hand.');
    }
    return bom + edited;
}

// Each edit made to the entry it is about: changed on its own line, its line removed, or a line
// added after the last entry, at the entries' indentation.
function editEntries(text: string, block: YAML.YAMLMap, edits: [StatusKind, string | null][], eol: string): string {
    const items = block.items as YAML.Pair<YAML.Scalar, unknown>[];
    const column = columnOf(text, items[0].key.range![0]);
    const splices: { from: number; to: number; text: string }[] = [];
    const added: string[] = [];
    for (const [kind, color] of edits) {
        const item = items.find((candidate) => hasKey(candidate, kind));
        if (item === undefined) {
            if (color !== null) {
                added.push(' '.repeat(column) + entry(kind, color));
            }
        }
        else if (color === null) {
            splices.push({ ...wholeLines(text, item.key.range![0], endOf(text, item)), text: '' });
        }
        else {
            // From the key, so an entry with no value, or one that is no colour, is written afresh.
            splices.push({ from: item.key.range![0], to: endOf(text, item), text: entry(kind, color) });
        }
    }
    if (added.length > 0) {
        const lineEnd = text.indexOf('\n', endOf(text, items[items.length - 1]));
        splices.push(lineEnd === -1
            ? { from: text.length, to: text.length, text: added.map((line) => eol + line).join('') }
            : { from: lineEnd + 1, to: lineEnd + 1, text: added.map((line) => line + eol).join('') });
    }
    // From the end, so each splice leaves the offsets of those before it where they were.
    return splices
        .sort((a, b) => b.from - a.from)
        .reduce((result, edit) => splice(result, edit.from, edit.to, edit.text), text);
}

// The pair written afresh in block style, or, with no colours left, removed: the lines it took,
// its own comments with them, so neither an empty key nor a stray comment is left behind.
function replacePair(text: string, pair: YAML.Pair<YAML.Scalar, unknown>, colors: Record<string, unknown>, step: number, eol: string): string {
    const from = pair.key.range![0];
    const value = YAML.isNode(pair.value) && pair.value.range ? pair.value.range : null;
    if (Object.keys(colors).length === 0) {
        const lines = wholeLines(text, from, trimmedEnd(text, from, value ? value[2] : pair.key.range![1]));
        return splice(text, lines.from, lines.to, '');
    }
    const column = columnOf(text, from);
    const written = 'status_colors:' + eol + indentBlock(YAML.stringify(colors, { lineWidth: 0 }), column + step, eol);
    return splice(text, from, trimmedEnd(text, from, value ? value[1] : pair.key.range![1]), written);
}

// A new block, after the other settings and before anything that follows them -- a comment at the
// end, or the `...` that ends the document -- at the settings' own indentation.
function insertBlock(text: string, root: YAML.YAMLMap | null, colors: Record<string, unknown>, eol: string): string {
    const pairs = root === null ? [] : root.items;
    const first = pairs[0]?.key;
    const column = YAML.isScalar(first) && first.range ? columnOf(text, first.range[0]) : 0;
    const written = ' '.repeat(column) + 'status_colors:' + eol
        + indentBlock(YAML.stringify(colors, { lineWidth: 0 }), column + indentStep(text, pairs), eol) + eol;
    const at = root?.range ? root.range[1] : text.length;
    const atLineStart = at === 0 || text[at - 1] === '\n';
    return splice(text, at, at, (atLineStart ? '' : eol) + written);
}

// `kind: colour`, the colour quoted where YAML needs it to be, as `"#ff0000"` does.
function entry(kind: StatusKind, color: string): string {
    return `${kind}: ${YAML.stringify(color, { lineWidth: 0 }).trimEnd()}`;
}

// Where an entry's value ends, before any comment or line break after it.
function endOf(text: string, item: YAML.Pair<YAML.Scalar, unknown>): number {
    const value = YAML.isNode(item.value) && item.value.range ? item.value.range[1] : item.key.range![1];
    return trimmedEnd(text, item.key.range![0], value);
}

// `to`, moved back over the whitespace before it: a block's range runs on through the line break
// after it, a flow one's does not.
function trimmedEnd(text: string, from: number, to: number): number {
    let end = to;
    while (end > from && /\s/.test(text[end - 1])) {
        end -= 1;
    }
    return end;
}

// The whole lines from `from` to `to`, line break included.
function wholeLines(text: string, from: number, to: number): { from: number; to: number } {
    const lineEnd = text.indexOf('\n', to);
    return { from: text.lastIndexOf('\n', from - 1) + 1, to: lineEnd === -1 ? text.length : lineEnd + 1 };
}

// The document as values, a document with nothing in it, or only comments, being an empty mapping
// as the readers take it; `undefined` if it cannot be read as values at all, as an alias with
// nothing to refer to cannot.
function valueOf(doc: YAML.Document.Parsed): Record<string, unknown> | undefined {
    if (doc.errors.length > 0) {
        return undefined;
    }
    try {
        return (doc.toJS() ?? {}) as Record<string, unknown>;
    }
    catch {
        return undefined;
    }
}

function isMapping(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The author's indentation step, from the first block mapping they nested, or the app's own.
function indentStep(text: string, pairs: YAML.Pair<unknown, unknown>[]): number {
    for (const pair of pairs) {
        if (YAML.isScalar(pair.key) && pair.key.range && YAML.isMap(pair.value) && !pair.value.flow && pair.value.range) {
            return columnOf(text, pair.value.range[0]) - columnOf(text, pair.key.range[0]);
        }
    }
    return 4;
}

function isStatusKind(kind: unknown): kind is StatusKind {
    return typeof kind === 'string' && Object.hasOwn(DEFAULT_STATUS_COLOR, kind);
}
