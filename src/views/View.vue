<template>
  <div class="view">
    <div>
      <button type="button" v-on:click="toggleEditor">{{ editorIsVisible ? 'Hide editor' : 'Edit' }}</button>
      <span v-show="text !== initialText">Modified</span>
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

import axios from 'axios';
import marked from 'marked';

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
    console.log(this.$route.params.path);
    if (this.$route.query.mode === 'create') {
      this.text = '';
      this.initialText = this.text;
      this.editorIsVisible = true;
    }
    else {
      axios.get(`http://localhost:3030/notes/${this.$route.params.path}`)
        .then(res => {
          this.text = res.data;
          this.initialText = this.text;
        });
    }
  }

  get rendered() {
    return marked(this.text);
  }

  toggleEditor() {
    this.editorIsVisible = !this.editorIsVisible;
    if (this.editorIsVisible) {
      (this.$refs.editor as Editor).focus();
    }
  }

  handleKeydown(e: KeyboardEvent) {
    if (e.ctrlKey && e.key == 's') {
      this.save();
      e.preventDefault();
    }
  }

  save() {
    const path = this.$route.params.path;
    axios.put(`http://localhost:3030/notes/${path}`, {
      Save: {
        content: this.text,
        message: `Update ${path}`,
      },
    }).then(res => {
      console.log(res.data);
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
  transition: margin-left 500ms;
}

.rendered {
  margin-left: 0;
  width: 100%;
  height: 100%;
  overflow: auto;
  transition: margin-left 500ms,
              width 500ms;
}

.panes.shifted .editor {
  margin-left: 0;
}

.panes.shifted .rendered {
  margin-left: 50%;
  width: 50%;
}
</style>
