import * as TOML from 'smol-toml';

import { useFiles } from '@/composables/files';

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

export async function loadAiActions(): Promise<AiAction[]> {
    let content: string;
    try {
        content = await useFiles().read(AI_ACTIONS_PATH);
    }
    catch (error) {
        if ((error as { response?: { status?: number } }).response?.status === 404) {
            // The file has not been created yet: no actions have been defined.
            return [];
        }
        throw error;
    }

    const parsed = TOML.parse(content);
    const actions: AiAction[] = [];
    for (const [id, table] of Object.entries(parsed)) {
        if (table === null || typeof table !== 'object' || Array.isArray(table)) {
            continue;
        }
        const { name, prompt } = table as { name?: unknown, prompt?: unknown };
        if (typeof name !== 'string' || typeof prompt !== 'string') {
            continue;
        }
        actions.push({ id, name, prompt });
    }
    return actions;
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

export async function saveAiActions(actions: AiAction[]): Promise<void> {
    const tables = actions.map((action) => {
        // `stringify` handles quoting the table key and the display name; only
        // the prompt is emitted by hand, for its multi-line form.
        const header = TOML.stringify({ [action.id]: {} }).trimEnd();
        const name = TOML.stringify({ name: action.name }).trimEnd();
        return `${header}\n${name}\nprompt = ${toMultilineBasicString(action.prompt)}\n`;
    });
    await useFiles().write(AI_ACTIONS_PATH, tables.join('\n'));
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
