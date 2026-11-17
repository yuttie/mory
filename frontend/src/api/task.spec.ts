import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/axios', () => ({ getAxios: () => client }));

import { getTask } from '@/api/task';
import { render } from '@/task';

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
