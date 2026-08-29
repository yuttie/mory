import { describe, expect, it, vi } from 'vitest';

import type { ListEntry2 } from '@/api';
import { toNestedForest } from '@/forest';
import {
    buildNoteForest,
    compareByLatestDesc,
    isDirectory,
    isHiddenPath,
    noteRouteFor,
} from '@/note-forest';
import type { NoteNode, NoteTreeItem } from '@/note-forest';

function entry(path: string, options: Partial<ListEntry2> = {}): ListEntry2 {
    return {
        path,
        size: 1,
        mime_type: 'text/markdown',
        metadata: { tags: [] },
        title: null,
        time: '2024-05-01T12:00:00+00:00',
        ...options,
    };
}

const at = (day: number) => `2024-05-${String(day).padStart(2, '0')}T12:00:00+00:00`;

interface Shape { id: string; children?: Shape[] }

function shapeOf(entries: ListEntry2[], prefix = ''): Shape[] {
    const forest = buildNoteForest(entries, prefix);
    return toNestedForest<NoteNode, Shape>(forest, forest.roots, (node, kids) =>
        ({ id: node.id, ...(kids !== undefined ? { children: kids } : {}) }));
}

describe('hidden paths', () => {
    it('recognise the application\'s own directories', () => {
        expect(isHiddenPath('.tasks/a.md')).toBe(true);
        expect(isHiddenPath('.mory/config.yaml')).toBe(true);
        expect(isHiddenPath('notes/.hidden/a.md')).toBe(true);
        expect(isHiddenPath('notes/a.md')).toBe(false);
    });

    // Filtered before the build rather than rejected by the policy, which would put a line in the
    // console on every recompute for the couple of hundred entries stored under `.tasks/`.
    it('are dropped without a warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(shapeOf([entry('.tasks/a.md'), entry('.mory/b.yaml'), entry('note.md')]))
            .toEqual([{ id: 'note.md' }]);
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('the directory-cover rule', () => {
    it('synthesizes a directory when no file covers it', () => {
        const forest = buildNoteForest([entry('proj/x.md')]);
        expect(shapeOf([entry('proj/x.md')]))
            .toEqual([{ id: 'proj', children: [{ id: 'proj/x.md' }] }]);
        expect(isDirectory(forest.byId.get('proj') as NoteNode)).toBe(true);
        expect(isDirectory(forest.byId.get('proj/x.md') as NoteNode)).toBe(false);
    });

    it('nests under the note that covers the directory instead', () => {
        expect(shapeOf([entry('proj.md'), entry('proj/x.md')]))
            .toEqual([{ id: 'proj.md', children: [{ id: 'proj/x.md' }] }]);
    });

    // Both parenting styles in one tree, which is the point of the shared rule.
    it('mixes a covered and an uncovered directory without a second code path', () => {
        expect(shapeOf([entry('a.md'), entry('a/x.md'), entry('b/y.md')])).toEqual([
            { id: 'a.md', children: [{ id: 'a/x.md' }] },
            { id: 'b', children: [{ id: 'b/y.md' }] },
        ]);
    });

    it('does not let a non-note swallow a directory of the same name', () => {
        expect(shapeOf([
            entry('photo.jpg', { mime_type: 'image/jpeg' }),
            entry('photo/x.md'),
        ])).toEqual([
            { id: 'photo', children: [{ id: 'photo/x.md' }] },
            { id: 'photo.jpg' },
        ]);
    });

    it('roots a subtree read under a deeper prefix', () => {
        expect(shapeOf([entry('proj/deep/x.md')], 'proj/'))
            .toEqual([{ id: 'proj/deep', children: [{ id: 'proj/deep/x.md' }] }]);
    });
});

describe('latest', () => {
    it('gives a synthesized directory the newest time beneath it', () => {
        const forest = buildNoteForest([
            entry('proj/old.md', { time: at(1) }),
            entry('proj/new.md', { time: at(9) }),
        ]);
        expect(forest.byId.get('proj')?.mtime).toBe('');
        expect(forest.byId.get('proj')?.latest).toBe(at(9));
    });

    it('gives a covering note the newest time beneath it, keeping its own mtime', () => {
        const forest = buildNoteForest([
            entry('proj.md', { time: at(1) }),
            entry('proj/child.md', { time: at(9) }),
        ]);
        expect(forest.byId.get('proj.md')?.mtime).toBe(at(1));
        expect(forest.byId.get('proj.md')?.latest).toBe(at(9));
    });

    it('carries the newest time up through several levels', () => {
        const forest = buildNoteForest([
            entry('a/b/c/deep.md', { time: at(9) }),
            entry('a/shallow.md', { time: at(2) }),
        ]);
        expect(forest.byId.get('a')?.latest).toBe(at(9));
        expect(forest.byId.get('a/b')?.latest).toBe(at(9));
        expect(forest.byId.get('a/b/c')?.latest).toBe(at(9));
    });

    it('leaves a leaf with its own time', () => {
        const forest = buildNoteForest([entry('note.md', { time: at(3) })]);
        expect(forest.byId.get('note.md')?.latest).toBe(at(3));
    });
});

describe('ordering', () => {
    it('interleaves directories and files by recency', () => {
        expect(shapeOf([
            entry('old-note.md', { time: at(1) }),
            entry('mid/x.md', { time: at(5) }),
            entry('new-note.md', { time: at(9) }),
            entry('oldest/y.md', { time: at(2) }),
        ]).map((n) => n.id)).toEqual(['new-note.md', 'mid', 'oldest', 'old-note.md']);
    });

    it('lifts a directory to the top when a file deep inside it is touched', () => {
        const before = shapeOf([
            entry('recent.md', { time: at(5) }),
            entry('archive/deep/x.md', { time: at(1) }),
        ]).map((n) => n.id);
        const after = shapeOf([
            entry('recent.md', { time: at(5) }),
            entry('archive/deep/x.md', { time: at(9) }),
        ]).map((n) => n.id);
        expect(before).toEqual(['recent.md', 'archive']);
        expect(after).toEqual(['archive', 'recent.md']);
    });

    it('orders by the instant, not by the string, across time zones', () => {
        // 09:00+09:00 is 00:00Z, an hour before 01:00Z, though it sorts after as text.
        expect(shapeOf([
            entry('east.md', { time: '2024-05-01T09:00:00+09:00' }),
            entry('utc.md', { time: '2024-05-01T01:00:00+00:00' }),
        ]).map((n) => n.id)).toEqual(['utc.md', 'east.md']);
    });

    it('breaks a tie on the path, so the order is stable', () => {
        const a = entry('zzz.md', { time: at(3) });
        const b = entry('aaa.md', { time: at(3) });
        expect(shapeOf([a, b]).map((n) => n.id)).toEqual(shapeOf([b, a]).map((n) => n.id));
        expect(shapeOf([a, b]).map((n) => n.id)).toEqual(['aaa.md', 'zzz.md']);
    });

    it('sorts nested siblings by recency too', () => {
        expect(shapeOf([
            entry('proj/old.md', { time: at(1) }),
            entry('proj/new.md', { time: at(9) }),
        ])).toEqual([{ id: 'proj', children: [{ id: 'proj/new.md' }, { id: 'proj/old.md' }] }]);
    });

    it('puts a node with no parsable time last', () => {
        const node = (id: string, latest: string) => ({ id, latest }) as NoteNode;
        expect(compareByLatestDesc(node('a', ''), node('b', at(1)))).toBeGreaterThan(0);
        expect(compareByLatestDesc(node('a', at(1)), node('b', ''))).toBeLessThan(0);
    });
});

describe('the row', () => {
    it('shows the entry title when there is one', () => {
        const forest = buildNoteForest([entry('proj/note.md', { title: 'A Real Title' })]);
        expect(forest.byId.get('proj/note.md')?.title).toBe('A Real Title');
        expect(forest.byId.get('proj/note.md')?.name).toBe('note.md');
    });

    it('falls back to the filename when the entry has no title', () => {
        const forest = buildNoteForest([entry('proj/untitled.md')]);
        expect(forest.byId.get('proj/untitled.md')?.title).toBe('untitled.md');
    });

    it('shows a directory by its own name, not its whole path', () => {
        const forest = buildNoteForest([entry('a/b/x.md')]);
        expect(forest.byId.get('a/b')?.title).toBe('b');
        expect(forest.byId.get('a/b')?.path).toBe('a/b');
    });
});

describe('noteRouteFor', () => {
    const routeOf = (path: string, mime: string) => {
        const forest = buildNoteForest([entry(path, { mime_type: mime })]);
        return noteRouteFor(forest.byId.get(path) as NoteNode);
    };

    it('sends media to the viewer and everything else to the editor', () => {
        expect(routeOf('a.png', 'image/png')).toBe('/media/a.png');
        expect(routeOf('a.mp4', 'video/mp4')).toBe('/media/a.mp4');
        expect(routeOf('a.pdf', 'application/pdf')).toBe('/media/a.pdf');
        expect(routeOf('a.md', 'text/markdown')).toBe('/note/a.md');
        expect(routeOf('a.txt', 'text/plain')).toBe('/note/a.txt');
        expect(routeOf('a.bin', 'application/octet-stream')).toBe('/note/a.bin');
    });

    it('keeps the whole path, not just the name', () => {
        expect(routeOf('deep/nested/a.md', 'text/markdown')).toBe('/note/deep/nested/a.md');
    });

    it('has nowhere to send a directory', () => {
        const forest = buildNoteForest([entry('proj/x.md')]);
        expect(noteRouteFor(forest.byId.get('proj') as NoteNode)).toBeNull();
    });
});

describe('the nested shape', () => {
    it('omits children on a leaf, so the tree can tell a folder from a file', () => {
        const forest = buildNoteForest([entry('a.md')]);
        const [leaf] = toNestedForest<NoteNode, NoteTreeItem>(forest, forest.roots, (node, kids) =>
            ({ ...node, ...(kids !== undefined ? { children: kids } : {}) }));
        expect('children' in leaf).toBe(false);
    });
});
