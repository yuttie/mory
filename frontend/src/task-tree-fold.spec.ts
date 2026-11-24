import { describe, expect, it } from 'vitest';

import type { TaskTreeItem } from '@/task-forest';
import { type ClosedFold, type TaskTreeRow, FOLD_PAGE, foldClosed, isFold, isFoldId, shownForMore, shownToReach } from '@/task-tree-fold';

function task(title: string, kind: string | undefined, children?: TaskTreeItem[]): TaskTreeItem {
    return {
        id: title,
        parent: null,
        uuid: title,
        name: null,
        path: `.tasks/${title}.md`,
        size: 0,
        mime_type: 'text/markdown',
        metadata: kind === undefined ? null : { task: { status: { kind } } } as TaskTreeItem['metadata'],
        title,
        mtime: '',
        ...(children === undefined ? {} : { children }),
    };
}

// The rows as titles, a fold as how many of its tasks it draws, children nested under their
// parent's.
function drawn(rows: TaskTreeRow[]): unknown[] {
    return rows.map((row) => {
        if (isFold(row)) {
            return `${row.shown}/${row.count} ${row.uuid}`;
        }
        return row.children === undefined ? row.title : [row.title, drawn(row.children)];
    });
}

function closedTasks(count: number): TaskTreeItem[] {
    return Array.from({ length: count }, (_, index) => task(`c${index}`, 'done'));
}

describe('foldClosed', () => {
    it('draws the closed tasks of a list as one row after the rest', () => {
        const items = [task('a', 'done'), task('b', 'todo'), task('c', 'canceled'), task('d', undefined)];
        expect(drawn(foldClosed(items, new Map()).rows)).toEqual(['b', 'd', '0/2 closed:']);
    });

    it('draws as many as asked for where they were, among their siblings, with the row after them', () => {
        const items = [task('a', 'todo'), task('b', 'done'), task('c', 'canceled'), task('d', 'done')];
        expect(drawn(foldClosed(items, new Map([['closed:', 2]])).rows)).toEqual(['a', 'b', 'c', '2/3 closed:']);
    });

    it('draws them all when asked for more than it holds', () => {
        const items = [task('a', 'todo'), task('b', 'done'), task('c', 'canceled')];
        expect(drawn(foldClosed(items, new Map([['closed:', FOLD_PAGE]])).rows)).toEqual(['a', 'b', 'c', '2/2 closed:']);
    });

    it('folds each list of subtasks apart, by the task holding it', () => {
        const items = [task('p', 'in_progress', [task('q', 'todo'), task('r', 'done')]), task('s', 'done')];
        expect(drawn(foldClosed(items, new Map([['closed:p', FOLD_PAGE]])).rows)).toEqual([['p', ['q', 'r', '1/1 closed:p']], '0/1 closed:']);
    });

    it('leaves where it is a closed task with an open subtask, there for that subtask', () => {
        const items = [task('a', 'todo'), task('b', 'done', [task('c', 'done'), task('d', 'todo')])];
        expect(drawn(foldClosed(items, new Map()).rows)).toEqual(['a', ['b', ['d', '0/1 closed:b']]]);
    });

    it('folds nothing in a list with nothing open, or nothing closed', () => {
        const items = [task('d', 'todo'), task('a', 'done', [task('b', 'done'), task('c', 'canceled')])];
        expect(drawn(foldClosed(items, new Map([['closed:', FOLD_PAGE]])).rows)).toEqual(['d', ['a', ['b', 'c']], '1/1 closed:']);
        expect(drawn(foldClosed([task('e', 'done')], new Map()).rows)).toEqual(['e']);
        expect(drawn(foldClosed([task('f', 'todo')], new Map()).rows)).toEqual(['f']);
    });

    it('says where each task folded is, those under it included, drawn or not', () => {
        const items = [
            task('a', 'todo', [task('x', 'todo'), task('b', 'done')]),
            task('c', 'done', [task('d', 'done')]),
            task('e', 'canceled'),
        ];
        for (const shown of [new Map<string, number>(), new Map([['closed:', FOLD_PAGE], ['closed:a', FOLD_PAGE]])]) {
            const { foldOf } = foldClosed(items, shown);
            expect(Object.fromEntries(foldOf)).toEqual({
                b: { fold: 'closed:a', index: 0 },
                c: { fold: 'closed:', index: 0 },
                d: { fold: 'closed:', index: 0 },
                e: { fold: 'closed:', index: 1 },
            });
        }
    });

    it('lists the folds by their ids', () => {
        const items = [task('a', 'todo', [task('x', 'todo'), task('b', 'done')]), task('c', 'done')];
        const { rows, folds } = foldClosed(items, new Map([['closed:', 1]]));
        expect([...folds.keys()].sort()).toEqual(['closed:', 'closed:a']);
        expect(folds.get('closed:')).toBe(rows.at(-1));
    });

    it('hands on as it came a branch with nothing folded under it', () => {
        const unfolded = task('a', 'todo', [task('b', 'todo')]);
        const folding = task('c', 'todo', [task('d', 'todo'), task('e', 'done')]);
        const { rows } = foldClosed([unfolded, folding, task('f', 'done')], new Map());
        expect(rows[0]).toBe(unfolded);
        expect(rows[1]).not.toBe(folding);
    });

    it('names its rows by ids no task has', () => {
        const { rows } = foldClosed([task('a', 'todo'), task('b', 'done')], new Map());
        expect(rows.filter(isFold).map((row) => isFoldId(row.uuid))).toEqual([true]);
        expect(isFoldId('0b5c8b8e-3b8c-4c8e-9a8c-0b5c8b8e3b8c')).toBe(false);
    });
});

