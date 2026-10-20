import { describe, expect, it } from 'vitest';

import type { ListEntry2 } from '@/api';
import { eventProblems, frontmatterProblems, taskProblems } from '@/health';

function entry(path: string, metadata: unknown): ListEntry2 {
    return {
        path,
        size: 0,
        mime_type: 'text/markdown',
        metadata: metadata as ListEntry2['metadata'],
        title: null,
        time: '2026-10-20T00:00:00+09:00',
    };
}

const A = '00000001-0000-4000-8000-000000000000';
const B = '00000002-0000-4000-8000-000000000000';

describe('frontmatterProblems', () => {
    it('passes a note without frontmatter, and one the schema accepts', () => {
        expect(frontmatterProblems([
            entry('plain.md', null),
            entry('tagged.md', { tags: ['a'] }),
        ])).toEqual([]);
    });

    it('reports frontmatter moried could not read', () => {
        expect(frontmatterProblems([entry('broken.md', { error: 'did not find expected key' })])).toEqual([
            { severity: 'error', message: 'The frontmatter cannot be read: did not find expected key', path: 'broken.md' },
        ]);
    });

    it('reports what the schema refuses, where it is', () => {
        const [problem] = frontmatterProblems([entry('bad.md', { tags: 'a' })]);
        expect(problem.path).toBe('bad.md');
        expect(problem.message).toMatch(/^\/tags: /);
    });

    it('names a key the schema does not allow, and not the alternatives that did not fit', () => {
        const messages = frontmatterProblems([entry('task.md', { task: { status: { kind: 'todo' }, urgency: 3 } })]).map((problem) => problem.message);
        expect(messages).toContain('/task: must NOT have additional properties: urgency');
        expect(messages.some((message) => message.includes('oneOf'))).toBe(false);
    });

    it('validates an `error` key beside others as any other key', () => {
        expect(frontmatterProblems([entry('note.md', { error: 'x', tags: [] })])).toEqual([]);
    });
});

describe('eventProblems', () => {
    const window = { from: '2026-01-01', to: '2026-12-31' };

    it('reports an event the calendar refuses, once however many times it is met', () => {
        const events = {
            standup: {
                start: '2026-10-01 09:00:00+09:00',
                end: 'soon',
                repeat: { freq: 'daily', count: 5 },
            },
        };
        expect(eventProblems([entry('meetings.md', { tags: [], events })], window)).toEqual([
            { severity: 'error', message: 'Invalid end "soon" of "standup"', path: 'meetings.md' },
        ]);
    });

    it('reports a task date the calendar refuses', () => {
        const problems = eventProblems([entry(`.tasks/${A}.md`, { tags: [], task: { status: { kind: 'todo' }, due_by: 'tomorrow' } })], window);
        expect(problems.map((problem) => problem.path)).toEqual([`.tasks/${A}.md`]);
    });
});

describe('taskProblems', () => {
    it('passes tasks named and nested as the tree expects', () => {
        expect(taskProblems([
            entry(`.tasks/${A}.md`, { tags: [] }),
            entry(`.tasks/report-${A.replace('1', '3')}.md`, { tags: [] }),
            entry(`.tasks/${A}/${B}.md`, { tags: [] }),
        ])).toEqual([]);
    });

    it('reports a task the tree leaves out', () => {
        expect(taskProblems([entry('.tasks/todo.md', null)]).map((problem) => problem.path)).toEqual(['.tasks/todo.md']);
    });

    it('leaves an attachment alone', () => {
        expect(taskProblems([{ ...entry('.tasks/photo.png', null), mime_type: 'image/png' }])).toEqual([]);
    });

    it('reports a subtask whose parent is missing', () => {
        const [problem] = taskProblems([entry(`.tasks/${A}/${B}.md`, null)]);
        expect(problem.path).toBe(`.tasks/${A}/${B}.md`);
        expect(problem.message).toContain(`.tasks/${A}/`);
    });

    it('finds the parent by its UUID, whatever name precedes it', () => {
        expect(taskProblems([
            entry(`.tasks/report-${A}.md`, null),
            entry(`.tasks/${A}/${B}.md`, null),
        ])).toEqual([]);
    });

    it('reports the older task model\'s keys', () => {
        const [problem] = taskProblems([entry(`.tasks/${A}.md`, { task: { urgency: 3, importance: 2 } })]);
        expect(problem.message).toContain('urgency, importance (as a number)');
    });
});
