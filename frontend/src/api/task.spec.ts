import { beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';

const client = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/axios', () => ({ getAxios: () => client }));

import { taskAlarmsToWrite } from '@/alarms';
import { getTask } from '@/api/task';
import { type Task, render } from '@/task';

const PATH = '.tasks/00000000-0000-4000-8000-000000000001.md';
const FRONTMATTER = '---\ncreated_at: 2026-11-01 09:00:00+09:00\ntask:\n    status:\n        kind: todo\ntags: []\n---\n';

// The note a save from the editor writes when nothing in it was changed.
async function resaved(markdown: string): Promise<string> {
    client.get.mockResolvedValue({ status: 200, data: markdown, headers: { etag: '"v1"' } });
    const [, task] = await getTask(PATH);
    if (task === null) {
        throw new Error('The task should have been read.');
    }
    return render(task);
}

beforeEach(() => {
    vi.resetAllMocks();
});

describe('a task read and saved unchanged', () => {
    it('keeps the note as it was', async () => {
        const markdown = `${FRONTMATTER}\n# Title\n\nBody\n`;
        expect(await resaved(markdown)).toBe(markdown);
    });

    it('keeps flow collections as written', async () => {
        const markdown = '---\ncreated_at: 2026-11-01 09:00:00+09:00\ntask:\n    status: {kind: todo}\n    due_by: 2026-11-20\n    alarms: {due_by: [-1d]}\ntags: [work]\nother: {x: [1, 2]}\n---\n\n# Title\n\nBody\n';
        expect(await resaved(markdown)).toBe(markdown);
    });

    it('keeps an empty heading, which is no title', async () => {
        const markdown = `${FRONTMATTER}\nIntro\n\n#\n\n# Second\n\nBody\n`;
        expect(await resaved(markdown)).toBe(markdown);
    });

    it('keeps what the note holds before its title', async () => {
        const markdown = `${FRONTMATTER}\nIntro paragraph.\n\n# Title\n\nBody\n`;
        const written = await resaved(markdown);
        expect(written).toContain('Intro paragraph.');
        expect(written.indexOf('Intro paragraph.')).toBeLessThan(written.indexOf('# Title'));
        expect(written).toContain('Body');
    });

    it.each([
        ['a block quote', '> # Quoted\n> more\n\nBody\n'],
        ['a list', '- # Listed\n- item\n\nBody\n'],
    ])('keeps a heading in %s where it is, rather than taking it as the title', async (_, body) => {
        client.get.mockResolvedValue({ status: 200, data: `${FRONTMATTER}\n${body}`, headers: { etag: '"v1"' } });
        const [, task] = await getTask(PATH);
        expect(task?.title).toBe('');
        expect(await resaved(`${FRONTMATTER}\n${body}`)).toContain(body);
    });

    it('takes no heading in a code block as the title', async () => {
        const body = '```\n# not a heading\n```\n\n# Title\n\nBody\n';
        client.get.mockResolvedValue({ status: 200, data: `${FRONTMATTER}\n${body}`, headers: { etag: '"v1"' } });
        const [, task] = await getTask(PATH);
        expect(task?.title).toBe('Title');
        expect(await resaved(`${FRONTMATTER}\n${body}`)).toContain('```\n# not a heading\n```');
    });
});

// A note in the task tree is a task by its path, whatever it holds; the editor fills in a status
// for one that holds none, and refuses one whose status it would have to replace.
describe('a note in the task tree without a status', () => {
    async function read(markdown: string) {
        client.get.mockResolvedValue({ status: 200, data: markdown, headers: { etag: '"v1"' } });
        const [, task] = await getTask(PATH);
        if (task === null) {
            throw new Error('The task should have been read.');
        }
        return task;
    }

    it.each([
        ['no frontmatter', '# Title\n\nBody\n'],
        ['empty frontmatter', '---\n---\n\n# Title\n\nBody\n'],
        ['frontmatter holding only a comment', '---\n# kept\n---\n\n# Title\n\nBody\n'],
        ['no task: block', '---\ntags: [work]\n# kept\nother: 1\n---\n\n# Title\n\nBody\n'],
        ['an empty task: block', '---\ntask:\ntags: [work]\n---\n\n# Title\n\nBody\n'],
        ['a task: block without a status', '---\ntask:\n    due_by: 2026-11-20\n---\n\n# Title\n\nBody\n'],
    ])('opens one with %s, and writes it a status and nothing less', async (_, markdown) => {
        const task = await read(markdown);
        expect(task.status).toBeUndefined();
        expect(task.title).toBe('Title');
        expect(() => render(task)).toThrow();
        const written = render({ ...task, status: { kind: 'backlog' } });
        const [, frontmatter, body] = written.split(/^---$/m);
        const metadata = YAML.parse(frontmatter);
        const before = YAML.parse(markdown.startsWith('---') ? markdown.split(/^---$/m)[1] : '') ?? {};
        expect(metadata).toMatchObject({ ...before, task: { ...(before.task ?? {}), status: { kind: 'backlog' } } });
        expect(body).toBe('\n\n# Title\n\nBody\n');
        if (markdown.includes('# kept')) {
            expect(frontmatter).toContain('# kept');
        }
    });

    it.each([
        ['a task: that is not a mapping', '---\ntask: soon\n---\n\n# Title\n', 'not a mapping'],
        ['a status that is not a mapping', '---\ntask:\n    status: todo\n---\n\n# Title\n', 'has no kind'],
        ['a status of no known kind', '---\ntask:\n    status: {kind: started}\n---\n\n# Title\n', 'has no kind'],
        ['frontmatter that is not a mapping', '---\n- a\n---\n\n# Title\n', 'not a mapping'],
        ['frontmatter that is not YAML', '---\ntask: [\n---\n\n# Title\n', 'not YAML'],
    ])('refuses one with %s, saying why', async (_, markdown, why) => {
        client.get.mockResolvedValue({ status: 200, data: markdown, headers: { etag: '"v1"' } });
        await expect(getTask(PATH)).rejects.toThrow(why);
    });
});

// A value the editor has no reading of reaches its field as unset; the save must not write that.
describe('a task holding values the editor does not read', () => {
    it.each([
        ['tags that are not a list', 'tags: foo\n', 'tags'],
        ['tags that are not strings', 'tags: [a, {b: 1}]\n', 'tags'],
        ['an importance of no level', 'task:\n    status: {kind: todo}\n    importance: urgent\n', 'importance'],
        ['a lead time that is not text', 'task:\n    status: {kind: todo}\n    lead_time: 7\n', 'lead_time'],
        ['an estimate that is not text', 'task:\n    status: {kind: todo}\n    estimate: 90\n', 'estimate'],
        ['a date that is not text', 'task:\n    status: {kind: todo}\n    due_by: [2026-11-20]\n', 'due_by'],
        ['an older start that is not text', 'task:\n    status: {kind: todo}\n    start_at: {at: 2026-11-20}\n', 'start_at'],
        ['alarms that are not a mapping', 'task:\n    status: {kind: todo}\n    deadline: 2026-11-20\n    alarms: -1d\n', 'alarms'],
        ['an alarm that is not one', 'task:\n    status: {kind: todo}\n    deadline: 2026-11-20\n    alarms:\n        deadline: [-1d, soon]\n', 'alarms'],
        ['alarms for something else', 'task:\n    status: {kind: todo}\n    alarms:\n        start: [-1d]\n', 'alarms'],
    ])('keeps %s as written', async (_, yaml, key) => {
        const markdown = `---\n${yaml.includes('task:') ? '' : 'task:\n    status: {kind: todo}\n'}${yaml}---\n\n# Title\n\nBody\n`;
        client.get.mockResolvedValue({ status: 200, data: markdown, headers: { etag: '"v1"' } });
        const [, task] = await getTask(PATH);
        expect(Object.keys(task?.unread ?? {})).toEqual([key]);
        const written = render({ ...task!, title: 'Title, revised', status: { kind: 'in_progress' } });
        const before = YAML.parse(markdown.split(/^---$/m)[1]);
        const after = YAML.parse(written.split(/^---$/m)[1]);
        expect(after).toEqual({ ...before, created_at: after.created_at, tags: before.tags ?? [], task: { ...before.task, status: { kind: 'in_progress' } } });
    });

    it('reads every value it can as it did', async () => {
        const markdown = '---\ntags: [work]\ntask:\n    status: {kind: todo}\n    importance: 4\n    lead_time: 2w\n    estimate: 1h 30m\n    due_by: 2026-11-20\n    alarms:\n        due_by: -1d\n---\n\n# Title\n';
        client.get.mockResolvedValue({ status: 200, data: markdown, headers: { etag: '"v1"' } });
        const [, task] = await getTask(PATH);
        expect(task?.unread).toBeUndefined();
        expect(task).toMatchObject({ tags: ['work'], importance: 'medium', lead_time: '2w', estimate: '1h 30m', due_by: '2026-11-20', alarms: { due_by: ['-1d'] } });
    });
});

// The editor writes a date's alarms only with the date (`taskAlarmsToWrite`), as it holds them.
function alarmsTheEditorWrites(task: Task): Task['alarms'] {
    return taskAlarmsToWrite({
        due_by: task.due_by ?? '',
        deadline: task.deadline ?? '',
        due_by_alarms: task.alarms?.due_by ?? null,
        deadline_alarms: task.alarms?.deadline ?? null,
    });
}

describe('the alarms of a date a task does not have', () => {
    it.each([
        ['no date', '    deadline: 2026-11-20\n    alarms:\n        due_by: [-1d]\n        deadline: [-2d]\n'],
        ['a date the editor does not read', '    due_by: [2026-11-20]\n    alarms:\n        due_by: [-1d]\n'],
    ])('are kept as written by a save that leaves it %s', async (_, lines) => {
        const markdown = `---\ntask:\n    status: {kind: todo}\n${lines}---\n\n# Title\n`;
        client.get.mockResolvedValue({ status: 200, data: markdown, headers: { etag: '"v1"' } });
        const [, task] = await getTask(PATH);
        const written = render({ ...task!, alarms: alarmsTheEditorWrites(task!), status: { kind: 'in_progress' } });
        expect(written).toContain(lines.slice(lines.indexOf('    alarms:')));
        const before = YAML.parse(markdown.split(/^---$/m)[1]);
        expect(YAML.parse(written.split(/^---$/m)[1]).task).toEqual({ ...before.task, status: { kind: 'in_progress' } });
    });

    it('go with the date the editor clears', async () => {
        const markdown = '---\ntask:\n    status: {kind: todo}\n    due_by: 2026-11-20\n    alarms:\n        due_by: [-1d]\n---\n\n# Title\n';
        client.get.mockResolvedValue({ status: 200, data: markdown, headers: { etag: '"v1"' } });
        const [, task] = await getTask(PATH);
        const cleared = { ...task!, due_by: undefined };
        const written = render({ ...cleared, alarms: alarmsTheEditorWrites(cleared) });
        expect(YAML.parse(written.split(/^---$/m)[1]).task).toEqual({ status: { kind: 'todo' } });
    });
});

// The task tree takes any file named for it, an image too; saving a form over one would replace it
// with a note.
describe('a file in the task tree that is not text', () => {
    it('is refused, saying why', async () => {
        client.get.mockResolvedValue({ status: 200, data: '\u0089PNG\r\n', headers: { etag: '"v1"', 'content-type': 'image/png' } });
        await expect(getTask('.tasks/00000000-0000-4000-8000-000000000001.png')).rejects.toThrow('is image/png, not text');
    });

    it('reads one served as text of any kind', async () => {
        client.get.mockResolvedValue({ status: 200, data: '# Title\n', headers: { etag: '"v1"', 'content-type': 'text/plain; charset=utf-8' } });
        const [, task] = await getTask('.tasks/00000000-0000-4000-8000-000000000001.txt');
        expect(task?.title).toBe('Title');
    });
});
