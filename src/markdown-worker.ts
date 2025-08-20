import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeStringify from 'rehype-stringify';

// State variables
let processor = null;
let isInitialized = false;

// Initialize the markdown processor with minimal plugins to avoid DOM dependencies
function initializeProcessor(apiFilesUrl) {
  processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, {
      allowDangerousHtml: true,
    })
    .use(rehypeRaw)
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, {
      properties: {
        ariaHidden: true,
        tabIndex: -1,
        class: 'header-anchor mdi mdi-link-variant',
      },
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