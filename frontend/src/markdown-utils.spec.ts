import { describe, expect, it } from 'vitest';

import { chunkMarkdownByHeadings, extractFrontmatterH1AndRest } from '@/markdown-utils';
import { render } from '@/task';

// The source line each chunk claims to start on, which must hold the chunk's first line.
function claimedFirstLines(markdown: string): [string, string][] {
    const lines = markdown.split('\n');
    return chunkMarkdownByHeadings(markdown).chunks.map((chunk) => [
        lines[chunk.startLine - 1].trim(),
        chunk.content.split('\n')[0],
    ]);
}

describe('chunkMarkdownByHeadings', () => {
    it('starts the first chunk on its own line after the frontmatter', () => {
        const withBlank = claimedFirstLines('---\na: 1\n---\n\nFirst paragraph.\n');
        expect(withBlank).toEqual([['First paragraph.', 'First paragraph.']]);

        const withoutBlank = claimedFirstLines('---\na: 1\n---\nFirst paragraph.\n');
        expect(withoutBlank).toEqual([['First paragraph.', 'First paragraph.']]);
    });

    it('counts blank lines a note without frontmatter opens with', () => {
        expect(claimedFirstLines('\n\n  First paragraph.\n')).toEqual([['First paragraph.', 'First paragraph.']]);
    });

    it('starts each heading chunk on its heading', () => {
        const markdown = '---\na: 1\n---\n\nIntro.\n\n# One\n\nText.\n\n\n## Two\n\nMore.\n';
        expect(claimedFirstLines(markdown)).toEqual([
            ['Intro.', 'Intro.'],
            ['# One', '# One'],
            ['## Two', '## Two'],
        ]);
    });
});

describe('extractFrontmatterH1AndRest', () => {
    // A task's title is written back after `# ` as it was read, so plain text would lose these.
    it('reads the heading as written, inline Markdown and all', () => {
        const read = extractFrontmatterH1AndRest('---\ntask: {}\n---\n\n# Read *the* `spec` [here](https://example.com) \\# #\n\nBody\n');
        expect(read).toEqual({
            frontmatter: 'task: {}',
            heading: 'Read *the* `spec` [here](https://example.com) \\#',
            rest: 'Body\n',
        });
    });

    it('reads a Setext heading without its underline', () => {
        expect(extractFrontmatterH1AndRest('Title **bold**\n===\n\nBody').heading).toBe('Title **bold**');
    });

    it('reads an empty heading, or none, as no title', () => {
        expect(extractFrontmatterH1AndRest('#\n\nBody')).toMatchObject({ heading: '', rest: 'Body' });
        expect(extractFrontmatterH1AndRest('Body')).toMatchObject({ heading: '', rest: 'Body' });
    });

    it('gives back the title a task was written with', () => {
        const title = 'Fix _the_ `parser`, see [#12](https://example.com/12)';
        const written = render({ uuid: '00000000-0000-4000-8000-000000000001', title, tags: [], status: { kind: 'todo' }, note: 'Body\n' });
        expect(extractFrontmatterH1AndRest(written)).toMatchObject({ heading: title, rest: 'Body\n' });
    });
});
