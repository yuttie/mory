// Which rows the task tree draws under a search and a status filter: the tasks both let through,
// and every task and tag group above one, so a task found is still seen where it lives rather than
// torn from its parents.

import type { StatusKind } from '@/task';
import { type TaskTreeItem, isTagGroupId } from '@/task-forest';

export interface TaskTreeFilter {
    // Words a task's title must each hold, in any case and any order.
    query: string;
    // The statuses whose tasks are left out. A task naming no status is in the backlog, as its icon
    // and the Status view have it. One naming a status there is none of is never left out: no box
    // in the filter is its own, and a filter should not be what hides a task whose note is wrong.
    hiddenStatuses: readonly string[];
}

// Statuses the filter shows or hides together. To do is in none: it is neither started nor set aside.
export const STATUS_PRESETS = [
    { title: 'Completed', kinds: ['done', 'canceled'] },
    { title: 'Inactive', kinds: ['backlog', 'on_hold'] },
    { title: 'Active', kinds: ['in_progress', 'waiting', 'blocked'] },
] as const satisfies readonly { title: string; kinds: readonly StatusKind[] }[];

export type PresetState = 'shown' | 'hidden' | 'mixed';

export function presetState(hidden: readonly string[], kinds: readonly string[]): PresetState {
    const shown = kinds.filter((kind) => !hidden.includes(kind)).length;
    if (shown === kinds.length) {
        return 'shown';
    }
    return shown === 0 ? 'hidden' : 'mixed';
}

// The hidden statuses with a group's shown, or hidden once all of them are shown already: a group
// partly shown is shown whole, as a box for a whole list ticks the list rather than clears it.
export function togglePreset(hidden: readonly string[], kinds: readonly string[]): string[] {
    if (presetState(hidden, kinds) === 'shown') {
        return [...hidden, ...kinds];
    }
    return hidden.filter((kind) => !kinds.includes(kind));
}

// A part of a title, and whether a search term covers it.
export interface TitleSegment {
    text: string;
    match: boolean;
}

// Split on any white space, the ideographic space included, so a query typed through an input
// method splits as one typed without.
//
// The terms and the titles are searched composed (NFC), as an input method types them: a title can
// be written with a letter and its mark apart, as in a name copied from a file on macOS, and its ガ
// would otherwise be no ガ that is typed.
export function searchTerms(query: string): string[] {
    return query.normalize('NFC').split(/\s+/u).filter((term) => term !== '');
}

// Case is ignored by the expression rather than by lowercasing both sides: a lowercased title can
// change length, and `highlight` marks positions in the title it draws.
function termPattern(term: string, flags: string): RegExp {
    return new RegExp(term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), `iu${flags}`);
}

function matcher(terms: readonly string[]): (title: string | null) => boolean {
    const patterns = terms.map((term) => termPattern(term, ''));
    return (title) => {
        const text = (title ?? '').normalize('NFC');
        return patterns.every((pattern) => pattern.test(text));
    };
}

export function titleMatches(title: string | null, terms: readonly string[]): boolean {
    return matcher(terms)(title);
}

// The title, composed, cut where the terms start and end, every occurrence of each marked, overlaps
// merged. Composed, it looks as it did.
export function highlight(title: string, terms: readonly string[]): TitleSegment[] {
    const text = title.normalize('NFC');
    const marked = new Array<boolean>(text.length).fill(false);
    for (const term of terms) {
        // From each character on, not from the end of the last occurrence, so that both of the
        // overlapping ones in "Banana" are marked.
        const pattern = termPattern(term, 'g');
        for (let found = pattern.exec(text); found !== null; found = pattern.exec(text)) {
            marked.fill(true, found.index, found.index + found[0].length);
            pattern.lastIndex = found.index + String.fromCodePoint(text.codePointAt(found.index)!).length;
        }
    }
    const segments: TitleSegment[] = [];
    for (let index = 0; index < text.length; index++) {
        const last = segments.at(-1);
        if (last !== undefined && last.match === marked[index]) {
            last.text += text[index];
        }
        else {
            segments.push({ text: text[index], match: marked[index] });
        }
    }
    return segments;
}

// One set for every tree left whole, so a tree given it has nothing new to draw.
const NONE_FOUND: ReadonlySet<string> = new Set();

export interface FilteredTaskTree {
    items: TaskTreeItem[];
    // The tasks let through on their own account, rather than kept for those under them: the ones
    // whose titles a search marks. Empty when nothing is filtered.
    found: ReadonlySet<string>;
}

// A tag group is only a heading for its members, so it is kept for them and never for its own name.
// A kept task whose subtasks are all left out is made a leaf, as v-treeview would otherwise give it
// a chevron that opens on nothing.
export function filterTaskTree(items: TaskTreeItem[], filter: TaskTreeFilter): FilteredTaskTree {
    const terms = searchTerms(filter.query);
    const hidden = new Set<unknown>(filter.hiddenStatuses);
    // The same array when nothing is filtered, so the tree has nothing new to draw.
    if (terms.length === 0 && hidden.size === 0) {
        return { items, found: NONE_FOUND };
    }
    const found = new Set<string>();
    const matches = matcher(terms);
    function keep(item: TaskTreeItem): TaskTreeItem | null {
        const children = item.children?.map(keep).filter((child) => child !== null) ?? [];
        if (!isTagGroupId(item.uuid)
            && !hidden.has(item.metadata?.task?.status?.kind ?? 'backlog')
            && matches(item.title)) {
            found.add(item.uuid);
        }
        if (children.length > 0) {
            return { ...item, children };
        }
        if (!found.has(item.uuid)) {
            return null;
        }
        if (item.children === undefined) {
            return item;
        }
        const leaf = { ...item };
        delete leaf.children;
        return leaf;
    }
    return { items: items.map(keep).filter((item) => item !== null), found };
}

// The rows holding others in a filtered tree: each is there for a task under it, and is opened to
// show it.
export function branchIds(items: readonly TaskTreeItem[]): string[] {
    return items.flatMap((item) => item.children === undefined ? [] : [item.uuid, ...branchIds(item.children)]);
}
