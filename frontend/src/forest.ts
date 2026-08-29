// A forest built from nodes that already know their own parent.
//
// Deliberately knows nothing about entries, tasks, paths or UUIDs: it links, sorts, walks and
// nests. Deriving *which* node is whose parent is the caller's business -- see `path-forest.ts`
// for the rule both the task tree and the note tree share.
//
// Every operation here is total. The forest is derived from a file listing that a mutation can
// leave momentarily inconsistent -- renaming a subtree moves one file at a time, so a child can
// briefly name a parent that does not exist yet -- and a tree view that throws in that window is
// worse than one that shows the child at the root for a few hundred milliseconds.

export interface ForestNode {
    id: string;
    parent: string | null;
}

export interface Forest<N extends ForestNode> {
    byId: Map<string, N>;
    childrenOf: Map<string, string[]>;
    roots: string[];
}

// Link `nodes` into a forest, sorting every sibling list -- the roots included -- with `sort`.
//
// Anomalies are repaired rather than thrown: a duplicate id keeps the first node seen, and a node
// whose parent is absent or would close a cycle becomes a root. Each kind is reported once, so a
// transient inconsistency costs one line in the console instead of one per affected node.
export function buildForest<N extends ForestNode>(
    nodes: Iterable<N>,
    sort?: (a: N, b: N) => number,
): Forest<N> {
    const byId = new Map<string, N>();
    let duplicates = 0;
    for (const node of nodes) {
        if (byId.has(node.id)) {
            duplicates += 1;
            continue;
        }
        byId.set(node.id, node);
    }
    if (duplicates > 0) {
        console.warn(`Forest: ignored ${duplicates} node(s) with a duplicate id.`);
    }

    const childrenOf = new Map<string, string[]>();
    const roots: string[] = [];
    let orphans = 0;
    let cycles = 0;
    for (const node of byId.values()) {
        let parent = node.parent;
        if (parent !== null && !byId.has(parent)) {
            orphans += 1;
            parent = null;
        }
        if (parent !== null && closesCycle(byId, node.id, parent)) {
            cycles += 1;
            parent = null;
        }

        if (parent === null) {
            roots.push(node.id);
        }
        else {
            const siblings = childrenOf.get(parent);
            if (siblings === undefined) {
                childrenOf.set(parent, [node.id]);
            }
            else {
                siblings.push(node.id);
            }
        }
    }
    if (orphans > 0) {
        console.warn(`Forest: re-rooted ${orphans} node(s) whose parent is missing.`);
    }
    if (cycles > 0) {
        console.warn(`Forest: re-rooted ${cycles} node(s) to break a cycle.`);
    }

    if (sort !== undefined) {
        const compare = (a: string, b: string) => sort(byId.get(a) as N, byId.get(b) as N);
        roots.sort(compare);
        for (const siblings of childrenOf.values()) {
            siblings.sort(compare);
        }
    }

    return { byId, childrenOf, roots };
}

// Whether making `parent` the parent of `id` would close a cycle -- that is, whether `id` is
// already an ancestor of `parent`. Walks parent links directly rather than the forest, because
// the forest is still being built when this runs.
function closesCycle<N extends ForestNode>(
    byId: Map<string, N>,
    id: string,
    parent: string,
): boolean {
    const seen = new Set<string>([id]);
    let current: string | null = parent;
    while (current !== null) {
        if (seen.has(current)) {
            return true;
        }
        seen.add(current);
        current = byId.get(current)?.parent ?? null;
    }
    return false;
}

// Re-sort every sibling list, the roots included, in place.
//
// `buildForest` takes the comparator up front, which is enough when the order depends only on a
// node's own fields. It is not enough when the order depends on the shape of the tree -- a
// directory ordered by the newest file anywhere beneath it cannot be compared until its children
// are linked -- so such a forest is built unsorted, annotated, and then sorted here.
export function sortForest<N extends ForestNode>(
    forest: Forest<N>,
    sort: (a: N, b: N) => number,
): void {
    const compare = (a: string, b: string) => sort(forest.byId.get(a) as N, forest.byId.get(b) as N);
    forest.roots.sort(compare);
    for (const siblings of forest.childrenOf.values()) {
        siblings.sort(compare);
    }
}

