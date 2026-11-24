// The closed tasks among each list of siblings in the task tree, drawn as one row until it is
// asked for them, and then a few at a time.
//
// A change to which branches are open re-renders every row the tree has mounted (see EntryTree),
// so what a click on a chevron costs grows with the rows shown. Most tasks are closed -- 449 of the
// 640 in the dev notes, 154 of the 223 at the top -- and showing them tripled the rows every click
// re-rendered. Folded, they are not mounted at all until asked for, and asked for, only as many as
// were.
//
// The tasks are drawn where they would have been, among their siblings, rather than one level
// down under the row: a level down is what a subtask is everywhere else in the tree. The row stays
// after them, where the next of them come from.

import type { TaskNode, TaskTreeItem } from '@/task-forest';

// How many more of its tasks a fold draws each time it is asked: enough to find one closed lately,
// as the tree has them newest first, and few enough to cost little more than the fold did.
export const FOLD_PAGE = 10;

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
    // How many of them, from the first, are drawn before it.
    shown: number;
    // A leaf, as its tasks are drawn beside it rather than under it.
    children?: undefined;
}

export interface TaskRow extends TaskNode {
    fold?: undefined;
    children?: TaskTreeRow[];
}

export type TaskTreeRow = TaskRow | ClosedFold;

// Where a folded task is: the fold it is behind, or behind with the task above it, and the place
// among the fold's tasks of the one of them it is or is under.
export interface FoldPlace {
    fold: string;
    index: number;
}

export interface FoldedTaskTree {
    rows: TaskTreeRow[];
    // Each fold, by its id.
    folds: ReadonlyMap<string, ClosedFold>;
    // Where each folded task, or a task under one, is, drawn or not.
    foldOf: ReadonlyMap<string, FoldPlace>;
}

const FOLD_PREFIX = 'closed:';

export function isFold(row: TaskTreeRow): row is ClosedFold {
    return row.fold === true;
}

export function isFoldId(id: string): boolean {
    return id.startsWith(FOLD_PREFIX);
}

// What a click on the row does: draw the next of its tasks, or once all of them are, fold them.
function foldTitle(count: number, shown: number): string {
    if (shown >= count) {
        return `Hide ${count} closed`;
    }
    const next = Math.min(FOLD_PAGE, count - shown);
    if (shown > 0) {
        return `Show ${next} more of ${count} closed`;
    }
    return next === count ? `Show ${count} closed` : `Show ${next} of ${count} closed`;
}

// How many of its tasks the fold `row` draws once asked for the next of them. Once that is all of
// them, it is all of them for good, so that the fold still draws all when another task closes,
// however many it held.
export function shownForMore(row: ClosedFold): number {
    return drawing(row, row.shown + FOLD_PAGE);
}

// How many of its tasks the fold `row` draws to reach the one at `index`: as many as the clicks
// reaching it would draw.
export function shownToReach(row: ClosedFold, index: number): number {
    return drawing(row, (Math.floor(index / FOLD_PAGE) + 1) * FOLD_PAGE);
}

function drawing({ count }: ClosedFold, shown: number): number {
    return shown >= count ? Infinity : shown;
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
//
// `shown` says how many of its tasks each fold draws, by its id; as many as it holds or more draws
// them all.
export function foldClosed(items: TaskTreeItem[], shown: ReadonlyMap<string, number>): FoldedTaskTree {
    const folds = new Map<string, ClosedFold>();
    const foldOf = new Map<string, FoldPlace>();

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
        closed.forEach(({ row }, index) => behind(row, { fold: id, index }));
        const count = closed.length;
        const drawn = Math.min(shown.get(id) ?? 0, count);
        const row: ClosedFold = { fold: true, uuid: id, title: foldTitle(count, drawn), count, shown: drawn };
        folds.set(id, row);
        return {
            rows: [
                ...kept.map((sibling) => sibling.row),
                ...closed.slice(0, row.shown).map((sibling) => sibling.row),
                row,
            ],
            same: false,
        };
    }

    // Under a folded task, every list is closed throughout, so none is folded again.
    function behind(row: TaskTreeRow, place: FoldPlace) {
        if (!isFold(row)) {
            foldOf.set(row.uuid, place);
            for (const child of row.children ?? []) {
                behind(child, place);
            }
        }
    }

    const { rows } = fold(items.map(visit), FOLD_PREFIX);
    return { rows, folds, foldOf };
}
