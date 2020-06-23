<template>
  <div ref="editor" class="editor">
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

import ace from 'ace-builds';
import 'ace-builds/src-noconflict/mode-markdown';
import 'ace-builds/src-noconflict/theme-nord_dark';

@Component
export default class Editor extends Vue {
  @Prop(String) readonly value!: string;
  editor: any = null;

  @Watch('value')
  onValueChanged(value: string) {
    if (value !== this.editor!.getValue()) {
      const cursor = this.editor!.getCursorPosition();
      this.editor!.setValue(value, -1);
      this.editor!.moveCursorToPosition(cursor);
    }
  }

  mounted() {
    this.editor = ace.edit(this.$refs.editor as Element, {
      mode: 'ace/mode/markdown',
      theme: 'ace/theme/nord_dark',
    });
    this.editor!.on('change', () => {
      this.$emit('change', this.editor!.getValue());
    });
    this.editor.resize();
  }
}
</script>

<style scoped lang="scss">
.editor {
  width: 100%;
  height: 100%;
}
</style>
