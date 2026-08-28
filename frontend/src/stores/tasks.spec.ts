import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntriesResponse, ListEntry2 } from '@/api';
import type { Task } from '@/task';
import type { TaskMetadata, TaskTreeItem } from '@/task-forest';

const apiMocks = vi.hoisted(() => ({
    getEntries: vi.fn<(since?: string) => Promise<EntriesResponse>>(),
    getHeadCommitId: vi.fn<() => Promise<string>>(async () => 'c0'),
    addNote: vi.fn<(path: string, content: string) => Promise<{ data: null }>>(
        async () => ({ data: null })),
    renameNote: vi.fn<(oldPath: string, newPath: string) => Promise<{ data: null }>>(
        async () => ({ data: null })),
    deleteNote: vi.fn<(path: string) => Promise<{ data: boolean }>>(async () => ({ data: true })),
    getNote: vi.fn<(path: string) => Promise<{ data: string }>>(async () => ({ data: '' })),
    uploadFiles: vi.fn<(form: FormData) => Promise<{ data: [string, string][] }>>(
        async () => ({ data: [] })),
    searchNotes: vi.fn<(pattern: string) => Promise<{ data: unknown[] }>>(
        async () => ({ data: [] })),
    noteExists: vi.fn<(path: string) => Promise<boolean>>(async () => false),
}));

vi.mock('@/api', () => apiMocks);

