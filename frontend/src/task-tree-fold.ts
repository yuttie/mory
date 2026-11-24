// The closed tasks among each list of siblings in the task tree, drawn as one row until it is
// expanded.
//
// A change to which branches are open re-renders every row the tree has mounted (see EntryTree),
// so what a click on a chevron costs grows with the rows shown. Most tasks are closed -- 449 of the
// 640 in the dev notes, 154 of the 223 at the top -- and showing them tripled the rows every click
// re-rendered. Folded, they are not mounted at all until asked for.
//
// The tasks are expanded where they would have been, among their siblings, rather than one level
// down under the row: a level down is what a subtask is everywhere else in the tree.

import type { TaskNode, TaskTreeItem } from '@/task-forest';

// The row standing for the closed tasks of one list of siblings.
export interface ClosedFold {
    fold: true;
    // `closed:` and the UUID of the task whose subtasks it folds, or `closed:` alone for the top: no
    // task's, as the tree tells its rows apart by `uuid`.
    uuid: string;
    // What the row says: what a click on it does. Vuetify reads every row's `title`, and takes the
    // row itself for one without, which its list item refuses as no text -- in development, with a
    // warning each time the row is drawn.
    title: string;
    // How many tasks it folds.
    count: number;
    // Whether they are drawn beside it.
    expanded: boolean;
    // A leaf, as its tasks are drawn beside it rather than under it.
    children?: undefined;
}

export interface TaskRow extends TaskNode {
    fold?: undefined;
    children?: TaskTreeRow[];
}

export type TaskTreeRow = TaskRow | ClosedFold;

export interface FoldedTaskTree {
    rows: TaskTreeRow[];
    // The fold each folded task, or a task under one, is drawn behind, expanded or not.
    foldOf: ReadonlyMap<string, string>;
}

const FOLD_PREFIX = 'closed:';

export function isFold(row: TaskTreeRow): row is ClosedFold {
    return row.fold === true;
}

export function isFoldId(id: string): boolean {
    return id.startsWith(FOLD_PREFIX);
}

function isClosed(item: TaskTreeItem): boolean {
    const kind = item.metadata?.task?.status?.kind;
    return kind === 'done' || kind === 'canceled';
}

// A task is folded when it is closed and so is every task drawn under it: one with an open
// subtask is there for it, as the status filter keeps it for one, and stays where it is.
//
// Only a list holding both is folded. Under a task with nothing open there is nothing to set the
// closed ones apart from, and its row was opened to see them; a list with nothing closed has
// nothing to fold.
export function foldClosed(items: TaskTreeItem[], expanded: ReadonlySet<string>): FoldedTaskTree {
    const foldOf = new Map<string, string>();

    interface Visited {
        row: TaskTreeRow;
        // Whether it is closed with all below it.
        closed: boolean;
        // Whether `row` is the item itself: a branch with nothing folded under it is handed on as
        // it came, rather than copied as every branch above a fold is. Not that the tree draws
        // less for it: Vuetify reads every item again whenever the items change.
        same: boolean;
    }

    function visit(item: TaskTreeItem): Visited {
        if (item.children === undefined) {
            return { row: item, closed: isClosed(item), same: true };
        }
        const children = item.children.map(visit);
        const { rows, same } = fold(children, `${FOLD_PREFIX}${item.uuid}`);
        return {
            row: same ? item : { ...item, children: rows },
            closed: isClosed(item) && children.every((child) => child.closed),
            same,
        };
    }

    function fold(siblings: Visited[], id: string): { rows: TaskTreeRow[]; same: boolean } {
        const kept = siblings.filter((sibling) => !sibling.closed);
        const closed = siblings.filter((sibling) => sibling.closed);
        if (kept.length === 0 || closed.length === 0) {
            return { rows: siblings.map((sibling) => sibling.row), same: siblings.every((sibling) => sibling.same) };
        }
        for (const { row } of closed) {
            behind(row, id);
        }
        const count = closed.length;
        const isExpanded = expanded.has(id);
        const row: ClosedFold = {
            fold: true,
            uuid: id,
            title: `${isExpanded ? 'Hide' : 'Show'} ${count} closed`,
            count,
            expanded: isExpanded,
        };
        return {
            rows: [
                ...kept.map((sibling) => sibling.row),
                ...(isExpanded ? closed.map((sibling) => sibling.row) : []),
                row,
            ],
            same: false,
        };
    }

    // Under a folded task, every list is closed throughout, so none is folded again.
    function behind(row: TaskTreeRow, id: string) {
        if (!isFold(row)) {
            foldOf.set(row.uuid, id);
            for (const child of row.children ?? []) {
                behind(child, id);
            }
        }
    }

    const { rows } = fold(items.map(visit), FOLD_PREFIX);
    return { rows, foldOf };
}
