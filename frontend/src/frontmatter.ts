// Editing a note's YAML frontmatter in place.
//
// A note stays its author's: an edit made on their behalf changes the lines it is about and leaves
// every other byte alone -- comments, layout, keys nothing here knows. The `yaml` library can write
// a parsed document back out, but not byte for byte: it respaces comments, pads flow collections
// and reindents sequences. So an edit splices the source text at the ranges the parser reports, and
// the result is parsed again to check it means what was intended. The MCP server's
// `mcp::frontmatter` edits the same way.

import YAML from 'yaml';
import type { Pair, Scalar } from 'yaml';

// The note with its frontmatter's text replaced by what `edit` makes of it. The fences and the body
// are left as they are.
export function editFrontmatter(markdown: string, edit: (yaml: string) => string): string {
    const opening = /^---\r?\n/.exec(markdown);
    if (opening === null) {
        throw new Error('The note has no frontmatter.');
    }
    const start = opening[0].length;
    const closingFence = /^---[ \t]*\r?$/gm;
    closingFence.lastIndex = start;
    const closing = closingFence.exec(markdown);
    if (closing === null) {
        throw new Error('The note\'s frontmatter is never closed.');
    }
    return markdown.slice(0, start) + edit(markdown.slice(start, closing.index)) + markdown.slice(closing.index);
}

// Whether a mapping entry's key is `name`.
export function hasKey(pair: Pair<unknown, unknown>, name: string): pair is Pair<Scalar, unknown> {
    return YAML.isScalar(pair.key) && pair.key.value === name;
}

// The line ending the text already uses, for the lines an edit adds.
export function lineEnding(text: string): string {
    return text.includes('\r\n') ? '\r\n' : '\n';
}

// How far into its line `offset` is.
export function columnOf(text: string, offset: number): number {
    return offset - (text.lastIndexOf('\n', offset - 1) + 1);
}

export function splice(text: string, from: number, to: number, replacement: string): string {
    return text.slice(0, from) + replacement + text.slice(to);
}

// Indents every line of a block `YAML.stringify` wrote, leaving blank lines blank. The block's
// final line break is dropped, so the caller decides what follows it.
export function indentBlock(block: string, column: number, eol: string): string {
    return block.trimEnd()
        .split('\n')
        .map((line) => line === '' ? line : ' '.repeat(column) + line)
        .join(eol);
}

// Whether `text` is valid YAML meaning exactly `expected`: the check an edit is refused on.
export function parsesTo(text: string, expected: unknown): boolean {
    const result = YAML.parseDocument(text);
    return result.errors.length === 0 && sameValue(result.toJS(), expected);
}

// Deep equality over the values YAML parses to, ignoring the order of a mapping's keys.
export function sameValue(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) || Array.isArray(b)) {
        return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
            a.every((item, i) => sameValue(item, b[i]));
    }
    if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
        const aRecord = a as Record<string, unknown>;
        const bRecord = b as Record<string, unknown>;
        const aKeys = Object.keys(aRecord);
        return aKeys.length === Object.keys(bRecord).length &&
            aKeys.every((key) => Object.hasOwn(bRecord, key) && sameValue(aRecord[key], bRecord[key]));
    }
    return Object.is(a, b);
}
