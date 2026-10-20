import axios from 'axios';
import * as TOML from 'smol-toml';

import { useFilesStore } from '@/stores/files';

export interface AiAction {
    id: string;
    name: string;
    prompt: string;
}

export const AI_ACTIONS_PATH = '.mory/ai-actions.toml';

// Kept as a source string rather than a shared RegExp: a `/g` regular expression
// carries `lastIndex` across calls, so a shared one would make `.test()` return
// alternating results for the same input.
const INPUT_PLACEHOLDER_PATTERN = '\\{\\{\\s*input\\s*\\}\\}';

function inputPlaceholderRegExp(): RegExp {
    return new RegExp(INPUT_PLACEHOLDER_PATTERN, 'gi');
}

export function hasInputPlaceholder(prompt: string): boolean {
    return inputPlaceholderRegExp().test(prompt);
}

// The canonical spelling the UI writes. `hasInputPlaceholder` additionally
// accepts `{{ input }}` and `{{INPUT}}`, so this is what we produce, not what we
// require.
export const INPUT_PLACEHOLDER = '{{input}}';

// Put the placeholder at the end of a prompt that does not already position it,
// so the common "run this instruction over my selection" case needs no
// placeholder typed by hand.
export function appendInputPlaceholder(prompt: string): string {
    if (hasInputPlaceholder(prompt)) {
        // Already positioned; a second copy would duplicate the input.
        return prompt;
    }
    return `${prompt.trimEnd()}\n\n${INPUT_PLACEHOLDER}`;
}

export function fillPrompt(prompt: string, input: string): string {
    // The replacement must be a function: passing `input` directly would make
    // `$&`, `` $` `` and `$'` inside the user's selection act as replacement
    // patterns and silently corrupt the prompt.
    return prompt.replaceAll(inputPlaceholderRegExp(), () => input);
}

function isMissing(error: unknown): boolean {
    return (error as { response?: { status?: number } } | null)?.response?.status === 404;
}

// The actions a file holds, and what else it holds -- a key that is no table, a table without a
// string `name` and `prompt`, or a key in an action besides those two -- which the menu does
// without, and which writing the actions back would drop.
function parseAiActions(content: string): { actions: AiAction[]; unreadable: string[] } {
    const parsed = TOML.parse(content);
    const actions: AiAction[] = [];
    const unreadable: string[] = [];
    for (const [id, table] of Object.entries(parsed)) {
        if (table === null || typeof table !== 'object' || Array.isArray(table)) {
            unreadable.push(id);
            continue;
        }
        const { name, prompt } = table as { name?: unknown, prompt?: unknown };
        if (typeof name !== 'string' || typeof prompt !== 'string') {
            unreadable.push(id);
            continue;
        }
        for (const key of Object.keys(table)) {
            if (key !== 'name' && key !== 'prompt') {
                unreadable.push(`${id}.${key}`);
            }
        }
        actions.push({ id, name, prompt });
    }
    return { actions, unreadable };
}

// Whether TOML that parsed holds a comment: a `#` outside every string. The file is written from
// the actions it holds, so a comment is lost the way a key no action has would be.
function hasComment(content: string): boolean {
    let i = 0;
    while (i < content.length) {
        const character = content[i];
        if (character === '#') {
            return true;
        }
        if (character !== '"' && character !== "'") {
            i += 1;
            continue;
        }
        // Only a basic string, `"`, has escapes, and only a multi-line one, three quotes, may span
        // lines.
        const basic = character === '"';
        const delimiter = content.startsWith(character.repeat(3), i) ? character.repeat(3) : character;
        i += delimiter.length;
        while (i < content.length && !content.startsWith(delimiter, i)) {
            i += basic && content[i] === '\\' ? 2 : 1;
        }
        i += delimiter.length;
        // A multi-line string may end in one or two quotes of its own before its delimiter.
        while (delimiter.length === 3 && content[i] === character) {
            i += 1;
        }
    }
    return false;
}

export async function loadAiActions(): Promise<AiAction[]> {
    let content: string;
    try {
        content = await useFilesStore().read(AI_ACTIONS_PATH);
    }
    catch (error) {
        if (isMissing(error)) {
            // The file has not been created yet: no actions have been defined.
            return [];
        }
        throw error;
    }
    return parseAiActions(content).actions;
}

