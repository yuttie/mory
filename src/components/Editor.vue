<template>
  <div class="editor">
    <div ref="editor"></div>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

import ace from 'ace-builds';
import 'ace-builds/src-noconflict/keybinding-vim';
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
      keyboardHandler: 'ace/keyboard/vim',
      fontSize: 14,
      fontFamily: 'monospace',
      navigateWithinSoftTabs: true,
    });
    this.editor!.on('change', () => {
      this.$emit('change', this.editor!.getValue());
    });
  }
}
</script>

<style scoped lang="scss">
.editor {
  position: relative;
  display: flex;

  & > * {
    flex: 1 1 0;
  }
}
</style>
