import { urgencyOf, mostUrgent, type Urgency } from '@/urgency';
import { useTaskSettingsStore } from '@/stores/taskSettings';
import { useZoneStore } from '@/stores/zone';
import { onScopeDispose, ref, computed } from 'vue';
import { defineStore } from 'pinia';
import axios from 'axios';

import type { UUID } from '@/api';
import {
    ancestors,
    childNodes,
    descendants,
    flatten,
    nodesOf,
    toNestedForest,
} from '@/forest';
import { buildPathForest } from '@/path-forest';
import { render, replaceStatus } from '@/task';
import type { Status, Task } from '@/task';
import {
    TASKS_DIR,
    buildTaskPath,
    childTaskPath,
    inStatusOrder,
    taskDirectoryOf,
    taskPolicy,
} from '@/task-forest';
import type { TaskMetadata, TaskNode, TaskTreeItem } from '@/task-forest';
import { useEntrySubset } from '@/composables/entrySubset';
import { useFilesStore } from '@/stores/files';
import { tagsOf } from '@/tags';

// The task forest, derived from the file listing rather than fetched.
//
// Tasks are files under `.tasks/`, so the forest is a pure function of entries the files store
// already holds, syncs incrementally and caches in IndexedDB. Deriving it rather than fetching it
// from `/v2/tasks?format=tree` removes a second, non-incremental listing *and* the class of bug
// that came with it: this store keeps no local copy of the forest, so there is nothing a server
// response can contradict. A task created here appears the moment the write is visible in the
// listing, and cannot be erased by a response describing an earlier commit.

// A save that landed, though the listing could not be brought to show it. No failed save: one tried
// again would be checked against the version read before it, find this one there, and be refused
// as a change made elsewhere. `written` is the ETag the save left, as `save` resolves to.
export class SavedUnlisted extends Error {
    constructor(readonly written: string | undefined, cause: unknown) {
        super(
            `the task list could not be refreshed: ${cause instanceof Error ? cause.message : String(cause)}`,
            { cause },
        );
        this.name = 'SavedUnlisted';
    }
}

// The titles a task's row in a list names it by.
export interface RowTitles {
    own: string;
    // Of the tasks above it, root first.
    ancestors: string[];
}

function toItem(node: TaskNode, children: TaskTreeItem[] | undefined): TaskTreeItem {
    return children === undefined ? { ...node } : { ...node, children };
}

