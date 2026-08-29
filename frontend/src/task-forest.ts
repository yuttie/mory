// The task tree's flavour of the shared path-forest rule.
//
// Tasks are Markdown files under `.tasks/`, named by a UUIDv4 and nested by directory:
// `.tasks/<a>/<b>.md` is the task `b` under the task `a`. The parenting rule itself lives in
// `path-forest.ts` -- `.tasks/<a>.md` covers the directory `.tasks/<a>`, so `b`'s parent is the
// file `a` -- and this module supplies only what is task-specific: identity by UUID, the
// validation the backend applied, and the sibling order it produced.

import type { UUID } from '@/api';
import type { Status } from '@/task';
import type { ForestNode } from '@/forest';
import type { PathForestPolicy } from '@/path-forest';
import { stripExtension } from '@/path-forest';
import { compareInstantsDesc } from '@/utils';

export const TASKS_DIR = '.tasks/';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface TaskMetadata {
    tags?: string[];
    task?: {
        status?: Status;
        progress?: number;
        importance?: number;
        urgency?: number;
        start_at?: string;
        due_by?: string;
        deadline?: string;
        scheduled_dates?: string[];
    };
    // Virtual tag-group nodes only; a real task never carries this.
    tag_group?: string;
}

// A task, as the tree and the list views see it.
//
// The listing's fields are carried flat rather than behind an `entry` reference, because a task
// node always has a backing entry -- unlike a note tree, where a directory node has none. `uuid`
// duplicates `id` so that `item-value="uuid"` and every template reading `node.uuid` keep working.
export interface TaskNode extends ForestNode {
    id: UUID;
    parent: UUID | null;
    uuid: UUID;
    name: string | null;
    path: string;
    size: number;
    mime_type: string;
    metadata: TaskMetadata | null;
    title: string | null;
    mtime: string;
}

// The nested shape v-treeview consumes. `children` is absent, not empty, on a leaf: the tree
// picks its folder icon by whether the property exists at all.
export interface TaskTreeItem extends TaskNode {
    children?: TaskTreeItem[];
}

export function isTaskPath(path: string): boolean {
    return path.startsWith(TASKS_DIR);
}

// The UUID a filename stem ends with, plus whatever name precedes it.
//
// Ported from the backend's `parse_file_uuid`: the stem must end with a UUIDv4, and anything
// before it -- minus a separating '-' -- is a human-readable name.
function parseStem(stem: string): { uuid: UUID; name: string | null } | null {
    if (stem.length < 36) {
        return null;
    }
    const uuid = stem.slice(-36);
    if (!UUID_V4_RE.test(uuid)) {
        return null;
    }
    const leading = stem.slice(0, -36).replace(/-$/, '');
    return { uuid, name: leading === '' ? null : leading };
}

function stemOf(path: string): string {
    const withoutExtension = stripExtension(path);
    return withoutExtension.slice(withoutExtension.lastIndexOf('/') + 1);
}

// A path is a task's only if it lies under `.tasks/`, every directory below that is a UUIDv4, and
// the filename stem ends with one. Ported from the backend's `validate_path_constraints`; a path
// that fails is skipped rather than fatal, because a stray file in `.tasks/` should cost one
// console line, not the whole view. (`entries_to_tree` bails, and `get_tasks` unwraps that into a
// 500.)
export function taskUuidOf(path: string): UUID | null {
    if (!isTaskPath(path)) {
        return null;
    }
    const components = path.slice(TASKS_DIR.length).split('/');
    const filename = components.pop();
    if (filename === undefined) {
        return null;
    }
    for (const directory of components) {
        if (!UUID_V4_RE.test(directory)) {
            return null;
        }
    }
    return parseStem(stemOf(filename))?.uuid ?? null;
}

// Newest first, as `sort_forest` served it. The backend compares `DateTime` values, so this has
// to compare instants rather than the RFC3339 text -- see `compareInstantsDesc`.
export function compareByMtimeDesc(a: TaskNode, b: TaskNode): number {
    // Ties would otherwise reorder between renders, which makes the tree jump.
    return compareInstantsDesc(a.mtime, b.mtime) || a.uuid.localeCompare(b.uuid);
}

export const taskPolicy: PathForestPolicy<TaskNode> = {
    idOf: (entry) => taskUuidOf(entry.path),

    coverOf: (entry) => stripExtension(entry.path),

    node: (entry, id, parent) => ({
        id,
        parent,
        uuid: id,
        name: parseStem(stemOf(entry.path))?.name ?? null,
        path: entry.path,
        size: entry.size,
        mime_type: entry.mime_type,
        metadata: entry.metadata as TaskMetadata | null,
        title: entry.title,
        mtime: entry.time,
    }),

    // A directory under `.tasks/` with no task file covering it is an anomaly, not structure --
    // and a routine one: moving a subtree renames the parent before its children, so between
    // those renames the children's directory has no covering file. Re-rooting them for those few
    // hundred milliseconds is right; inventing a node for the directory is not.
    directory: () => null,

    sort: compareByMtimeDesc,
};

// Where a task's file belongs, given its parent: `.tasks/<ancestors...>/<uuid>.md`.
export function buildTaskPath(ancestorsRootFirst: readonly UUID[], uuid: UUID): string {
    return TASKS_DIR + [...ancestorsRootFirst, uuid].join('/') + '.md';
}
