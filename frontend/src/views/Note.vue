<template>
  <div class="note">
    <template v-if="notFound">
      <div>
        <h1>Not Found</h1>
      </div>
    </template>
    <template v-else>
      <div
        v-show="!isLoading"
        style="position: fixed; right: 0; transform: translateY(40px); display: flex; flex-direction: column; z-index: 3;"
        class="toolbar mx-2 my-2"
      >
        <v-btn tile icon v-bind:color=" editorIsVisible && !viewerIsVisible ? 'primary' : 'normal'" v-on:click="editorIsVisible = true;  viewerIsVisible = false;"><v-icon>mdi-pencil</v-icon></v-btn>
        <v-btn tile icon v-bind:color=" editorIsVisible &&  viewerIsVisible ? 'primary' : 'normal'" v-on:click="editorIsVisible = true;  viewerIsVisible = true; "><v-icon>mdi-file-document-edit</v-icon></v-btn>
        <v-btn tile icon v-bind:color="!editorIsVisible &&  viewerIsVisible ? 'primary' : 'normal'" v-on:click="editorIsVisible = false; viewerIsVisible = true; "><v-icon>mdi-file-document</v-icon></v-btn>

        <v-btn tile icon color="gray" class="mt-5" v-on:click="lockScroll = !lockScroll;">
          <template v-if="lockScroll">
            <v-icon>mdi-lock</v-icon>
          </template>
          <template v-else>
            <v-icon>mdi-lock-open</v-icon>
          </template>
        </v-btn>

        <v-btn tile icon color="gray" class="mt-5" v-on:click="notifyUpstreamState">
          <v-icon>mdi-compare-vertical</v-icon>
        </v-btn>
        <v-btn tile icon color="gray" class="mt-0"                    v-bind:disabled="needSave" v-on:click="reload"><v-icon>mdi-reload</v-icon></v-btn>
        <v-btn tile icon color="pink" class="mt-0"                    v-bind:disabled="!needSave" v-bind:loading="isSaving" v-on:click.stop="saveIfNeeded"><v-icon>mdi-content-save</v-icon></v-btn>
        <v-btn tile icon color="gray" class="mt-0" id="rename-toggle" v-bind:disabled="!noteHasUpstream" v-bind:loading="isRenaming"><v-icon>mdi-rename-box</v-icon></v-btn>

        <v-btn tile icon color="gray" class="mt-5" id="toc-toggle"><v-icon>mdi-table-of-contents</v-icon></v-btn>
      </div>
      <v-dialog
        v-model="showConfirmationDialog"
        max-width="25em"
      >
        <v-card>
          <template v-if="upstreamState === 'different'">
            <v-card-title class="headline">
              Really overwrite note?
            </v-card-title>
            <v-card-text>
              Upstream has been modified since the note was loaded.
              Those changes will be lost if you continue to save the note.
            </v-card-text>
          </template>
          <template v-else-if="upstreamState === 'deleted'">
            <v-card-title class="headline">
              Really create a new note?
            </v-card-title>
            <v-card-text>
              Upstream has been deleted.
              A new note will be created if you continue to save the note.
            </v-card-text>
          </template>
          <template v-else>
            <v-card-title class="headline">
              Something is wrong.
            </v-card-title>
            <v-card-text>
              This message should not be shown to you...
            </v-card-text>
          </template>
          <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn
              text
              v-on:click="showConfirmationDialog = false;"
            >
              Cancel
            </v-btn>

            <v-btn
              color="error darken-1"
              text
              v-on:click="showConfirmationDialog = false; save();"
            >
              OK
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
      <div class="panes" v-bind:class="panesState">
        <Editor
          v-bind:value="text"
          v-bind:mode="editorMode"
          v-on:change="onEditorChange"
          v-on:scroll="onEditorScroll"
          ref="editor"
        ></Editor>
        <div class="viewer">
          <v-snackbar top timeout="1000" v-model="showUpstreamState" v-bind:color="upstreamStateSnackbarColor">
            <template v-if="upstreamState === 'different'">
              Upstream has been modified since it was loaded.
            </template>
            <template v-else-if="upstreamState === 'deleted'">
              Upstream has been deleted.
            </template>
            <template v-else>
              This is the latest version.
            </template>
          </v-snackbar>
          <v-expansion-panels
            accordion
            flat
            tile
            hover
            class="metadata"
            v-if="rendered.metadata"
          >
            <v-expansion-panel>
              <v-expansion-panel-header>
                <span>
                  Metadata
                  <template v-if="rendered.metadata.hasOwnProperty('validationErrors')">
                    <v-tooltip bottom color="success">
                      <template v-slot:activator="{ on, attrs }">
                        <v-icon color="success" v-bind="attrs" v-on="on">
                          mdi-check
                        </v-icon>
                      </template>
                      <span>YAML parse succeeded</span>
                    </v-tooltip>
                    <template v-if="rendered.metadata.validationErrors === null">
                      <v-tooltip bottom color="success">
                        <template v-slot:activator="{ on, attrs }">
                          <v-icon color="success" v-bind="attrs" v-on="on">
                            mdi-check
                          </v-icon>
                        </template>
                        <span>Schema validation succeeded</span>
                      </v-tooltip>
                    </template>
                    <template v-else>
                      <v-tooltip bottom color="error">
                        <template v-slot:activator="{ on, attrs }">
                          <v-icon color="error" v-bind="attrs" v-on="on">
                            mdi-alert
                          </v-icon>
                        </template>
                        <span>Schema validation failed</span>
                      </v-tooltip>
                    </template>
                  </template>
                  <template v-else>
                    <v-tooltip bottom color="error">
                      <template v-slot:activator="{ on, attrs }">
                        <v-icon color="error" v-bind="attrs" v-on="on">
                          mdi-alert
                        </v-icon>
                      </template>
                      <span>YAML parse failed</span>
                    </v-tooltip>
                  </template>
                </span>
              </v-expansion-panel-header>
              <v-expansion-panel-content>
                <template v-if="rendered.metadata.hasOwnProperty('validationErrors')">
                  <template v-if="rendered.metadata.validationErrors !== null">
                    <ul>
                      <li v-for="error of rendered.metadata.validationErrors" v-bind:key="error.dataPath + error.schemaPath">
                        <span class="font-weight-bold">{{error.dataPath}}: <span class="error--text">error:</span> {{error.message}}</span> (schema path: {{error.schemaPath}})
                      </li>
                    </ul>
                  </template>
                  <pre>{{ JSON.stringify(rendered.metadata.value, null, 2) }}</pre>
                </template>
                <template v-else>
                  <span class="error--text font-weight-bold">{{ rendered.metadata.parseError.toString() }}</span>
                </template>
              </v-expansion-panel-content>
            </v-expansion-panel>
          </v-expansion-panels>
          <div
            ref="renderedContent"
            class="content note-viewer-content"
          ></div>
        </div>
      </div>
      <v-menu
        v-model="renameMenuIsVisible"
        activator="#rename-toggle"
        v-bind:close-on-content-click="false"
      >
        <v-card
          min-width="30em"
        >
          <v-card-text>
            <v-text-field
              label="New path"
              v-model="newPath"
              v-on:focus="$event.target.select()"
              v-on:keydown="onNewPathKeydown"
              autofocus
            ></v-text-field>
          </v-card-text>
          <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn
              text
              v-on:click="renameMenuIsVisible = false;"
            >Cancel</v-btn>
            <v-btn
              text
              color="primary"
              v-on:click="rename(); renameMenuIsVisible = false;"
              v-bind:disabled="newPath === $route.params.path"
            >Rename</v-btn>
          </v-card-actions>
        </v-card>
      </v-menu>
      <v-menu offset-y activator="#toc-toggle" max-height="90vh">
        <v-card class="toc">
          <v-card-title>Table of Contents</v-card-title>
          <v-card-text>
            <ol class="tree" v-bind:class="{ collapsed: !tocIsVisible }">
              <li v-for="h1 of toc" v-bind:key="h1.title"><a v-bind:href="h1.href">{{ h1.title }}</a>
                <ol>
                  <li v-for="h2 of h1.children" v-bind:key="h2.title"><a v-bind:href="h2.href">{{ h2.title }}</a>
                    <ol>
                      <li v-for="h3 of h2.children" v-bind:key="h3.title"><a v-bind:href="h3.href">{{ h3.title }}</a>
                      </li>
                    </ol>
                  </li>
                </ol>
              </li>
            </ol>
          </v-card-text>
        </v-card>
      </v-menu>
      <v-overlay v-bind:value="isLoading" z-index="10" opacity="0">
        <v-progress-circular indeterminate color="blue-grey lighten-3" size="64"></v-progress-circular>
      </v-overlay>
    </template>
    <v-snackbar v-model="error" color="error" top timeout="5000">{{ errorText }}</v-snackbar>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