function uuid(n: number): string {
    return `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

interface Spec {
    path: string;
    tags?: string[];
    title?: string;
    day?: number;
    status?: string;
}

function entry(spec: Spec): ListEntry2 {
    const metadata: TaskMetadata = {
        tags: spec.tags ?? [],
        task: { status: { kind: (spec.status ?? 'todo') } as never, progress: 0 },
    };
    return {
        path: spec.path,
        size: 1,
        mime_type: 'text/markdown',
        metadata: metadata as ListEntry2['metadata'],
        title: spec.title ?? spec.path,
        time: `2024-05-${String(spec.day ?? 1).padStart(2, '0')}T12:00:00+00:00`,
    };
}

// The repository the backend serves, plus the mutations the store issues against it. Writes and
// renames land in the listing immediately, so `settle` sees them on its first look.
function repository(specs: Spec[]) {
    const files = new Map(specs.map((s) => [s.path, entry(s)]));
    let commit = 0;

    apiMocks.getEntries.mockImplementation(async (): Promise<EntriesResponse> => ({
        kind: 'full',
        commit: `c${commit}`,
        head: `c${commit}`,
        entries: [...files.values()],
    }));
    apiMocks.addNote.mockImplementation(async (path: string) => {
        commit += 1;
        files.set(path, files.get(path) ?? entry({ path }));
        return { data: null };
    });
    apiMocks.renameNote.mockImplementation(async (from: string, to: string) => {
        commit += 1;
        const moved = files.get(from);
        if (moved !== undefined) {
            files.delete(from);
            files.set(to, { ...moved, path: to });
        }
        return { data: null };
    });
    apiMocks.deleteNote.mockImplementation(async (path: string) => {
        commit += 1;
        files.delete(path);
        return { data: true };
    });

    return { paths: () => [...files.keys()].sort() };
}

async function load() {
    vi.resetModules();
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
    setActivePinia(createPinia());
    return await import('@/stores/tasks');
}

async function storeWith(specs: Spec[]) {
    const mod = await load();
    const repo = repository(specs);
    const store = mod.useTasksStore();
    await store.init();
    return { store, repo, ...mod };
}

const titles = (items: TaskTreeItem[]): unknown[] =>
    items.map((i) => (i.children === undefined ? i.title : { [i.title as string]: titles(i.children) }));

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

//   1 Parent          (root with children -> stays a real root)
//   +- 2 Child
//   3 Alpha    #work  (childless root -> grouped under its first tag)
//   4 Beta     #home
//   5 Gamma    #work
//   6 Delta    (no tags -> Untagged)
const sample: Spec[] = [
    { path: `.tasks/${uuid(1)}.md`, title: 'Parent', tags: ['work'], day: 1 },
    { path: `.tasks/${uuid(1)}/${uuid(2)}.md`, title: 'Child', tags: ['work'], day: 2 },
    { path: `.tasks/${uuid(3)}.md`, title: 'Alpha', tags: ['work'], day: 3 },
    { path: `.tasks/${uuid(4)}.md`, title: 'Beta', tags: ['home'], day: 4 },
    { path: `.tasks/${uuid(5)}.md`, title: 'Gamma', tags: ['work'], day: 5 },
    { path: `.tasks/${uuid(6)}.md`, title: 'Delta', day: 6 },
];

describe('the derived forest', () => {
    it('is empty until loaded, and reports it', async () => {
        const mod = await load();
        repository(sample);
        const store = mod.useTasksStore();
        expect(store.isLoaded).toBe(false);
        expect(store.hasData).toBe(false);
        await store.init();
        expect(store.isLoaded).toBe(true);
        expect(store.hasData).toBe(true);
    });

    it('holds every task under .tasks/ and nothing else', async () => {
        const { store } = await storeWith([...sample, { path: 'notes/a.md', title: 'Not a task' }]);
        expect(store.allTasks.map((t) => t.title).sort())
            .toEqual(['Alpha', 'Beta', 'Child', 'Delta', 'Gamma', 'Parent']);
    });

    it('exposes the structural tree, newest first, without tag groups', async () => {
        const { store } = await storeWith(sample);
        expect(titles(store.tree)).toEqual(['Delta', 'Gamma', 'Beta', 'Alpha', { Parent: ['Child'] }]);
    });

    it('resolves a path to its uuid', async () => {
        const { store } = await storeWith(sample);
        expect(store.idByPath(`.tasks/${uuid(3)}.md`)).toBe(uuid(3));
        expect(store.idByPath('.tasks/nope.md')).toBeUndefined();
    });

    it('flattens descendants of a node', async () => {
        const { store } = await storeWith(sample);
        expect(store.flattenDescendants(uuid(1)).map((t) => t.title)).toEqual(['Child']);
        expect(store.flattenDescendants(uuid(3))).toEqual([]);
    });
});

describe('tag grouping', () => {
    it('keeps a root with children at the top level and groups the childless ones by first tag', async () => {
        const { store } = await storeWith(sample);
        expect(titles(store.treeWithTagGroups)).toEqual([
            { Parent: ['Child'] },
            { home: ['Beta'] },
            { work: ['Gamma', 'Alpha'] },
            { Untagged: ['Delta'] },
        ]);
    });

    it('sorts groups alphabetically but always puts Untagged last', async () => {
        const { store } = await storeWith([
            { path: `.tasks/${uuid(1)}.md`, title: 'z', tags: ['zebra'] },
            { path: `.tasks/${uuid(2)}.md`, title: 'u' },
            { path: `.tasks/${uuid(3)}.md`, title: 'a', tags: ['apple'] },
        ]);
        expect(store.treeWithTagGroups.map((i) => i.title)).toEqual(['apple', 'zebra', 'Untagged']);
    });

    it('groups by the first tag only', async () => {
        const { store } = await storeWith([
            { path: `.tasks/${uuid(1)}.md`, title: 'multi', tags: ['second', 'first'] },
        ]);
        expect(store.treeWithTagGroups.map((i) => i.title)).toEqual(['second']);
    });

    it('moves a task out of its tag group as soon as it gains a child', async () => {
        const withChild: Spec[] = [
            { path: `.tasks/${uuid(3)}.md`, title: 'Alpha', tags: ['work'] },
            { path: `.tasks/${uuid(3)}/${uuid(7)}.md`, title: 'New child', tags: ['work'] },
        ];
        const { store } = await storeWith(withChild);
        expect(titles(store.treeWithTagGroups)).toEqual([{ Alpha: ['New child'] }]);
    });

    it('gives a tag group a stable identity across recomputes', async () => {
        const { store } = await storeWith(sample);
        const first = store.treeWithTagGroups.find((i) => i.title === 'work');
        const second = store.treeWithTagGroups.find((i) => i.title === 'work');
        // `mtime` used to be `new Date().toISOString()`, so a group looked new on every read.
        expect(first?.mtime).toBe(second?.mtime);
        expect(first?.uuid).toBe(second?.uuid);
    });
});

describe('tag-aware accessors', () => {
    it('resolves a tag group id to a virtual node', async () => {
        const { store, tagGroupId, isTagGroupId, tagNameOf } = await storeWith(sample);
        const id = tagGroupId('work');
        expect(isTagGroupId(id)).toBe(true);
        expect(tagNameOf(id)).toBe('work');
        expect(store.node(id)).toMatchObject({
            uuid: id,
            title: 'work',
            mime_type: 'application/x-tag-group',
            metadata: { tag_group: 'work' },
        });
    });

    it('lists the members of a tag group as its children', async () => {
        const { store, tagGroupId } = await storeWith(sample);
        expect(store.childrenOf(tagGroupId('work')).map((t) => t.title)).toEqual(['Gamma', 'Alpha']);
        expect(store.childrenOf(tagGroupId('nope'))).toEqual([]);
    });

    // What expanding the tree to a selected node walks, so it has to follow the tree the user
    // actually sees rather than the structural one.
    it('reports the tag group of a childless root as its parent', async () => {
        const { store, tagGroupId } = await storeWith(sample);
        expect(store.parentOf(uuid(3))).toBe(tagGroupId('work'));
        expect(store.parentOf(uuid(6))).toBe(tagGroupId('Untagged'));
    });

    it('leaves a real parent and a tag group itself alone', async () => {
        const { store, tagGroupId } = await storeWith(sample);
        expect(store.parentOf(uuid(2))).toBe(uuid(1));   // child of a real task
        expect(store.parentOf(uuid(1))).toBeNull();      // root with children
        expect(store.parentOf(tagGroupId('work'))).toBeNull();
        expect(store.parentOf('unknown')).toBeNull();
    });

    it('resolves an ordinary uuid through the same accessors', async () => {
        const { store } = await storeWith(sample);
        expect(store.node(uuid(1))?.title).toBe('Parent');
        expect(store.node('unknown')).toBeUndefined();
        expect(store.childrenOf(uuid(1)).map((t) => t.title)).toEqual(['Child']);
    });
});

describe('save', () => {
    const task = (id: string): Task => ({
        uuid: id,
        title: 'Written',
        tags: [],
        status: { kind: 'todo' },
        progress: 0,
        importance: 3,
        urgency: 3,
        scheduled_dates: [],
        note: '',
    });

    it('writes the file and does not return before the listing shows it', async () => {
        const { store, repo } = await storeWith([]);
        const path = `.tasks/${uuid(7)}.md`;
        await store.save(task(uuid(7)), path);

        expect(apiMocks.addNote).toHaveBeenCalledWith(path, expect.stringContaining('# Written'));
        expect(repo.paths()).toEqual([path]);
        // The forest is derived, so the task is present without any local bookkeeping.
        expect(store.allTasks.map((t) => t.uuid)).toEqual([uuid(7)]);
    });

    it('renders the frontmatter into the file', async () => {
        const { store } = await storeWith([]);
        await store.save(task(uuid(7)), `.tasks/${uuid(7)}.md`);
        const [, content] = apiMocks.addNote.mock.calls[0];
        expect(content).toContain('status:');
        expect(content).toContain('kind: todo');
    });
});

describe('remove', () => {
    it('deletes the file and drops the task from the forest', async () => {
        const { store, repo } = await storeWith(sample);
        const path = `.tasks/${uuid(3)}.md`;
        await expect(store.remove(path)).resolves.toBe(true);
        expect(repo.paths()).not.toContain(path);
        expect(store.allTasks.map((t) => t.title)).not.toContain('Alpha');
    });

    it('reports a refusal from the server without touching the forest', async () => {
        const { store } = await storeWith(sample);
        apiMocks.deleteNote.mockResolvedValueOnce({ data: false } as never);
        await expect(store.remove(`.tasks/${uuid(3)}.md`)).resolves.toBe(false);
        expect(store.allTasks.map((t) => t.title)).toContain('Alpha');
    });
});

describe('move', () => {
    it('renames the task and every descendant, preserving the nesting', async () => {
        const { store, repo } = await storeWith(sample);
        await store.move(uuid(1), uuid(4));

        expect(repo.paths()).toContain(`.tasks/${uuid(4)}/${uuid(1)}.md`);
        expect(repo.paths()).toContain(`.tasks/${uuid(4)}/${uuid(1)}/${uuid(2)}.md`);
        expect(store.parentOf(uuid(1))).toBe(uuid(4));
        expect(store.parentOf(uuid(2))).toBe(uuid(1));
    });

    it('moves a task back out to the root, into the tag group it then belongs to', async () => {
        const { store, repo, tagGroupId } = await storeWith(sample);
        await store.move(uuid(2), null);
        expect(repo.paths()).toContain(`.tasks/${uuid(2)}.md`);
        expect(store.node(uuid(2))?.parent).toBeNull();
        expect(store.parentOf(uuid(2))).toBe(tagGroupId('work'));
    });

    it('renames the parent before its descendants, so nothing is stranded', async () => {
        const { store } = await storeWith(sample);
        await store.move(uuid(1), uuid(4));
        const order = apiMocks.renameNote.mock.calls.map(([from]) => from);
        expect(order).toEqual([`.tasks/${uuid(1)}.md`, `.tasks/${uuid(1)}/${uuid(2)}.md`]);
    });

    it('does nothing when the parent is already the one asked for', async () => {
        const { store } = await storeWith(sample);
        await store.move(uuid(2), uuid(1));
        expect(apiMocks.renameNote).not.toHaveBeenCalled();
    });

    it('refuses to move a task under its own descendant', async () => {
        const { store } = await storeWith(sample);
        await expect(store.move(uuid(1), uuid(2))).rejects.toThrow(/descendant/);
        expect(apiMocks.renameNote).not.toHaveBeenCalled();
    });

    it('refuses to move a task it does not hold', async () => {
        const { store } = await storeWith(sample);
        await expect(store.move('unknown', null)).rejects.toThrow(/unknown/);
    });
});
