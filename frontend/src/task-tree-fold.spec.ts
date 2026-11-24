import { describe, expect, it } from 'vitest';

import type { TaskTreeItem } from '@/task-forest';
import { type TaskTreeRow, foldClosed, isFold, isFoldId } from '@/task-tree-fold';

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

// The rows as titles, a fold as what it says, children nested under their parent's.
function drawn(rows: TaskTreeRow[]): unknown[] {
    return rows.map((row) => {
        if (isFold(row)) {
            return `${row.expanded ? '-' : '+'}${row.count} ${row.uuid}`;
        }
        return row.children === undefined ? row.title : [row.title, drawn(row.children)];
    });
}

describe('foldClosed', () => {
    it('draws the closed tasks of a list as one row after the rest', () => {
        const items = [task('a', 'done'), task('b', 'todo'), task('c', 'canceled'), task('d', undefined)];
        expect(drawn(foldClosed(items, new Set()).rows)).toEqual(['b', 'd', '+2 closed:']);
    });

    it('draws them where they were, among their siblings, with the row after them once expanded', () => {
        const items = [task('a', 'todo'), task('b', 'done'), task('c', 'canceled')];
        expect(drawn(foldClosed(items, new Set(['closed:'])).rows)).toEqual(['a', 'b', 'c', '-2 closed:']);
    });

    it('folds each list of subtasks apart, by the task holding it', () => {
        const items = [task('p', 'in_progress', [task('q', 'todo'), task('r', 'done')]), task('s', 'done')];
        expect(drawn(foldClosed(items, new Set(['closed:p'])).rows)).toEqual([['p', ['q', 'r', '-1 closed:p']], '+1 closed:']);
    });

    it('leaves where it is a closed task with an open subtask, there for that subtask', () => {
        const items = [task('a', 'todo'), task('b', 'done', [task('c', 'done'), task('d', 'todo')])];
        expect(drawn(foldClosed(items, new Set()).rows)).toEqual(['a', ['b', ['d', '+1 closed:b']]]);
    });

    it('folds nothing in a list with nothing open, or nothing closed', () => {
        const items = [task('d', 'todo'), task('a', 'done', [task('b', 'done'), task('c', 'canceled')])];
        expect(drawn(foldClosed(items, new Set(['closed:'])).rows)).toEqual(['d', ['a', ['b', 'c']], '-1 closed:']);
        expect(drawn(foldClosed([task('e', 'done')], new Set()).rows)).toEqual(['e']);
        expect(drawn(foldClosed([task('f', 'todo')], new Set()).rows)).toEqual(['f']);
    });

    it('says which fold each task folded is behind, those under it included, expanded or not', () => {
        const items = [task('a', 'todo', [task('x', 'todo'), task('b', 'done')]), task('c', 'done', [task('d', 'done')])];
        for (const expanded of [new Set<string>(), new Set(['closed:', 'closed:a'])]) {
            const { foldOf } = foldClosed(items, expanded);
            expect(Object.fromEntries(foldOf)).toEqual({ b: 'closed:a', c: 'closed:', d: 'closed:' });
        }
    });

    it('hands on as it came a branch with nothing folded under it', () => {
        const unfolded = task('a', 'todo', [task('b', 'todo')]);
        const folding = task('c', 'todo', [task('d', 'todo'), task('e', 'done')]);
        const { rows } = foldClosed([unfolded, folding, task('f', 'done')], new Set());
        expect(rows[0]).toBe(unfolded);
        expect(rows[1]).not.toBe(folding);
    });

    // A row's title is what the tree draws on it, and what Vuetify takes it to say.
    it('says on its row what a click on it does', () => {
        const items = [task('a', 'todo'), task('b', 'done'), task('c', 'canceled')];
        const titles = [new Set<string>(), new Set(['closed:'])].map((expanded) => foldClosed(items, expanded).rows.filter(isFold).map((row) => row.title));
        expect(titles).toEqual([['Show 2 closed'], ['Hide 2 closed']]);
    });

    it('names its rows by ids no task has', () => {
        const { rows } = foldClosed([task('a', 'todo'), task('b', 'done')], new Set());
        expect(rows.filter(isFold).map((row) => isFoldId(row.uuid))).toEqual([true]);
        expect(isFoldId('0b5c8b8e-3b8c-4c8e-9a8c-0b5c8b8e3b8c')).toBe(false);
    });
});
