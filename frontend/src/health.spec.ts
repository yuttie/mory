import { describe, expect, it } from 'vitest';
import { computed, reactive } from 'vue';

import type { ListEntry2 } from '@/api';
import { eventChecks, frontmatterChecks, guardChecks, settingsChecks, taskChecks } from '@/health';
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

    it('quotes the value a pattern refuses rather than the pattern', () => {
        const events = { standup: { start: '2026-10-01', alarms: ['10m'] } };
        const messages = problemsOf(frontmatterChecks([entry('note.md', { events })]))['frontmatter-schema'].map((problem) => problem.message);
        expect(messages).toContain('/events/standup/alarms/0: is not in the form it should be: "10m"');
    });

    it('validates an `error` key beside others as any other key', () => {
        expect(frontmatterChecks([entry('note.md', { error: 'x', tags: [] })]).flatMap((check) => check.problems)).toEqual([]);
    });
});

describe('eventChecks', () => {
    const window = { from: '2026-01-01', to: '2026-12-31' };

    it('lists every check, each passing, for notes without mistakes', () => {
        const checks = eventChecks([entry('plain.md', { tags: [], events: { lunch: { start: '2026-10-01' } } })], window, { categories: new Map() });
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

    it('says the categories were not verified without the configuration', () => {
        const events = { standup: { start: '2026-10-01', category: 'typo' } };
        expect(problemsOf(eventChecks([entry('meetings.md', { events })], window))['event-category']).toEqual([
            { message: 'Not verified: the categories in .mory/calendars.yaml could not be read.' },
        ]);
        expect(problemsOf(eventChecks([entry('meetings.md', { events })], window, { categories: new Map() }))['event-category']).toEqual([
            { path: 'meetings.md', message: 'Invalid category "typo" of "standup"' },
        ]);
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

    it('reports a task date urgency does not read', () => {
        const task = { status: { kind: 'todo' }, due_by: '2026-10-01 10:00', deadline: '2026-02-30', available_from: '2026-10-01' };
        expect(problemsOf(taskChecks([entry(`.tasks/${A}.md`, { task })]))['task-date-values']).toEqual([
            { path: `.tasks/${A}.md`, message: 'due_by "2026-10-01 10:00" is not read.' },
            { path: `.tasks/${A}.md`, message: 'deadline "2026-02-30" is not read.' },
        ]);
    });

    it('passes a datetime that carries its offset', () => {
        const task = { status: { kind: 'todo' }, due_by: '2026-10-01 10:00+09:00', deadline: null };
        expect(problemsOf(taskChecks([entry(`.tasks/${A}.md`, { task })]))['task-date-values']).toEqual([]);
    });

    it('reports the older task model\'s keys', () => {
        const [problem] = problemsOf(taskChecks([entry(`.tasks/${A}.md`, { task: { urgency: 3, importance: 2 } })]))['task-model'];
        expect(problem.message).toContain('urgency, importance (as a number)');
    });
});

describe('settingsChecks', () => {
    it('takes the configuration\'s problems from the store, and the feeds\' from asking them', () => {
        expect(problemsOf(settingsChecks({
            calendarsPath: '.mory/calendars.yaml',
            calendarErrors: ['.mory/calendars.yaml: alarms.timed: not an alarm', 'Stale: 500'],
            feedErrors: ['Work: 404'],
            tasksPath: '.mory/tasks.yaml',
            taskSettingsProblems: ['Invalid default_lead_time'],
            planPaths: ['.mory/plans/2026-10.yaml'],
            planErrors: { '2026-10': 'not a mapping' },
        }))).toEqual({
            'calendars-settings': [{ path: '.mory/calendars.yaml', message: 'alarms.timed: not an alarm' }],
            'calendar-feeds': [{ message: 'Work: 404' }],
            'tasks-settings': [{ path: '.mory/tasks.yaml', message: 'Invalid default_lead_time' }],
            'plans': [{ path: '.mory/plans/2026-10.yaml', message: 'not a mapping' }],
        });
    });
});

describe('the plans check', () => {
    const plansOf = (planPaths: string[], planErrors: Record<string, string>) => problemsOf(settingsChecks({
        calendarsPath: '.mory/calendars.yaml',
        calendarErrors: [],
        feedErrors: [],
        tasksPath: '.mory/tasks.yaml',
        taskSettingsProblems: [],
        planPaths,
        planErrors,
    })).plans;

    it('reports every unreadable month listed', () => {
        expect(plansOf(['.mory/plans/2026-01.yaml', '.mory/plans/2026-02.yaml'], { '2026-01': 'bad', '2026-02': 'worse' })).toEqual([
            { path: '.mory/plans/2026-01.yaml', message: 'bad' },
            { path: '.mory/plans/2026-02.yaml', message: 'worse' },
        ]);
    });

    it('sees a month that fails after the first look', () => {
        const errors = reactive<Record<string, string>>({});
        const problems = computed(() => plansOf(['.mory/plans/2026-01.yaml'], errors));
        expect(problems.value).toEqual([]);
        errors['2026-01'] = 'bad';
        expect(problems.value).toEqual([{ path: '.mory/plans/2026-01.yaml', message: 'bad' }]);
    });

    it('leaves out the error of a month whose file is gone', () => {
        expect(plansOf([], { '2026-01': 'bad' })).toEqual([]);
    });

    it('reports a file no plan is read from', () => {
        expect(plansOf(['.mory/plans/2026-13.yaml', '.mory/plans/notes.md'], {}).map((problem) => problem.path)).toEqual([
            '.mory/plans/2026-13.yaml',
            '.mory/plans/notes.md',
        ]);
    });
});

describe('guardChecks', () => {
    it('hands on the checks that ran', () => {
        const checks = taskChecks([]);
        expect(guardChecks('tasks', 'Tasks can be checked', () => checks)).toBe(checks);
    });

    it('stands one failed check in for those that threw', () => {
        expect(problemsOf(guardChecks('tasks', 'Tasks can be checked', () => {
            throw new TypeError('x is undefined');
        }))).toEqual({ tasks: [{ message: 'The checks could not run: x is undefined' }] });
    });
});