export const useTasksStore = defineStore('tasks', () => {
    const files = useFilesStore();
    const taskSettings = useTaskSettingsStore();
    const zones = useZoneStore();
    const now = ref(Date.now());
    const timer = setInterval(() => { now.value = Date.now(); }, 60_000);
    onScopeDispose(() => clearInterval(timer));
    const subset = useEntrySubset(TASKS_DIR);

    const forest = computed(() => buildPathForest(subset.entries.value, TASKS_DIR, taskPolicy));

    const pathToUuid = computed(() => {
        const index = new Map<string, UUID>();
        for (const node of forest.value.byId.values()) {
            index.set(node.path, node.id);
        }
        return index;
    });

    function node(id: string): TaskNode | undefined {
        return forest.value.byId.get(id);
    }

    function childrenOf(id: string): TaskNode[] {
        return childNodes(forest.value, id);
    }

    function parentOf(id: string): string | null {
        return forest.value.byId.get(id)?.parent ?? null;
    }

    // The tasks above one, root first.
    //
    // Given `below`, only the ones under it: a list of `below`'s descendants shows `below` and
    // everything above it on every item alike. A `below` the task is not under keeps them all.
    function ancestorsOf(id: string, below?: string): TaskNode[] {
        const chain = nodesOf(forest.value, ancestors(forest.value, id).reverse());
        const belowIndex = chain.findIndex((node) => node.id === below);
        return chain.slice(belowIndex + 1);
    }

    // The titles a task's row in a list draws: its own, and those of the tasks above it under
    // `below`, as `ancestorsOf` takes them, a task without one drawn as Untitled.
    function rowTitles(task: TaskNode, below?: string): RowTitles {
        return {
            own: task.title || 'Untitled',
            ancestors: ancestorsOf(task.uuid, below).map((node) => node.title || 'Untitled'),
        };
    }

    function idByPath(path: string): UUID | undefined {
        return pathToUuid.value.get(path);
    }

    function flattenDescendants(id: UUID): TaskNode[] {
        return nodesOf(forest.value, descendants(forest.value, id));
    }

    // Every task's own urgency, worked out in one pass. It changes only with the listing, the
    // settings, the zone and the minute, but each row of the task tree asks again whenever the
    // tree re-renders.
    const ownUrgencies = computed(() => {
        const zone = zones.zone;
        const byId = new Map<string, Urgency>();
        for (const task of forest.value.byId.values()) {
            byId.set(task.id, urgencyOf(task.metadata?.task ?? {}, task.metadata?.tags ?? [], taskSettings.settings, now.value, zone));
        }
        // What an id the listing no longer holds has: no task, so no dates.
        const none = urgencyOf({}, [], taskSettings.settings, now.value, zone);
        return { byId, none };
    });

    function ownUrgency(id: string): Urgency {
        const { byId, none } = ownUrgencies.value;
        return byId.get(id) ?? none;
    }

    function urgency(id: string, own = ownUrgency(id), status = node(id)?.metadata?.task?.status?.kind): Urgency {
        if (status === 'done' || status === 'canceled') {
            return own;
        }
        const descendants = flattenDescendants(id).filter((task) => !['done', 'canceled'].includes(task.metadata?.task?.status?.kind ?? ''));
        const highest = mostUrgent([own, ...descendants.map((task) => ownUrgency(task.uuid))]);
        return { ...highest, actionable: own.actionable, short_window: own.short_window };
    }

    function progress(id: string): number | undefined {
        if (childrenOf(id).length === 0) {
            return undefined;
        }
        const leaves = flattenDescendants(id).filter((task) => childrenOf(task.uuid).length === 0);
        const counted = leaves.filter((task) => task.metadata?.task?.status?.kind !== 'canceled');
        return counted.length > 0 ? counted.filter((task) => task.metadata?.task?.status?.kind === 'done').length / counted.length * 100 : 0;
    }

    // Each task by the directory its file covers, the first where two claim one, as the forest
    // takes them.
    const byCover = computed(() => {
        const index = new Map<string, TaskNode>();
        for (const node of forest.value.byId.values()) {
            const cover = taskDirectoryOf(node.path);
            if (cover !== null && !index.has(cover)) {
                index.set(cover, node);
            }
        }
        return index;
    });

    // The task one at `path` sits under, by the forest's own rule, whether or not the listing holds
    // `path` yet: the task whose file covers the directory `path` is in. `undefined` at the top.
    function parentAt(path: string): TaskNode | undefined {
        return byCover.value.get(path.slice(0, path.lastIndexOf('/')));
    }

    // Where the task `id` belongs under `parent`, or at the top for `null`: in the directory the
    // parent's file covers, where the forest looks for its children. A task created there and one
    // moved there land in the same directory.
    //
    // Not a directory per ancestor the forest gives the parent: a parent whose own parent's file is
    // gone is re-rooted and has none, though its file still sits in that parent's directory.
    function pathUnder(parent: UUID | null, id: UUID): string {
        if (parent === null) {
            return buildTaskPath([], id);
        }
        const node = forest.value.byId.get(parent);
        if (node === undefined) {
            throw new Error(`Cannot place a task under an unknown task: ${parent}`);
        }
        return childTaskPath(node.path, node.uuid, id);
    }

    // The parent the task `id` moves to when dropped on the task tree's row `target`: the task
    // dropped on. `undefined` where the drop would change nothing or cannot be made: on the task
    // itself or one under it, or on the parent it has. No row stands for the top, so a task goes
    // there from the editor's parent dialog.
    function parentForDrop(id: UUID, target: string): UUID | null | undefined {
        const current = forest.value.byId.get(id);
        if (current === undefined) {
            return undefined;
        }
        if (!forest.value.byId.has(target)) {
            return undefined;
        }
        if (target === id || target === current.parent || descendants(forest.value, id).includes(target)) {
            return undefined;
        }
        return target;
    }

    // --- Mutations. Server first, then wait for the listing to show the result. ---

    // Resolves to the ETag of the note it wrote over, for the editor's next save to check against.
    // Rejects with `SavedUnlisted` when it wrote, but the listing could not be refreshed.
    async function save(task: Task, path: string): Promise<string | undefined> {
        const content = render(task);
        let written: string | undefined;
        // Only over the note it was read from. The editor stays open after a save, so the note can
        // move on while it is -- completed through MCP, its dates set on another device -- and
        // writing the form over that would undo it unannounced. A note read without an ETag is
        // refused as one that changed, rather than written over unchecked. A task not read from a
        // note is a new one, written only where there is none: a read that failed leaves the
        // editor holding no task, and offering to create one over the note it could not read.
        try {
            written = await files.writeChecked(
                path,
                content,
                task.source === undefined ? 'absent' : task.etag ?? 'absent',
            );
        }
        catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 412) {
                throw new Error(
                    task.source === undefined
                        ? 'A note is already there, which could not be read, so creating this task '
                            + 'would replace it. Copy anything you want to keep, then close it and '
                            + 'open it again.'
                        : 'The task changed elsewhere since it was opened. Copy anything you want to '
                            + 'keep, then close it and open it again.',
                    { cause: error },
                );
            }
            throw error;
        }
        try {
            await subset.settle(path, true);
        }
        catch (error) {
            throw new SavedUnlisted(written, error);
        }
        return written;
    }

    // Write new tasks in the order given, which must put each after the one it sits under, and
    // wait for the listing to hold them all. Each write is a commit of its own, so a failure part
    // way leaves the ones before it written: `written` hears of each as it lands, for a caller to
    // carry on from the next one rather than write any twice.
    async function saveAll(writes: readonly { path: string; markdown: string }[], written?: () => void): Promise<void> {
        for (const { path, markdown } of writes) {
            await files.write(path, markdown);
            written?.();
        }
        // The listing is of a commit, so the one holding the last write holds the rest.
        const last = writes.at(-1);
        if (last !== undefined) {
            await subset.settle(last.path, true);
        }
    }

    // Change the status alone. `save` regenerates the whole note from a `Task`, which only the
    // editor holds; this reads the note as it stands and rewrites nothing but the status.
    async function setStatus(path: string, status: Status): Promise<void> {
        const content = await files.read(path);
        const edited = replaceStatus(content, status);
        // A note that already says so was changed by something the listing had not caught up
        // with. Nothing to write, but the listing still wants the sync.
        if (edited !== content) {
            await files.write(path, edited);
        }
        // The note is listed before the write as after it, so its path shows nothing: the status
        // the listing gives it does. Returning before that would let a caller drawing the task in
        // its new column meanwhile hand it back to a listing that still has it in the old one.
        await subset.settle(
            path,
            (entry) => (entry.metadata as TaskMetadata | null)?.task?.status?.kind === status.kind,
        );
    }

    // Only a task with nothing under it. Its subtasks live in the directory it names, which
    // deleting its file leaves behind: they would be drawn at the top of the tree, with nothing to
    // say what they were part of. Asked once any move is done, as a move renames the task's file
    // before its subtasks' and the forest draws them at the top in between, and of the listing as
    // it is now: a view left open syncs only as it mounts, and a subtask added since, through MCP
    // or on another device, is not in the listing it holds.
    async function remove(path: string): Promise<boolean> {
        await renaming;
        await subset.refresh();
        const id = idByPath(path);
        if (id !== undefined && childrenOf(id).length > 0) {
            throw new Error('It has subtasks. Delete them, or move them elsewhere, first.');
        }
        const deleted = await files.remove(path);
        if (deleted) {
            await subset.settle(path, false);
        }
        return deleted;
    }

    // Move a task and everything under it.
    //
    // The hierarchy is the directory layout, so a move is a rename per file. Between those renames
    // the listing describes a subtree whose parent has already moved; the forest builder re-roots
    // the stragglers for that window rather than failing, and the final sync settles it.
    //
    // Moves run one at a time, each once the renames of the one before are done. A move reads from
    // the forest which files to rename and where to, and one still renaming leaves it half moved: a
    // task under it, moved meanwhile, would be renamed by both. Each rename is in the listing this
    // store reads as soon as it is done, so the next move need not wait for a sync to show it too.
    let renaming: Promise<unknown> = Promise.resolve();

    function move(id: UUID, newParent: UUID | null): Promise<void> {
        const renamed = renaming.then(() => renameSubtree(id, newParent));
        renaming = renamed.catch(() => undefined);
        return renamed.then((path) => path === null ? undefined : subset.settle(path, true));
    }

    // Renames the files of a move, and gives the task's new path, or null for a move that changes
    // nothing.
    async function renameSubtree(id: UUID, newParent: UUID | null): Promise<string | null> {
        const current = forest.value.byId.get(id);
        if (current === undefined) {
            throw new Error(`Cannot move an unknown task: ${id}`);
        }
        if (current.parent === newParent) {
            return null;
        }
        if (newParent !== null && descendants(forest.value, id).includes(newParent)) {
            throw new Error('A task cannot be moved under one of its own descendants.');
        }

        // The file keeps its name, and a readable one with it, in the directory it moves to. Its
        // own tasks are in the directory named by its UUID beside it, whatever its name.
        const oldPath = current.path;
        const oldParentDirectory = oldPath.slice(0, oldPath.lastIndexOf('/'));
        const placed = pathUnder(newParent, id);
        const newParentDirectory = placed.slice(0, placed.lastIndexOf('/'));
        const newPath = newParentDirectory + oldPath.slice(oldParentDirectory.length);
        if (oldPath === newPath) {
            return null;
        }

        // Deepest last, so a descendant is only moved once its new home exists.
        const oldDirectory = `${oldParentDirectory}/${id}`;
        const newDirectory = `${newParentDirectory}/${id}`;
        const moves: [string, string][] = [[oldPath, newPath]];
        for (const descendant of nodesOf(forest.value, descendants(forest.value, id))) {
            moves.push([
                descendant.path,
                newDirectory + descendant.path.slice(oldDirectory.length),
            ]);
        }

        for (const [from, to] of moves) {
            await files.rename(from, to);
        }
        return newPath;
    }

    const allTasks = computed<TaskNode[]>(() => flatten(forest.value));

    // What a task's fields offer to fill in, most used first: the tags and the waiting-for
    // contacts the tasks already carry.
    const knownTags = computed<[string, number][]>(() => {
        const tagCounts = new Map<string, number>();
        for (const node of allTasks.value) {
            for (const tag of tagsOf(node.metadata)) {
                tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
            }
        }
        return Array.from(tagCounts)
            .sort(([_tag1, count1], [_tag2, count2]) => count2 - count1);
    });

    const knownContacts = computed<[string, number][]>(() => {
        const contactCounts = new Map<string, number>();
        for (const node of allTasks.value) {
            const status = node.metadata?.task?.status;
            const contact = status?.kind === 'waiting' ? status.contact : undefined;
            if (contact && contact.trim() !== '') {
                contactCounts.set(contact, (contactCounts.get(contact) ?? 0) + 1);
            }
        }
        return Array.from(contactCounts)
            .sort(([_contact1, count1], [_contact2, count2]) => count2 - count1);
    });

    return {
        // === Getters ===
        isLoaded: computed(() => subset.hasLoadedOnce.value),
        isLoading: computed(() => files.isLoading),
        hasData: computed(() => forest.value.byId.size > 0),

        // The forest as the task tree, and every dialog choosing a parent, draws it: in the order
        // the statuses give, where the lists take the forest's own.
        tree: computed<TaskTreeItem[]>(() => {
            const ordered = inStatusOrder(forest.value);
            return toNestedForest(ordered, ordered.roots, toItem);
        }),

        allTasks,
        knownTags,
        knownContacts,

        // === Actions ===
        node,
        urgency,
        now,
        ownUrgency,
        progress,
        childrenOf,
        parentOf,
        ancestorsOf,
        rowTitles,
        idByPath,
        parentAt,
        pathUnder,
        parentForDrop,
        flattenDescendants,

        init: subset.init,
        refresh: subset.refresh,
        save,
        saveAll,
        setStatus,
        remove,
        move,
    };
});
