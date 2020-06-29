<template>
  <div class="view">
    <div>
      <button type="button" v-on:click="toggleEditor">{{ editorIsVisible ? 'Hide editor' : 'Edit' }}</button>
      <span v-show="isModified">Modified</span>
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

@Component({
  components: {
    Editor,
  },
})
export default class View extends Vue {
  text = '';
  initialText = '';
  editorIsVisible = false;

  mounted() {
    document.title = `${this.$route.params.path} | ${process.env.VUE_APP_NAME}`;

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

  get isModified(): boolean {
    return this.text !== this.initialText;
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
</style>
