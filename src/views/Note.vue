<template>
  <div class="note">
    <div class="not-found" v-if="notFound">
      <div>
        <h1>Not Found</h1>
      </div>
    </div>
    <div class="found" v-if="!notFound">
      <div
        v-show="!isLoading"
        style="position: fixed; right: 0; display: flex; flex-direction: column; z-index: 1;"
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
        <Editor v-bind:value="text" v-on:change="onEditorChange" ref="editor"></Editor>
        <div class="rendered">
          <div class="metadata" v-if="rendered.metadata">
            <h2>Metadata</h2>
            <pre>{{ rendered.metadata }}</pre>
          </div>
          <div
            ref="renderedContent"
            class="content"
            v-html="rendered.content"
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
    </div>
    <v-snackbar v-model="error" color="error" top timeout="5000">{{ errorText }}</v-snackbar>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

import Editor from '@/components/Editor.vue';

import axios from '@/axios';
import marked from 'marked';
import '@mdi/font/css/materialdesignicons.css';
import Prism from 'prismjs';
import 'prism-themes/themes/prism-nord.css';
import YAML from 'yaml';

declare const MathJax: any;

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
  rendered = { metadata: null as null | string, content: '' };
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
    document.title = `${this.$route.params.path} | ${process.env.VUE_APP_NAME}`;

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

  get panesState() {
    return {
      onlyEditor: this.editorIsVisible && !this.viewerIsVisible,
      onlyViewer: !this.editorIsVisible && this.viewerIsVisible,
      both: this.editorIsVisible && this.viewerIsVisible,
    };
  }

  updateRendered() {
    this.mathjaxTypesetPromise = this.mathjaxTypesetPromise.then(() => {
      return MathJax.typesetPromise([this.$refs.renderedContent]);
    });

    const text = this.text;
    if (text.startsWith('---\n')) {
      const endMarkerIndex = text.indexOf('\n---\n', 4);
      if (endMarkerIndex >= 0) {
        const yaml = text.slice(4, endMarkerIndex);
        const body = text.slice(endMarkerIndex + '\n---\n'.length);
        try {
          const metadata = YAML.parse(yaml);
          this.rendered = {
            metadata: JSON.stringify(metadata, null, 2),
            content: marked(body),
          };
          return;
        }
        catch (e) {
          this.rendered = {
            metadata: yaml,
            content: marked(body),
          };
          return;
        }
      }
    }
    this.rendered = {
      metadata: null,
      content: marked(text),
    };
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
    if (!this.editorIsVisible && e.key === 'e') {
      this.toggleEditor();
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

<style lang="scss">
@use "@/custom.scss";
$nav-height: 64px;

// Disable Vuetify's styles
.v-application {
  .rendered {
    p {
      margin-bottom: unset;
    }

    code {
      background-color: unset;
      color: unset;
      padding: unset;
    }

    code, kbd {
      border-radius: unset;
      font-size: unset;
      font-weight: unset;
    }

    ul, ol {
      padding-left: unset;
    }
  }
}

// Apply custom styles for rendered notes
.note {
  .rendered {
    .content {
      @include custom.rendered-note-styles($nav-height);
    }
  }
}
</style>

<style scoped lang="scss">
$nav-height: 64px;

.note {
  position: relative;

  & > .not-found,
  & > .found {
    display: contents;
  }
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

.rendered {
  transition: margin-left 300ms,
              width 300ms;

  .metadata {
    padding: 0.3em 1em;
    background-color: #eee;
    color: #222;
  }
}

.panes.onlyEditor {
  .editor {
    margin-left: 0%;
    width: 100%;
  }

  .rendered {
    margin-left: 100%;
    width: 50%;
  }
}

.panes.onlyViewer {
  .editor {
    margin-left: -50%;
    width: 50%;
  }

  .rendered {
    margin-left: 0%;
    width: 100%;
  }
}

.panes.both {
  .editor {
    margin-left: 0%;
    width: 50%;
  }

  .rendered {
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
