import { describe, expect, it } from 'vitest';

import type { ListEntry2 } from '@/api';
import { eventChecks, frontmatterChecks, settingsChecks, taskChecks } from '@/health';
import type { HealthCheck } from '@/health';

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

/// Each check's problems, by its id: what a reader sees under each line.
function problemsOf(checks: HealthCheck[]): Record<string, { path?: string; message: string }[]> {
    return Object.fromEntries(checks.map((check) => [
        check.id,
        check.problems.map(({ path, message }) => (path === undefined ? { message } : { path, message })),
    ]));
}

const A = '00000001-0000-4000-8000-000000000000';
const B = '00000002-0000-4000-8000-000000000000';

describe('frontmatterChecks', () => {
    it('passes a note without frontmatter, and one the schema accepts', () => {
        expect(problemsOf(frontmatterChecks([
            entry('plain.md', null),
            entry('tagged.md', { tags: ['a'] }),
        ]))).toEqual({ 'frontmatter-yaml': [], 'frontmatter-schema': [] });
    });

    it('reports frontmatter moried could not read under its own check', () => {
        expect(problemsOf(frontmatterChecks([entry('broken.md', { error: 'did not find expected key' })]))).toEqual({
            'frontmatter-yaml': [{ path: 'broken.md', message: 'did not find expected key' }],
            'frontmatter-schema': [],
        });
    });

    it('reports what the schema refuses, where it is', () => {
        const [problem] = problemsOf(frontmatterChecks([entry('bad.md', { tags: 'a' })]))['frontmatter-schema'];
        expect(problem.path).toBe('bad.md');
        expect(problem.message).toMatch(/^\/tags: /);
    });

    it('names a key the schema does not allow, and not the alternatives that did not fit', () => {
        const messages = problemsOf(frontmatterChecks([entry('task.md', { task: { status: { kind: 'todo' }, urgency: 3 } })]))['frontmatter-schema']
            .map((problem) => problem.message);
        expect(messages).toContain('/task: must NOT have additional properties: urgency');
        expect(messages.some((message) => message.includes('oneOf'))).toBe(false);
    });

    it('validates an `error` key beside others as any other key', () => {
        expect(frontmatterChecks([entry('note.md', { error: 'x', tags: [] })]).flatMap((check) => check.problems)).toEqual([]);
    });
});

describe('eventChecks', () => {
    const window = { from: '2026-01-01', to: '2026-12-31' };

    it('lists every check, each passing, for notes without mistakes', () => {
        const checks = eventChecks([entry('plain.md', { tags: [], events: { lunch: { start: '2026-10-01' } } })], window);
        expect(checks.map((check) => check.id)).toEqual([
            'event-times', 'event-repeat', 'event-adjustments', 'event-category', 'event-alarms', 'task-dates',
        ]);
        expect(checks.flatMap((check) => check.problems)).toEqual([]);
    });

    it('reports an event the calendar refuses under its check, once however many times it is met', () => {
        const events = {
            standup: {
                start: '2026-10-01 09:00:00+09:00',
                end: 'soon',
                repeat: { freq: 'daily', count: 5 },
                alarms: ['10m'],
            },
        };
        const problems = problemsOf(eventChecks([entry('meetings.md', { tags: [], events })], window));
        expect(problems['event-times']).toEqual([{ path: 'meetings.md', message: 'Invalid end "soon" of "standup"' }]);
        expect(problems['event-alarms']).toEqual([{ path: 'meetings.md', message: 'Invalid alarms "10m" of "standup"' }]);
    });

    it('reports a task date the calendar refuses under the task dates', () => {
        const problems = problemsOf(eventChecks([entry(`.tasks/${A}.md`, { tags: [], task: { status: { kind: 'todo' }, due_by: 'tomorrow' } })], window));
        expect(problems['task-dates'].map((problem) => problem.path)).toEqual([`.tasks/${A}.md`]);
    });
});

describe('taskChecks', () => {
    it('passes tasks named and nested as the tree expects', () => {
        expect(taskChecks([
            entry(`.tasks/${A}.md`, { tags: [] }),
            entry(`.tasks/report-${A.replace('1', '3')}.md`, { tags: [] }),
            entry(`.tasks/${A}/${B}.md`, { tags: [] }),
        ]).flatMap((check) => check.problems)).toEqual([]);
    });

    it('reports a task the tree leaves out', () => {
        expect(problemsOf(taskChecks([entry('.tasks/todo.md', null)]))['task-names'].map((problem) => problem.path)).toEqual(['.tasks/todo.md']);
    });

    it('leaves an attachment alone', () => {
        expect(taskChecks([{ ...entry('.tasks/photo.png', null), mime_type: 'image/png' }]).flatMap((check) => check.problems)).toEqual([]);
    });

    it('reports a subtask whose parent is missing', () => {
        const [problem] = problemsOf(taskChecks([entry(`.tasks/${A}/${B}.md`, null)]))['task-parents'];
        expect(problem.path).toBe(`.tasks/${A}/${B}.md`);
        expect(problem.message).toContain(`.tasks/${A}/`);
    });

    it('finds the parent by its UUID, whatever name precedes it', () => {
        expect(taskChecks([
            entry(`.tasks/report-${A}.md`, null),
            entry(`.tasks/${A}/${B}.md`, null),
        ]).flatMap((check) => check.problems)).toEqual([]);
    });

    it('reports the older task model\'s keys', () => {
        const [problem] = problemsOf(taskChecks([entry(`.tasks/${A}.md`, { task: { urgency: 3, importance: 2 } })]))['task-model'];
        expect(problem.message).toContain('urgency, importance (as a number)');
    });
});

describe('settingsChecks', () => {
    it('tells the configuration\'s problems from a feed\'s, and names each plan month\'s file', () => {
        expect(problemsOf(settingsChecks({
            calendarsPath: '.mory/calendars.yaml',
            calendarErrors: ['.mory/calendars.yaml: alarms.timed: not an alarm', 'Work: 404'],
            tasksPath: '.mory/tasks.yaml',
            taskSettingsProblems: ['Invalid default_lead_time'],
            planErrors: { '2026-10': 'not a mapping' },
        }))).toEqual({
            'calendars-settings': [{ path: '.mory/calendars.yaml', message: 'alarms.timed: not an alarm' }],
            'calendar-feeds': [{ message: 'Work: 404' }],
            'tasks-settings': [{ path: '.mory/tasks.yaml', message: 'Invalid default_lead_time' }],
            'plans': [{ path: '.mory/plans/2026-10.yaml', message: 'not a mapping' }],
        });
    });
});
