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

import MarkdownIt from 'markdown-it';
import mdit_anchor from 'markdown-it-anchor';
import mdit_container from 'markdown-it-container';
const mdit_deflist = require('markdown-it-deflist');  // eslint-disable-line @typescript-eslint/no-var-requires
const mdit_task_lists = require('markdown-it-task-lists');  // eslint-disable-line @typescript-eslint/no-var-requires
import markdownItMermaid from '@liradb2000/markdown-it-mermaid';
import Prism from 'prismjs';


const apiFilesUrl = new URL('files/', new URL(process.env.VUE_APP_API_URL!, window.location.href)).href;

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

const mdit = new MarkdownIt('default', {
  html: true,
  linkify: true,
  highlight: (code: string, lang: string) => {
    if (Prism.languages[lang]) {
      return `<pre class="language-${lang}"><code class="language-${lang}">${Prism.highlight(code, Prism.languages[lang], lang)}</code></pre>`;
    }
    else {
      return '';  // use external default escaping
    }
  },
});
mdit.core.ruler.push('baseurl', (state: any): any => {
  const baseUrl = new URL('files/', new URL(process.env.VUE_APP_API_URL!, window.location.href)).href;
  function rewrite(tokens: any[]) {
    for (const token of tokens) {
      if (token.type === 'image') {
        for (const attr of token.attrs) {
          if (attr[0] === 'src') {
            if (!/^(\/|https?:\/\/)/.test(attr[1])) {
              attr[1] = baseUrl + attr[1];
            }
          }
        }
      }
      else if (token.type === 'html_block') {
        const root = document.createElement('div');
        root.innerHTML = token.content;
        for (const img of root.querySelectorAll('img')) {
          const src = img.getAttribute('src');
          if (src !== null && !/^(\/|https?:\/\/)/.test(src)) {
            img.setAttribute('src', baseUrl + src);
          }
        }
        token.content = root.innerHTML;
      }
      // Process recursively
      if (token.children !== null) {
        rewrite(token.children);
      }
    }
  }
  rewrite(state.tokens);
});
// Borrowed from https://github.com/waylonflinn/markdown-it-katex/blob/fd464f82dae0b427d80517ce7aa96dccb72b2f47/index.js#L15-L153
// Test if potential opening or closing delimieter
// Assumes that there is a "$" at state.src[pos]
function isValidDelim(state: any, pos: any) {
  let can_open = true;
  let can_close = true;
  const max = state.posMax;
  const prevChar = pos > 0 ? state.src.charCodeAt(pos - 1) : -1;
  const nextChar = pos + 1 <= max ? state.src.charCodeAt(pos + 1) : -1;

  // Check non-whitespace conditions for opening and closing, and
  // check that closing delimeter isn't followed by a number
  if (prevChar === 0x20/* " " */ || prevChar === 0x09/* \t */ ||
    (nextChar >= 0x30/* "0" */ && nextChar <= 0x39/* "9" */)) {
    can_close = false;
  }
  if (nextChar === 0x20/* " " */ || nextChar === 0x09/* \t */) {
    can_open = false;
  }

  return {
    can_open: can_open,
    can_close: can_close
  };
}

function math_inline(state: any, silent: any) {
  if (state.src[state.pos] !== "$") { return false; }

  let res = isValidDelim(state, state.pos);
  if (!res.can_open) {
    if (!silent) { state.pending += "$"; }
    state.pos += 1;
    return true;
  }

  // First check for and bypass all properly escaped delimieters
  // This loop will assume that the first leading backtick can not
  // be the first character in state.src, which is known since
  // we have found an opening delimieter already.
  const start = state.pos + 1;
  let match = start;
  while ( (match = state.src.indexOf("$", match)) !== -1) {
    // Found potential $, look for escapes, pos will point to
    // first non escape when complete
    let pos = match - 1;
    while (state.src[pos] === "\\") { pos -= 1; }

    // Even number of escapes, potential closing delimiter found
    if ( ((match - pos) % 2) == 1 ) { break; }
    match += 1;
  }

  // No closing delimter found.  Consume $ and continue.
  if (match === -1) {
    if (!silent) { state.pending += "$"; }
    state.pos = start;
    return true;
  }

  // Check if we have empty content, ie: $$.  Do not parse.
  if (match - start === 0) {
    if (!silent) { state.pending += "$$"; }
    state.pos = start + 1;
    return true;
  }

  // Check for valid closing delimiter
  res = isValidDelim(state, match);
  if (!res.can_close) {
    if (!silent) { state.pending += "$"; }
    state.pos = start;
    return true;
  }

  if (!silent) {
    const token     = state.push('text', '', 0);
    token.markup  = "$";
    token.content = '$' + state.src.slice(start, match) + '$';
  }

  state.pos = match + 1;
  return true;
}