// Serialize a prompt as a TOML multi-line basic string, so the committed file
// stays readable and its diffs stay line-oriented. `smol-toml`'s `stringify`
// emits every string on a single line with escaped newlines instead.
function toMultilineBasicString(value: string): string {
    let escaped = '';
    for (const character of value) {
        const code = character.codePointAt(0) as number;
        if (character === '\\') {
            escaped += '\\\\';
        }
        else if (character === '\n' || character === '\t') {
            // The only two control characters a multi-line basic string may hold
            // literally, and the two that make holding it literally worthwhile.
            escaped += character;
        }
        else if (code < 0x20 || code === 0x7f) {
            escaped += `\\u${code.toString(16).padStart(4, '0')}`;
        }
        else {
            escaped += character;
        }
    }

    escaped = escaped
        // A trailing quote would run into the closing delimiter. Before the run
        // collapsing below, which would otherwise escape it a second time.
        .replace(/"$/, '\\"')
        // Three quotes in a row would end the string early.
        .replace(/"""/g, '""\\"');

    // The newline directly after the opening delimiter is dropped by the parser,
    // so it costs nothing and lets the value start on its own line.
    return `"""\n${escaped}"""`;
}

function renderAiActions(actions: AiAction[]): string {
    const tables = actions.map((action) => {
        // `stringify` handles quoting the table key and the display name; only
        // the prompt is emitted by hand, for its multi-line form.
        const header = TOML.stringify({ [action.id]: {} }).trimEnd();
        const name = TOML.stringify({ name: action.name }).trimEnd();
        return `${header}\n${name}\nprompt = ${toMultilineBasicString(action.prompt)}\n`;
    });
    return tables.join('\n');
}

// Change the actions as the file holds them now, write them back, and resolve to what was written.
//
// The file is read here rather than taken from what a view loaded: a view that could not read it,
// after a typo or a dropped connection, holds no actions, and the file written from that would hold
// only the one being added. A key that is not an action refuses the change rather than be dropped
// from the file by it, and the write is checked against the version read, so a change made
// meanwhile is not put back either.
export async function updateAiActions(edit: (actions: AiAction[]) => AiAction[]): Promise<AiAction[]> {
    const files = useFilesStore();
    let content = '';
    let etag = 'absent';
    try {
        const version = await files.readVersion(AI_ACTIONS_PATH);
        if (typeof version.content !== 'string') {
            throw new Error(`${AI_ACTIONS_PATH} could not be read as text.`);
        }
        content = version.content;
        etag = version.etag;
    }
    catch (error) {
        if (!isMissing(error)) {
            throw error;
        }
    }

    const { actions, unreadable } = parseAiActions(content);
    if (unreadable.length > 0) {
        throw new Error(
            `${AI_ACTIONS_PATH} holds ${unreadable.join(', ')}, which saving would delete: an action `
            + 'is a table of a name and a prompt alone. Fix the file first.',
        );
    }
    if (hasComment(content)) {
        throw new Error(
            `${AI_ACTIONS_PATH} holds comments, which saving would delete. Move what they say into `
            + 'a prompt, or make this change in the file itself.',
        );
    }
    const next = edit(actions);
    const ids = new Set<string>();
    for (const { id } of next) {
        if (ids.has(id)) {
            throw new Error(`An AI action with the identifier ${id} already exists.`);
        }
        ids.add(id);
    }

    try {
        await files.writeChecked(AI_ACTIONS_PATH, renderAiActions(next), etag);
    }
    catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 412) {
            throw new Error(`${AI_ACTIONS_PATH} changed while saving. Try again.`, { cause: error });
        }
        throw error;
    }
    return next;
}

export interface AiActionNode {
    label: string;
    action?: AiAction;
    children?: AiActionNode[];
}

// Turn the flat action list into the menu's tree: a display name of
// `Text/Translate/English` nests the action under a `Text` group and a
// `Translate` group within it. Actions sharing a leading path share the group.
export function buildAiActionTree(actions: AiAction[]): AiActionNode[] {
    const roots: AiActionNode[] = [];
    // Groups are keyed by their full path so that two groups with the same
    // label under different parents stay distinct.
    const groups = new Map<string, AiActionNode>();

    for (const action of actions) {
        const segments = action.name.split('/').map((segment) => segment.trim()).filter((segment) => segment !== '');
        if (segments.length === 0) {
            // A blank display name would render as an unclickable empty row.
            roots.push({ label: action.id, action });
            continue;
        }

        let siblings = roots;
        let path = '';
        for (const segment of segments.slice(0, -1)) {
            path = path === '' ? segment : `${path}/${segment}`;
            let group = groups.get(path);
            if (!group) {
                group = { label: segment, children: [] };
                groups.set(path, group);
                siblings.push(group);
            }
            siblings = group.children as AiActionNode[];
        }
        siblings.push({ label: segments[segments.length - 1], action });
    }

    function sortLevel(nodes: AiActionNode[]) {
        nodes.sort((a, b) => a.label.localeCompare(b.label));
        for (const node of nodes) {
            if (node.children) {
                sortLevel(node.children);
            }
        }
    }
    sortLevel(roots);

    return roots;
}
