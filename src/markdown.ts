import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import myRemarkYamlFrontmatter from '@/remark-yaml-frontmatter';
import remarkGfm from 'remark-gfm';
import { remarkDefinitionList, defListHastHandlers } from 'remark-definition-list';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import myRehypeEmbedLineNumbers from '@/rehype-embed-line-numbers';
import myRehypeLazyLoadImages from '@/rehype-lazy-load-images';
import rehypeUrlInspector from '@jsdevtools/rehype-url-inspector';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeMermaid from 'rehype-mermaid';
import rehypeStringify from 'rehype-stringify';
import { all } from 'lowlight';
import type { VFile } from 'vfile';
import { visit } from 'unist-util-visit';
import type { Root, Heading, Yaml } from 'mdast';
import { toString } from 'mdast-util-to-string';


const apiFilesUrl = new URL('files/', new URL(import.meta.env.VITE_APP_API_URL!, window.location.href)).href;

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter)
  .use(myRemarkYamlFrontmatter)
  .use(remarkGfm)
  .use(remarkDefinitionList)
  .use(remarkMath)
  .use(remarkRehype, {
    handlers: {
      ...defListHastHandlers,
    },
    allowDangerousHtml: true,
  })
  .use(rehypeRaw)
  .use(myRehypeEmbedLineNumbers)
  .use(myRehypeLazyLoadImages)
  .use(rehypeUrlInspector, {
    inspectEach: ({ url, propertyName, node }) => {
      if (node.tagName === 'img' && propertyName === 'src' && node.properties) {
        if (!/^(\/|https?:\/\/)/.test(url)) {
          node.properties[propertyName] = apiFilesUrl + url;
        }
      }
    },
  })
  .use(rehypeSlug)
  .use(rehypeAutolinkHeadings, {
    properties: {
      ariaHidden: true,
      tabIndex: -1,
      class: 'header-anchor mdi mdi-link-variant',
    },
  })
  .use(rehypeHighlight, {
    languages: all,
  })
  .use(rehypeKatex, {
    macros: {},
  })
  .use(rehypeMermaid, {
    strategy: 'inline-svg',
  })
  .use(rehypeStringify, {
    allowDangerousHtml: true,
  });

export async function renderMarkdown(markdown: string): Promise<VFile> {
  const file = await processor.process(markdown);
  return file;
}

// Worker-based rendering function
export async function renderMarkdownWorker(markdown: string): Promise<VFile> {
  try {
    const { renderMarkdownInWorker } = await import('./markdown-worker-service');
    return await renderMarkdownInWorker(markdown);
  } catch (error) {
    console.warn('Worker-based markdown rendering failed, falling back to main thread:', error);
    // Fallback to main thread processing
    return renderMarkdown(markdown);
  }
}

/**
 * Parse markdown and return frontmatter (YAML), first H1 text, and the rest after the H1.
 *
 * Behavior:
 * - frontmatter: content of the initial YAML block (without the --- fences), or "" if none.
 * - heading: first level-1 heading text (ATX or Setext), or "" if none.
 * - rest: markdown after that H1 block (or after frontmatter if no H1), with leading blank lines trimmed.
 *
 * Requires:
 *   npm i unified remark-parse remark-frontmatter unist-util-visit mdast-util-to-string
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
