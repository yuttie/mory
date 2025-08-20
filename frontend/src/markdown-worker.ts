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

// State variables
let processor = null;
let isInitialized = false;

// Initialize the markdown processor
function initializeProcessor(apiFilesUrl) {
  processor = unified()
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

  isInitialized = true;
}

// Handle messages from the main thread
self.addEventListener('message', async (event) => {
  const { type, id, data } = event.data;

  try {
    switch (type) {
      case 'init':
        initializeProcessor(data.apiFilesUrl);
        self.postMessage({ type: 'init-complete', id });
        break;

      case 'render':
        if (!isInitialized || !processor) {
          throw new Error('Processor not initialized');
        }
        
        const file = await processor.process(data.markdown);
        const result = {
          html: String(file),
          data: file.data
        };
        
        self.postMessage({ 
          type: 'render-complete', 
          id, 
          result 
        });
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    self.postMessage({ 
      type: 'error', 
      id, 
      error: {
        message: error.message,
        stack: error.stack
      }
    });
  }
});

// Notify that the worker is ready
self.postMessage({ type: 'worker-ready' });