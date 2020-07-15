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
    ace.config.loadModule("ace/keyboard/vim", function(m) {
      // Remove <C-d> for the insert mode from the default keymap
      const i = m.handler.defaultKeymap.findIndex((entry: any) => entry.keys === '<C-d>' && entry.context === 'insert');
      m.handler.defaultKeymap.splice(i, 1);
    });

    this.editor = ace.edit(this.$refs.editor as Element, {
      mode: 'ace/mode/markdown',
      theme: 'ace/theme/nord_dark',
      keyboardHandler: 'ace/keyboard/vim',
      fontSize: 13,
      fontFamily: 'Menlo, monospace',
      useSoftTabs: true,
      navigateWithinSoftTabs: true,
      enableAutoIndent: true,
      showGutter: true,
      showLineNumbers: true,
      showPrintMargin: false,
      displayIndentGuides: true,
      highlightActiveLine: true,
      highlightGutterLine: true,
      highlightSelectedWord: true,
      showInvisibles: false,
      wrap: true,
      indentedSoftWrap: true,
      scrollPastEnd: true,
      animatedScroll: false,
    });
    this.editor!.on('change', () => {  // eslint-disable-line @typescript-eslint/no-non-null-assertion
      this.$emit('change', this.editor!.getValue());  // eslint-disable-line @typescript-eslint/no-non-null-assertion
    });

    // Adjust keybindings
    // Ctrl-a
    this.editor!.commands.removeCommand('gotolinestart', false);
    this.editor!.commands.addCommand({
      name: "gotolinestart",
      description: "Go to line start",
      bindKey: { win: "Alt-Left|Home|Ctrl-A", mac: "Command-Left|Home|Ctrl-A" },
      exec: function(editor: any) { editor.navigateLineStart(); },
      multiSelectAction: "forEach",
      scrollIntoView: "cursor",
      readOnly: true
    });
    // Ctrl-e
    this.editor!.commands.removeCommand('gotolineend', false);
    this.editor!.commands.addCommand({
      name: "gotolineend",
      description: "Go to line end",
      bindKey: { win: "Alt-Right|End|Ctrl-E", mac: "Command-Right|End|Ctrl-E" },
      exec: function(editor: any) { editor.navigateLineEnd(); },
      multiSelectAction: "forEach",
      scrollIntoView: "cursor",
      readOnly: true
    });
    // Ctrl-f
    this.editor!.commands.removeCommand('gotoright', false);
    this.editor!.commands.addCommand({
      name: "gotoright",
      description: "Go to right",
      bindKey: { win: "Right|Ctrl-F", mac: "Right|Ctrl-F" },
      exec: function(editor: any, args: any) { editor.navigateRight(args.times); },
      multiSelectAction: "forEach",
      scrollIntoView: "cursor",
      readOnly: true
    });
    // Ctrl-b
    this.editor!.commands.removeCommand('gotoleft', false);
    this.editor!.commands.addCommand({
      name: "gotoleft",
      description: "Go to left",
      bindKey: { win: "Left|Ctrl-B", mac: "Left|Ctrl-B" },
      exec: function(editor: any, args: any) { editor.navigateLeft(args.times); },
      multiSelectAction: "forEach",
      scrollIntoView: "cursor",
      readOnly: true
    });
    // Ctrl-d
    this.editor!.commands.removeCommand('del', false);
    this.editor!.commands.addCommand({
      name: "del",
      description: "Delete",
      bindKey: { win: "Delete|Ctrl-D", mac: "Delete|Ctrl-D|Shift-Delete" },
      exec: function(editor: any) { editor.remove("right"); },
      multiSelectAction: "forEach",
      scrollIntoView: "cursor"
    });
    // Ctrl-h
    this.editor!.commands.removeCommand('backspace', false);
    this.editor!.commands.addCommand({
      name: "backspace",
      description: "Backspace",
      bindKey: {
        win: "Shift-Backspace|Backspace|Ctrl-H",
        mac: "Ctrl-Backspace|Shift-Backspace|Backspace|Ctrl-H"
      },
      exec: function(editor: any) { editor.remove("left"); },
      multiSelectAction: "forEach",
      scrollIntoView: "cursor"
    });
    // Alt-Right
    this.editor!.commands.removeCommand('blockindent', false);
    this.editor!.commands.addCommand({
      name: "blockindent",
      description: "Block indent",
      bindKey: { win: "Ctrl-]|Alt-Right", mac: "Ctrl-]|Alt-Right" },
      exec: function(editor: any) { editor.blockIndent(); },
      multiSelectAction: "forEachLine",
      scrollIntoView: "selectionPart"
    });
    // Alt-Left
    this.editor!.commands.removeCommand('blockoutdent', false);
    this.editor!.commands.addCommand({
      name: "blockoutdent",
      description: "Block outdent",
      bindKey: { win: "Ctrl-[|Alt-Left", mac: "Ctrl-[|Alt-Left" },
      exec: function(editor: any) { editor.blockOutdent(); },
      multiSelectAction: "forEachLine",
      scrollIntoView: "selectionPart"
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
