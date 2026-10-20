import { describe, expect, it } from 'vitest';

import type { TaskTreeItem } from '@/task-forest';
import { STATUS_KINDS } from '@/task';
import {
    STATUS_PRESETS,
    branchIds,
    filterTaskTree,
    highlight,
    presetState,
    searchTerms,
    titleMatches,
    togglePreset,
} from '@/task-tree-filter';

function task(title: string | null, children?: TaskTreeItem[], status: unknown = { kind: 'todo' }): TaskTreeItem {
    const id = title ?? 'untitled';
    return {
        id,
        parent: null,
        uuid: id,
        name: null,
        path: `.tasks/${id}.md`,
        size: 0,
        mime_type: 'text/markdown',
        metadata: { task: { status } } as TaskTreeItem['metadata'],
        title,
        mtime: '',
        ...(children === undefined ? {} : { children }),
    };
}

function group(tag: string, members: TaskTreeItem[]): TaskTreeItem {
    return { ...task(tag, members), uuid: `tag-group-${tag}`, metadata: { tag_group: tag } };
}

// The tree as titles, children nested under their parent's.
function titles(items: TaskTreeItem[]): unknown[] {
    return items.map((item) => item.children === undefined ? item.title : [item.title, titles(item.children)]);
}

describe('searchTerms', () => {
    it('splits on any white space, the ideographic space included', () => {
        expect(searchTerms('  draft\treport　会議 ')).toEqual(['draft', 'report', '会議']);
        expect(searchTerms('   ')).toEqual([]);
    });
});

describe('titleMatches', () => {
    it('needs every term, in any case and any order', () => {
        expect(titleMatches('Write the Quarterly Report', ['report', 'QUARTER'])).toBe(true);
        expect(titleMatches('Write the Quarterly Report', ['report', 'annual'])).toBe(false);
    });

    it('reads a term as text, not as a pattern', () => {
        expect(titleMatches('Fix a+b (again)', ['a+b', '(again)'])).toBe(true);
        expect(titleMatches('Fix aab', ['a+b'])).toBe(false);
    });

    it('finds nothing in a task with no title', () => {
        expect(titleMatches(null, ['draft'])).toBe(false);
    });
});

describe('highlight', () => {
    it('marks every occurrence of each term, overlapping ones included', () => {
        expect(highlight('Banana band', ['ana', 'BAND'])).toEqual([
            { text: 'B', match: false },
            { text: 'anana', match: true },
            { text: ' ', match: false },
            { text: 'band', match: true },
        ]);
    });

    it('merges the occurrences of terms that overlap', () => {
        expect(highlight('Banana', ['ban', 'nan'])).toEqual([
            { text: 'Banan', match: true },
            { text: 'a', match: false },
        ]);
    });

    it('marks the title as written where lowercasing would change its length', () => {
        // `İ` lowercases to two code units, which would shift every position after it.
        expect(highlight('İstanbul trip', ['trip'])).toEqual([
            { text: 'İstanbul ', match: false },
            { text: 'trip', match: true },
        ]);
    });

    it('keeps a character outside the Basic Multilingual Plane whole', () => {
        expect(highlight('🎉 party', ['🎉'])).toEqual([
            { text: '🎉', match: true },
            { text: ' party', match: false },
        ]);
    });
});

