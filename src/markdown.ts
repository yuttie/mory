import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import myRemarkYamlFrontmatter from '@/remark-yaml-frontmatter';
import remarkGfm from 'remark-gfm';
import { remarkDefinitionList, defListHastHandlers } from 'remark-definition-list';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import myRehypeEmbedLineNumbers from '@/rehype-embed-line-numbers';
import rehypeUrlInspector from '@jsdevtools/rehype-url-inspector';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeHighlight from 'rehype-highlight';
import rehypeMathjaxChtml from 'rehype-mathjax/chtml';
import rehypeMermaid from 'rehype-mermaid';
import rehypeStringify from 'rehype-stringify';
import { all } from 'lowlight';
import type { VFile } from 'vfile';


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
  })
  .use(myRehypeEmbedLineNumbers)
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
  .use(rehypeMathjaxChtml, {
    chtml: {
      fontURL: 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/output/chtml/fonts/woff-v2',
    },
  })
  .use(rehypeMermaid, {
    strategy: 'inline-svg',
  })
  .use(rehypeStringify);

async function renderMarkdown(markdown: string): Promise<VFile> {
  const file = await processor.process(markdown);
  return file;
}

export { renderMarkdown };
