import { describe, expect, it, vi } from 'vitest';

import type { ListEntry2 } from '@/api';
import { flatten, toNestedForest } from '@/forest';
import type { ForestNode } from '@/forest';
import { buildPathForest, stripExtension } from '@/path-forest';
import type { PathForestPolicy } from '@/path-forest';

function entry(path: string, overrides: Partial<ListEntry2> = {}): ListEntry2 {
    return {
        path,
        size: 0,
        mime_type: 'text/markdown',
        metadata: null,
        title: null,
        time: '2020-01-01T00:00:00+00:00',
        ...overrides,
    };
}

interface Node extends ForestNode {
    directory: boolean;
}

const byId = (a: Node, b: Node) => a.id.localeCompare(b.id);

// Stands in for the task policy: identity is the filename stem, and a directory no file covers
// is an anomaly whose children re-root.
const stemPolicy: PathForestPolicy<Node> = {
    idOf: (e) => stripExtension(e.path).split('/').pop() ?? null,
    coverOf: (e) => stripExtension(e.path),
    node: (_e, id, parent) => ({ id, parent, directory: false }),
    directory: () => null,
    sort: byId,
};

// Stands in for the note policy: identity is the path, directories become nodes, and only
// markdown may cover a directory.
const pathPolicy: PathForestPolicy<Node> = {
    idOf: (e) => e.path,
    coverOf: (e) => (e.mime_type === 'text/markdown' ? stripExtension(e.path) : null),
    node: (_e, id, parent) => ({ id, parent, directory: false }),
    directory: (_path, id, parent) => ({ id, parent, directory: true }),
    sort: byId,
};

const nest = (forest: ReturnType<typeof buildPathForest<Node>>) =>
    toNestedForest<Node, { id: string; children?: unknown[] }>(
        forest,
        forest.roots,
        (n, kids) => ({ id: n.id, ...(kids !== undefined ? { children: kids } : {}) }),
    );

describe('stripExtension', () => {
    it('drops the final extension', () => {
        expect(stripExtension('.tasks/A.md')).toBe('.tasks/A');
        expect(stripExtension('a/b.tar.gz')).toBe('a/b.tar');
    });

    it('leaves a dotfile alone, at the root or nested', () => {
        expect(stripExtension('.gitignore')).toBe('.gitignore');
        expect(stripExtension('a/.gitignore')).toBe('a/.gitignore');
    });

    it('leaves a path with no extension alone', () => {
        expect(stripExtension('a/b')).toBe('a/b');
    });
});

describe('the directory-cover rule', () => {
    it('parents a file to the entry covering its directory', () => {
        const forest = buildPathForest(
            [entry('.tasks/A.md'), entry('.tasks/A/B.md'), entry('.tasks/A/B/C.md'), entry('.tasks/Z.md')],
            '.tasks/',
            stemPolicy,
        );
        expect(forest.roots).toEqual(['A', 'Z']);
        expect(forest.childrenOf.get('A')).toEqual(['B']);
        expect(forest.childrenOf.get('B')).toEqual(['C']);
    });

    it('treats an entry directly inside the root prefix as a root', () => {
        const forest = buildPathForest([entry('.tasks/A.md')], '.tasks/', stemPolicy);
        expect(forest.byId.get('A')?.parent).toBeNull();
    });

    it('accepts a root prefix with or without its trailing slash', () => {
        const withSlash = buildPathForest([entry('.tasks/A.md')], '.tasks/', stemPolicy);
        const without = buildPathForest([entry('.tasks/A.md')], '.tasks', stemPolicy);
        expect(without.roots).toEqual(withSlash.roots);
    });

    it('roots a subtree read under a deeper prefix', () => {
        const forest = buildPathForest(
            [entry('notes/proj/x.md'), entry('notes/proj/y.md')],
            'notes/proj/',
            pathPolicy,
        );
        expect(forest.roots).toEqual(['notes/proj/x.md', 'notes/proj/y.md']);
    });
});

describe('an uncovered directory', () => {
    // What a subtree rename passes through: the parent file has already moved, so for a moment
    // the children's directory has no covering file.
    it('re-roots the children when the policy declines to synthesize one', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const forest = buildPathForest(
            [entry('.tasks/A/B.md'), entry('.tasks/Z.md')],
            '.tasks/',
            stemPolicy,
        );
        expect(forest.roots).toEqual(['B', 'Z']);
        warn.mockRestore();
    });

    it('becomes a node when the policy synthesizes one', () => {
        const forest = buildPathForest([entry('notes/proj/x.md')], '', pathPolicy);
        expect(nest(forest)).toEqual([
            { id: 'notes', children: [{ id: 'notes/proj', children: [{ id: 'notes/proj/x.md' }] }] },
        ]);
    });

    it('synthesizes a shared directory once, however many entries sit in it', () => {
        const forest = buildPathForest(
            [entry('notes/a.md'), entry('notes/b.md'), entry('notes/c.md')],
            '',
            pathPolicy,
        );
        expect(flatten(forest).filter((n) => n.directory).map((n) => n.id)).toEqual(['notes']);
    });
});

// The point of the shared rule: the task tree's UUID convention and plain directory nesting are
// the same thing, so a note tree gets both without a second code path.
describe('both parenting styles in one tree', () => {
    it('nests under a directory node or under the file covering it, as each case demands', () => {
        const forest = buildPathForest(
            [
                entry('notes/proj/x.md'),        // no notes/proj.md -> synthetic directory
                entry('notes/uuid.md'),          // covers notes/uuid
                entry('notes/uuid/child.md'),    // -> nests under the *file* notes/uuid.md
            ],
            '',
            pathPolicy,
        );
        expect(nest(forest)).toEqual([
            {
                id: 'notes',
                children: [
                    { id: 'notes/proj', children: [{ id: 'notes/proj/x.md' }] },
                    { id: 'notes/uuid.md', children: [{ id: 'notes/uuid/child.md' }] },
                ],
            },
        ]);
    });

    it('lets a policy refuse to let a non-markdown file swallow a directory', () => {
        const forest = buildPathForest(
            [entry('photo/a.md'), entry('photo.jpg', { mime_type: 'image/jpeg' })],
            '',
            pathPolicy,
        );
        expect(nest(forest)).toEqual([
            { id: 'photo', children: [{ id: 'photo/a.md' }] },
            { id: 'photo.jpg' },
        ]);
    });
});

describe('entries the policy rejects', () => {
    it('skips them with a single warning rather than failing the whole forest', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const rejecting: PathForestPolicy<Node> = {
            ...pathPolicy,
            idOf: (e) => (e.path.includes('bad') ? null : e.path),
        };
        const forest = buildPathForest(
            [entry('ok-1.md'), entry('bad-1.md'), entry('bad-2.md'), entry('ok-2.md')],
            '',
            rejecting,
        );
        expect(forest.roots).toEqual(['ok-1.md', 'ok-2.md']);
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0][0]).toContain('2');
        warn.mockRestore();
    });
});
