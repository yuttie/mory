// Which rows the task tree draws under a search: the tasks it finds, and every task and tag group
// above one, so a task found is still seen where it lives rather than torn from its parents.

import type { TaskTreeItem } from '@/task-forest';

export interface TaskTreeFilter {
    // Words a task's title must each hold, in any case and any order.
    query: string;
}

// A part of a title, and whether a search term covers it.
export interface TitleSegment {
    text: string;
    match: boolean;
}

// Split on any white space, the ideographic space included, so a query typed through an input
// method splits as one typed without.
export function searchTerms(query: string): string[] {
    return query.split(/\s+/u).filter((term) => term !== '');
}

// Case is ignored by the expression rather than by lowercasing both sides: a lowercased title can
// change length, and `highlight` marks positions in the title as written.
function termPattern(term: string, flags: string): RegExp {
    return new RegExp(term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), `iu${flags}`);
}

function matcher(terms: readonly string[]): (title: string | null) => boolean {
    const patterns = terms.map((term) => termPattern(term, ''));
    return (title) => patterns.every((pattern) => pattern.test(title ?? ''));
}

export function titleMatches(title: string | null, terms: readonly string[]): boolean {
    return matcher(terms)(title);
}

// The title cut where the terms start and end, every occurrence of each marked, overlaps merged.
export function highlight(title: string, terms: readonly string[]): TitleSegment[] {
    const marked = new Array<boolean>(title.length).fill(false);
    for (const term of terms) {
        // From each character on, not from the end of the last occurrence, so that both of the
        // overlapping ones in "Banana" are marked.
        const pattern = termPattern(term, 'g');
        for (let found = pattern.exec(title); found !== null; found = pattern.exec(title)) {
            marked.fill(true, found.index, found.index + found[0].length);
            pattern.lastIndex = found.index + String.fromCodePoint(title.codePointAt(found.index)!).length;
        }
    }
    const segments: TitleSegment[] = [];
    for (let index = 0; index < title.length; index++) {
        const last = segments.at(-1);
        if (last !== undefined && last.match === marked[index]) {
            last.text += title[index];
        }
        else {
            segments.push({ text: title[index], match: marked[index] });
        }
    }
    return segments;
}

// A tag group is only a heading for its members, so it is kept for them and never for its own name.
// A kept task whose subtasks are all left out is made a leaf, as v-treeview would otherwise give it
// a chevron that opens on nothing.
export function filterTaskTree(items: TaskTreeItem[], filter: TaskTreeFilter): TaskTreeItem[] {
    const terms = searchTerms(filter.query);
    // The same array when nothing is filtered, so the tree has nothing new to draw.
    if (terms.length === 0) {
        return items;
    }
    const matches = matcher(terms);
    function keep(item: TaskTreeItem): TaskTreeItem | null {
        const children = item.children?.map(keep).filter((child) => child !== null) ?? [];
        const found = item.metadata?.tag_group === undefined && matches(item.title);
        if (children.length > 0) {
            return { ...item, children };
        }
        if (!found) {
            return null;
        }
        const leaf = { ...item };
        delete leaf.children;
        return leaf;
    }
    return items.map(keep).filter((item) => item !== null);
}

// The rows holding others in a filtered tree: each is there for a task under it, and is opened to
// show it.
export function branchIds(items: readonly TaskTreeItem[]): string[] {
    return items.flatMap((item) => item.children === undefined ? [] : [item.uuid, ...branchIds(item.children)]);
}
