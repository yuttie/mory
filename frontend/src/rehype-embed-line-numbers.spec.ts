import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';

import myRehypeEmbedLineNumbers from '@/rehype-embed-line-numbers';

// The elements the plugin numbered, as `tag:line-end`, in document order.
function numbered(markdown: string): string[] {
    const html = String(unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeRaw)
        .use(myRehypeEmbedLineNumbers)
        .use(rehypeStringify)
        .processSync(markdown));
    return [...html.matchAll(/<(\w+)[^>]*\sdata-line="(\d+)" data-line-end="(\d+)"/g)].map((m) => `${m[1]}:${m[2]}-${m[3]}`);
}

describe('myRehypeEmbedLineNumbers', () => {
    it('numbers blocks by the lines they span, the end exclusive', () => {
        expect(numbered('# Title\n\nText\nwrapped.\n\n- one\n- two\n\n```\ncode\n```\n')).toEqual([
            'h1:1-2', 'p:3-5', 'ul:6-8', 'li:6-7', 'li:7-8', 'pre:9-12',
        ]);
    });

    it('ends an element that runs to the start of a line with the line before', () => {
        // An unclosed fence runs to the end of the file, after the last line break.
        expect(numbered('Text.\n\n```\ncode\n')).toEqual(['p:1-2', 'pre:3-5']);
    });

    it('leaves inline elements unnumbered, which start part-way along a line', () => {
        expect(numbered('Text with a [link](x), *emphasis* and `code`.\n\n<div>raw <b>bold</b></div>\n')).toEqual([
            'p:1-2', 'div:3-4',
        ]);
    });

    it('numbers table rows, so a long table has an anchor per row', () => {
        expect(numbered('| a |\n|---|\n| 1 |\n| 2 |\n')).toEqual([
            'table:1-5', 'thead:1-2', 'tr:1-2', 'tbody:3-5', 'tr:3-4', 'tr:4-5',
        ]);
    });
});
