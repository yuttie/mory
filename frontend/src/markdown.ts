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
import type { LanguageFn } from 'highlight.js';
import { hljsLanguageMap } from '@/hljs-language-map';
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
  languages: string[];  // Canonical highlight.js grammar names used by the document, sorted.
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
    languages: detectLanguages(markdown),
  };
}

function detectLanguages(markdown: string): string[] {
  const found = new Set<string>();
  // Fenced code blocks: the first word of the info string (```js, ~~~python).
  for (const match of markdown.matchAll(/^[ \t]*(?:`{3,}|~{3,})[ \t]*([^\s`~{]+)/gm)) {
    found.add(match[1].toLowerCase());
  }
  // Raw HTML code blocks with a language-x class.
  for (const match of markdown.matchAll(/class="(?:[^"]*\s)?language-([^\s"]+)/g)) {
    found.add(match[1].toLowerCase());
  }
  const canonical = new Set<string>();
  for (const name of found) {
    const grammar = hljsLanguageMap[name];
    // Unknown languages (including mermaid, handled by rehype-mermaid) are
    // simply left unhighlighted, matching rehype-highlight's own behavior.
    if (grammar) {
      canonical.add(grammar);
    }
  }
  return [...canonical].sort();
}

// Grammar modules under highlight.js/es/languages/, bundled as lazy chunks.
// The *.js.js files are deprecation stubs, not grammars.
const grammarLoaders = import.meta.glob<{ default: LanguageFn }>([
  '../node_modules/highlight.js/es/languages/*.js',
  '!../node_modules/highlight.js/es/languages/*.js.js',
]);

function loadGrammar(name: string): Promise<LanguageFn> {
  return grammarLoaders[`../node_modules/highlight.js/es/languages/${name}.js`]().then((m) => m.default);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProcessor = Processor<any, any, any, any, string>;

// Cache one processor per feature combination so repeated renders (e.g.
// progressive chunk rendering) don't rebuild the pipeline.
const processorCache = new Map<string, Promise<AnyProcessor>>();

async function getProcessor(features: PipelineFeatures): Promise<AnyProcessor> {
  const key = `${features.math ? 'm' : ''}${features.mermaid ? 'd' : ''}:${features.languages.join(',')}`;
  let cached = processorCache.get(key);
  if (!cached) {
    cached = buildProcessor(features);
    processorCache.set(key, cached);
  }
  return cached;
}

async function buildProcessor(features: PipelineFeatures): Promise<AnyProcessor> {
  // Load heavyweight plugins and highlight.js grammars in parallel, only
  // when needed.
  const [rehypeKatex, rehypeMermaid, grammars] = await Promise.all([
    features.math ? import('rehype-katex').then((m) => m.default) : undefined,
    features.mermaid ? import('rehype-mermaid').then((m) => m.default) : undefined,
    Promise.all(features.languages.map(loadGrammar)),
  ]);
  // Registering a grammar under its canonical name also registers its
  // aliases (js, ts, ...), so language-js classes still resolve.
  const languages = Object.fromEntries(features.languages.map((name, i) => [name, grammars[i]]));

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
      languages,
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
