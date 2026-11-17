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
            before: '',
            rest: 'Body\n',
        });
    });

    it('reads a Setext heading without its underline', () => {
        expect(extractFrontmatterH1AndRest('Title **bold**\n===\n\nBody').heading).toBe('Title **bold**');
    });

    // An empty heading is a line of the note all the same, which a save must not drop.
    it('reads an empty heading, or none, as no title, keeping an empty one in the rest', () => {
        expect(extractFrontmatterH1AndRest('#\n\nBody')).toMatchObject({ heading: '', rest: '#\n\nBody' });
        expect(extractFrontmatterH1AndRest('Intro\n\n#\n\nBody\n')).toEqual({ frontmatter: '', heading: '', before: 'Intro', rest: '#\n\nBody\n' });
        expect(extractFrontmatterH1AndRest('Body')).toMatchObject({ heading: '', rest: 'Body' });
    });

    // As the listing's title is: a `# ` in a block quote or a list belongs to the body there.
    it('takes only a top-level heading as the title', () => {
        expect(extractFrontmatterH1AndRest('> # Quoted\n\nBody')).toMatchObject({ heading: '', before: '', rest: '> # Quoted\n\nBody' });
        expect(extractFrontmatterH1AndRest('- # Listed\n\n# Title\n\nBody')).toMatchObject({ heading: 'Title', before: '- # Listed', rest: 'Body' });
    });

    it('gives what comes before the heading apart from what comes after it', () => {
        expect(extractFrontmatterH1AndRest('---\na: 1\n---\n\nIntro.\n\n```\n# code\n```\n\n# Title\n\nBody\n')).toEqual({
            frontmatter: 'a: 1',
            heading: 'Title',
            before: 'Intro.\n\n```\n# code\n```',
            rest: 'Body\n',
        });
    });

    it('gives back the title a task was written with', () => {
        const title = 'Fix _the_ `parser`, see [#12](https://example.com/12)';
        const written = render({ uuid: '00000000-0000-4000-8000-000000000001', title, tags: [], status: { kind: 'todo' }, note: 'Body\n' });
        expect(extractFrontmatterH1AndRest(written)).toMatchObject({ heading: title, rest: 'Body\n' });
    });
});
