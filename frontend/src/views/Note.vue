<template>
  <div class="note">
    <div class="panes" v-bind:class="panesState">
      <Editor v-bind:value="text" v-on:change="text = $event" ref="editor"></Editor>
      <div class="rendered">
        <div>
          <span v-show="isModified">Modified</span>
        </div>
        <div v-html="rendered"></div>
      </div>
    </div>
    <div
      style="position: fixed; right: 0; display: flex; flex-direction: column;"
      class="mx-2 my-2"
    >
      <v-btn fab small color="primary" class="my-1" v-bind:outlined="!editorIsVisible" v-on:click="toggleEditor"><v-icon>mdi-pencil</v-icon></v-btn>
      <v-btn fab small color="primary" class="my-1" v-bind:outlined="!viewerIsVisible" v-on:click="toggleViewer"><v-icon>mdi-file-document</v-icon></v-btn>
      <v-btn fab small color="primary" class="my-1" outlined id="toc-toggle"><v-icon>mdi-table-of-contents</v-icon></v-btn>
    </div>
    <v-menu offset-y activator="#toc-toggle">
      <v-card>
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

marked.setOptions({
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
  editorIsVisible = false;
  viewerIsVisible = true;
  tocIsVisible = false;

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
      this.text = '';
      this.initialText = this.text;
      this.editorIsVisible = true;
      (this.$refs.editor as Editor).focus();
    }
    else {
      axios.get(`/notes/${this.$route.params.path}`)
        .then(res => {
          this.text = res.data;
          this.initialText = this.text;

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
        }).catch(error => {
          if (error.response) {
            if (error.response.status === 401) {
              // Unauthorized
              this.$emit('tokenExpired');
            }
            else {
              console.log('Unhandled error: {}', error.response);
            }
          }
          else {
            console.log('Unhandled error: {}', error);
          }
        });
    }
  }

  destroyed() {
    window.removeEventListener('keydown', this.handleKeydown);
  }

  get panesState() {
    return {
      onlyEditor: this.editorIsVisible && !this.viewerIsVisible,
      onlyViewer: !this.editorIsVisible && this.viewerIsVisible,
      both: this.editorIsVisible && this.viewerIsVisible,
    };
  }

  get rendered() {
    return marked(this.text);
  }

  get toc() {
    const rendered = this.rendered;
    const root = document.createElement('div');
    root.innerHTML = rendered;

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

  @Watch('token')
  onTokenChanged(token: null | string) {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
    else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }

  makeFragmentId(text: string) {
    return makeFragmentId(text);
  }

  toggleToc() {
    this.tocIsVisible = !this.tocIsVisible;
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
    else if (e.ctrlKey && e.key === 's') {
      if (this.isModified) {
        this.save();
      }
      e.preventDefault();
    }
  }

  save() {
    const path = this.$route.params.path;
    axios.put(`/notes/${path}`, {
      Save: {
        content: this.text,
        message: `Update ${path}`,
      },
    }).then(res => {
      this.initialText = this.text;
    }).catch(error => {
      if (error.response) {
        if (error.response.status === 401) {
          // Unauthorized
          this.$emit('tokenExpired');
        }
        else {
          console.log('Unhandled error: {}', error.response);
        }
      }
      else {
        console.log('Unhandled error: {}', error);
      }
    });
  }
}
</script>

<style lang="scss">
@import "@/custom.scss";
</style>

<style scoped lang="scss">
$nav-height: 64px;

.note {
  display: flex;
}

.panes {
  position: relative;
  width: 100%;

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
</style>
