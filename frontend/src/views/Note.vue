<template>
  <div class="note">
    <template v-if="notFound">
      <div>
        <h1>Not Found</h1>
      </div>
    </template>
    <template v-if="!notFound">
      <div
        v-show="!isLoading"
        style="position: fixed; right: 0; transform: translateY(40px); display: flex; flex-direction: column; z-index: 3;"
        class="toolbar mx-2 my-2"
      >
        <v-btn icon color="primary" v-on:click="editorIsVisible = true;  viewerIsVisible = false;" v-bind:outlined=" editorIsVisible && !viewerIsVisible"><v-icon>mdi-pencil</v-icon></v-btn>
        <v-btn icon color="primary" v-on:click="editorIsVisible = true;  viewerIsVisible = true; " v-bind:outlined=" editorIsVisible &&  viewerIsVisible"><v-icon>mdi-file-document-edit</v-icon></v-btn>
        <v-btn icon color="primary" v-on:click="editorIsVisible = false; viewerIsVisible = true; " v-bind:outlined="!editorIsVisible &&  viewerIsVisible"><v-icon>mdi-file-document</v-icon></v-btn>

        <v-btn icon color="gray" class="mt-5"                    v-bind:disabled="needSave" v-on:click="reload"><v-icon>mdi-reload</v-icon></v-btn>
        <v-btn icon color="pink" class="mt-0"                    v-bind:disabled="!needSave" v-bind:loading="isSaving" v-on:click="saveIfNeeded"><v-icon>mdi-content-save</v-icon></v-btn>
        <v-btn icon color="gray" class="mt-0" id="rename-toggle" v-bind:disabled="!noteIsLoaded" v-bind:loading="isRenaming"><v-icon>mdi-rename-box</v-icon></v-btn>

        <v-btn icon color="gray" class="mt-5" id="toc-toggle"><v-icon>mdi-table-of-contents</v-icon></v-btn>
      </div>
      <div class="panes" v-bind:class="panesState">
        <Editor
          v-bind:value="text"
          v-bind:mode="editorMode"
          v-on:change="onEditorChange"
          ref="editor"
        ></Editor>
        <div class="viewer">
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
      <v-menu offset-y activator="#toc-toggle">
        <v-card class="toc">
          <v-card-title>Table of Contents</v-card-title>
          <v-card-text>
            <ol class="tree" v-bind:class="{ collapsed: !tocIsVisible }">
              <li v-for="h1 of toc" v-bind:key="h1.title"><a v-bind:href="'#' + makeFragmentId(h1.title)">{{ h1.title }}</a>
                <ol>
                  <li v-for="h2 of h1.children" v-bind:key="h2.title"><a v-bind:href="'#' + makeFragmentId(h2.title)">{{ h2.title }}</a>
                    <ol>
                      <li v-for="h3 of h2.children" v-bind:key="h3.title"><a v-bind:href="'#' + makeFragmentId(h3.title)">{{ h3.title }}</a>
                      </li>
                    </ol>
                  </li>
                </ol>
              </li>
            </ol>
          </v-card-text>
        </v-card>
      </v-menu>
      <v-overlay v-bind:value="isLoading" z-index="10">
        <v-progress-circular indeterminate size="64"></v-progress-circular>
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
import axios from '@/axios';
import marked from 'marked';
import '@mdi/font/css/materialdesignicons.css';
import Prism from 'prismjs';
import 'prism-themes/themes/prism-nord.css';
import YAML from 'yaml';

declare const MathJax: any;

const ajv = new Ajv();
const validateMetadata = ajv.compile(metadataSchema);

marked.setOptions({
  baseUrl: new URL('files/', new URL(process.env.VUE_APP_API_URL!, window.location.href)).href,
  gfm: true,
  highlight: function(code, lang) {
    if (Prism.languages[lang]) {
      return Prism.highlight(code, Prism.languages[lang], lang);
    }
    else {
      return code;
    }
  },
});

function makeFragmentId(text: string) {
  return text.toLowerCase().replace(/ /g, '-').replace(/[^-\p{Letter}\p{Number}]+/gu, '');
}

const renderer = {
  heading(text: string, level: number) {
    const fragmentId = makeFragmentId(text);

    return `<h${level} id="${fragmentId}"><a href="#${fragmentId}" class="header-link mdi mdi-link"></a>${text}</h${level}>`;
  },
};

(marked as any).use({ renderer });

@Component({
  components: {
    Editor,
  },
})
export default class Note extends Vue {
  @Prop(String) readonly token!: null | string;

  text = '';
  initialText = '';
  rendered = { metadata: null as null | any, content: '' };
  noteIsLoaded = false;
  editorIsVisible = false;
  viewerIsVisible = true;
  tocIsVisible = false;
  renameMenuIsVisible = false;
  newPath = null as null | string;
  isLoading = false;
  isSaving = false;
  isRenaming = false;
  notFound = false;
  error = false;
  errorText = '';
  mathjaxTypesetPromise = Promise.resolve();
  renderTimeoutId = null as null | number;

  mounted() {
    document.title = `${this.title} | ${process.env.VUE_APP_NAME}`;

    this.onTokenChanged(this.token);

    window.addEventListener('beforeunload', e => {
      if (this.isModified) {
        // Cancel the event
        e.preventDefault();
        e.returnValue = '';  // Chrome requires returnValue to be set
      }
      else {
        delete e['returnValue'];  // This guarantees the browser unload happens
      }
    });

    window.addEventListener('keydown', this.handleKeydown);

    if (this.$route.query.mode === 'create') {
      if (this.$route.query.template) {
        this.loadTemplate(this.$route.query.template as string);
      }
      else {
        this.text = `---
tags:
events:
event color:
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

    ((this.$refs.editor as Vue).$el as HTMLElement).addEventListener('transitionend', () => {
      (this.$refs.editor as Editor).resize();
    });
  }

  destroyed() {
    window.removeEventListener('keydown', this.handleKeydown);
    if (this.renderTimeoutId) {
      window.clearTimeout(this.renderTimeoutId);
      this.renderTimeoutId = null;
    }
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

    // Render the body
    const renderedContent = marked(body);

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
      const child = { level: level, title: (hx as HTMLElement).innerText, children: [] };
      parent.children.push(child);
      stack.push(child);
    }

    return toc;
  }

  get isModified(): boolean {
    return this.text !== this.initialText;
  }

  get needSave(): boolean {
    if (this.noteIsLoaded) {
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

  load(path: string) {
    this.isLoading = true;
    axios.get(`/notes/${path}`)
      .then(res => {
        this.text = res.data;
        this.initialText = this.text;
        this.noteIsLoaded = true;

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

  makeFragmentId(text: string) {
    return makeFragmentId(text);
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

  handleKeydown(e: KeyboardEvent) {
    if (e.key === 'e') {
      if (!this.editorIsVisible) {
        this.toggleEditor();
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
      this.save();
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
      this.noteIsLoaded = true;
      this.isSaving = false;
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
