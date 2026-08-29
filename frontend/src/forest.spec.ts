import { describe, expect, it, vi } from 'vitest';

import {
    ancestors,
    buildForest,
    childNodes,
    descendants,
    flatten,
    groupRoots,
    nodesOf,
    sortForest,
    subtree,
    toNested,
    toNestedForest,
} from '@/forest';
import type { ForestNode } from '@/forest';

interface Node extends ForestNode {
    label: string;
}

function node(id: string, parent: string | null): Node {
    return { id, parent, label: id.toUpperCase() };
}

// Descending by id, so a sort is visibly applied rather than coinciding with insertion order.
function byIdDesc(a: Node, b: Node): number {
    return b.id.localeCompare(a.id);
}

//     a          z
//     +- b
//     |  +- d
//     +- c
const sample = () => buildForest(
    [node('a', null), node('b', 'a'), node('c', 'a'), node('d', 'b'), node('z', null)],
    byIdDesc,
);

describe('buildForest', () => {
    it('links children to their parents and collects the rest as roots', () => {
        const forest = sample();
        expect(forest.roots).toEqual(['z', 'a']);
        expect(forest.childrenOf.get('a')).toEqual(['c', 'b']);
        expect(forest.childrenOf.get('b')).toEqual(['d']);
        expect(forest.childrenOf.get('d')).toBeUndefined();
    });

    it('sorts every sibling list, the roots included', () => {
        const forest = buildForest(
            [node('a', null), node('z', null), node('c', 'a'), node('b', 'a')],
            byIdDesc,
        );
        expect(forest.roots).toEqual(['z', 'a']);
        expect(forest.childrenOf.get('a')).toEqual(['c', 'b']);
    });

    it('leaves the given order alone when no sort is supplied', () => {
        const forest = buildForest([node('z', null), node('a', null), node('c', 'a')]);
        expect(forest.roots).toEqual(['z', 'a']);
    });

    // The forest is derived from a file listing that a mutation can leave momentarily
    // inconsistent, so none of these may throw: a tree view that dies mid-rename is worse than
    // one that shows a node at the root for a few hundred milliseconds.
    it('re-roots a node whose parent is missing, rather than dropping or throwing', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const forest = buildForest([node('x', 'gone'), node('y', null)]);
        expect(forest.roots.sort()).toEqual(['x', 'y']);
        expect(warn).toHaveBeenCalledOnce();
        warn.mockRestore();
    });

    it('keeps the first of a duplicate id', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const forest = buildForest([
            { id: 'p', parent: null, label: 'first' },
            { id: 'p', parent: null, label: 'second' },
        ]);
        expect(forest.byId.get('p')?.label).toBe('first');
        expect(forest.byId.size).toBe(1);
        warn.mockRestore();
    });

    it('breaks a cycle, leaving every node reachable from a root', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const forest = buildForest([node('m', 'o'), node('o', 'm')]);
        expect(flatten(forest).map((n) => n.id).sort()).toEqual(['m', 'o']);
        warn.mockRestore();
    });

    it('warns once per anomaly kind, not once per node', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        buildForest([node('x', 'gone'), node('y', 'gone'), node('w', 'gone')]);
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0][0]).toContain('3');
        warn.mockRestore();
    });
});

describe('walking', () => {
    it('returns descendants in pre-order', () => {
        expect(descendants(sample(), 'a')).toEqual(['c', 'b', 'd']);
    });

    it('includes the node itself in its subtree', () => {
        expect(subtree(sample(), 'b')).toEqual(['b', 'd']);
    });

    it('walks ancestors nearest-first', () => {
        expect(ancestors(sample(), 'd')).toEqual(['b', 'a']);
        expect(ancestors(sample(), 'a')).toEqual([]);
    });

    it('flattens roots first, then their descendants', () => {
        expect(flatten(sample()).map((n) => n.id)).toEqual(['z', 'a', 'c', 'b', 'd']);
    });

    it('resolves child and id lists to nodes, skipping ids it does not hold', () => {
        const forest = sample();
        expect(childNodes(forest, 'a').map((n) => n.id)).toEqual(['c', 'b']);
        expect(childNodes(forest, 'd')).toEqual([]);
        expect(nodesOf(forest, ['a', 'nope', 'd']).map((n) => n.id)).toEqual(['a', 'd']);
    });
});

describe('toNested', () => {
    const make = (n: Node, kids: { id: string }[] | undefined) =>
        ({ id: n.id, ...(kids !== undefined ? { children: kids } : {}) });

    it('nests the forest', () => {
        expect(toNestedForest(sample(), sample().roots, make)).toEqual([
            { id: 'z' },
            { id: 'a', children: [{ id: 'c' }, { id: 'b', children: [{ id: 'd' }] }] },
        ]);
    });

    // v-treeview tells a folder from a leaf by whether `children` exists at all, so an empty
    // array would draw every leaf as an expandable folder.
    it('omits children entirely on a leaf rather than passing an empty array', () => {
        const [leaf] = toNestedForest(sample(), ['z'], make);
        expect('children' in leaf).toBe(false);
    });

    it('returns undefined for an id the forest does not hold', () => {
        expect(toNested(sample(), 'nope', make)).toBeUndefined();
    });
});

describe('groupRoots', () => {
    it('gathers nodes under synthetic groups, ordered by the key comparator', () => {
        const forest = buildForest([node('p', null), node('q', null), node('r', null)]);
        const grouped = groupRoots<Node, { group: string; members: string[] }>(
            forest,
            ['p', 'q', 'r'],
            (n) => (n.id === 'r' ? 'B' : 'A'),
            (a, b) => a.localeCompare(b),
            (key, members) => ({ group: key, members: members.flatMap((m) => m.members) }),
            (n) => ({ group: '', members: [n.id] }),
        );
        expect(grouped).toEqual([
            { group: 'A', members: ['p', 'q'] },
            { group: 'B', members: ['r'] },
        ]);
    });

    it('keeps members in the order they were given, which is the forest order', () => {
        const forest = buildForest([node('b', null), node('a', null)], byIdDesc);
        const grouped = groupRoots<Node, string[]>(
            forest,
            forest.roots,
            () => 'all',
            (a, b) => a.localeCompare(b),
            (_key, members) => members.flat(),
            (n) => [n.id],
        );
        expect(grouped).toEqual([['b', 'a']]);
    });
});

describe('sortForest', () => {
    it('re-sorts every sibling list, the roots included', () => {
        const forest = buildForest([node('a', null), node('z', null), node('b', 'a'), node('c', 'a')]);
        sortForest(forest, byIdDesc);
        expect(forest.roots).toEqual(['z', 'a']);
        expect(forest.childrenOf.get('a')).toEqual(['c', 'b']);
    });

    // The reason it exists: an order that cannot be known until the tree is linked, such as a
    // parent ranked by the newest of its descendants.
    it('can order on a value derived from the shape of the tree', () => {
        const forest = buildForest([
            { id: 'quiet', parent: null, label: '1' },
            { id: 'busy', parent: null, label: '1' },
            { id: 'recent', parent: 'busy', label: '9' },
        ]);
        for (const id of [...flatten(forest)].reverse().map((n) => n.id)) {
            const self = forest.byId.get(id) as Node;
            for (const child of childNodes(forest, id)) {
                if (child.label > self.label) { self.label = child.label; }
            }
        }
        sortForest(forest, (a, b) => b.label.localeCompare(a.label));
        expect(forest.roots).toEqual(['busy', 'quiet']);
    });
});