export function childNodes<N extends ForestNode>(forest: Forest<N>, id: string): N[] {
    const ids = forest.childrenOf.get(id);
    if (ids === undefined) {
        return [];
    }
    return ids
        .map((childId) => forest.byId.get(childId))
        .filter((node): node is N => node !== undefined);
}

// Every node below `id`, in pre-order. Iterative, so a pathological depth cannot blow the stack.
export function descendants<N extends ForestNode>(forest: Forest<N>, id: string): string[] {
    const out: string[] = [];
    const stack = [...(forest.childrenOf.get(id) ?? [])].reverse();
    while (stack.length > 0) {
        const current = stack.pop() as string;
        out.push(current);
        const kids = forest.childrenOf.get(current);
        if (kids !== undefined) {
            for (let i = kids.length - 1; i >= 0; i -= 1) {
                stack.push(kids[i]);
            }
        }
    }
    return out;
}

export function subtree<N extends ForestNode>(forest: Forest<N>, id: string): string[] {
    return [id, ...descendants(forest, id)];
}

// `id`'s ancestors, nearest first. `buildForest` has already broken any cycle, so this terminates.
export function ancestors<N extends ForestNode>(forest: Forest<N>, id: string): string[] {
    const out: string[] = [];
    let current = forest.byId.get(id)?.parent ?? null;
    while (current !== null) {
        out.push(current);
        current = forest.byId.get(current)?.parent ?? null;
    }
    return out;
}

export function nodesOf<N extends ForestNode>(forest: Forest<N>, ids: string[]): N[] {
    return ids
        .map((id) => forest.byId.get(id))
        .filter((node): node is N => node !== undefined);
}

// Every node in the forest, roots first and then their descendants in pre-order.
export function flatten<N extends ForestNode>(forest: Forest<N>): N[] {
    const ids: string[] = [];
    for (const root of forest.roots) {
        ids.push(...subtree(forest, root));
    }
    return nodesOf(forest, ids);
}

// Build whatever nested shape a view wants, bottom-up.
//
// `kids` is `undefined` rather than `[]` for a leaf: v-treeview tells a folder from a leaf by
// whether the item has a `children` property at all, so an empty array would draw every leaf as
// an expandable folder.
export function toNested<N extends ForestNode, T>(
    forest: Forest<N>,
    id: string,
    make: (node: N, kids: T[] | undefined) => T,
): T | undefined {
    const node = forest.byId.get(id);
    if (node === undefined) {
        return undefined;
    }
    const childIds = forest.childrenOf.get(id);
    const kids = childIds === undefined
        ? undefined
        : childIds
            .map((childId) => toNested(forest, childId, make))
            .filter((child): child is T => child !== undefined);
    return make(node, kids !== undefined && kids.length > 0 ? kids : undefined);
}

export function toNestedForest<N extends ForestNode, T>(
    forest: Forest<N>,
    ids: string[],
    make: (node: N, kids: T[] | undefined) => T,
): T[] {
    return ids
        .map((id) => toNested(forest, id, make))
        .filter((item): item is T => item !== undefined);
}

// Gather `ids` under synthetic grouping roots -- the task tree's tag groups, and whatever a note
// tree eventually groups by. Nodes are grouped by `keyOf`; group order is `compareKeys`; members
// keep the order they were given in, which is already the forest's sibling order.
export function groupRoots<N extends ForestNode, T>(
    forest: Forest<N>,
    ids: string[],
    keyOf: (node: N) => string,
    compareKeys: (a: string, b: string) => number,
    makeGroup: (key: string, members: T[]) => T,
    makeMember: (node: N) => T,
): T[] {
    const groups = new Map<string, T[]>();
    for (const node of nodesOf(forest, ids)) {
        const key = keyOf(node);
        const members = groups.get(key);
        if (members === undefined) {
            groups.set(key, [makeMember(node)]);
        }
        else {
            members.push(makeMember(node));
        }
    }
    return Array.from(groups.keys())
        .sort(compareKeys)
        .map((key) => makeGroup(key, groups.get(key) as T[]));
}
