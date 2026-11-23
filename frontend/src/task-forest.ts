// The task tree's flavour of the shared path-forest rule.
//
// Tasks are Markdown files under `.tasks/`, named by a UUIDv4 and nested by directory:
// `.tasks/<a>/<b>.md` is the task `b` under the task `a`. The parenting rule itself lives in
// `path-forest.ts` -- `.tasks/<a>.md` covers the directory `.tasks/<a>`, so `b`'s parent is the
// file `a` -- and this module supplies only what is task-specific: identity by UUID, the
// directory a file covers, the validation the backend applied, and the sibling order it produced.

import type { UUID } from '@/api';
import type { Status, StatusKind } from '@/task';
import type { Importance } from '@/urgency';
import type { Forest, ForestNode } from '@/forest';
import { sortForest } from '@/forest';
import type { PathForestPolicy } from '@/path-forest';
import { stripExtension } from '@/path-forest';
import { compareInstantsDesc } from '@/utils';

export const TASKS_DIR = '.tasks/';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface TaskMetadata {
    created_at?: string;
    tags?: string[];
    task?: {
        status?: Status;
        importance?: Importance | number;
        available_from?: string;
        lead_time?: string;
        start_at?: string;
        due_by?: string;
        deadline?: string;
        // `task.alarms` as the frontmatter held it: `readTaskAlarms` gives it its shape.
        alarms?: unknown;
    };
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

// Where a status puts a task among its siblings in the task tree, first to last: the work under
// way, the work to take on, then the work over with. On hold comes before Backlog, being work begun
// and paused -- it resumes to In progress, never to To do -- where a task in the backlog may never
// begin. Done and Canceled share a place, so the task closed last comes first whichever way it
// closed.
const STATUS_RANK: Record<StatusKind, number> = {
    in_progress: 0,
    waiting: 1,
    blocked: 2,
    todo: 3,
    on_hold: 4,
    backlog: 5,
    done: 6,
    canceled: 6,
};

// The work under way, which lifts every task above it to its place.
const UNDER_WAY: ReadonlySet<StatusKind> = new Set(['in_progress', 'waiting', 'blocked']);

// The status a task is drawn with (`statusIcon`): Backlog for one naming none, and To do, as not
// yet finished, for one naming a status there is none of.
function drawnStatus(node: TaskNode): StatusKind {
    const kind: unknown = node.metadata?.task?.status?.kind ?? 'backlog';
    return typeof kind === 'string' && Object.hasOwn(STATUS_RANK, kind) ? kind as StatusKind : 'todo';
}

// The forest as the task tree draws it: every list of siblings, the roots included, in the order
// their statuses give, and newest change first within one place.
//
// A task with work under way anywhere below it takes the place of the most active of that work, so
// a project whose step is in progress is drawn among the tasks in progress. Work below that is not
// under way moves it nowhere: an On hold project stays on hold whatever is left to do in it. A task
// done or canceled keeps its own place, as it keeps its own urgency, though what is under way below
// it still lifts the tasks above it.
//
// A copy: the store's forest keeps the order the lists beside the tree take.
export function inStatusOrder(forest: Forest<TaskNode>): Forest<TaskNode> {
    const place = new Map<string, number>();
    // Places the task `id` and everything below it, and gives the place of the work under way
    // there, the most active first, or Infinity for none.
    function visit(id: string): number {
        const status = drawnStatus(forest.byId.get(id) as TaskNode);
        const own = STATUS_RANK[status];
        let below = Infinity;
        for (const child of forest.childrenOf.get(id) ?? []) {
            below = Math.min(below, visit(child));
        }
        place.set(id, status === 'done' || status === 'canceled' ? own : Math.min(own, below));
        return Math.min(UNDER_WAY.has(status) ? own : Infinity, below);
    }
    for (const root of forest.roots) {
        visit(root);
    }
    const ordered: Forest<TaskNode> = {
        byId: forest.byId,
        childrenOf: new Map([...forest.childrenOf].map(([id, children]) => [id, [...children]])),
        roots: [...forest.roots],
    };
    sortForest(ordered, (a, b) => ((place.get(a.id) ?? 0) - (place.get(b.id) ?? 0)) || compareByMtimeDesc(a, b));
    return ordered;
}

// The directory a task's file covers: the one beside it named by its UUID alone. A readable name
// before the UUID changes nothing, as the backend parents a task by its directory's UUID, and a
// directory below `.tasks/` must be a bare UUIDv4 to hold tasks at all. `null` for no task's path.
export function taskDirectoryOf(path: string): string | null {
    const id = taskUuidOf(path);
    return id === null ? null : `${path.slice(0, path.lastIndexOf('/'))}/${id}`;
}

export const taskPolicy: PathForestPolicy<TaskNode> = {
    idOf: (entry) => taskUuidOf(entry.path),

    coverOf: (entry) => taskDirectoryOf(entry.path),

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

// Where the task `id` belongs under the task at `parentPath`: in the directory the parent's file
// covers. Worked out from the path alone, so a parent written a moment ago and not listed yet can
// take children too.
export function childTaskPath(parentPath: string, parentUuid: UUID, id: UUID): string {
    return `${parentPath.slice(0, parentPath.lastIndexOf('/'))}/${parentUuid}/${id}.md`;
}
