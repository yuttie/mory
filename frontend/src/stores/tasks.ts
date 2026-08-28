import { computed } from 'vue';
import { defineStore } from 'pinia';

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
import { render } from '@/task';
import type { Task } from '@/task';
import { TASKS_DIR, buildTaskPath, taskPolicy } from '@/task-forest';
import type { TaskNode, TaskTreeItem } from '@/task-forest';
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

    function idByPath(path: string): UUID | undefined {
        return pathToUuid.value.get(path);
    }

    function flattenDescendants(id: UUID): TaskNode[] {
        return nodesOf(forest.value, descendants(forest.value, id));
    }

    // --- Mutations. Server first, then wait for the listing to show the result. ---

    async function save(task: Task, path: string): Promise<void> {
        await files.write(path, render(task));
        await subset.settle(path, true);
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

        const parentChain = newParent === null
            ? []
            : [...ancestors(forest.value, newParent)].reverse().concat(newParent);
        const oldPath = current.path;
        const newPath = buildTaskPath(parentChain, id);
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

        allTasks: computed<TaskNode[]>(() => flatten(forest.value)),

        // === Actions ===
        node,
        childrenOf,
        parentOf,
        idByPath,
        flattenDescendants,

        init: subset.init,
        refresh: subset.refresh,
        save,
        remove,
        move,
    };
});