// A row's title is what the tree draws on it, and what Vuetify takes it to say.
describe('the title of a fold', () => {
    function titles(count: number, shown: number[]): string[] {
        const items = [task('open', 'todo'), ...closedTasks(count)];
        return shown.map((each) => foldClosed(items, new Map([['closed:', each]])).folds.get('closed:')!.title);
    }

    it('says how many the next click draws, and of how many', () => {
        expect(titles(23, [0, 10, 20, 30])).toEqual([
            'Show 10 of 23 closed',
            'Show 10 more of 23 closed',
            'Show 3 more of 23 closed',
            'Hide 23 closed',
        ]);
    });

    it('says only how many there are when one click draws them all', () => {
        expect(titles(FOLD_PAGE, [0, FOLD_PAGE])).toEqual([`Show ${FOLD_PAGE} closed`, `Hide ${FOLD_PAGE} closed`]);
    });
});

describe('how many of its tasks a fold draws', () => {
    // The fold of `count` closed tasks beside an open one, drawing `shown` of them.
    function fold(count: number, shown: number): ClosedFold {
        return foldClosed([task('open', 'todo'), ...closedTasks(count)], new Map([['closed:', shown]])).folds.get('closed:')!;
    }

    it('draws ten more each time, and all of them for good once that is all', () => {
        expect([0, 10, 20].map((shown) => shownForMore(fold(23, shown)))).toEqual([10, 20, Infinity]);
        expect(shownForMore(fold(FOLD_PAGE, 0))).toBe(Infinity);
    });

    it('still draws all when another task closes, however many it held', () => {
        const items = [task('open', 'todo'), ...closedTasks(FOLD_PAGE + 1)];
        const shown = new Map([['closed:', shownForMore(fold(FOLD_PAGE, 0))]]);
        expect(drawn(foldClosed(items, shown).rows).at(-1)).toBe(`${FOLD_PAGE + 1}/${FOLD_PAGE + 1} closed:`);
    });

    it('draws as many as the clicks reaching a task would', () => {
        expect([0, 9, 10, 19, 20, 22].map((index) => shownToReach(fold(23, 0), index))).toEqual([10, 10, 20, 20, Infinity, Infinity]);
        expect(shownToReach(fold(FOLD_PAGE, 0), FOLD_PAGE - 1)).toBe(Infinity);
    });
});

describe('the task kept drawn', () => {
    const items = [
        task('open', 'todo', [task('step', 'todo'), ...closedTasks(3).map((child) => ({ ...child, uuid: `step-${child.uuid}` }))]),
        ...closedTasks(23),
    ];

    it('draws as many of the tasks it is folded with as reach it, and no fewer than asked for', () => {
        expect(foldClosed(items, new Map(), 'c12').folds.get('closed:')?.shown).toBe(20);
        expect(foldClosed(items, new Map(), 'c22').folds.get('closed:')?.shown).toBe(23);
        expect(foldClosed(items, new Map([['closed:', 23]]), 'c0').folds.get('closed:')?.shown).toBe(23);
    });

    it('draws no other fold', () => {
        const folded = foldClosed(items, new Map(), 'step-c1');
        expect(folded.folds.get('closed:open')?.shown).toBe(3);
        expect(folded.folds.get('closed:')?.shown).toBe(0);
        expect(foldClosed(items, new Map(), 'open').folds.get('closed:')?.shown).toBe(0);
    });
});
