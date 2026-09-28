import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';

import myRehypeEmbedLineNumbers from '@/rehype-embed-line-numbers';

// The elements the plugin numbered, as `tag:line`, in document order.
function numbered(markdown: string): string[] {
    const html = String(unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeRaw)
        .use(myRehypeEmbedLineNumbers)
        .use(rehypeStringify)
        .processSync(markdown));
    return [...html.matchAll(/<(\w+)[^>]*\sdata-line="(\d+)"/g)].map((m) => `${m[1]}:${m[2]}`);
}

describe('myRehypeEmbedLineNumbers', () => {
    it('numbers blocks by the line they start on', () => {
        expect(numbered('# Title\n\nText.\n\n- one\n- two\n\n```\ncode\n```\n')).toEqual([
            'h1:1', 'p:3', 'ul:5', 'li:5', 'li:6', 'pre:8',
        ]);
    });

    it('leaves inline elements unnumbered, which start part-way along a line', () => {
        expect(numbered('Text with a [link](x), *emphasis* and `code`.\n\n<div>raw <b>bold</b></div>\n')).toEqual([
            'p:1', 'div:3',
        ]);
    });

    it('numbers table rows, so a long table has an anchor per row', () => {
        expect(numbered('| a |\n|---|\n| 1 |\n| 2 |\n')).toEqual([
            'table:1', 'thead:1', 'tr:1', 'tbody:3', 'tr:3', 'tr:4',
        ]);
    });
});
