// Editing a note's YAML frontmatter in place.
//
// A note stays its author's: an edit made on their behalf changes the lines it is about and leaves
// every other byte alone -- comments, layout, keys nothing here knows. The `yaml` library can write
// a parsed document back out, but not byte for byte: it respaces comments, pads flow collections
// and reindents sequences. So an edit splices the source text at the ranges the parser reports, and
// the result is parsed again to check it means what was intended. The MCP server's
// `mcp::frontmatter` edits the same way.
//
// Where a whole file has to be written afresh, as the task editor and the calendar settings do,
// `stringifyWithFlowAlarms` is the layout the app writes it in. Whatever writes YAML at an indent
// other than two goes through `quoteIndentedText`, or `stringifyQuotingIndented` for a plain value.

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

// Marks each text in a document that would be written as a block whose first line starts with a
// space to be written quoted instead. Such a block needs an indentation indicator, and `yaml` 2.9
// writes the one a two-space step needs whatever `indent` says (eemeli/yaml#733): at four, the text
// of a mapping's value reads back indented further, and further again at each save. Quoted, it
// reads back as it was. Text in a sequence comes out right either way, and is quoted too, so that
// no writer has to know where its text sits.
export function quoteIndentedText(document: YAML.Document): void {
    YAML.visit(document, {
        Scalar(_key, scalar) {
            if (typeof scalar.value === 'string' && scalar.value.includes('\n')
                && /^\n* /.test(scalar.value)) {
                scalar.type = YAML.Scalar.QUOTE_DOUBLE;
            }
        },
    });
}

// `YAML.stringify`, through `quoteIndentedText`.
export function stringifyQuotingIndented(value: unknown, options: YAML.ToStringOptions = {}): string {
    const document = new YAML.Document(value);
    quoteIndentedText(document);
    return document.toString(options);
}

// `YAML.stringify`, with each list under an `alarms:` key written on the line that names it, as a
// note writes them: `timed: [-10m, 0m]`, and not a list of `- -10m` under it. Nothing else is
// written in flow style, so the rest of the document keeps the layout it has everywhere.
export function stringifyWithFlowAlarms(value: unknown, options: YAML.ToStringOptions = {}): string {
    const document = new YAML.Document(value);
    YAML.visit(document, {
        Seq(_key, seq, path) {
            const inAlarms = path.some((node) => YAML.isPair(node)
                && YAML.isScalar(node.key) && node.key.value === 'alarms');
            if (inAlarms) {
                seq.flow = true;
            }
        },
    });
    quoteIndentedText(document);
    return document.toString({ flowCollectionPadding: false, ...options });
}
