import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

import { type Status, type Task, STATUS_KINDS, hasFields, makeDefaultStatus, render, replaceStatus, withoutBlanks } from '@/task';

function task(overrides: Partial<Task> = {}): Task {
    return {
        created_at: '2026-10-04 14:05:12+09:00',
        uuid: '00000000-0000-4000-8000-000000000000',
        title: 'Write the report',
        tags: ['work'],
        status: { kind: 'waiting', waiting_for: 'the figures', contact: 'Alice' },
        importance: 'medium',
        due_by: '2026-10-01',
        note: 'Some notes.\n',
        ...overrides,
    };
}

function frontmatterOf(markdown: string): unknown {
    return YAML.parse(markdown.split(/^---$/m)[1]);
}

describe('render, alarms', () => {
    it('writes the alarms a task sets for its dates, on the line that names them', () => {
        const markdown = render(task({
            deadline: '2026-10-05 17:00:00+09:00',
            alarms: { due_by: ['09:00'], deadline: ['-1d 18:00', '-2h'] },
        }));

        expect(markdown).toContain('    alarms:\n        due_by: [09:00]\n        deadline: [-1d 18:00, -2h]\n');
        expect(frontmatterOf(markdown)).toMatchObject({
            task: { alarms: { due_by: ['09:00'], deadline: ['-1d 18:00', '-2h'] } },
        });
        // Beside the dates, and with `scheduled_dates` still last, where it always was.
        const keys = Object.keys((frontmatterOf(markdown) as { task: object }).task);
        expect(keys).toEqual([
            'status', 'importance', 'due_by', 'deadline', 'alarms',
        ]);
    });

    // An empty list is a setting that silences a date; leaving a date out is what inherits.
    it('writes an empty list, which silences, and leaves a date out that sets none', () => {
        const markdown = render(task({ alarms: { deadline: [] } }));
        expect(markdown).toContain('        deadline: []\n');
        expect(markdown).not.toContain('due_by: [');
    });

    it('writes nothing for a task that sets none', () => {
        expect(render(task())).not.toContain('alarms');
        expect(render(task({ alarms: {} }))).not.toContain('alarms');
    });

    it('writes a task without alarms exactly as it was written before they existed', () => {
        // The same layout as ever: block lists, four spaces, and nothing in flow style.
        expect(render(task())).toBe(`---
created_at: 2026-10-04 14:05:12+09:00
task:
    status:
        kind: waiting
        waiting_for: the figures
        contact: Alice
    importance: medium
    due_by: 2026-10-01
tags:
    - work
---

# Write the report

Some notes.
`);
    });

    it('keeps them through a status change in place', () => {
        const before = render(task({ alarms: { due_by: ['09:00'] } }));
        const after = replaceStatus(before, { kind: 'todo' });
        expect(after).toBe(render(task({ status: { kind: 'todo' }, alarms: { due_by: ['09:00'] } })));
        expect(after).toContain('due_by: [09:00]');
    });
});

