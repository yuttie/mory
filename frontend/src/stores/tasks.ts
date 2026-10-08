import { urgencyOf, mostUrgent, type Urgency } from '@/urgency';
import { useTaskSettingsStore } from '@/stores/taskSettings';
import { onScopeDispose, ref, computed } from 'vue';
import { defineStore } from 'pinia';
import dayjs from 'dayjs';

import type { UUID } from '@/api';
import {
    ancestors,
    childNodes,
    descendants,
    flatten,
    groupRoots,
    nodesOf,
    toNestedForest,
} from '@/forest';
import { buildPathForest, stripExtension } from '@/path-forest';
import { render, replaceStatus } from '@/task';
import type { Status, Task } from '@/task';
import { TASKS_DIR, buildTaskPath, childTaskPath, taskPolicy } from '@/task-forest';
import type { TaskMetadata, TaskNode, TaskTreeItem } from '@/task-forest';
import { useEntrySubset } from '@/composables/entrySubset';
import { useFilesStore } from '@/stores/files';

// The task forest, derived from the file listing rather than fetched.
//
// Tasks are files under `.tasks/`, so the forest is a pure function of entries the files store
// already holds, syncs incrementally and caches in IndexedDB. Deriving it rather than fetching it
// from `/v2/tasks?format=tree` removes a second, non-incremental listing *and* the class of bug
// that came with it: this store keeps no local copy of the forest, so there is nothing a server
// response can contradict. A task created here appears the moment the write is visible in the
// listing, and cannot be erased by a response describing an earlier commit.

// Root tasks with no children are grouped under a virtual node per tag, so that a flat pile of
// unrelated tasks reads as a set of lists rather than one long root.
const TAG_GROUP_PREFIX = 'tag-group-';
const UNTAGGED = 'Untagged';

export function isTagGroupId(id: string): boolean {
    return id.startsWith(TAG_GROUP_PREFIX);
}

export function tagGroupId(tag: string): string {
    return TAG_GROUP_PREFIX + tag;
}

// The tag a group node stands for. Only meaningful for an id `isTagGroupId` accepts.
export function tagNameOf(id: string): string {
    return id.slice(TAG_GROUP_PREFIX.length);
}

// The catch-all gathers tasks by the absence of a tag, so its name is not a tag to give a task
// created from it: written into the frontmatter, "Untagged" would become one.
export function isUntaggedGroupId(id: string): boolean {
    return id === tagGroupId(UNTAGGED);
}

function firstTagOf(node: TaskNode): string {
    const tags = node.metadata?.tags;
    if (Array.isArray(tags) && tags.length > 0 && tags[0]) {
        return String(tags[0]);
    }
    return UNTAGGED;
}

// Alphabetical, with the catch-all last: it is where a task lands by omission, not by choice.
function compareTagNames(a: string, b: string): number {
    if (a === b) {
        return 0;
    }
    if (a === UNTAGGED) {
        return 1;
    }
    if (b === UNTAGGED) {
        return -1;
    }
    return a.localeCompare(b);
}

// A tag group is not a file, so its node is invented. `mtime` is a fixed empty string rather than
// the current time: it is compared and rendered like any other node's, and a value that changed on
// every recompute made the node look new each time it was read.
function tagGroupNode(tag: string): TaskNode {
    return {
        id: tagGroupId(tag),
        parent: null,
        uuid: tagGroupId(tag),
        name: null,
        path: `.tags/${tag}`,
        size: 0,
        mime_type: 'application/x-tag-group',
        metadata: { tag_group: tag },
        title: tag,
        mtime: '',
    };
}

function toItem(node: TaskNode, children: TaskTreeItem[] | undefined): TaskTreeItem {
    return children === undefined ? { ...node } : { ...node, children };
}