import Editor from '@/components/Editor.vue';
import metadataSchema from '@/metadata-schema.json';

import Ajv, { JSONSchemaType, DefinedError } from 'ajv';
import { getAxios } from '@/axios';
import MarkdownIt from 'markdown-it';
import mdit_anchor from 'markdown-it-anchor';
import mdit_container from 'markdown-it-container';
const mdit_deflist = require('markdown-it-deflist');  // eslint-disable-line @typescript-eslint/no-var-requires
const mdit_task_lists = require('markdown-it-task-lists');  // eslint-disable-line @typescript-eslint/no-var-requires
import Prism from 'prismjs';
import YAML from 'yaml';

const axios = getAxios();

declare const MathJax: any;

const ajv = new Ajv();
const validateMetadata = ajv.compile(metadataSchema);

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
  var prevChar, nextChar,
    max = state.posMax,
    can_open = true,
    can_close = true;

  prevChar = pos > 0 ? state.src.charCodeAt(pos - 1) : -1;
  nextChar = pos + 1 <= max ? state.src.charCodeAt(pos + 1) : -1;

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
  var start, match, token, res, pos, esc_count;

  if (state.src[state.pos] !== "$") { return false; }

  res = isValidDelim(state, state.pos);
  if (!res.can_open) {
    if (!silent) { state.pending += "$"; }
    state.pos += 1;
    return true;
  }

  // First check for and bypass all properly escaped delimieters
  // This loop will assume that the first leading backtick can not
  // be the first character in state.src, which is known since
  // we have found an opening delimieter already.
  start = state.pos + 1;
  match = start;
  while ( (match = state.src.indexOf("$", match)) !== -1) {
    // Found potential $, look for escapes, pos will point to
    // first non escape when complete
    pos = match - 1;
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
    token         = state.push('text', '', 0);
    token.markup  = "$";
    token.content = '$' + state.src.slice(start, match) + '$';
  }

  state.pos = match + 1;
  return true;
}