describe('replaceStatus', () => {
    it('writes what render would, for a note render wrote', () => {
        const before = render(task());
        const after = replaceStatus(before, { kind: 'todo' });
        expect(after).toBe(render(task({ status: { kind: 'todo' } })));
    });

    it('takes the old status\'s companion keys with it', () => {
        const after = replaceStatus(render(task()), { kind: 'in_progress' });
        expect(after).not.toContain('waiting_for');
        expect(after).not.toContain('contact');
    });

    it('writes the companion keys the new status needs', () => {
        const before = render(task({ status: { kind: 'todo' } }));
        const after = replaceStatus(before, { kind: 'blocked', blocked_by: 'the review: part #2' });
        expect(frontmatterOf(after)).toMatchObject({
            task: { status: { kind: 'blocked', blocked_by: 'the review: part #2' } },
        });
    });

    it('leaves comments, unknown keys, the layout and the body alone', () => {
        const before = [
            '---',
            '# Kept for the quarterly review.',
            'task:',
            '  status:',
            '    kind: todo',
            '  progress: 0   # not started',
            '  scheduled_dates: [2026-09-28, 2026-09-29]',
            'events:',
            '  review:',
            '    start: 2026-10-01 10:00:00+09:00',
            'tags:',
            '- work',
            '---',
            '',
            '# Title',
            '',
            'status: this line is body text, not frontmatter',
            '',
        ].join('\n');
        const after = replaceStatus(before, { kind: 'in_progress' });
        expect(after).toBe(before.replace('    kind: todo', '    kind: in_progress'));
    });

    it('replaces the whole mapping, a trailing comment included, and keeps the blank line after it', () => {
        const before = [
            '---',
            'task:',
            '    status:',
            '        kind: waiting',
            '        waiting_for: Bob  # asked on Monday',
            '',
            '    progress: 0',
            '---',
            '',
        ].join('\n');
        const after = replaceStatus(before, { kind: 'todo' });
        expect(after).toBe([
            '---',
            'task:',
            '    status:',
            '        kind: todo',
            '',
            '    progress: 0',
            '---',
            '',
        ].join('\n'));
    });

    it('keeps a flow-style status in flow style', () => {
        const before = '---\ntask:\n    progress: 0\n    status: {kind: todo}\n---\n';
        const after = replaceStatus(before, { kind: 'done', completed_at: '2026-09-27 10:00:00+09:00' });
        expect(after).toBe(
            '---\ntask:\n    progress: 0\n    status: { kind: done, completed_at: 2026-09-27 10:00:00+09:00 }\n---\n',
        );
    });

    it('adds a status to a task that names none, first and at the author\'s indentation', () => {
        const before = '---\ntask:\n  progress: 0\n  urgency: 3\ntags: []\n---\n';
        const after = replaceStatus(before, { kind: 'todo' });
        expect(after).toBe('---\ntask:\n  status:\n    kind: todo\n  progress: 0\n  urgency: 3\ntags: []\n---\n');
    });

    it('fills in a status that is named but empty', () => {
        for (const empty of ['status:', 'status: null', 'status: ~']) {
            const before = `---\ntask:\n    ${empty}\n    progress: 0\n---\n`;
            const after = replaceStatus(before, { kind: 'todo' });
            expect(after).toBe('---\ntask:\n    status:\n        kind: todo\n    progress: 0\n---\n');
        }
    });

    it('keeps CRLF line endings', () => {
        const before = '---\r\ntask:\r\n    status:\r\n        kind: todo\r\n    progress: 0\r\n---\r\nBody\r\n';
        const after = replaceStatus(before, { kind: 'on_hold', hold_reason: 'budget' });
        expect(after).toBe(
            '---\r\ntask:\r\n    status:\r\n        kind: on_hold\r\n        hold_reason: budget\r\n    progress: 0\r\n---\r\nBody\r\n',
        );
    });

    it('drops an undefined field rather than writing it', () => {
        const after = replaceStatus(render(task()), { kind: 'done', completed_at: '2026-09-27', completion_note: undefined });
        expect(after).not.toContain('completion_note');
    });

    it('leaves a note alone when it already has the status, however it is spelt', () => {
        const notes = [
            '---\ntask:\n    status: {kind: todo}\n---\n',
            '---\ntask:\n    status:\n        kind: waiting\n        waiting_for: Bob  # asked on Monday\n---\n',
        ];
        expect(replaceStatus(notes[0], { kind: 'todo' })).toBe(notes[0]);
        expect(replaceStatus(notes[1], { kind: 'waiting', waiting_for: 'Bob' })).toBe(notes[1]);
    });

    it('refuses a note it cannot edit in place', () => {
        expect(() => replaceStatus('# No frontmatter\n', { kind: 'todo' })).toThrow();
        expect(() => replaceStatus('---\ntask:\n    status: {kind: todo}\n', { kind: 'todo' })).toThrow();
        expect(() => replaceStatus('---\ntags: [a]\n---\n', { kind: 'todo' })).toThrow();
        expect(() => replaceStatus('---\ntask: {progress: 0}\n---\n', { kind: 'todo' })).toThrow();
        expect(() => replaceStatus('---\ntask:\n  status: [\n---\n', { kind: 'todo' })).toThrow();
    });

    it('refuses rather than break an alias that points into the old status', () => {
        const before = '---\ntask:\n    status: &s\n        kind: todo\n    previous: *s\n---\n';
        expect(() => replaceStatus(before, { kind: 'in_progress' })).toThrow();
    });
});

describe('makeDefaultStatus', () => {
    // A datetime carries its offset, as `completed_at` always has.
    const stamp = expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);

    it('stamps Done and Canceled with the time they are switched to', () => {
        expect(makeDefaultStatus('done')).toEqual({ kind: 'done', completed_at: stamp });
        expect(makeDefaultStatus('canceled')).toEqual({ kind: 'canceled', canceled_at: stamp, cancel_reason: '' });
    });

    it('leaves what only the author can say empty', () => {
        expect(makeDefaultStatus('todo')).toEqual({ kind: 'todo' });
        expect(makeDefaultStatus('waiting')).toEqual({ kind: 'waiting', waiting_for: '' });
    });
});

describe('hasFields', () => {
    it('is true of the statuses that carry more than their kind', () => {
        expect(STATUS_KINDS.filter(hasFields)).toEqual(['waiting', 'blocked', 'on_hold', 'done', 'canceled']);
    });
});

describe('withoutBlanks', () => {
    it('leaves out an optional field left empty, however it came to be empty', () => {
        const cleared = { kind: 'waiting', waiting_for: 'Bob', expected_by: null, contact: '  ', follow_up_at: '' } as unknown as Status;
        expect(withoutBlanks(cleared)).toEqual({ kind: 'waiting', waiting_for: 'Bob' });
    });

    it('keeps every field that says something', () => {
        const done: Status = { kind: 'done', completed_at: '2026-09-27', completion_note: 'Shipped' };
        expect(withoutBlanks(done)).toEqual(done);
    });
});

describe('render, frontmatter preservation', () => {
    it('preserves unrelated metadata and comments while removing legacy task fields', () => {
        const source = "---\ncreated_at: 2020-01-01 12:00:00+09:00\n# Keep\ncustom: [one, two]\nevents: {Meet: {start: 2026-10-10}}\ntask:\n    status: {kind: todo}\n    progress: 30\n    urgency: 5\n    scheduled_dates: [2025-01-01]\n    start_at: 2026-10-01\n    importance: 3\n---\n# Old\n";
        const result = render(task({ source, created_at: '2020-01-01 12:00:00+09:00', importance: undefined }));
        expect(result).toContain('# Keep');
        expect(frontmatterOf(result)).toMatchObject({ custom: ['one', 'two'], events: { Meet: { start: '2026-10-10' } }, created_at: '2020-01-01 12:00:00+09:00' });
        const metadata = frontmatterOf(result) as { task: object };
        expect(metadata.task).not.toHaveProperty('progress');
        expect(metadata.task).not.toHaveProperty('urgency');
        expect(metadata.task).not.toHaveProperty('scheduled_dates');
        expect(metadata.task).not.toHaveProperty('start_at');
        expect(metadata.task).not.toHaveProperty('importance');
    });
});
