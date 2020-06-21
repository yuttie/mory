<template>
  <div class="home">
    <button type="button" v-on:click="toggleEditor">{{ editorIsVisible ? 'Hide editor' : 'Edit' }}</button>
    <div>
      <textarea v-model="text" class="editor" v-bind:class="{ shifted: editorIsVisible }"></textarea>
      <div v-html="rendered" class="rendered" v-bind:class="{ shifted: editorIsVisible }"></div>
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';

import marked from 'marked';

@Component
export default class Home extends Vue {
  text = `abc
===

## def

This *is* an **Apple**.


![google](https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png)

* [ ] abc
* [x] def ~xyz~
    * 1
    * 2

| foo | bar |
| --- | --- |
| baz | bim |

`;
  editorIsVisible = false;

  get rendered() {
    return marked(this.text);
  }

  toggleEditor() {
    this.editorIsVisible = !this.editorIsVisible;
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
