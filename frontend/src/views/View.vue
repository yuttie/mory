<template>
  <div class="view">
    <div>
      <button type="button" v-on:click="toggleEditor">{{ editorIsVisible ? 'Hide editor' : 'Edit' }}</button>
      <span v-show="isModified">Modified</span>
    </div>
    <div class="toc" v-on:click="toggleToc">
      <div class="header">TOC</div>
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
    </div>
    <div class="panes" v-bind:class="{ shifted: editorIsVisible }">
      <Editor v-bind:value="text" v-on:change="text = $event" ref="editor"></Editor>
      <div v-html="rendered" class="rendered"></div>
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';

import Editor from '@/components/Editor.vue';

import axios from '@/axios';
import marked from 'marked';
import 'material-design-icons/iconfont/material-icons.css';
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

    return `<h${level}><a id="${fragmentId}" href="#${fragmentId}" class="header-link material-icons"></a>${text}</h${level}>`;
  },
};

(marked as any).use({ renderer });

@Component({
  components: {
    Editor,
  },
})
export default class View extends Vue {
  text = '';
  initialText = '';
  editorIsVisible = false;
  tocIsVisible = false;

  mounted() {
    document.title = `${this.$route.params.path} | ${process.env.VUE_APP_NAME}`;

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
        });
    }
  }

  destroyed() {
    window.removeEventListener('keydown', this.handleKeydown);
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

  makeFragmentId(text: string) {
    return makeFragmentId(text);
  }

  toggleToc() {
    this.tocIsVisible = !this.tocIsVisible;
  }

  toggleEditor() {
    this.editorIsVisible = !this.editorIsVisible;
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
    });
  }
}
</script>

<style scoped lang="scss">
.view {
  display: flex;
  flex-direction: column;
}

.panes {
  flex: 1 1 0;
  position: relative;
  overflow: hidden;

  & > * {
    width: 50%;
    height: 100%;
  }
}

.editor {
  position: absolute;
  margin-left: -50%;
  transition: margin-left 300ms;
}

.rendered {
  margin-left: 0;
  width: 100%;
  height: 100%;
  overflow: auto;
  transition: margin-left 300ms,
              width 300ms;
}

.panes.shifted .editor {
  margin-left: 0;
}

.panes.shifted .rendered {
  margin-left: 50%;
  width: 50%;
}

.toc {
  position: absolute;
  right: 20px;
  z-index: 1;
  overflow: hidden;
  background: white;
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.3);

  .header {
    font-weight: bold;
    text-align: center;
  }

  .tree {
    margin: 0;

    &.collapsed {
      width: 0;
      height: 0;
    }
  }
}
</style>