function math_block(state: any, start: any, end: any, silent: any){
  var firstLine, lastLine, next, lastPos, found = false, token,
    pos = state.bMarks[start] + state.tShift[start],
    max = state.eMarks[start]

  if(pos + 2 > max){ return false; }
  if(state.src.slice(pos,pos+2)!=='$$'){ return false; }

  pos += 2;
  firstLine = state.src.slice(pos,max);

  if(silent){ return true; }
  if(firstLine.trim().slice(-2)==='$$'){
    // Single line expression
    firstLine = firstLine.trim().slice(0, -2);
    found = true;
  }

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
      lastPos = state.src.slice(0,max).lastIndexOf('$$');
      lastLine = state.src.slice(pos,lastPos);
      found = true;
    }

  }

  state.line = next + 1;

  token = state.push('text', '', 0);
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
  if (tokens[idx].map && tokens[idx].level === 0) {
    const lineNumber = tokens[idx].map[0];
    tokens[idx].attrJoin('class', 'line');
    tokens[idx].attrSet('data-line', String(metadataLineCount + lineNumber));
  }
  return slf.renderToken(tokens, idx, options, env, slf);
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

@Component({
  components: {
    Editor,
  },
})
export default class Note extends Vue {
  @Prop(String) readonly token!: null | string;

  text = '';
  initialText = '';
  upstreamState = 'same';
  showUpstreamState = false;
  rendered = { metadata: null as null | any, content: '' };
  observer = null as null | IntersectionObserver;
  lockScroll = true;
  ignoreNext = false;
  noteHasUpstream = false;
  editorIsVisible = false;
  viewerIsVisible = true;
  tocIsVisible = false;
  renameMenuIsVisible = false;
  newPath = null as null | string;
  isLoading = false;
  isSaving = false;
  isRenaming = false;
  notFound = false;
  showConfirmationDialog = false;
  error = false;
  errorText = '';
  mathjaxTypesetPromise = Promise.resolve();
  renderTimeoutId = null as null | number;

