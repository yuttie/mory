import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { visit } from 'unist-util-visit';
import type { Root, Heading, Yaml } from 'mdast';
import { toString } from 'mdast-util-to-string';

/**
 * Lightweight markdown parsing helpers.
 *
 * These only depend on remark-parse and a couple of tiny mdast utilities, so
 * importing this module does NOT pull in the full rendering pipeline
 * (highlight.js, KaTeX, mermaid, ...). Keep heavy rendering code in
 * `@/markdown` instead.
 */

/**
 * Split markdown into chunks by H1 and H2 headings for progressive rendering.
 *
 * Separates frontmatter (YAML) from content and splits the content at heading
 * boundaries. Each chunk includes its starting line number for scroll sync.
 *
 * @param markdown - Full markdown document
 * @returns Object with frontmatter string and array of chunks with line numbers
 */
export function chunkMarkdownByHeadings(markdown: string): { frontmatter: string; chunks: Array<{ content: string; startLine: number }> } {
    const processor = unified()
        .use(remarkParse)
        .use(remarkFrontmatter, ['yaml']);

    const tree = processor.parse(markdown) as Root;
    const chunks: Array<{ content: string; startLine: number }> = [];

    // `startLine` is the line `start` lies on. A chunk can open with line
    // breaks, such as the one ending the frontmatter's closing fence and the
    // blank line after it, and trimming drops them, so count them into the
    // line the content starts on: the viewer adds it to every rendered line
    // number, which scroll sync relies on.
    function pushChunk(start: number, startLine: number, end: number) {
        const raw = markdown.slice(start, end);
        const content = raw.trim();
        if (content) {
            const skipped = raw.slice(0, raw.length - raw.trimStart().length);
            chunks.push({ content, startLine: startLine + skipped.split('\n').length - 1 });
        }
    }

    let frontmatter = '';
    let currentChunkStart = 0;
    let currentChunkStartLine = 1;

    // Extract frontmatter if present
    const firstNode = tree.children[0];
    if (firstNode?.type === 'yaml') {
        if (firstNode.position?.end?.offset != null && firstNode.position?.end?.line != null) {
            frontmatter = markdown.slice(0, firstNode.position.end.offset);
            currentChunkStart = firstNode.position.end.offset;
            currentChunkStartLine = firstNode.position.end.line;
        }
    }

    // Split content at H1 or H2 headings
    for (let i = 0; i < tree.children.length; i++) {
        const node = tree.children[i];

        // Skip frontmatter node
        if (node.type === 'yaml') {
            continue;
        }

        // Split at H1 or H2 headings
        if (node.type === 'heading' && (node.depth === 1 || node.depth === 2)) {
            if (node.position?.start?.offset != null && currentChunkStart < node.position.start.offset) {
                pushChunk(currentChunkStart, currentChunkStartLine, node.position.start.offset);
                currentChunkStart = node.position.start.offset;
                currentChunkStartLine = node.position.start.line;
            }
        }
    }

    // Add the remaining content as the last chunk
    if (currentChunkStart < markdown.length) {
        pushChunk(currentChunkStart, currentChunkStartLine, markdown.length);
    }

    return { frontmatter, chunks };
}

/**
 * Parse markdown and return frontmatter (YAML), first H1 text, and the rest after the H1.
 *
 * Behavior:
 * - frontmatter: content of the initial YAML block (without the --- fences), or "" if none.
 * - heading: first level-1 heading text (ATX or Setext), or "" if none.
 * - rest: markdown after that H1 block (or after frontmatter if no H1), with leading blank lines trimmed.
 */
export function extractFrontmatterH1AndRest(markdown: string): {
    frontmatter: string;
    heading: string;
    rest: string;
} {
    const processor = unified()
        .use(remarkParse)
        .use(remarkFrontmatter, ['yaml']);

    const tree = processor.parse(markdown) as Root;

    // 1) Frontmatter (only if it is the very first node)
    let frontmatter = '';
    let afterFrontmatterOffset = 0;
    const first = tree.children[0] as Yaml | undefined;
    if (first?.type === 'yaml') {
        frontmatter = first.value ?? '';
        afterFrontmatterOffset = first.position?.end.offset ?? 0;
    }

    // 2) Find the first depth-1 heading anywhere in document order
    let h1Node: Heading | null = null;
    visit(tree, 'heading', (node: Heading) => {
        if (!h1Node && node.depth === 1) {
            h1Node = node;
        }
    });

    // 3) Compute heading text and 'rest' slice point
    let headingText = '';
    let sliceFrom = afterFrontmatterOffset; // default: after frontmatter (or 0 if none)

    if (h1Node?.position?.end?.offset != null) {
        headingText = toString(h1Node).trim();
        sliceFrom = h1Node.position.end.offset;
    }

    // 4) Slice the rest and strip any blank lines immediately following
    let rest = markdown.slice(sliceFrom);
    rest = rest.replace(/^(?:[ \t]*\r?\n)+/, '');

    return {
        frontmatter,
        heading: headingText,
        rest,
    };
}
