import { unified, type Processor } from 'unified';
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
import rehypeStringify from 'rehype-stringify';
import { all } from 'lowlight';
import type { VFile } from 'vfile';

const apiFilesUrl = new URL('files/', new URL(import.meta.env.VITE_APP_API_URL!, window.location.href)).href;

/**
 * Feature flags detected from the markdown source. Expensive renderers
 * (KaTeX, mermaid) are only loaded and added to the pipeline when the
 * document actually needs them.
 */
interface PipelineFeatures {
  math: boolean;
  mermaid: boolean;
}

function detectFeatures(markdown: string): PipelineFeatures {
  return {
    // remark-math triggers on $...$, $$...$$; rehype-katex additionally
    // handles elements with math classes. False positives only cost an
    // unnecessary lazy load, never broken output.
    math: /\$|\\\(|\\\[|class="(?:[^"]*\s)?math|language-math/.test(markdown),
    // Fenced code blocks (``` or ~~~) with the mermaid language, or raw HTML
    // using mermaid classes.
    mermaid: /^[ \t]*(?:`{3,}|~{3,})[ \t]*mermaid|class="(?:[^"]*\s)?mermaid/m.test(markdown),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProcessor = Processor<any, any, any, any, string>;

// Cache one processor per feature combination so repeated renders (e.g.
// progressive chunk rendering) don't rebuild the pipeline.
const processorCache = new Map<string, Promise<AnyProcessor>>();

async function getProcessor(features: PipelineFeatures): Promise<AnyProcessor> {
  const key = `${features.math ? 'm' : ''}${features.mermaid ? 'd' : ''}`;
  let cached = processorCache.get(key);
  if (!cached) {
    cached = buildProcessor(features);
    processorCache.set(key, cached);
  }
  return cached;
}

async function buildProcessor(features: PipelineFeatures): Promise<AnyProcessor> {
  // Load heavyweight plugins in parallel, only when needed.
  const [rehypeKatex, rehypeMermaid] = await Promise.all([
    features.math ? import('rehype-katex').then((m) => m.default) : undefined,
    features.mermaid ? import('rehype-mermaid').then((m) => m.default) : undefined,
  ]);

  let processor = unified()
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
    .use(rehypeSlug, {
      prefix: 'h-',
    })
    .use(rehypeAutolinkHeadings, {
      properties: {
        ariaHidden: true,
        tabIndex: -1,
        class: 'header-anchor mdi mdi-link-variant',
      },
    })
    .use(rehypeHighlight, {
      languages: all,
    }) as AnyProcessor;

  if (rehypeKatex) {
    processor = processor.use(rehypeKatex, {
      macros: {},
    });
  }
  if (rehypeMermaid) {
    processor = processor.use(rehypeMermaid, {
      strategy: 'inline-svg',
    });
  }

  return processor.use(rehypeStringify, {
    allowDangerousHtml: true,
  }) as AnyProcessor;
}

export async function renderMarkdown(markdown: string): Promise<VFile> {
  const processor = await getProcessor(detectFeatures(markdown));
  const file = await processor.process(markdown);
  return file;
}
