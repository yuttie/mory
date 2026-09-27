import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

import { type Task, makeDefaultStatus, render, replaceStatus } from '@/task';

function task(overrides: Partial<Task> = {}): Task {
    return {
        uuid: '00000000-0000-4000-8000-000000000000',
        title: 'Write the report',
        tags: ['work'],
        status: { kind: 'waiting', waiting_for: 'the figures', contact: 'Alice' },
        progress: 40,
        importance: 3,
        urgency: 4,
        due_by: '2026-10-01',
        scheduled_dates: ['2026-09-28'],
        note: 'Some notes.\n',
        ...overrides,
    };
}

function frontmatterOf(markdown: string): unknown {
    return YAML.parse(markdown.split(/^---$/m)[1]);
}

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
