import Ajv from 'ajv';
import YAML from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';

import metadataSchema from '@/metadata-schema.json';

import { type OutlineTask, countTasks, parseOutline, writesOf } from '@/task-outline';
import { taskInstant } from '@/urgency';

function uuid(n: number): string {
    return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

// Titles nested as the outline nests them.
function shape(tasks: OutlineTask[]): unknown[] {
    return tasks.map((task) => task.children.length > 0 ? [task.title, shape(task.children)] : task.title);
}

function frontmatterOf(markdown: string): Record<string, unknown> {
    return YAML.parse(markdown.split(/^---$/m)[1]) as Record<string, unknown>;
}

describe('parseOutline', () => {
    const example = [
        '- Task 1 [to do, high, 3w, <=2026-12-01, !<=2026-12-08]',
        '    - Subtask 1 [2d]',
        '    - Subtask 2',
        '        - Subsubtask 1',
        '        - Subsubtask 2 ["Some notes..."]',
        '    - Subtask 3',
        '- Task 2',
        '    - Subtask 1',
    ].join('\n');

    it('reads a tree of tasks from an indented list', () => {
        const { tasks, problems } = parseOutline(example);
        expect(problems).toEqual([]);
        expect(shape(tasks)).toEqual([
            ['Task 1', ['Subtask 1', ['Subtask 2', ['Subsubtask 1', 'Subsubtask 2']], 'Subtask 3']],
            ['Task 2', ['Subtask 1']],
        ]);
        expect(countTasks(tasks)).toBe(8);
    });

    it('gives a task the fields its brackets set, and the rest nothing', () => {
        const [task1, task2] = parseOutline(example).tasks;
        expect(task1.fields).toEqual({
            status: 'todo',
            importance: 'high',
            lead_time: '3w',
            due_by: '2026-12-01',
            deadline: '2026-12-08',
            tags: [],
        });
        expect(task1.children[0].fields).toEqual({ status: 'backlog', lead_time: '2d', tags: [] });
        expect(task1.children[1].fields).toEqual({ status: 'backlog', tags: [] });
        expect(task2.fields).toEqual({ status: 'backlog', tags: [] });
    });

    it('keeps a quoted note, commas, brackets, escapes and all', () => {
        const { tasks, problems } = parseOutline('- A ["one, [two]", "say \\"three\\"\\nfour"]');
        expect(problems).toEqual([]);
        expect(tasks[0].title).toBe('A');
        expect(tasks[0].note).toBe('one, [two]\n\nsay "three"\nfour');
    });

    it('reads any consistent indentation, tabs included', () => {
        expect(shape(parseOutline('A\n\tB\n\t\tC\n\tD').tasks)).toEqual([['A', [['B', ['C']], 'D']]]);
        expect(shape(parseOutline('  * A\n    * B\n  * C').tasks)).toEqual([['A', ['B']], 'C']);
    });

    it('counts a tab to the next multiple of four, so it mixes with spaces', () => {
        expect(shape(parseOutline('- A\n\t- B\n    - C\n  \t  - D').tasks)).toEqual([['A', ['B', ['C', ['D']]]]]);
    });

    it('nests a line indented with full-width or non-breaking spaces', () => {
        expect(shape(parseOutline('- A\n\u3000\u3000- B\n\u3000\u3000\u3000\u3000- C\n    - D').tasks)).toEqual([['A', [['B', ['C']], 'D']]]);
        expect(shape(parseOutline('- A\n\u00a0\u00a0- B').tasks)).toEqual([['A', ['B']]]);
    });

    it('puts a line indented between two levels under the shallower one', () => {
        expect(shape(parseOutline('- A\n    - B\n  - C').tasks)).toEqual([['A', ['B', 'C']]]);
    });

    it('takes any bullet, a number, or none', () => {
        expect(shape(parseOutline('- A\n* B\n+ C\n1. D\n2) E\nF\n-1 day').tasks)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', '-1 day']);
    });

    it('skips blank lines and numbers lines as an editor does', () => {
        const { tasks } = parseOutline('\n- A\n\n  - B\n');
        expect(shape(tasks)).toEqual([['A', ['B']]]);
        expect(tasks[0].children[0].line).toBe(4);
    });

    // Enter in the editor continues a list, so the last line is usually one of these.
    it('skips an item not written yet, without a word', () => {
        const { tasks, problems } = parseOutline('- A\n  - \n-\n1. \n- [ ] \n  - [x]');
        expect(shape(tasks)).toEqual(['A']);
        expect(problems).toEqual([]);
    });

    it('reads a task list\'s box, a ticked one as Done', () => {
        const { tasks, problems } = parseOutline('- [ ] Buy milk\n- [x] Pay rent [high]\n  - [X] Sign it\n- [x] Both [todo]\n[x] Not in a list');
        expect(tasks.map((task) => [task.title, task.fields.status])).toEqual([
            ['Buy milk', 'backlog'],
            ['Pay rent', 'done'],
            ['Both', 'done'],
            ['[x] Not in a list', 'backlog'],
        ]);
        expect(tasks[1].children[0].fields.status).toBe('done');
        expect(problems).toEqual([{ line: 4, message: 'The status is given twice.' }]);
    });

    it('takes only the list that ends the line, so a title may hold brackets', () => {
        const { tasks, problems } = parseOutline('- Fix arr[0] in parse() [todo]\n- Read [the book] []\n- Ask [why]?');
        expect(problems).toEqual([]);
        expect(tasks.map((task) => task.title)).toEqual(['Fix arr[0] in parse()', 'Read [the book]', 'Ask [why]?']);
        expect(tasks[0].fields.status).toBe('todo');
    });

    it('spells the words of a status, an importance and a lead time loosely', () => {
        const statuses = parseOutline('- A [To Do]\n- B [todo]\n- C [in-progress]\n- D [In progress]\n- E [BACKLOG]\n- F [in_progress]').tasks;
        expect(statuses.map((task) => task.fields.status)).toEqual(['todo', 'todo', 'in_progress', 'in_progress', 'backlog', 'in_progress']);
        expect(parseOutline('- A [High]').tasks[0].fields.importance).toBe('high');
        // In lower case, as the schema's pattern spells a unit.
        expect(parseOutline('- A [3W]\n- B [2 Days]').tasks.map((task) => task.fields.lead_time)).toEqual(['3w', '2 days']);
    });

    // Looked up in a plain object, these found its prototype's members.
    it('takes no name an object inherits for a status', () => {
        const { tasks, problems } = parseOutline('- A [constructor]\n- B [toString]\n- C [__proto__]');
        expect(tasks.map((task) => task.fields.status)).toEqual(['backlog', 'backlog', 'backlog']);
        expect(problems.map((problem) => problem.line)).toEqual([1, 2, 3]);
    });

    it('gathers tags, each once', () => {
        expect(parseOutline('- A [#work, #home office, #work]').tasks[0].fields.tags).toEqual(['work', 'home office']);
    });

    it('reads the three dates', () => {
        const { tasks, problems } = parseOutline('- A [>=2026-10-01, <= 2026-10-10, !<=2026-10-12 17:30+09:00]');
        expect(problems).toEqual([]);
        expect(tasks[0].fields).toMatchObject({
            available_from: '2026-10-01',
            due_by: '2026-10-10',
            deadline: '2026-10-12 17:30+09:00',
        });
    });

    it('gives a time typed without an offset the reader\'s', () => {
        const due = parseOutline('- A [<=2026-12-01 18:00]').tasks[0].fields.due_by;
        expect(due).toMatch(/^2026-12-01 18:00[+-][0-9]{2}:[0-9]{2}$/);
        expect(taskInstant(due, 'UTC')).toBe(new Date(2026, 11, 1, 18, 0).valueOf());
    });

    describe('across a change of offset', () => {
        afterEach(() => {
            vi.unstubAllEnvs();
        });

        it('moves a time the zone skips forward, as a task reads one', () => {
            vi.stubEnv('TZ', 'America/New_York');
            const { tasks } = parseOutline('- A [<=2026-03-08 02:30, !<=2026-03-08 01:59:30, >=2026-11-01 01:30]');
            expect(tasks[0].fields).toMatchObject({
                due_by: '2026-03-08 03:30-04:00',
                deadline: '2026-03-08 01:59:30-05:00',
                // Twice that night: the first, as a task reads it.
                available_from: '2026-11-01 01:30-04:00',
            });
            // 03:30 EDT, not 01:30 EST, which 02:30-04:00 would have been.
            expect(taskInstant(tasks[0].fields.due_by, 'UTC')).toBe(Date.UTC(2026, 2, 8, 7, 30));
        });
    });

    it('reports what it cannot read, by line', () => {
        const { problems } = parseOutline([
            '- A [urgent]',
            '- B [todo, done]',
            '- C [<=2026-02-30, <=2026-10-10 25:00]',
            '- D [waiting]',
            '- [todo]',
            '- E ["unclosed]',
            '- F [#]',
            '- G [3 fortnights]',
            '- H [todo, urgnet]',
            '- I [cancelled]',
            '- J ["a\tb"]',
            '- Close the ]',
        ].join('\n'));
        expect(problems).toEqual([
            { line: 1, message: '"urgent" is not a property. A title that ends in brackets needs an empty [] after it.' },
            { line: 2, message: 'The status is given twice.' },
            { line: 3, message: '"2026-02-30" is not a date; write YYYY-MM-DD, or YYYY-MM-DD HH:MM.' },
            { line: 3, message: '"2026-10-10 25:00" is not a date; write YYYY-MM-DD, or YYYY-MM-DD HH:MM.' },
            { line: 4, message: 'Waiting needs a reason; give it in the task\'s editor once the task is added.' },
            { line: 5, message: 'The task has no title.' },
            { line: 6, message: 'The brackets that end the line are not a list of fields; check its quotes, or end a title that has brackets with an empty [].' },
            { line: 7, message: 'A tag needs a name after the #.' },
            { line: 8, message: '"3 fortnights" is not a property. A title that ends in brackets needs an empty [] after it.' },
            // Beside a field, a word that is not one is a typo rather than the title's.
            { line: 9, message: '"urgnet" is not a property.' },
            { line: 10, message: 'Canceled needs a reason; give it in the task\'s editor once the task is added.' },
            { line: 11, message: 'The note "a\tb" cannot be read; write a backslash as \\\\ and a tab as \\t.' },
            { line: 12, message: 'The brackets that end the line are not a list of fields; check its quotes, or end a title that has brackets with an empty [].' },
        ]);
    });

    it('still nests the lines after one with a problem', () => {
        const { tasks, problems } = parseOutline('- A [urgent]\n    - B\n        - C [waiting]\n            - D\n- E');
        expect(problems.map((problem) => problem.line)).toEqual([1, 3]);
        expect(shape(tasks)).toEqual([['A', [['B', [['C', ['D']]]]]], 'E']);
    });
});

describe('writesOf', () => {
    it('writes each parent before its children, in its directory', () => {
        let next = 0;
        const { tasks } = parseOutline('- A\n  - B\n    - C\n  - D\n- E');
        const writes = writesOf(tasks, (id) => `.tasks/${uuid(100)}/${id}.md`, () => uuid(++next));
        expect(writes.map(({ title, path }) => [title, path])).toEqual([
            ['A', `.tasks/${uuid(100)}/${uuid(1)}.md`],
            ['B', `.tasks/${uuid(100)}/${uuid(1)}/${uuid(2)}.md`],
            ['C', `.tasks/${uuid(100)}/${uuid(1)}/${uuid(2)}/${uuid(3)}.md`],
            ['D', `.tasks/${uuid(100)}/${uuid(1)}/${uuid(4)}.md`],
            ['E', `.tasks/${uuid(100)}/${uuid(5)}.md`],
        ]);
    });

    it('renders a task as the editor would save it', () => {
        const { tasks } = parseOutline('- Write it [to do, high, 3w, >=2026-11-01, <=2026-12-01, !<=2026-12-08, #work, "Notes."]');
        const [write] = writesOf(tasks, (id) => `.tasks/${id}.md`, () => uuid(1));
        const frontmatter = frontmatterOf(write.markdown);
        expect(frontmatter.created_at).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}[+-][0-9]{2}:[0-9]{2}$/);
        expect(frontmatter.tags).toEqual(['work']);
        expect(frontmatter.task).toEqual({
            status: { kind: 'todo' },
            importance: 'high',
            available_from: '2026-11-01',
            lead_time: '3w',
            due_by: '2026-12-01',
            deadline: '2026-12-08',
        });
        expect(write.markdown.endsWith('---\n\n# Write it\n\nNotes.\n')).toBe(true);
    });

    it('writes notes the metadata schema accepts', () => {
        const validate = new Ajv().compile(metadataSchema);
        const { tasks, problems } = parseOutline([
            '- [x] Done [low, #a, #b c]',
            '  - Doing [in progress, medium, 10 Days, >=2026-10-01 09:00, <=2026-10-02, !<=2026-10-03 17:00+09:00, "A\\nnote"]',
            '    - Next [to do, high, 2W, <=2026-10-02T18:00:00Z]',
            '- Later [backlog]',
            '- Plain',
        ].join('\n'));
        expect(problems).toEqual([]);
        const writes = writesOf(tasks, (id) => `.tasks/${id}.md`);
        expect(writes).toHaveLength(5);
        for (const write of writes) {
            expect(validate(frontmatterOf(write.markdown)), `${write.title}: ${JSON.stringify(validate.errors)}`).toBe(true);
        }
    });

    it('marks a task done when it is written', () => {
        const [write] = writesOf(parseOutline('- Did it [done]').tasks, (id) => `.tasks/${id}.md`, () => uuid(1));
        const status = (frontmatterOf(write.markdown).task as { status: { kind: string; completed_at: string } }).status;
        expect(status.kind).toBe('done');
        expect(taskInstant(status.completed_at, 'UTC')).toBeGreaterThan(Date.now() - 60_000);
    });
});