  mounted() {
    const prismTheme = localStorage.getItem('prism-theme') || null;
    this.loadPrismTheme(prismTheme);

    document.title = `${this.title} | ${process.env.VUE_APP_NAME}`;

    this.onTokenChanged(this.token);

    window.addEventListener('focus', this.notifyUpstreamState);

    window.addEventListener('beforeunload', this.onBeforeunload);

    window.addEventListener('keydown', this.handleKeydown);

    if (this.$route.query.mode === 'create') {
      if (this.$route.query.template) {
        this.loadTemplate(this.$route.query.template as string);
      }
      else {
        this.text = `---
tags:
events:
---

# ${this.$route.params.path}`;
        this.initialText = this.text;
        this.editorIsVisible = true;
        (this.$refs.editor as Editor).focus();

        // Update immediately
        this.updateRendered();
      }
    }
    else {
      this.load(this.$route.params.path);
    }

    if (/\.less$/i.test(this.$route.params.path)) {
      this.editorIsVisible = true;
      this.viewerIsVisible = false;
      this.focusOrBlurEditor();
    }

    ((this.$refs.editor as Vue).$el as HTMLElement).addEventListener('transitionend', () => {
      (this.$refs.editor as Editor).resize();
    });
  }

  destroyed() {
    window.removeEventListener('focus', this.notifyUpstreamState);

    window.removeEventListener('beforeunload', this.onBeforeunload);

    window.removeEventListener('keydown', this.handleKeydown);
    if (this.renderTimeoutId) {
      window.clearTimeout(this.renderTimeoutId);
      this.renderTimeoutId = null;
    }
  }

  loadPrismTheme(theme: string | null) {
    if      (theme === 'a11y-dark')                        { import('prism-themes/themes/prism-a11y-dark.css');                       }
    else if (theme === 'atom-dark')                        { import('prism-themes/themes/prism-atom-dark.css');                       }
    else if (theme === 'base16-atelier-sulphurpool-light') { import('prism-themes/themes/prism-base16-ateliersulphurpool.light.css'); }
    else if (theme === 'cb')                               { import('prism-themes/themes/prism-cb.css');                              }
    else if (theme === 'coldark-cold')                     { import('prism-themes/themes/prism-coldark-cold.css');                    }
    else if (theme === 'coldark-dark')                     { import('prism-themes/themes/prism-coldark-dark.css');                    }
    else if (theme === 'coy-without-shadows')              { import('prism-themes/themes/prism-coy-without-shadows.css');             }
    else if (theme === 'darcula')                          { import('prism-themes/themes/prism-darcula.css');                         }
    else if (theme === 'dracula')                          { import('prism-themes/themes/prism-dracula.css');                         }
    else if (theme === 'duotone-dark')                     { import('prism-themes/themes/prism-duotone-dark.css');                    }
    else if (theme === 'duotone-earth')                    { import('prism-themes/themes/prism-duotone-earth.css');                   }
    else if (theme === 'duotone-forest')                   { import('prism-themes/themes/prism-duotone-forest.css');                  }
    else if (theme === 'duotone-light')                    { import('prism-themes/themes/prism-duotone-light.css');                   }
    else if (theme === 'duotone-sea')                      { import('prism-themes/themes/prism-duotone-sea.css');                     }
    else if (theme === 'duotone-space')                    { import('prism-themes/themes/prism-duotone-space.css');                   }
    else if (theme === 'ghcolors')                         { import('prism-themes/themes/prism-ghcolors.css');                        }
    else if (theme === 'hopscotch')                        { import('prism-themes/themes/prism-hopscotch.css');                       }
    else if (theme === 'material-dark')                    { import('prism-themes/themes/prism-material-dark.css');                   }
    else if (theme === 'material-light')                   { import('prism-themes/themes/prism-material-light.css');                  }
    else if (theme === 'material-oceanic')                 { import('prism-themes/themes/prism-material-oceanic.css');                }
    else if (theme === 'nord')                             { import('prism-themes/themes/prism-nord.css');                            }
    else if (theme === 'pojoaque')                         { import('prism-themes/themes/prism-pojoaque.css');                        }
    else if (theme === 'shades-of-purple')                 { import('prism-themes/themes/prism-shades-of-purple.css');                }
    else if (theme === 'synthwave84')                      { import('prism-themes/themes/prism-synthwave84.css');                     }
    else if (theme === 'vs')                               { import('prism-themes/themes/prism-vs.css');                              }
    else if (theme === 'vsc-dark-plus')                    { import('prism-themes/themes/prism-vsc-dark-plus.css');                   }
    else if (theme === 'xonokai')                          { import('prism-themes/themes/prism-xonokai.css');                         }
  }

