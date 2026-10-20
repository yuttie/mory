import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import YAML from 'yaml';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntriesResponse, ListEntry2 } from '@/api';
import type { Task } from '@/task';
import type { TaskMetadata, TaskTreeItem } from '@/task-forest';
import hierarchyFixtures from '../../../fixtures/urgency/hierarchy.json';

const apiMocks = vi.hoisted(() => ({
    getEntries: vi.fn<(since?: string) => Promise<EntriesResponse>>(),
    getHeadCommitId: vi.fn<() => Promise<string>>(async () => 'c0'),
    addNote: vi.fn<(path: string, content: string) => Promise<{ data: null }>>(
        async () => ({ data: null })),
    saveFileChecked: vi.fn<(path: string, content: string, expectedETag: string) => Promise<string | undefined>>(
        async () => undefined),
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
    contact?: string;
    deadline?: string;
}

function entry(spec: Spec): ListEntry2 {
    const metadata: TaskMetadata = {
        tags: spec.tags ?? [],
        task: {
            status: { kind: (spec.status ?? 'todo'), contact: spec.contact } as never,
            deadline: spec.deadline,
        },
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
// renames land in the listing immediately, so `settle` sees them on its first look -- unless
// `lag(n)` is called, after which the next `n` listings still describe the commit before the next
// write, as the backend's do while its cache catches up.
function repository(specs: Spec[]) {
    const files = new Map(specs.map((s) => [s.path, entry(s)]));
    let commit = 0;
    let lagging = 0;
    let behind: { commit: number; entries: ListEntry2[]; left: number } | null = null;

    apiMocks.getEntries.mockImplementation(async (): Promise<EntriesResponse> => {
        const served = behind ?? { commit, entries: [...files.values()], left: 0 };
        if (behind !== null && --behind.left === 0) {
            behind = null;
        }
        return { kind: 'full', commit: `c${served.commit}`, head: `c${commit}`, entries: served.entries };
    });
    const write = (path: string, content: string) => {
        if (lagging > 0) {
            behind = { commit, entries: [...files.values()], left: lagging };
            lagging = 0;
        }
        commit += 1;
        // Listed with what the written frontmatter says, as the backend lists it.
        const metadata = YAML.parse(content.split(/^---$/m)[1] ?? '') ?? null;
        files.set(path, { ...(files.get(path) ?? entry({ path })), metadata });
    };
    apiMocks.addNote.mockImplementation(async (path: string, content: string) => {
        write(path, content);
        return { data: null };
    });
    // Unchecked, as `addNote` is: a test of the check makes the call refuse by itself.
    apiMocks.saveFileChecked.mockImplementation(async (path: string, content: string) => {
        write(path, content);
        return `"c${commit}"`;
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

    return {
        paths: () => [...files.keys()].sort(),
        lag: (listings: number) => {
            lagging = listings;
        },
    };
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
    for (const fixture of hierarchyFixtures) {
        it(`matches shared hierarchy: ${fixture.name}`, async () => {
            const mod = await load();
            apiMocks.getEntries.mockResolvedValue({
                kind: 'full',
                commit: 'hierarchy',
                head: 'hierarchy',
                entries: fixture.entries.map((item) => ({
                    ...entry({ path: item.path }),
                    metadata: item.metadata ? { tags: [], ...item.metadata } : null,
                })),
            });
            const store = mod.useTasksStore();
            await store.init();
            store.now = Date.parse('2026-10-04T00:00:00Z');
            for (const expected of fixture.expected) {
                const id = store.allTasks.find((task) => task.path === expected.path)!.uuid;
                expect(store.urgency(id).level).toBe(expected.level);
                expect(store.progress(id) ?? null).toBe(expected.progress);
            }
        });
    }
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

describe('known tags and contacts', () => {
    it('counts each tag across every task, most used first', async () => {
        const { store } = await storeWith(sample);
        expect(store.knownTags).toEqual([['work', 4], ['home', 1]]);
    });

    it('counts only the contacts of tasks still waiting, and none left blank', async () => {
        const { store } = await storeWith([
            { path: `.tasks/${uuid(1)}.md`, status: 'waiting', contact: 'Alice' },
            { path: `.tasks/${uuid(2)}.md`, status: 'waiting', contact: 'Bob' },
            { path: `.tasks/${uuid(3)}.md`, status: 'waiting', contact: 'Bob' },
            { path: `.tasks/${uuid(4)}.md`, status: 'waiting', contact: ' ' },
            { path: `.tasks/${uuid(5)}.md`, status: 'done', contact: 'Carol' },
        ]);
        expect(store.knownContacts).toEqual([['Bob', 2], ['Alice', 1]]);
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

    it('tells the catch-all group apart from a real tag', async () => {
        const { tagGroupId, isUntaggedGroupId } = await storeWith(sample);
        expect(isUntaggedGroupId(tagGroupId('Untagged'))).toBe(true);
        expect(isUntaggedGroupId(tagGroupId('work'))).toBe(false);
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

describe('ancestorsOf', () => {
    it('lists the tasks above one, root first', async () => {
        const { store } = await storeWith([
            ...sample,
            { path: `.tasks/${uuid(1)}/${uuid(2)}/${uuid(7)}.md`, title: 'Grandchild' },
        ]);
        expect(store.ancestorsOf(uuid(7)).map((t) => t.title)).toEqual(['Parent', 'Child']);
        expect(store.ancestorsOf(uuid(2)).map((t) => t.title)).toEqual(['Parent']);
        expect(store.ancestorsOf(uuid(1))).toEqual([]);
    });

    it('lists only the ones under a given ancestor', async () => {
        const { store } = await storeWith([
            ...sample,
            { path: `.tasks/${uuid(1)}/${uuid(2)}/${uuid(7)}.md`, title: 'Grandchild' },
        ]);
        expect(store.ancestorsOf(uuid(7), uuid(1)).map((t) => t.title)).toEqual(['Child']);
        expect(store.ancestorsOf(uuid(7), uuid(2))).toEqual([]);
    });

    it('lists them all below a task it is not under', async () => {
        const { store } = await storeWith([
            ...sample,
            { path: `.tasks/${uuid(1)}/${uuid(2)}/${uuid(7)}.md`, title: 'Grandchild' },
        ]);
        expect(store.ancestorsOf(uuid(7), uuid(3)).map((t) => t.title)).toEqual(['Parent', 'Child']);
        expect(store.ancestorsOf(uuid(7), uuid(7)).map((t) => t.title)).toEqual(['Parent', 'Child']);
    });

    it('does not count a tag group as an ancestor', async () => {
        const { store, tagGroupId } = await storeWith(sample);
        expect(store.ancestorsOf(uuid(3))).toEqual([]);
        expect(store.ancestorsOf(tagGroupId('work'))).toEqual([]);
        expect(store.ancestorsOf('unknown')).toEqual([]);
    });
});

describe('parentAt', () => {
    it('finds the task a path sits under, listed or not', async () => {
        const { store } = await storeWith(sample);
        expect(store.parentAt(`.tasks/${uuid(1)}/${uuid(2)}.md`)?.uuid).toBe(uuid(1));
        expect(store.parentAt(`.tasks/${uuid(1)}/${uuid(2)}/${uuid(9)}.md`)?.uuid).toBe(uuid(2));
    });

    it('finds none at the top, or where no file covers the directory', async () => {
        const { store } = await storeWith(sample);
        expect(store.parentAt(`.tasks/${uuid(9)}.md`)).toBeUndefined();
        expect(store.parentAt(`.tasks/${uuid(7)}/${uuid(9)}.md`)).toBeUndefined();
    });

    // As the backend parents a task: by the UUID its directory is named after.
    it('finds a task named with a readable prefix over the directory named by its UUID', async () => {
        const { store } = await storeWith([...sample, { path: `.tasks/named-${uuid(7)}.md`, title: 'Named' }]);
        expect(store.parentAt(`.tasks/${uuid(7)}/${uuid(9)}.md`)?.uuid).toBe(uuid(7));
        expect(store.parentAt(`.tasks/named-${uuid(7)}/${uuid(9)}.md`)).toBeUndefined();
    });

    it('agrees with the forest about every listed task', async () => {
        const { store } = await storeWith(sample);
        for (const task of store.allTasks) {
            expect(store.parentAt(task.path)?.uuid ?? null).toBe(task.parent);
        }
    });
});

describe('pathUnder', () => {
    it('places a task below a directory per ancestor of its parent, root first', async () => {
        const { store } = await storeWith(sample);
        expect(store.pathUnder(uuid(2), uuid(9))).toBe(`.tasks/${uuid(1)}/${uuid(2)}/${uuid(9)}.md`);
        expect(store.pathUnder(uuid(3), uuid(9))).toBe(`.tasks/${uuid(3)}/${uuid(9)}.md`);
    });

    it('places a task without a parent at the top', async () => {
        const { store } = await storeWith(sample);
        expect(store.pathUnder(null, uuid(9))).toBe(`.tasks/${uuid(9)}.md`);
    });

    // 2's own parent file is gone, so the forest re-roots it, yet its children still belong in the
    // directory its file covers.
    it('places a task where the forest finds it under a parent re-rooted by a missing file', async () => {
        const { store } = await storeWith([{ path: `.tasks/${uuid(1)}/${uuid(2)}.md`, title: 'Orphan' }]);
        expect(store.parentOf(uuid(2))).not.toBe(uuid(1));
        expect(store.pathUnder(uuid(2), uuid(9))).toBe(`.tasks/${uuid(1)}/${uuid(2)}/${uuid(9)}.md`);
    });

    // A directory must be a bare UUIDv4, and `named-<uuid>.md` covers the one named by its UUID.
    it('places a task under a parent named with a readable prefix where the forest finds it', async () => {
        const { store } = await storeWith([{ path: `.tasks/named-${uuid(2)}.md`, title: 'Named' }]);
        expect(store.pathUnder(uuid(2), uuid(9))).toBe(`.tasks/${uuid(2)}/${uuid(9)}.md`);
        expect(store.parentAt(store.pathUnder(uuid(2), uuid(9)))?.uuid).toBe(uuid(2));
    });

    it('refuses a parent the forest does not hold', async () => {
        const { store } = await storeWith(sample);
        expect(() => store.pathUnder(uuid(9), uuid(8))).toThrow();
    });
});

describe('save', () => {
    const task = (id: string): Task => ({
        uuid: id,
        title: 'Written',
        tags: [],
        status: { kind: 'todo' },
        note: '',
    });

    it('writes the file and does not return before the listing shows it', async () => {
        const { store, repo } = await storeWith([]);
        const path = `.tasks/${uuid(7)}.md`;
        await store.save(task(uuid(7)), path);

        expect(apiMocks.saveFileChecked).toHaveBeenCalledWith(path, expect.stringContaining('# Written'), 'absent');
        expect(repo.paths()).toEqual([path]);
        // The forest is derived, so the task is present without any local bookkeeping.
        expect(store.allTasks.map((t) => t.uuid)).toEqual([uuid(7)]);
    });

    it('renders the frontmatter into the file', async () => {
        const { store } = await storeWith([]);
        await store.save(task(uuid(7)), `.tasks/${uuid(7)}.md`);
        const [, content] = apiMocks.saveFileChecked.mock.calls[0];
        expect(content).toContain('status:');
        expect(content).toContain('kind: todo');
    });

    // A read that fails leaves the editor with no task, offering to create one where the note it
    // could not read is: written unchecked, the form replaced it.
    it('creates a task only where there is no note', async () => {
        const { store } = await storeWith(sample);
        apiMocks.saveFileChecked.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 412'), {
            isAxiosError: true,
            response: { status: 412 },
        }));

        await expect(store.save(task(uuid(3)), `.tasks/${uuid(3)}.md`)).rejects.toThrow('already there');
        expect(apiMocks.addNote).not.toHaveBeenCalled();
    });
});

describe('save over a note', () => {
    const read = (id: string): Task => ({
        uuid: id,
        title: 'Written',
        tags: [],
        status: { kind: 'todo' },
        note: '',
        source: '---\ntask:\n    status:\n        kind: todo\n---\n\n# Alpha\n',
        etag: '"as-read"',
    });
    // As axios rejects the 412 moried answers when the note is no longer the blob named.
    const preconditionFailed = () => Object.assign(new Error('Request failed with status code 412'), {
        isAxiosError: true,
        response: { status: 412 },
    });

    it('writes an edited task only over the note it was read from', async () => {
        const { store } = await storeWith(sample);
        const path = `.tasks/${uuid(3)}.md`;
        apiMocks.saveFileChecked.mockResolvedValueOnce('"as-written"');

        // The version it wrote, for the editor's next save to count from.
        await expect(store.save(read(uuid(3)), path)).resolves.toBe('"as-written"');

        expect(apiMocks.saveFileChecked).toHaveBeenCalledWith(path, expect.stringContaining('# Written'), '"as-read"');
        expect(apiMocks.addNote).not.toHaveBeenCalled();
    });

    it('takes a note read without an ETag for one that changed', async () => {
        const { store } = await storeWith(sample);
        const path = `.tasks/${uuid(3)}.md`;

        await store.save({ ...read(uuid(3)), etag: undefined }, path);

        expect(apiMocks.saveFileChecked).toHaveBeenCalledWith(path, expect.any(String), 'absent');
        expect(apiMocks.addNote).not.toHaveBeenCalled();
    });

    // The editor stays open after a save, so the note may move on while it is: completed through
    // MCP, its dates set on another device. Writing the form over it would undo that unannounced.
    it('refuses to write over a note changed since the task was read', async () => {
        const { store } = await storeWith(sample);
        apiMocks.saveFileChecked.mockRejectedValueOnce(preconditionFailed());

        await expect(store.save(read(uuid(3)), `.tasks/${uuid(3)}.md`)).rejects.toThrow('changed elsewhere');
        expect(apiMocks.addNote).not.toHaveBeenCalled();
    });

    // Only the listing failed to follow. Taken for a failed save, it left the editor to check its
    // next one against the version before this, which found this one there and refused.
    it('keeps the version it wrote when the listing cannot be refreshed', async () => {
        const { store, SavedUnlisted } = await storeWith(sample);
        apiMocks.saveFileChecked.mockResolvedValueOnce('"as-written"');
        apiMocks.getEntries.mockRejectedValue(new Error('offline'));

        const saving = store.save(read(uuid(3)), `.tasks/${uuid(3)}.md`);

        await expect(saving).rejects.toBeInstanceOf(SavedUnlisted);
        await expect(saving).rejects.toMatchObject({ written: '"as-written"' });
    });
});

describe('saveAll', () => {
    const write = (path: string) => ({ path, markdown: `---\ntask:\n    status:\n        kind: todo\n---\n\n# ${path}\n` });

    it('writes every task in order and does not return before the listing nests them', async () => {
        const { store, repo } = await storeWith([]);
        const parent = `.tasks/${uuid(1)}.md`;
        const child = `.tasks/${uuid(1)}/${uuid(2)}.md`;
        repo.lag(2);

        await store.saveAll([write(parent), write(child)]);

        expect(apiMocks.addNote.mock.calls.map(([path]) => path)).toEqual([parent, child]);
        expect(store.childrenOf(uuid(1)).map((t) => t.uuid)).toEqual([uuid(2)]);
    });

    it('reports each write as it lands, and stops at the first that fails', async () => {
        const { store, repo } = await storeWith([]);
        apiMocks.addNote.mockImplementationOnce(apiMocks.addNote.getMockImplementation()!);
        apiMocks.addNote.mockRejectedValueOnce(new Error('offline'));
        const written = vi.fn();

        await expect(store.saveAll([
            write(`.tasks/${uuid(1)}.md`),
            write(`.tasks/${uuid(2)}.md`),
            write(`.tasks/${uuid(3)}.md`),
        ], written)).rejects.toThrow('offline');

        expect(written).toHaveBeenCalledTimes(1);
        expect(repo.paths()).toEqual([`.tasks/${uuid(1)}.md`]);
    });
});

describe('setStatus', () => {
    it('rewrites the status alone and waits for the listing', async () => {
        const { store } = await storeWith(sample);
        const path = `.tasks/${uuid(3)}.md`;
        const before = '---\n# Why it matters\ntask:\n  status:\n    kind: todo\n  progress: 0\n---\n\n# Alpha\n';
        apiMocks.getNote.mockResolvedValueOnce({ data: before });
        const syncs = apiMocks.getEntries.mock.calls.length;

        await store.setStatus(path, { kind: 'blocked', blocked_by: 'the vendor' });

        expect(apiMocks.getNote).toHaveBeenCalledWith(path);
        expect(apiMocks.addNote).toHaveBeenCalledWith(
            path,
            before.replace('    kind: todo\n', '    kind: blocked\n    blocked_by: the vendor\n'),
        );
        expect(apiMocks.getEntries.mock.calls.length).toBeGreaterThan(syncs);
    });

    // The case settling on the path alone missed: the note is listed before the write as after it.
    // Two stale listings, because a refresh already asks twice when the first one lags; settling
    // is what waits beyond that.
    it('does not return while the listing still has the old status', async () => {
        const { store, repo } = await storeWith(sample);
        const path = `.tasks/${uuid(3)}.md`;
        apiMocks.getNote.mockResolvedValueOnce({ data: '---\ntask:\n  status:\n    kind: todo\n---\n' });
        repo.lag(2);

        await store.setStatus(path, { kind: 'in_progress' });

        expect(store.node(uuid(3))?.metadata?.task?.status?.kind).toBe('in_progress');
    });

    it('writes nothing when the note already has the status, but still syncs', async () => {
        const { store } = await storeWith([{ path: `.tasks/${uuid(3)}.md`, title: 'Alpha', status: 'blocked' }]);
        apiMocks.getNote.mockResolvedValueOnce({ data: '---\ntask:\n    status:\n        kind: blocked\n        blocked_by: the vendor\n---\n' });
        const syncs = apiMocks.getEntries.mock.calls.length;

        await store.setStatus(`.tasks/${uuid(3)}.md`, { kind: 'blocked', blocked_by: 'the vendor' });

        expect(apiMocks.addNote).not.toHaveBeenCalled();
        expect(apiMocks.getEntries.mock.calls.length).toBeGreaterThan(syncs);
    });

    it('writes nothing when the note cannot be edited in place', async () => {
        const { store } = await storeWith(sample);
        apiMocks.getNote.mockResolvedValueOnce({ data: '# No frontmatter\n' });
        await expect(store.setStatus(`.tasks/${uuid(3)}.md`, { kind: 'todo' })).rejects.toThrow();
        expect(apiMocks.addNote).not.toHaveBeenCalled();
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

    // Its subtasks live in the directory it names, which deleting its file leaves behind: they
    // would be shown at the top of the tree, with nothing to say what they were part of.
    it('refuses a task that has subtasks', async () => {
        const { store, repo } = await storeWith(sample);
        await expect(store.remove(`.tasks/${uuid(1)}.md`)).rejects.toThrow('subtasks');
        expect(apiMocks.deleteNote).not.toHaveBeenCalled();
        expect(repo.paths()).toContain(`.tasks/${uuid(1)}.md`);
        expect(store.childrenOf(uuid(1)).map((t) => t.title)).toEqual(['Child']);
    });

    // A view left open syncs only as it mounts, so a subtask added since -- through MCP, on another
    // device -- is not in the listing it holds.
    it('refuses a task given a subtask since the listing was read', async () => {
        const { store, repo } = await storeWith(sample);
        const parent = `.tasks/${uuid(3)}.md`;
        await apiMocks.addNote(`.tasks/${uuid(3)}/${uuid(9)}.md`, '---\ntask:\n    status:\n        kind: todo\n---\n');
        expect(store.childrenOf(uuid(3))).toEqual([]);

        await expect(store.remove(parent)).rejects.toThrow('subtasks');
        expect(repo.paths()).toContain(parent);
    });

    // A move renames the task's file before its subtasks', and in between the forest draws them at
    // the top of the tree: the task looks childless to a delete that does not wait for the move.
    it('refuses a task whose subtasks are still being moved with it', async () => {
        const { store } = await storeWith(sample);
        const moved = `.tasks/${uuid(3)}/${uuid(1)}.md`;
        const rename = apiMocks.renameNote.getMockImplementation()!;
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        apiMocks.renameNote
            .mockImplementationOnce(rename)
            .mockImplementationOnce(async (from: string, to: string) => {
                await held;
                return rename(from, to);
            });

        const moving = store.move(uuid(1), uuid(3));
        await vi.waitFor(() => expect(store.idByPath(moved)).toBe(uuid(1)));
        const refused = expect(store.remove(moved)).rejects.toThrow('subtasks');
        release();
        await moving;

        await refused;
        expect(apiMocks.deleteNote).not.toHaveBeenCalled();
    });
});

describe('parentForDrop', () => {
    it('moves a task under the task it is dropped on', async () => {
        const { store } = await storeWith(sample);
        expect(store.parentForDrop(uuid(2), uuid(3))).toBe(uuid(3));
        expect(store.parentForDrop(uuid(3), uuid(1))).toBe(uuid(1));
    });

    it('refuses the task itself, a task under it, and the parent it has', async () => {
        const { store } = await storeWith(sample);
        expect(store.parentForDrop(uuid(1), uuid(1))).toBeUndefined();
        expect(store.parentForDrop(uuid(1), uuid(2))).toBeUndefined();
        expect(store.parentForDrop(uuid(2), uuid(1))).toBeUndefined();
    });

    it('moves a task to the top when dropped on the group of its first tag', async () => {
        const { store, tagGroupId } = await storeWith([
            ...sample,
            { path: `.tasks/${uuid(1)}/${uuid(7)}.md`, title: 'Untagged child', day: 7 },
        ]);
        expect(store.parentForDrop(uuid(2), tagGroupId('work'))).toBeNull();
        expect(store.parentForDrop(uuid(7), tagGroupId('Untagged'))).toBeNull();
    });

    it('refuses the group of another tag, which the task would not land in', async () => {
        const { store, tagGroupId } = await storeWith([
            ...sample,
            { path: `.tasks/${uuid(1)}/${uuid(7)}.md`, title: 'Tagged twice', tags: ['home', 'work'], day: 7 },
        ]);
        expect(store.parentForDrop(uuid(2), tagGroupId('home'))).toBeUndefined();
        expect(store.parentForDrop(uuid(2), tagGroupId('Untagged'))).toBeUndefined();
        // Filed by its first tag only.
        expect(store.parentForDrop(uuid(7), tagGroupId('work'))).toBeUndefined();
        expect(store.parentForDrop(uuid(7), tagGroupId('home'))).toBeNull();
    });

    it('refuses its group to a task already at the top, with tasks under it or not', async () => {
        const { store, tagGroupId } = await storeWith(sample);
        expect(store.parentForDrop(uuid(3), tagGroupId('work'))).toBeUndefined();
        expect(store.parentForDrop(uuid(1), tagGroupId('work'))).toBeUndefined();
    });

    it('takes a task named with a readable prefix', async () => {
        const { store } = await storeWith([
            ...sample,
            { path: `.tasks/plan-${uuid(8)}.md`, title: 'Prefixed', day: 8 },
        ]);
        expect(store.parentForDrop(uuid(3), uuid(8))).toBe(uuid(8));
    });

    it('takes a parent re-rooted by a missing file, where the forest still finds its children', async () => {
        const { store } = await storeWith([
            { path: `.tasks/${uuid(1)}/${uuid(2)}.md`, title: 'Orphan' },
            { path: `.tasks/${uuid(3)}.md`, title: 'Moved' },
        ]);
        expect(store.parentForDrop(uuid(3), uuid(2))).toBe(uuid(2));
    });

    it('refuses a task it does not hold, dragged or dropped on', async () => {
        const { store } = await storeWith(sample);
        expect(store.parentForDrop('unknown', uuid(1))).toBeUndefined();
        expect(store.parentForDrop(uuid(3), 'unknown')).toBeUndefined();
    });
});

describe('move', () => {
    it('moves a task under a parent re-rooted by a missing file, where the forest finds it', async () => {
        const { store, repo } = await storeWith([
            { path: `.tasks/${uuid(1)}/${uuid(2)}.md`, title: 'Orphan' },
            { path: `.tasks/${uuid(3)}.md`, title: 'Moved' },
        ]);
        await store.move(uuid(3), uuid(2));

        expect(repo.paths()).toContain(`.tasks/${uuid(1)}/${uuid(2)}/${uuid(3)}.md`);
        expect(store.parentOf(uuid(3))).toBe(uuid(2));
    });

    it('renames the task and every descendant, preserving the nesting', async () => {
        const { store, repo } = await storeWith(sample);
        await store.move(uuid(1), uuid(4));

        expect(repo.paths()).toContain(`.tasks/${uuid(4)}/${uuid(1)}.md`);
        expect(repo.paths()).toContain(`.tasks/${uuid(4)}/${uuid(1)}/${uuid(2)}.md`);
        expect(store.parentOf(uuid(1))).toBe(uuid(4));
        expect(store.parentOf(uuid(2))).toBe(uuid(1));
    });

    // A readable name is the author's, and the tasks under it are in the directory named by its UUID.
    it('moves a task named with a readable prefix with its name, and the tasks under it', async () => {
        const { store, repo } = await storeWith([
            ...sample,
            { path: `.tasks/plan-${uuid(8)}.md`, title: 'Prefixed', day: 8 },
            { path: `.tasks/${uuid(8)}/${uuid(9)}.md`, title: 'Step', day: 9 },
        ]);
        expect(store.parentOf(uuid(9))).toBe(uuid(8));
        await store.move(uuid(8), uuid(4));

        expect(apiMocks.renameNote.mock.calls).toEqual([
            [`.tasks/plan-${uuid(8)}.md`, `.tasks/${uuid(4)}/plan-${uuid(8)}.md`],
            [`.tasks/${uuid(8)}/${uuid(9)}.md`, `.tasks/${uuid(4)}/${uuid(8)}/${uuid(9)}.md`],
        ]);
        expect(repo.paths()).toContain(`.tasks/${uuid(4)}/plan-${uuid(8)}.md`);
        expect(store.parentOf(uuid(8))).toBe(uuid(4));
        expect(store.parentOf(uuid(9))).toBe(uuid(8));
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

    it('moves a task from where the move before it put it, asked for while that one ran', async () => {
        const { store, repo } = await storeWith(sample);
        await Promise.all([store.move(uuid(1), uuid(4)), store.move(uuid(2), uuid(6))]);

        expect(apiMocks.renameNote.mock.calls).toEqual([
            [`.tasks/${uuid(1)}.md`, `.tasks/${uuid(4)}/${uuid(1)}.md`],
            [`.tasks/${uuid(1)}/${uuid(2)}.md`, `.tasks/${uuid(4)}/${uuid(1)}/${uuid(2)}.md`],
            [`.tasks/${uuid(4)}/${uuid(1)}/${uuid(2)}.md`, `.tasks/${uuid(6)}/${uuid(2)}.md`],
        ]);
        expect(repo.paths()).toContain(`.tasks/${uuid(6)}/${uuid(2)}.md`);
    });

    it('starts a move once the renames before it are done, without waiting for a sync', async () => {
        const { store } = await storeWith(sample);
        // The listing held back, as a slow sync holds it.
        let release!: () => void;
        const held = new Promise<void>((resolve) => { release = resolve; });
        const listing = apiMocks.getEntries.getMockImplementation()!;
        apiMocks.getEntries.mockImplementation(async (since) => {
            await held;
            return await listing(since);
        });

        const first = store.move(uuid(3), uuid(4));
        const second = store.move(uuid(5), uuid(4));
        await vi.waitFor(() => expect(apiMocks.renameNote).toHaveBeenCalledTimes(2));
        release();
        await Promise.all([first, second]);
        expect(store.parentOf(uuid(5))).toBe(uuid(4));
    });

    it('still runs a move asked for after one that failed', async () => {
        const { store } = await storeWith(sample);
        const refused = store.move(uuid(1), uuid(2));
        const moved = store.move(uuid(3), uuid(4));

        await expect(refused).rejects.toThrow(/descendant/);
        await moved;
        expect(store.parentOf(uuid(3))).toBe(uuid(4));
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

describe('derived parent progress', () => {
    it('combines an edited parent with its open descendants while keeping its own availability', async () => {
        const { store } = await storeWith([
            { path: `.tasks/${uuid(1)}.md` },
            { path: `.tasks/${uuid(1)}/${uuid(2)}.md`, deadline: '1970-01-01' },
        ]);
        const { urgencyOf } = await import('@/urgency');
        const edited = urgencyOf({ deadline: '2099-01-01', available_from: '2098-01-01' });
        const inherited = store.urgency(uuid(1), edited, 'todo');
        expect(inherited.level).toBe('overdue');
        expect(inherited.actionable).toBe(false);
        expect(inherited.short_window).toBe(edited.short_window);
        expect(store.urgency(uuid(1), edited, 'done')).toEqual(edited);
    });
    it('counts done leaves, excluding canceled leaves and intermediate parents', async () => {
        const { store } = await storeWith([
            { path: `.tasks/${uuid(1)}.md` },
            { path: `.tasks/${uuid(1)}/${uuid(2)}.md`, status: 'done' },
            { path: `.tasks/${uuid(1)}/${uuid(3)}.md`, status: 'done' },
            { path: `.tasks/${uuid(1)}/${uuid(3)}/${uuid(4)}.md`, status: 'todo' },
            { path: `.tasks/${uuid(1)}/${uuid(5)}.md`, status: 'canceled' },
        ]);
        expect(store.progress(uuid(1))).toBe(50);
        expect(store.progress(uuid(2))).toBeUndefined();
        expect(store.progress(uuid(3))).toBe(0);
    });
});

describe('own urgency', () => {
    // Worked out for every task at once and kept, so it must still follow each thing it depends on.
    it('follows the clock and the settings', async () => {
        const { store } = await storeWith([
            { path: `.tasks/${uuid(1)}.md`, deadline: '2026-10-20' },
        ]);
        const { useTaskSettingsStore } = await import('@/stores/taskSettings');
        const settings = useTaskSettingsStore();
        store.now = Date.parse('2026-10-10T00:00:00Z');
        // About ten days left, against the default week of lead time.
        expect(store.ownUrgency(uuid(1)).level).toBe('notice');

        settings.settings = { default_lead_time: '3 days' };
        expect(store.ownUrgency(uuid(1)).level).toBe('calm');

        store.now = Date.parse('2026-10-25T00:00:00Z');
        expect(store.ownUrgency(uuid(1)).level).toBe('overdue');
    });

    it('gives a tag group, or a task no longer listed, no urgency', async () => {
        const { store, tagGroupId } = await storeWith(sample);
        for (const id of [tagGroupId('work'), uuid(99)]) {
            expect(store.ownUrgency(id)).toMatchObject({ level: 'none', actionable: true });
        }
    });
});
