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
  editor: any = null;  // eslint-disable-line @typescript-eslint/no-explicit-any

  @Watch('value')
  onValueChanged(value: string) {
    if (value !== this.editor!.getValue()) {  // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const cursor = this.editor!.getCursorPosition();  // eslint-disable-line @typescript-eslint/no-non-null-assertion
      this.editor!.setValue(value, -1);  // eslint-disable-line @typescript-eslint/no-non-null-assertion
      this.editor!.moveCursorToPosition(cursor);  // eslint-disable-line @typescript-eslint/no-non-null-assertion
    }
  }

  mounted() {
    this.editor = ace.edit(this.$refs.editor as Element, {
      mode: 'ace/mode/markdown',
      theme: 'ace/theme/nord_dark',
      keyboardHandler: 'ace/keyboard/vim',
      fontSize: 14,
      fontFamily: 'Menlo, monospace',
      navigateWithinSoftTabs: true,
    });
    this.editor!.on('change', () => {  // eslint-disable-line @typescript-eslint/no-non-null-assertion
      this.$emit('change', this.editor!.getValue());  // eslint-disable-line @typescript-eslint/no-non-null-assertion
    });
  }

  focus() {
    this.editor!.focus();  // eslint-disable-line @typescript-eslint/no-non-null-assertion
  }

  blur() {
    this.editor!.blur();  // eslint-disable-line @typescript-eslint/no-non-null-assertion
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
