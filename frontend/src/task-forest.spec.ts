import { describe, expect, it, vi } from 'vitest';

import type { ListEntry2 } from '@/api';
import { toNestedForest } from '@/forest';
import { buildPathForest } from '@/path-forest';
import {
    TASKS_DIR,
    buildTaskPath,
    compareByMtimeDesc,
    inStatusOrder,
    isTaskPath,
    taskPolicy,
    taskUuidOf,
} from '@/task-forest';
import type { TaskNode } from '@/task-forest';

// A valid UUIDv4 from a counter, so fixtures are readable and stable.
function uuid(n: number): string {
    return `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

function entry(path: string, time = '2020-01-01T00:00:00+00:00'): ListEntry2 {
    return {
        path,
        size: 10,
        mime_type: 'text/markdown',
        metadata: { tags: [] },
        title: `Title of ${path}`,
        time,
    };
}

function build(entries: ListEntry2[]) {
    return buildPathForest(entries, TASKS_DIR, taskPolicy);
}

interface Shape { uuid: string; children?: Shape[] }

function shapeOf(entries: ListEntry2[]): Shape[] {
    const forest = build(entries);
    return toNestedForest<TaskNode, Shape>(forest, forest.roots, (node, kids) =>
        ({ uuid: node.uuid, ...(kids !== undefined ? { children: kids } : {}) }));
}

describe('taskUuidOf', () => {
    it('takes the UUID a filename stem ends with', () => {
        expect(taskUuidOf(`.tasks/${uuid(1)}.md`)).toBe(uuid(1));
    });

    it('allows a human-readable name before the UUID', () => {
        expect(taskUuidOf(`.tasks/write-the-report-${uuid(2)}.md`)).toBe(uuid(2));
    });

    it('requires every directory below .tasks/ to be a UUIDv4', () => {
        expect(taskUuidOf(`.tasks/${uuid(1)}/${uuid(2)}.md`)).toBe(uuid(2));
        expect(taskUuidOf(`.tasks/inbox/${uuid(2)}.md`)).toBeNull();
    });

    it('rejects a stem that does not end with a UUIDv4', () => {
        expect(taskUuidOf('.tasks/not-a-uuid.md')).toBeNull();
        expect(taskUuidOf('.tasks/short.md')).toBeNull();
        // A v1 UUID has the wrong version nibble.
        expect(taskUuidOf('.tasks/00000001-0000-1000-8000-000000000000.md')).toBeNull();
    });

    it('rejects anything outside .tasks/', () => {
        expect(taskUuidOf(`notes/${uuid(1)}.md`)).toBeNull();
        expect(isTaskPath(`.tasks/${uuid(1)}.md`)).toBe(true);
        expect(isTaskPath('notes/a.md')).toBe(false);
    });
});

describe('the task policy', () => {
    it('carries the listing fields onto the node, with time as mtime', () => {
        const forest = build([entry(`.tasks/report-${uuid(1)}.md`, '2021-03-04T05:06:07+09:00')]);
        const node = forest.byId.get(uuid(1));
        expect(node).toMatchObject({
            id: uuid(1),
            uuid: uuid(1),
            parent: null,
            name: 'report',
            path: `.tasks/report-${uuid(1)}.md`,
            mtime: '2021-03-04T05:06:07+09:00',
            title: `Title of .tasks/report-${uuid(1)}.md`,
        });
    });

    it('leaves name null when the stem is only a UUID', () => {
        const forest = build([entry(`.tasks/${uuid(1)}.md`)]);
        expect(forest.byId.get(uuid(1))?.name).toBeNull();
    });

    // The backend bails on a path like this and get_tasks() unwraps that into a 500, which takes
    // the whole task view down. One stray file should cost a console line instead.
    it('skips a malformed path and still builds the rest of the forest', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const forest = build([
            entry('.tasks/not-a-uuid.md'),
            entry(`.tasks/${uuid(1)}.md`),
            entry(`.tasks/${uuid(1)}/${uuid(2)}.md`),
        ]);
        expect(forest.roots).toEqual([uuid(1)]);
        expect(forest.childrenOf.get(uuid(1))).toEqual([uuid(2)]);
        warn.mockRestore();
    });

    it('never synthesizes a node for a directory, re-rooting an orphan instead', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // Mid-rename: the parent file has moved away, its child has not yet.
        const forest = build([entry(`.tasks/${uuid(1)}/${uuid(2)}.md`)]);
        expect(forest.roots).toEqual([uuid(2)]);
        expect(forest.byId.size).toBe(1);
        warn.mockRestore();
    });
});

describe('sibling order', () => {
    it('puts the newest first, as the backend served it', () => {
        expect(shapeOf([
            entry(`.tasks/${uuid(1)}.md`, '2020-01-01T00:00:00+00:00'),
            entry(`.tasks/${uuid(2)}.md`, '2022-01-01T00:00:00+00:00'),
            entry(`.tasks/${uuid(3)}.md`, '2021-01-01T00:00:00+00:00'),
        ])).toEqual([{ uuid: uuid(2) }, { uuid: uuid(3) }, { uuid: uuid(1) }]);
    });

    // The backend leaves equal mtimes in hash order, so the tree could reorder between renders.
    it('breaks an mtime tie by UUID, so the order is stable', () => {
        const same = '2020-01-01T00:00:00+00:00';
        const a = { ...entry(`.tasks/${uuid(9)}.md`, same), path: `.tasks/${uuid(9)}.md` };
        const b = { ...entry(`.tasks/${uuid(4)}.md`, same), path: `.tasks/${uuid(4)}.md` };
        expect(shapeOf([a, b])).toEqual(shapeOf([b, a]));
        expect(shapeOf([a, b])).toEqual([{ uuid: uuid(4) }, { uuid: uuid(9) }]);
    });

    it('orders by the instant, not by the string, across time zones', () => {
        // 09:00+09:00 is 00:00Z, an hour *before* 01:00Z, though it sorts after as a string.
        const forest = build([
            entry(`.tasks/${uuid(1)}.md`, '2020-01-01T09:00:00+09:00'),
            entry(`.tasks/${uuid(2)}.md`, '2020-01-01T01:00:00+00:00'),
        ]);
        expect(forest.roots).toEqual([uuid(2), uuid(1)]);
    });
});

describe('buildTaskPath', () => {
    it('places a root task directly under .tasks/', () => {
        expect(buildTaskPath([], uuid(1))).toBe(`.tasks/${uuid(1)}.md`);
    });

    it('nests a task under its ancestor chain, root first', () => {
        expect(buildTaskPath([uuid(1), uuid(2)], uuid(3)))
            .toBe(`.tasks/${uuid(1)}/${uuid(2)}/${uuid(3)}.md`);
    });

    it('round-trips: a built path parses back to the task and its parent', () => {
        const path = buildTaskPath([uuid(1), uuid(2)], uuid(3));
        expect(taskUuidOf(path)).toBe(uuid(3));
        const forest = build([
            entry(`.tasks/${uuid(1)}.md`),
            entry(`.tasks/${uuid(1)}/${uuid(2)}.md`),
            entry(path),
        ]);
        expect(forest.byId.get(uuid(3))?.parent).toBe(uuid(2));
    });
});

describe('compareByMtimeDesc', () => {
    it('is a total order even when mtimes match', () => {
        const node = (id: string, mtime: string) => ({ uuid: id, mtime }) as TaskNode;
        expect(compareByMtimeDesc(node('a', '2021'), node('b', '2020'))).toBeLessThan(0);
        expect(compareByMtimeDesc(node('a', '2020'), node('b', '2021'))).toBeGreaterThan(0);
        expect(compareByMtimeDesc(node('a', '2020'), node('b', '2020'))).toBeLessThan(0);
        expect(compareByMtimeDesc(node('a', '2020'), node('a', '2020'))).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Parity with the backend
//
// `GET /v2/tasks?format=tree` still exists and is still the reference for what this forest
// should be. `referenceTree` below is a direct transcription of the Rust that serves it --
// entries_to_tree() and sort_forest() in backend/src/main.rs -- so a change to either side that
// silently diverges shows up here.
// ---------------------------------------------------------------------------

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function referenceTree(entries: ListEntry2[]): Shape[] {
    const parentOf = new Map<string, string | null>();
    const times = new Map<string, number>();

    for (const e of entries) {
        // strip_special_dir + validate_path_constraints
        const components = e.path.slice(TASKS_DIR.length).split('/');
        const filename = components.pop() as string;
        for (const directory of components) {
            if (!UUID_V4.test(directory)) { throw new Error(`bad directory: ${directory}`); }
        }
        // parse_file_uuid
        const stem = filename.replace(/\.[^./]*$/, '');
        if (stem.length < 36) { throw new Error(`stem too short: ${stem}`); }
        const id = stem.slice(-36);
        if (!UUID_V4.test(id)) { throw new Error(`stem does not end with a UUIDv4: ${stem}`); }
        if (parentOf.has(id)) { throw new Error(`duplicate uuid: ${id}`); }
        parentOf.set(id, components.length > 0 ? components[components.length - 1] : null);
        times.set(id, Date.parse(e.time));
    }

    const childrenOf = new Map<string, string[]>();
    for (const [child, parent] of parentOf) {
        if (parent === null) { continue; }
        if (!parentOf.has(parent)) { throw new Error(`missing parent entry: ${parent}`); }
        childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), child]);
    }

    // sort_forest: siblings by mtime descending, recursively.
    const sorted = (ids: string[]) =>
        [...ids].sort((a, b) => (times.get(b) as number) - (times.get(a) as number));
    const assemble = (id: string): Shape => {
        const kids = sorted(childrenOf.get(id) ?? []);
        return { uuid: id, ...(kids.length > 0 ? { children: kids.map(assemble) } : {}) };
    };
    return sorted([...parentOf].filter(([, p]) => p === null).map(([id]) => id)).map(assemble);
}

// A listing with the shapes that matter: several roots, a deep chain, a node with several
// children, named stems, one with a child of its own, and mtimes that put sorting to work. Tie-free, because the backend
// leaves equal mtimes in hash order and so has no order to be compared against there.
function fixture(): ListEntry2[] {
    const at = (day: number) => `2024-05-${String(day).padStart(2, '0')}T12:00:00+00:00`;
    return [
        entry(`.tasks/${uuid(1)}.md`, at(1)),
        entry(`.tasks/${uuid(1)}/${uuid(2)}.md`, at(2)),
        entry(`.tasks/${uuid(1)}/${uuid(3)}.md`, at(3)),
        entry(`.tasks/${uuid(1)}/${uuid(2)}/${uuid(4)}.md`, at(4)),
        entry(`.tasks/${uuid(1)}/${uuid(2)}/${uuid(4)}/${uuid(5)}.md`, at(5)),
        entry(`.tasks/deep-name-${uuid(6)}.md`, at(6)),
        entry(`.tasks/${uuid(6)}/${uuid(10)}.md`, at(10)),
        entry(`.tasks/${uuid(7)}.md`, at(7)),
        entry(`.tasks/${uuid(7)}/renamed-${uuid(8)}.md`, at(8)),
        entry(`.tasks/${uuid(9)}.md`, at(9)),
    ];
}

describe('parity with GET /v2/tasks?format=tree', () => {
    it('builds the tree the backend would have served', () => {
        const entries = fixture();
        expect(shapeOf(entries)).toEqual(referenceTree(entries));
    });

    it('does not depend on the order the listing arrives in', () => {
        const entries = fixture();
        const reversed = [...entries].reverse();
        expect(shapeOf(reversed)).toEqual(referenceTree(entries));
    });

    it('accounts for every entry exactly once', () => {
        const entries = fixture();
        const forest = build(entries);
        expect(forest.byId.size).toBe(entries.length);
        const seen: string[] = [];
        const walk = (nodes: Shape[]) => nodes.forEach((n) => {
            seen.push(n.uuid);
            walk(n.children ?? []);
        });
        walk(shapeOf(entries));
        expect(seen.sort()).toEqual([...forest.byId.keys()].sort());
    });
});

// The tree is the paths', whatever the file is: moried lists an image with no metadata, and it is
// a task there as a note without a `task:` block is, which `list_tasks` matches.
describe('a file in the task tree that is not Markdown', () => {
    it('is a node of the tree, with no metadata', () => {
        const image = { ...entry(`.tasks/${uuid(1)}.png`), mime_type: 'image/png', metadata: null, title: null };
        expect(shapeOf([image, entry(`.tasks/${uuid(1)}/${uuid(2)}.md`)])).toEqual([
            { uuid: uuid(1), children: [{ uuid: uuid(2) }] },
        ]);
    });
});

describe('inStatusOrder', () => {
    // A task named `name`, in `status` (none, if omitted), last changed on the `day`th.
    function task(path: string, name: string, status?: unknown, day = 1): ListEntry2 {
        return {
            ...entry(path, `2020-01-${String(day).padStart(2, '0')}T00:00:00+00:00`),
            metadata: { tags: [], task: status === undefined ? {} : { status: { kind: status } } },
            title: name,
        };
    }

    // The titles as the tree draws them, a parent's followed by its children's.
    function drawn(entries: ListEntry2[]): unknown[] {
        const ordered = inStatusOrder(build(entries));
        return toNestedForest<TaskNode, unknown>(ordered, ordered.roots, (node, kids) =>
            kids === undefined ? node.title : { [node.title as string]: kids });
    }

    it('puts the work under way first, then the work to take on, then the work over with', () => {
        const statuses = ['done', 'backlog', 'on_hold', 'todo', 'blocked', 'waiting', 'in_progress', 'canceled'];
        expect(drawn(statuses.map((status, n) => task(`.tasks/${uuid(n + 1)}.md`, status, status)))).toEqual([
            'in_progress', 'waiting', 'blocked', 'todo', 'on_hold', 'backlog', 'done', 'canceled',
        ]);
    });

    it('draws the newest change first within one place, and Done and Canceled as one', () => {
        expect(drawn([
            task(`.tasks/${uuid(1)}.md`, 'Old to do', 'todo', 1),
            task(`.tasks/${uuid(2)}.md`, 'New to do', 'todo', 3),
            task(`.tasks/${uuid(3)}.md`, 'Done long ago', 'done', 1),
            task(`.tasks/${uuid(4)}.md`, 'Canceled lately', 'canceled', 2),
            task(`.tasks/${uuid(5)}.md`, 'Done just now', 'done', 3),
        ])).toEqual(['New to do', 'Old to do', 'Done just now', 'Canceled lately', 'Done long ago']);
    });

    it('places a task naming no status in the backlog, and one naming no known status with To do', () => {
        expect(drawn([
            task(`.tasks/${uuid(1)}.md`, 'Unsorted'),
            task(`.tasks/${uuid(2)}.md`, 'Parked', 'on_hold'),
            task(`.tasks/${uuid(3)}.md`, 'Misspelt', 'finished'),
            task(`.tasks/${uuid(4)}.md`, 'Not a name', 'constructor'),
            task(`.tasks/${uuid(5)}.md`, 'Waiting', 'waiting'),
        ])).toEqual(['Waiting', 'Misspelt', 'Not a name', 'Parked', 'Unsorted']);
    });

    // As `statusIcon` draws each: a status without a kind names none, and a kind that is not text
    // names no status, whatever text it would turn into.
    it('places a task whose frontmatter holds no status of the right shape as its icon draws it', () => {
        const shaped = (n: number, name: string, metadata: ListEntry2['metadata']): ListEntry2 =>
            ({ ...task(`.tasks/${uuid(n)}.md`, name), metadata });
        expect(drawn([
            task(`.tasks/${uuid(1)}.md`, 'Waiting', 'waiting'),
            task(`.tasks/${uuid(2)}.md`, 'Parked', 'on_hold'),
            shaped(3, 'No frontmatter', null),
            shaped(4, 'Empty task block', { tags: [], task: null }),
            shaped(5, 'Task as text', { tags: [], task: 'in_progress' }),
            shaped(6, 'Status as text', { tags: [], task: { status: 'in_progress' } }),
            shaped(7, 'Kind as a list', { tags: [], task: { status: { kind: ['in_progress'] } } }),
        ])).toEqual([
            'Waiting', 'Kind as a list', 'Parked',
            'No frontmatter', 'Empty task block', 'Task as text', 'Status as text',
        ]);
    });

    it('lifts a task to the place of the work under way anywhere below it, at every level', () => {
        expect(drawn([
            task(`.tasks/${uuid(1)}.md`, 'Waiting alone', 'waiting'),
            task(`.tasks/${uuid(2)}.md`, 'Project', 'todo'),
            task(`.tasks/${uuid(2)}/${uuid(3)}.md`, 'Phase to do', 'todo'),
            task(`.tasks/${uuid(2)}/${uuid(4)}.md`, 'Phase under way', 'backlog'),
            task(`.tasks/${uuid(2)}/${uuid(4)}/${uuid(5)}.md`, 'Step', 'in_progress'),
        ])).toEqual([
            { Project: [{ 'Phase under way': ['Step'] }, 'Phase to do'] },
            'Waiting alone',
        ]);
    });

    it('leaves a task where it is for work below it that is not under way', () => {
        expect(drawn([
            task(`.tasks/${uuid(1)}.md`, 'Paused project', 'on_hold'),
            task(`.tasks/${uuid(1)}/${uuid(2)}.md`, 'Step left to do', 'todo'),
            task(`.tasks/${uuid(3)}.md`, 'Backlog project', 'backlog'),
            task(`.tasks/${uuid(3)}/${uuid(4)}.md`, 'Step taken on', 'todo'),
            task(`.tasks/${uuid(5)}.md`, 'To do', 'todo'),
        ])).toEqual([
            'To do',
            { 'Paused project': ['Step left to do'] },
            { 'Backlog project': ['Step taken on'] },
        ]);
    });

    it('keeps a closed task in its own place, though the work under way below it lifts the tasks above', () => {
        expect(drawn([
            task(`.tasks/${uuid(1)}.md`, 'Waiting alone', 'waiting'),
            task(`.tasks/${uuid(2)}.md`, 'Project', 'todo'),
            task(`.tasks/${uuid(2)}/${uuid(3)}.md`, 'Closed phase', 'done'),
            task(`.tasks/${uuid(2)}/${uuid(3)}/${uuid(4)}.md`, 'Step', 'in_progress'),
            task(`.tasks/${uuid(2)}/${uuid(5)}.md`, 'Open phase', 'todo'),
        ])).toEqual([
            { Project: ['Open phase', { 'Closed phase': ['Step'] }] },
            'Waiting alone',
        ]);
    });

    it('leaves the forest it was given in its own order', () => {
        const forest = build([
            task(`.tasks/${uuid(1)}.md`, 'Older under way', 'in_progress', 1),
            task(`.tasks/${uuid(2)}.md`, 'Newer to do', 'todo', 2),
            task(`.tasks/${uuid(2)}/${uuid(3)}.md`, 'Older step', 'blocked', 1),
            task(`.tasks/${uuid(2)}/${uuid(4)}.md`, 'Newer step', 'todo', 2),
        ]);
        const ordered = inStatusOrder(forest);
        expect(ordered.roots).toEqual([uuid(1), uuid(2)]);
        expect(ordered.childrenOf.get(uuid(2))).toEqual([uuid(3), uuid(4)]);
        expect(forest.roots).toEqual([uuid(2), uuid(1)]);
        expect(forest.childrenOf.get(uuid(2))).toEqual([uuid(4), uuid(3)]);
    });
});