  get editorMode() {
    if (/\.less$/i.test(this.$route.params.path)) {
      return 'less';
    }
    else {
      return 'markdown';
    }
  }

  get panesState() {
    return {
      onlyEditor: this.editorIsVisible && !this.viewerIsVisible,
      onlyViewer: !this.editorIsVisible && this.viewerIsVisible,
      both: this.editorIsVisible && this.viewerIsVisible,
    };
  }

  updateRendered() {
    const text = this.text;

    // Split the note text into a YAML part and a body part
    const [yaml, body] = ((): [null | string, string] => {
      if (text.startsWith('---\n')) {
        const endMarkerIndex = text.indexOf('\n---\n', 4);
        if (endMarkerIndex >= 0) {
          const yaml = text.slice(4, endMarkerIndex);
          const body = text.slice(endMarkerIndex + '\n---\n'.length);
          return [yaml, body];
        }
        else {
          return [null, text];
        }
      }
      else {
        return [null, text];
      }
    })();

    // Memorize the number of lines of metadata block
    if (yaml !== null) {
      // Count the lines including '---'
      let count = 2;  // Opening '---' and its next line
      let start = 0;
      let i = 0;
      while (true) {  // eslint-disable-line no-constant-condition
        const i = yaml.indexOf('\n', start);
        if (i === -1) {
          break;
        }
        else {
          count += 1;
          start = i + 1;
        }
      }
      count += 1;  // Closing '---'
      // Memorize it
      metadataLineCount = count;
    }

    // Render the body
    const renderedContent = mdit.render(body);
    this.ignoreNext = true;

    // Observe elements for scroll sync
    this.$nextTick(() => {
      if (this.observer) {
        this.observer.disconnect();
      }
      // Create a new observer
      let visibleEntries = [] as IntersectionObserverEntry[];
      this.observer = new IntersectionObserver((entries: IntersectionObserverEntry[], observer: IntersectionObserver) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleEntries.push(entry);
          }
          else {
            visibleEntries = visibleEntries.filter(el => {
              return el.target === entry.target;
            });
          }
        }
        visibleEntries.sort((a, b) => {
          if (a.boundingClientRect.top < b.boundingClientRect.top) {
            return -1;
          }
          else if (a.boundingClientRect.top > b.boundingClientRect.top) {
            return 1;
          }
          else {
            return 0;
          }
        });
        if (this.ignoreNext) {
          this.ignoreNext = false;
        }
        else {
          if (this.lockScroll && visibleEntries.length > 0) {
            const lineNumber = (visibleEntries[0].target as any).dataset.line;
            (this.$refs.editor as Editor).scrollTo(lineNumber);
          }
        }
      }, {
        root: null,
        rootMargin: '48px 0px 0px 0px',
        threshold: 1.0,
      });
      const candidates = (this.$refs.renderedContent as Element).querySelectorAll('[data-line]');
      for (const el of candidates) {
        this.observer.observe(el);
      }
    });

    // Parse a YAML part
    const [parseError, metadata] = (() => {
      if (yaml !== null) {
        try {
          return [null, YAML.parse(yaml)];
        }
        catch (err) {
          return [err, null];
        }
      }
      else {
        return [null, null];
      }
    })();

    // Validate metadata
    const validationErrors = (() => {
      if (metadata !== null) {
        if (validateMetadata(metadata)) {
          return null;
        }
        else {
          const errors = [];
          for (const err of validateMetadata.errors as DefinedError[]) {
            errors.push(err);
          }
          errors.sort((a, b) => {
            if (a.dataPath < b.dataPath) {
              return -1;
            }
            else if (a.dataPath > b.dataPath) {
              return 1;
            }
            else {
              return 0;
            }
          });
          return errors;
        }
      }
      else {
        return null;
      }
    })();

    // Set this.rendered
    if (metadata !== null) {
      // Metadata could be parsed correctly
      this.rendered = {
        metadata: {
          validationErrors: validationErrors,
          value: metadata
        },
        content: renderedContent,
      };
    }
    else if (parseError !== null) {
      // YAML parse error
      this.rendered = {
        metadata: {
          parseError: parseError,
          value: null,
        },
        content: renderedContent,
      };
    }
    else {
      // Metadata part does not exist
      this.rendered = {
        metadata: null,
        content: renderedContent,
      };
    }

    // We have to update the innerHTML immediately here instead of letting Vue
    // update it reactively, otherwise MathJax will not be able to see the new
    // content.
    (this.$refs.renderedContent as Element).innerHTML = this.rendered.content;

    // Schedule math rendering
    this.mathjaxTypesetPromise = this.mathjaxTypesetPromise.then(() => {
      return MathJax.typesetPromise([this.$refs.renderedContent]);
    });

    // Update the page title
    document.title = `${this.title} | ${process.env.VUE_APP_NAME}`;
  }

  updateRenderedLazy() {
    if (this.renderTimeoutId) {
      window.clearTimeout(this.renderTimeoutId);
      this.renderTimeoutId = null;
    }
    this.renderTimeoutId = window.setTimeout(() => {
      this.updateRendered();
    }, 500);
  }

  get title() {
    const rendered = this.rendered;
    const root = document.createElement('div');
    root.innerHTML = rendered.content;
    const h1 = root.querySelector('h1');
    if (h1) {
      return h1.textContent;
    }
    else {
      return this.$route.params.path;
    }
  }

  get toc() {
    const rendered = this.rendered;
    const root = document.createElement('div');
    root.innerHTML = rendered.content;

    const toc: any = [];
    const stack = [{ level: 0, title: '/', children: toc }];
    for (const hx of [...root.children].filter(el => /^H\d+$/.test(el.tagName))) {
      const level = parseInt(hx.tagName.slice(1));

      // Find the parent of the header
      while (level <= stack[stack.length - 1].level) {
        stack.pop();
      }

      const parent = stack[stack.length - 1];
      const child = {
        level: level,
        title: (hx as HTMLElement).innerText,
        href: hx.querySelector('a.header-anchor')?.getAttribute('href'),
        children: [],
      };
      parent.children.push(child);
      stack.push(child);
    }

    return toc;
  }

  get isModified(): boolean {
    return this.text !== this.initialText;
  }

  get upstreamStateSnackbarColor(): string {
    if (this.upstreamState === 'different') {
      return 'error';
    }
    else if (this.upstreamState === 'deleted') {
      return 'warning';
    }
    else if (this.upstreamState === 'same') {
      return 'success';
    }
    else {
      throw 'Invalid upstream state!';
    }
  }

  get needSave(): boolean {
    if (this.noteHasUpstream) {
      if (this.isModified) {
        return true;
      }
      else {
        return false;
      }
    }
    else {
      return true;
    }
  }

  @Watch('token')
  onTokenChanged(token: null | string) {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
    else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }

  @Watch('renameMenuIsVisible')
  onRenameMenuIsVisibleChanged(isVisible: boolean) {
    if (isVisible) {
      this.newPath = this.$route.params.path;
    }
  }

  onEditorChange(text: string) {
    this.text = text;
    // Update lazily
    this.updateRenderedLazy();
  }

  onEditorScroll(lineNumber: number) {
    if (this.lockScroll) {
      const renderedContent = this.$refs.renderedContent as Element;
      const candidates = [...renderedContent.querySelectorAll('[data-line]')];
      while (candidates.length > 0 ) {
        if (parseInt((candidates[0] as any).dataset['line']) >= lineNumber) {
          break;
        }
        else {
          candidates.shift();
        }
      }
      if (candidates.length > 0) {
        candidates[0].scrollIntoView(true);
        this.ignoreNext = true;
      }
    }
  }

  checkUpstreamState() {
    const path = this.$route.params.path;
    return axios.get(`/notes/${path}`)
      .then(res => {
        if (res.data === this.initialText) {
          return 'same';
        }
        else {
          return 'different';
        }
      })
      .catch(error => {
        if (error.response) {
          if (error.response.status === 404) {
            // Not Found
            return 'deleted';
          }
          else {
            throw error;
          }
        }
        else {
          throw error;
        }
      });
  }

  load(path: string) {
    this.isLoading = true;
    axios.get(`/notes/${path}`)
      .then(res => {
        this.text = res.data;
        this.initialText = this.text;
        this.upstreamState = 'same';
        this.noteHasUpstream = true;

        // Update immediately
        this.updateRendered();

        // Jump to a header if specified
        if (this.$route.hash) {
          const anchorSelector = decodeURIComponent(this.$route.hash);
          this.$nextTick(() => {
            const anchor = document.querySelector(anchorSelector);
            if (anchor) {
              anchor.scrollIntoView();
            }
          });
        }

        this.isLoading = false;
        this.notFound = false;
      }).catch(error => {
        if (error.response) {
          if (error.response.status === 401) {
            // Unauthorized
            this.$emit('tokenExpired', () => {
              this.load(path);
              this.focusOrBlurEditor();
            });
          }
          else if (error.response.status === 404) {
            // Not Found
            this.isLoading = false;
            this.notFound = true;
          }
          else {
            this.error = true;
            this.errorText = error.response;
            console.log('Unhandled error: {}', error.response);
            this.isLoading = false;
          }
        }
        else {
          this.error = true;
          this.errorText = error.toString();
          console.log('Unhandled error: {}', error);
          this.isLoading = false;
        }
      });
  }

  loadTemplate(path: string) {
    this.isLoading = true;
    axios.get(`/notes/${path}`)
      .then(res => {
        this.text = res.data;
        this.initialText = this.text;
        this.editorIsVisible = true;
        (this.$refs.editor as Editor).focus();

        // Update immediately
        this.updateRendered();

        this.isLoading = false;
        this.notFound = false;
      }).catch(error => {
        if (error.response) {
          if (error.response.status === 401) {
            // Unauthorized
            this.$emit('tokenExpired', () => {
              this.load(path);
              this.focusOrBlurEditor();
            });
          }
          else if (error.response.status === 404) {
            // Not Found
            this.isLoading = false;
            this.notFound = true;
          }
          else {
            this.error = true;
            this.errorText = error.response;
            console.log('Unhandled error: {}', error.response);
            this.isLoading = false;
          }
        }
        else {
          this.error = true;
          this.errorText = error.toString();
          console.log('Unhandled error: {}', error);
          this.isLoading = false;
        }
      });
  }

  reload() {
    this.load(this.$route.params.path);
  }

  toggleEditor() {
    if (this.viewerIsVisible) {
      if (this.editorIsVisible) {
        this.editorIsVisible = false;
      }
      else {
        this.editorIsVisible = true;
      }
    }
    else {
      if (this.editorIsVisible) {
        this.editorIsVisible = false;
        this.viewerIsVisible = true;
      }
      else {
        // Though this case shouldn't happen...
        this.editorIsVisible = true;
      }
    }

    this.focusOrBlurEditor();
  }

  toggleViewer() {
    if (this.editorIsVisible) {
      if (this.viewerIsVisible) {
        this.viewerIsVisible = false;
      }
      else {
        this.viewerIsVisible = true;
      }
    }
    else {
      if (this.viewerIsVisible) {
        this.viewerIsVisible = false;
        this.editorIsVisible = true;
      }
      else {
        // Though this case shouldn't happen...
        this.viewerIsVisible = true;
      }
    }

    this.focusOrBlurEditor();
  }

  focusOrBlurEditor() {
    if (this.editorIsVisible) {
      (this.$refs.editor as Editor).focus();
    }
    else {
      (this.$refs.editor as Editor).blur();
    }
  }

  notifyUpstreamState(e: FocusEvent) {
    this.checkUpstreamState()
      .then(state => {
        if (this.noteHasUpstream || state === 'different') {
          this.upstreamState = state;
          this.showUpstreamState = true;
        }
      })
      .catch(error => {
        if (error.response) {
          if (error.response.status === 401) {
            // Unauthorized
            this.$emit('tokenExpired', () => {
              this.notifyUpstreamState(e);
            });
          }
          else {
            this.error = true;
            this.errorText = error.response;
            console.log('Unhandled error: {}', error.response);
          }
        }
        else {
          this.error = true;
          this.errorText = error.toString();
          console.log('Unhandled error: {}', error);
        }
      });
  }

  onBeforeunload(e: any) {
    if (this.isModified) {
      // Cancel the event
      e.preventDefault();
      e.returnValue = '';  // Chrome requires returnValue to be set
    }
    else {
      delete e['returnValue'];  // This guarantees the browser unload happens
    }
  }

  handleKeydown(e: KeyboardEvent) {
    if (e.key === 'e') {
      if (!this.editorIsVisible) {
        this.toggleEditor();
        e.preventDefault();
      }
      else {
        this.focusOrBlurEditor();
      }
    }
    else if (e.ctrlKey && e.key === 'Enter') {
      this.toggleEditor();
    }
    else if (e.shiftKey && e.key === 'Enter') {
      this.toggleViewer();
    }
    else if (e.ctrlKey && e.key === 's') {
      this.saveIfNeeded();
      e.preventDefault();
    }
  }

  saveIfNeeded() {
    if (this.needSave) {
      this.checkUpstreamState()
        .then(state => {
          if (this.noteHasUpstream) {
            if (state === 'same') {
              this.save();
            }
            else {
              this.upstreamState = state;
              this.showConfirmationDialog = true;
            }
          }
          else {
            if (state === 'same' || state === 'deleted') {
              this.save();
            }
            else {
              this.upstreamState = state;
              this.showConfirmationDialog = true;
            }
          }
        })
        .catch(error => {
          if (error.response) {
            if (error.response.status === 401) {
              // Unauthorized
              this.$emit('tokenExpired', () => {
                this.saveIfNeeded();
              });
            }
            else {
              this.error = true;
              this.errorText = error.response;
              console.log('Unhandled error: {}', error.response);
            }
          }
          else {
            this.error = true;
            this.errorText = error.toString();
            console.log('Unhandled error: {}', error);
          }
        });
    }
  }

  save() {
    this.isSaving = true;
    const path = this.$route.params.path;
    const content = this.text;
    axios.put(`/notes/${path}`, {
      Save: {
        content: content,
        message: `Update ${path}`,
      },
    }).then(res => {
      this.initialText = content;
      this.noteHasUpstream = true;
      this.isSaving = false;
      // Remove 'mode' query parameter
      const newQuery = { ...this.$route.query };
      delete newQuery.mode;
      this.$router.replace({ query: newQuery });
    }).catch(error => {
      if (error.response) {
        if (error.response.status === 401) {
          // Unauthorized
          this.$emit('tokenExpired', () => {
            this.save();
            this.focusOrBlurEditor();
          });
        }
        else {
          this.error = true;
          this.errorText = error.response;
          console.log('Unhandled error: {}', error.response);
          this.isSaving = false;
        }
      }
      else {
        this.error = true;
        this.errorText = error.toString();
        console.log('Unhandled error: {}', error);
        this.isSaving = false;
      }
    });
  }

  onNewPathKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.rename();
    }
  }

  rename() {
    const oldPath = this.$route.params.path;
    const newPath = this.newPath;

    if (newPath !== null && newPath !== oldPath) {
      this.isRenaming = true;
      axios.put(`/notes/${newPath}`, {
        Rename: {
          from: oldPath,
        },
      }).then(res => {
        this.$router.replace({
          path: `/note/${newPath}`,
        });
        this.isRenaming = false;
      }).catch(error => {
        if (error.response) {
          if (error.response.status === 401) {
            // Unauthorized
            this.$emit('tokenExpired', () => {
              this.rename();
              this.focusOrBlurEditor();
            });
          }
          else {
            this.error = true;
            this.errorText = error.response;
            console.log('Unhandled error: {}', error.response);
            this.isRenaming = false;
          }
        }
        else {
          this.error = true;
          this.errorText = error.toString();
          console.log('Unhandled error: {}', error);
          this.isRenaming = false;
        }
      });
    }
  }
}
</script>

<style scoped lang="scss">
$nav-height: 64px;

.note {
  position: relative;
}

.toolbar {
  opacity: 0.2;
  transition: opacity 200ms;

  &:hover {
    opacity: 1;
  }
}

.panes {
  position: relative;
  width: 100%;
  overflow: hidden;

  & > * {
    width: 50%;
    height: 100%;
  }
}

.editor {
  position: fixed;
  height: calc(100vh - #{$nav-height});
  transition: margin-left 300ms,
              width 300ms;
}

.viewer {
  transition: margin-left 300ms,
              width 300ms;
}

.panes.onlyEditor {
  .editor {
    margin-left: 0%;
    width: 100%;
  }

  .viewer {
    margin-left: 100%;
    width: 50%;
  }
}

.panes.onlyViewer {
  .editor {
    margin-left: -50%;
    width: 50%;
  }

  .viewer {
    margin-left: 0%;
    width: 100%;
  }
}

.panes.both {
  .editor {
    margin-left: 0%;
    width: 50%;
  }

  .viewer {
    margin-left: 50%;
    width: 50%;
  }
}

.toc {
  ol {
    padding-left: 1.5em;
  }
}
</style>