export const useTasksStore = defineStore('tasks', () => {
    const files = useFilesStore();
    const taskSettings = useTaskSettingsStore();
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

    // Roots that own a subtree stay top-level; the rest are what the tag groups gather.
    const leafRootIds = computed(() => forest.value.roots.filter(
        (id) => (forest.value.childrenOf.get(id)?.length ?? 0) === 0,
    ));
    const parentRootIds = computed(() => forest.value.roots.filter(
        (id) => (forest.value.childrenOf.get(id)?.length ?? 0) > 0,
    ));

    const tagGroupItems = computed<TaskTreeItem[]>(() => groupRoots<TaskNode, TaskTreeItem>(
        forest.value,
        leafRootIds.value,
        firstTagOf,
        compareTagNames,
        (tag, members) => ({ ...tagGroupNode(tag), children: members }),
        (node) => ({ ...node }),
    ));

    const tagGroupById = computed(() => {
        const index = new Map<string, TaskTreeItem>();
        for (const item of tagGroupItems.value) {
            index.set(item.uuid, item);
        }
        return index;
    });

    // --- Accessors. Tag-group aware, so a view can treat a virtual node like any other. ---

    function node(id: string): TaskNode | undefined {
        if (isTagGroupId(id)) {
            return tagGroupById.value.get(id);
        }
        return forest.value.byId.get(id);
    }

    function childrenOf(id: string): TaskNode[] {
        if (isTagGroupId(id)) {
            return tagGroupById.value.get(id)?.children ?? [];
        }
        return childNodes(forest.value, id);
    }

    function parentOf(id: string): string | null {
        if (isTagGroupId(id)) {
            return null;
        }
        const current = forest.value.byId.get(id);
        if (current === undefined) {
            return null;
        }
        if (current.parent !== null) {
            return current.parent;
        }
        // A childless root is displayed inside its tag group, so that is its parent in the tree
        // the user actually sees -- which is what expanding to a selected node walks.
        if ((forest.value.childrenOf.get(id)?.length ?? 0) === 0) {
            return tagGroupId(firstTagOf(current));
        }
        return null;
    }

    // The tasks above one, root first. Structural, unlike `parentOf`: a tag group only arranges the
    // tree and is no task's ancestor.
    //
    // Given `below`, only the ones under it: a list of `below`'s descendants shows `below` and
    // everything above it on every item alike. A `below` the task is not under keeps them all.
    function ancestorsOf(id: string, below?: string): TaskNode[] {
        const chain = nodesOf(forest.value, ancestors(forest.value, id).reverse());
        const belowIndex = chain.findIndex((node) => node.id === below);
        return chain.slice(belowIndex + 1);
    }

    function idByPath(path: string): UUID | undefined {
        return pathToUuid.value.get(path);
    }

    function flattenDescendants(id: UUID): TaskNode[] {
        return nodesOf(forest.value, descendants(forest.value, id));
    }

    // Every task's own urgency, worked out in one pass. It changes only with the listing, the
    // settings and the minute, but each row of the task tree asks again whenever the tree
    // re-renders, and `urgencyOf` left to itself guesses the time zone on every call -- the costly
    // part, at about a tenth of the time it took to open a parent. One guess per pass instead.
    const ownUrgencies = computed(() => {
        const zone = dayjs.tz.guess();
        const byId = new Map<string, Urgency>();
        for (const task of forest.value.byId.values()) {
            byId.set(task.id, urgencyOf(task.metadata?.task ?? {}, task.metadata?.tags ?? [], taskSettings.settings, now.value, zone));
        }
        // What a tag group, or an id the listing no longer holds, has: no task, so no dates.
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
        if (childrenOf(id).length === 0 || isTagGroupId(id)) {
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
            const cover = stripExtension(node.path);
            if (!index.has(cover)) {
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

    // Where the task `id` belongs under `parent`, or at the top for `null`: in a directory named
    // after the parent, beside the parent's own file. For a file named by its UUID alone, as tasks
    // are written, that is the directory the file covers, where the forest looks for its children.
    // A task created there and one moved there land at the same path.
    //
    // Not a directory per ancestor the forest gives the parent: a parent whose own parent's file is
    // gone is re-rooted and has none, though its file still sits in that parent's directory. And
    // not the cover itself: a file with a readable prefix covers a directory no task may be in, and
    // a task beside it is at least still a task.
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

    // --- Mutations. Server first, then wait for the listing to show the result. ---

    async function save(task: Task, path: string): Promise<void> {
        await files.write(path, render(task));
        await subset.settle(path, true);
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

    async function remove(path: string): Promise<boolean> {
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
    async function move(id: UUID, newParent: UUID | null): Promise<void> {
        const current = forest.value.byId.get(id);
        if (current === undefined) {
            throw new Error(`Cannot move an unknown task: ${id}`);
        }
        if (current.parent === newParent) {
            return;
        }
        if (newParent !== null && descendants(forest.value, id).includes(newParent)) {
            throw new Error('A task cannot be moved under one of its own descendants.');
        }

        const oldPath = current.path;
        const newPath = pathUnder(newParent, id);
        if (oldPath === newPath) {
            return;
        }

        // Deepest last, so a descendant is only moved once its new home exists.
        const oldDirectory = stripExtension(oldPath);
        const newDirectory = stripExtension(newPath);
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
        await subset.settle(newPath, true);
    }

    const allTasks = computed<TaskNode[]>(() => flatten(forest.value));

    // What a task's fields offer to fill in, most used first: the tags and the waiting-for
    // contacts the tasks already carry.
    const knownTags = computed<[string, number][]>(() => {
        const tagCounts = new Map<string, number>();
        for (const node of allTasks.value) {
            for (const tag of node.metadata?.tags ?? []) {
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

        // The structural forest, without the tag grouping: what "choose a parent" browses.
        tree: computed<TaskTreeItem[]>(
            () => toNestedForest(forest.value, forest.value.roots, toItem),
        ),
        // The forest as the task tree shows it: real parent tasks, then a node per tag.
        treeWithTagGroups: computed<TaskTreeItem[]>(() => [
            ...toNestedForest(forest.value, parentRootIds.value, toItem),
            ...tagGroupItems.value,
        ]),

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
        idByPath,
        parentAt,
        pathUnder,
        flattenDescendants,

        init: subset.init,
        refresh: subset.refresh,
        save,
        setStatus,
        remove,
        move,
    };
});