describe('filterTaskTree', () => {
    const tree = [
        task('Launch', [
            task('Write the announcement'),
            task('Ship', [
                task('Build the release'),
                task('Write release notes'),
            ]),
        ]),
        group('home', [task('Water the plants'), task('Write to the landlord')]),
        group('work', [task('Expense report')]),
    ];

    it('hands back the tree it was given when there is nothing to search for', () => {
        expect(filterTaskTree(tree, { query: ' ', hiddenStatuses: [] })).toBe(tree);
    });

    it('keeps the tasks found and everything above them', () => {
        expect(titles(filterTaskTree(tree, { query: 'write', hiddenStatuses: [] }))).toEqual([
            ['Launch', ['Write the announcement', ['Ship', ['Write release notes']]]],
            ['home', ['Write to the landlord']],
        ]);
    });

    it('draws a task found as a leaf when none of its subtasks is', () => {
        const [launch] = filterTaskTree(tree, { query: 'launch', hiddenStatuses: [] });
        expect(launch.title).toBe('Launch');
        expect(launch).not.toHaveProperty('children');
    });

    it('leaves out the tasks of a hidden status, at any depth, unless one under them is kept', () => {
        const statuses = [
            task('Done project', [
                task('Done step', undefined, { kind: 'done' }),
                task('Open step'),
            ], { kind: 'done' }),
            task('Open project', [
                task('Canceled step', undefined, { kind: 'canceled' }),
            ]),
            task('Finished project', [
                task('Last step', undefined, { kind: 'done' }),
            ], { kind: 'done' }),
            group('home', [task('Done chore', undefined, { kind: 'done' })]),
        ];
        expect(titles(filterTaskTree(statuses, { query: '', hiddenStatuses: ['done', 'canceled'] }))).toEqual([
            ['Done project', ['Open step']],
            'Open project',
        ]);
    });

    it('files a task naming no status in the backlog, and never hides one naming no known status', () => {
        const statuses = [
            task('Unsorted', undefined, null),
            task('Misspelt', undefined, { kind: 'finished' }),
            task('Garbled', undefined, 'done'),
        ];
        expect(titles(filterTaskTree(statuses, { query: '', hiddenStatuses: ['backlog', 'done'] }))).toEqual([
            'Misspelt',
        ]);
        expect(titles(filterTaskTree(statuses, { query: '', hiddenStatuses: ['done'] }))).toEqual([
            'Unsorted',
            'Misspelt',
            'Garbled',
        ]);
    });

    it('keeps only the tasks both the search and the statuses let through', () => {
        const both = [
            task('Write the draft'),
            task('Write the summary', undefined, { kind: 'done' }),
            task('Read the paper'),
        ];
        expect(titles(filterTaskTree(both, { query: 'write', hiddenStatuses: ['done'] }))).toEqual(['Write the draft']);
    });

    it('never keeps a tag group for its own name', () => {
        expect(filterTaskTree(tree, { query: 'home', hiddenStatuses: [] })).toEqual([]);
    });
});

describe('branchIds', () => {
    it('names every row holding others, at any depth', () => {
        const filtered = filterTaskTree([task('A', [task('B', [task('C')]), task('D')])], { query: 'c', hiddenStatuses: [] });
        expect(branchIds(filtered)).toEqual(['A', 'B']);
    });
});

describe('STATUS_PRESETS', () => {
    it('puts every status but To do in exactly one group', () => {
        const grouped: string[] = STATUS_PRESETS.flatMap((preset) => preset.kinds);
        expect(new Set(grouped).size).toBe(grouped.length);
        expect(STATUS_KINDS.filter((kind) => !grouped.includes(kind))).toEqual(['todo']);
    });
});

describe('presetState', () => {
    it('tells a group shown, hidden or partly shown', () => {
        expect(presetState([], ['done', 'canceled'])).toBe('shown');
        expect(presetState(['backlog'], ['done', 'canceled'])).toBe('shown');
        expect(presetState(['canceled', 'done'], ['done', 'canceled'])).toBe('hidden');
        expect(presetState(['done'], ['done', 'canceled'])).toBe('mixed');
    });
});

describe('togglePreset', () => {
    it('hides a group all shown, keeping the other statuses hidden', () => {
        expect(togglePreset(['backlog'], ['done', 'canceled'])).toEqual(['backlog', 'done', 'canceled']);
    });

    it('shows a group hidden or partly shown, whole', () => {
        expect(togglePreset(['done', 'backlog', 'canceled'], ['done', 'canceled'])).toEqual(['backlog']);
        expect(togglePreset(['blocked', 'todo'], ['in_progress', 'waiting', 'blocked'])).toEqual(['todo']);
    });
});