function math_block(state: any, start: any, end: any, silent: any){
  let pos = state.bMarks[start] + state.tShift[start];
  let max = state.eMarks[start];

  if(pos + 2 > max){ return false; }
  if(state.src.slice(pos,pos+2)!=='$$'){ return false; }

  pos += 2;
  let firstLine = state.src.slice(pos,max);
  let lastLine;

  let found = false;
  if(silent){ return true; }
  if(firstLine.trim().slice(-2)==='$$'){
    // Single line expression
    firstLine = firstLine.trim().slice(0, -2);
    found = true;
  }

  let next;
  for(next = start; !found; ){

    next++;

    if(next >= end){ break; }

    pos = state.bMarks[next]+state.tShift[next];
    max = state.eMarks[next];

    if(pos < max && state.tShift[next] < state.blkIndent){
      // non-empty line with negative indent should stop the list:
      break;
    }

    if(state.src.slice(pos,max).trim().slice(-2)==='$$'){
      const lastPos = state.src.slice(0,max).lastIndexOf('$$');
      lastLine = state.src.slice(pos,lastPos);
      found = true;
    }

  }

  state.line = next + 1;

  const token = state.push('text', '', 0);
  token.block = true;
  token.content = '$$' + (firstLine && firstLine.trim() ? firstLine + '\n' : '')
    + state.getLines(start + 1, next, state.tShift[start], true)
    + (lastLine && lastLine.trim() ? lastLine : '') + '$$';
  token.map = [ start, state.line ];
  token.markup = '$$';
  return true;
}
// Borrowed from https://github.com/waylonflinn/markdown-it-katex/blob/fd464f82dae0b427d80517ce7aa96dccb72b2f47/index.js#L191-L194
mdit.inline.ruler.after('escape', 'math_inline', math_inline);
mdit.block.ruler.after('blockquote', 'math_block', math_block, {
  alt: ['paragraph', 'reference', 'blockquote', 'list'],
});
// Borrowed from https://github.com/markdown-it/markdown-it/blob/5789a3fe9693aa3ef6aa882b0f57e0ea61efafc0/support/demo_template/index.js#L166-L181
// Inject line numbers for sync scroll. Notes:
// - We track only headings and paragraphs on first level. That's enough.
// - Footnotes content causes jumps. Level limit filter it automatically.
let metadataLineCount = 0;
function injectLineNumbers(tokens: any, idx: any, options: any, env: any, slf: any) {
  if (tokens[idx].map) {
    const lineNumber = tokens[idx].map[0];
    tokens[idx].attrSet('data-line', String(metadataLineCount + lineNumber));
  }
  return slf.renderToken(tokens, idx, options, env, slf);
}
function updateMetadataLineCount(count: number) {
  metadataLineCount = count;
}
mdit.renderer.rules.paragraph_open = injectLineNumbers;
mdit.renderer.rules.heading_open = injectLineNumbers;
mdit.use(mdit_anchor, {
  level: 2,
  permalink: true,
  permalinkBefore: true,
  permalinkSpace: false,
  permalinkSymbol: '',
  renderPermalink: (slug: any, opts: any, state: any, idx: any) => {
    const space = () => Object.assign(new state.Token('text', '', 0), { content: ' ' })

    const linkTokens = [
      Object.assign(new state.Token('link_open', 'a', 1), {
        attrs: [
          ...(opts.permalinkClass ? [['class', opts.permalinkClass + ' mdi mdi-link-variant']] : []),
          ['href', opts.permalinkHref(slug, state)],
          ...Object.entries(opts.permalinkAttrs(slug, state))
        ]
      }),
      Object.assign(new state.Token('html_block', '', 0), { content: opts.permalinkSymbol }),
      new state.Token('link_close', 'a', -1)
    ]

    // `push` or `unshift` according to position option.
    // Space is at the opposite side.
    if (opts.permalinkSpace) {
      if (opts.permalinkBefore) {
        linkTokens.push(space())
      }
      else {
        linkTokens.unshift(space())
      }
    }
    if (opts.permalinkBefore) {
      state.tokens[idx + 1].children.unshift(...linkTokens)
    }
    else {
      state.tokens[idx + 1].children.push(...linkTokens)
    }
  },
});
mdit.use(mdit_container, 'dynamic', {
  validate: () => true,
  render: (tokens: any, idx: any) => {
    const token = tokens[idx];
    if (token.nesting === 1) {
      return `<div class="${token.info.trim()}">`;
    } else {
      return '</div>';
    }
  },
});
mdit.use(mdit_deflist);
mdit.use(mdit_task_lists);
mdit.use(markdownItMermaid);

export { mdit, updateMetadataLineCount, renderMarkdown };
