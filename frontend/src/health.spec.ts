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
        ]))).toEqual({ 'frontmatter-yaml': [], 'frontmatter-schema': [], 'frontmatter-notes': [] });
    });

    it('reports frontmatter moried could not read under its own check', () => {
        expect(problemsOf(frontmatterChecks([entry('broken.md', { error: 'did not find expected key' })]))).toEqual({
            'frontmatter-yaml': [{ path: 'broken.md', message: 'did not find expected key' }],
            'frontmatter-schema': [],
            'frontmatter-notes': [],
        });
    });

    it('reports tags in a file search does not read', () => {
        const files = [
            { ...entry('meeting.md.template', { tags: ['meeting'] }), mime_type: 'application/octet-stream' },
            { ...entry('.mory/notes.md', { tags: ['x'] }) },
            { ...entry('README', { tags: ['x'] }), mime_type: 'text/markdown' },
            { ...entry('plain.template', { tags: [] }), mime_type: 'application/octet-stream' },
            { ...entry('Notes.MARKDOWN', { tags: ['x'] }), mime_type: 'text/plain' },
        ];
        expect(problemsOf(frontmatterChecks(files))['frontmatter-notes'].map((problem) => problem.path)).toEqual([
            'meeting.md.template',
            '.mory/notes.md',
        ]);
    });

    it('reports what moried says some reader does not take, with frontmatter or without', () => {
        const files = [
            { ...entry('dotted.md', null), unread: ['The frontmatter ends with `...`.'] },
            { ...entry('keyed.md', { tags: [] }), unread: ['The listing leaves out a null key in `events`.'] },
        ];
        expect(problemsOf(frontmatterChecks(files))['frontmatter-yaml']).toEqual([
            { path: 'dotted.md', message: 'The frontmatter ends with `...`.' },
            { path: 'keyed.md', message: 'The listing leaves out a null key in `events`.' },
        ]);
    });

    // Each says what is wrong in one line, where Ajv reports how the value fails every shape it
    // might have taken.
    it.each([
        ['a value of no shape allowed', { tags: 'a' }, ['/tags: must be array']],
        ['a tag that is not text', { tags: [2024, 'a'] }, ['/tags/0: must be string']],
        ['a nested tag', { tags: [['a']] }, ['/tags/0: must be string']],
        ['tags as a mapping', { tags: { a: 1 } }, ['/tags: must be array']],
        ['a value no alternative fits', { events: { standup: { start: '2026-10-01', alarms: 5 } } }, ['/events/standup/alarms: must be string or array']],
        ['an alarm', { events: { standup: { start: '2026-10-01', alarms: ['10m'] } } }, ['/events/standup/alarms/0: is not in the form it should be: "10m"']],
        ['an event naming no occurrence', { events: { e: { end: '2026-01-01' } } }, ['/events/e: must have one of start, instances, times']],
        ['a key not allowed', { task: { status: { kind: 'todo' }, foo: 3 } }, ['/task: must not have foo']],
        ['a status missing what its kind needs', { task: { status: { kind: 'done' } } }, ['/task/status: must have required property \'completed_at\'']],
        ['a status of no kind', { task: { status: { kind: 'finished' } } }, ['/task/status/kind: must be one of backlog, todo, in_progress, waiting, blocked, on_hold, done, canceled']],
        ['a status that is not a mapping', { task: { status: 'todo' } }, ['/task/status: must be a mapping with a kind']],
        ['an importance', { task: { status: { kind: 'todo' }, importance: 'urgent' } }, ['/task/importance: must be one of low, medium, high']],
    ])('reports %s in one line', (_name, metadata, expected) => {
        expect(problemsOf(frontmatterChecks([entry('bad.md', metadata)]))['frontmatter-schema']).toEqual(
            expected.map((message) => ({ path: 'bad.md', message })));
    });

    it('names every property at fault, not only the first', () => {
        const messages = problemsOf(frontmatterChecks([entry('bad.md', { created_at: 'x', tags: 'a', events: { e: { start: 1 } } })]))['frontmatter-schema']
            .map((problem) => problem.message);
        expect(messages).toEqual([
            '/created_at: is not in the form it should be: "x"',
            '/events/e/start: must be string',
            '/tags: must be array',
        ]);
    });

    // An empty value is YAML null, which every reader takes as the key's absence.
    it('passes an event field left empty', () => {
        const empty = { color: null, location: null, url: null, note: null, name: null };
        const events = { standup: { start: '2026-10-01', category: null, ...empty, repeat: { freq: 'daily' }, overrides: [{ at: '2026-10-02', ...empty }] } };
        expect(problemsOf(frontmatterChecks([entry('note.md', { events })]))['frontmatter-schema']).toEqual([]);
        expect(problemsOf(frontmatterChecks([entry('note.md', { events: { standup: { start: '2026-10-01', color: 5 } } })]))['frontmatter-schema']).toEqual([
            { path: 'note.md', message: '/events/standup/color: must be string' },
        ]);
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

    it('quotes a rule\'s error as it is, and files a series\' unusable start under the times', () => {
        const events = {
            weekly: { start: '2026-10-01', repeat: { freq: 'weekly', byday: ['WE'] } },
            broken: { start: 'soon', repeat: { freq: 'daily' } },
        };
        const problems = problemsOf(eventChecks([entry('series.md', { events })], window, { categories: new Map() }));
        expect(problems['event-repeat']).toEqual([{ path: 'series.md', message: 'The rule of "weekly": Unknown weekday "WE"' }]);
        expect(problems['event-times']).toEqual([{ path: 'series.md', message: 'The rule of "broken": Unusable start "soon"' }]);
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

    // The calendar and moried read an event's times alike, `fixtures/calendar/` holding them to it,
    // so what the calendar refuses is what moried never rings or lists either.
    it('reports a start with a fraction of a second, which neither the calendar nor moried reads', () => {
        const events = { standup: { start: '2026-10-01 10:00:00.000+09:00' }, lunch: { start: '2026-10-01 12:00 +09:00' } };
        expect(problemsOf(eventChecks([entry('meetings.md', { events })], window, { categories: new Map() }))['event-times']).toEqual([
            { path: 'meetings.md', message: 'Invalid start "2026-10-01 10:00:00.000+09:00" of "standup"' },
        ]);
    });

    // Each spelling one set of readers takes and the other does not is reported by the check of the
    // readers that refuse it.
    it.each([
        ['2026-10-01T10:00:00.000Z', ['task-dates']],
        ['2026-10-01 10:00 +09:00', ['task-date-values']],
        ['2026-10-01 10:00+0900', ['task-date-values']],
        ['2026-12-1', ['task-date-values']],
        ['2026/12/01', ['task-dates', 'task-date-values']],
        ['2026-10-01T10:00:00Z', []],
    ])('reports the task date %s where it is not read', (value, expected) => {
        const entries = [entry(`.tasks/${A}.md`, { task: { status: { kind: 'todo' }, due_by: value } })];
        const checks = [...eventChecks(entries, window, { categories: new Map() }), ...taskChecks(entries)];
        expect(checks.filter((check) => check.problems.length > 0).map((check) => check.id)).toEqual(expected);
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

    it('reports every file of a UUID that names more than one', () => {
        const paths = [`.tasks/${A}.md`, `.tasks/old-${A}.md`, `.tasks/${B}/${A}.md`];
        const problems = problemsOf(taskChecks([...paths, `.tasks/${B}.md`].map((path) => entry(path, null))))['task-ids'];
        expect(problems.map((problem) => problem.path)).toEqual(paths);
        expect(problems[0].message).toBe(`Shares its UUID with .tasks/old-${A}.md, .tasks/${B}/${A}.md; the task tree shows only one of them.`);
    });

    it('reports a UUID written in another case as the same one', () => {
        const lower = 'abcdef01-0000-4000-8000-000000000000';
        const paths = [`.tasks/${lower}.md`, `.tasks/${lower.toUpperCase()}.md`];
        expect(problemsOf(taskChecks(paths.map((path) => entry(path, null))))['task-ids']).toEqual([
            { path: paths[0], message: `Shares its UUID with ${paths[1]}; day plans and moried's tools take them for one task.` },
            { path: paths[1], message: `Shares its UUID with ${paths[0]}; day plans and moried's tools take them for one task.` },
        ]);
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
        const task = { status: { kind: 'todo' }, due_by: '2026-10-01 25:00', deadline: '2026-02-30', available_from: '2026-10-01 10:00' };
        expect(problemsOf(taskChecks([entry(`.tasks/${A}.md`, { task })]))['task-date-values']).toEqual([
            { path: `.tasks/${A}.md`, message: 'due_by "2026-10-01 25:00" is not read.' },
            { path: `.tasks/${A}.md`, message: 'deadline "2026-02-30" is not read.' },
        ]);
    });

    it('passes a datetime that carries its offset', () => {
        const task = { status: { kind: 'todo' }, due_by: '2026-10-01 10:00+09:00', deadline: null };
        expect(problemsOf(taskChecks([entry(`.tasks/${A}.md`, { task })]))['task-date-values']).toEqual([]);
    });

    it('reports the older task model\'s keys, under the task model alone', () => {
        const metadata = { task: { status: { kind: 'todo' }, urgency: 3, start_at: '2026-01-01', importance: 2 } };
        const [problem] = problemsOf(taskChecks([entry(`.tasks/${A}.md`, metadata)]))['task-model'];
        expect(problem.message).toBe('Holds urgency, start_at, importance (as a number).');
        expect(frontmatterChecks([entry(`.tasks/${A}.md`, metadata)]).flatMap((check) => check.problems)).toEqual([]);
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
