<template>
  <div class="view">
    <button type="button" v-on:click="toggleEditor">{{ editorIsVisible ? 'Hide editor' : 'Edit' }}</button>
    <div>
      <textarea
        v-model="text"
        v-on:keydown="handleKeydown"
        v-bind:class="{ shifted: editorIsVisible }"
        class="editor"
      ></textarea>
      <div v-html="rendered" class="rendered" v-bind:class="{ shifted: editorIsVisible }"></div>
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';

import axios from 'axios';
import marked from 'marked';

@Component
export default class Home extends Vue {
  text = '';
  editorIsVisible = false;

  mounted() {
    console.log(this.$route.params.path);
    axios.get(`http://localhost:3030/load/${this.$route.params.path}`)
      .then(res => {
        this.text = res.data;
      });
  }

  get rendered() {
    return marked(this.text);
  }

  toggleEditor() {
    this.editorIsVisible = !this.editorIsVisible;
  }

  handleKeydown(e: KeyboardEvent) {
    if (e.ctrlKey && e.key == 's') {
      this.save();
      e.preventDefault();
    }
  }

  save() {
    const path = this.$route.params.path;
    axios.post('http://localhost:3030/save', {
      path: path,
      content: this.text,
      message: `Update ${path}`,
    }).then(res => {
      console.log(res.data);
    });
  }
}
</script>

<style scoped lang="scss">
.editor {
  position: absolute;
  width: 50%;
  height: 100%;
  margin-left: -50%;
  transition: margin-left 500ms;
  resize: none;
}

.rendered {
  margin-left: 0;
  width: 100%;
  height: 100%;
  transition: margin-left 500ms,
              width 500ms;
}

.editor.shifted {
  margin-left: 0;
}

.rendered.shifted {
  margin-left: 50%;
  width: 50%;
}
</style>
