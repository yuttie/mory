import { describe, expect, it } from 'vitest';

import { chunkMarkdownByHeadings } from '@/markdown-utils';

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
