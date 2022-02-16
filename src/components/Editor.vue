<template>
  <div class="editor">
    <div ref="editor"></div>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

import ace from 'ace-builds';

@Component
export default class Editor extends Vue {
  @Prop(String) readonly value!: string;
  @Prop(String) readonly mode!: string;
  editor: any = null;  // eslint-disable-line @typescript-eslint/no-explicit-any
  ignoreNextChangeScrollTopEvent = false;

  @Watch('value')
  onValueChanged(value: string) {
    if (value !== this.editor!.getValue()) {  // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const cursor = this.editor!.getCursorPosition();  // eslint-disable-line @typescript-eslint/no-non-null-assertion
      this.editor!.setValue(value, -1);  // eslint-disable-line @typescript-eslint/no-non-null-assertion
      this.editor!.moveCursorToPosition(cursor);  // eslint-disable-line @typescript-eslint/no-non-null-assertion
    }
  }

  @Watch('mode')
  onModeChanged(mode: string) {
    if (mode === 'markdown') {
      import('ace-builds/src-noconflict/mode-markdown').then(() => {
        this.editor!.getSession().setMode(`ace/mode/${mode}`);
      });
    }
    else if (mode === 'less') {
      import('ace-builds/src-noconflict/mode-less').then(() => {
        this.editor!.getSession().setMode(`ace/mode/${mode}`);
      });
    }
  }

  mounted() {
    this.editor = ace.edit(this.$refs.editor as Element, {
      fontSize: parseInt(localStorage.getItem('editor-font-size')) || 13,
      fontFamily: localStorage.getItem('editor-font-family') || 'Menlo, monospace',
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
    this.editor!.getSession().on('changeScrollTop', (e: any) => {  // eslint-disable-line @typescript-eslint/no-non-null-assertion
      if (!this.ignoreNextChangeScrollTopEvent) {
        const lineNumber = this.editor!.renderer.getFirstFullyVisibleRow();
        this.$emit('scroll', lineNumber);  // eslint-disable-line @typescript-eslint/no-non-null-assertion
      }
      else {
        this.ignoreNextChangeScrollTopEvent = false;
      }
    });

    const theme = localStorage.getItem('editor-theme') || 'default';
    this.setTheme(theme);

    if (this.mode === 'markdown') {
      import('ace-builds/src-noconflict/mode-markdown').then(() => {
        this.editor!.getSession().setMode(`ace/mode/${this.mode}`);
      });
    }
    else if (this.mode === 'less') {
      import('ace-builds/src-noconflict/mode-less').then(() => {
        this.editor!.getSession().setMode(`ace/mode/${this.mode}`);
      });
    }

    const keybinding = localStorage.getItem('editor-keybinding') || 'default';
    this.setKeybinding(keybinding);
  }

  focus() {
    this.editor!.focus();  // eslint-disable-line @typescript-eslint/no-non-null-assertion
  }

  blur() {
    this.editor!.blur();  // eslint-disable-line @typescript-eslint/no-non-null-assertion
  }

  resize() {
    this.editor!.resize();  // eslint-disable-line @typescript-eslint/no-non-null-assertion
  }

  scrollTo(lineNumber: number) {
    this.editor!.scrollToLine(lineNumber, false, false, null);
    this.ignoreNextChangeScrollTopEvent = true;
  }

  setTheme(theme: string) {
    let loading = null;

    if      (theme === 'ambiance')                { loading = import('ace-builds/src-noconflict/theme-ambiance');                }
    else if (theme === 'chaos')                   { loading = import('ace-builds/src-noconflict/theme-chaos');                   }
    else if (theme === 'chrome')                  { loading = import('ace-builds/src-noconflict/theme-chrome');                  }
    else if (theme === 'clouds')                  { loading = import('ace-builds/src-noconflict/theme-clouds');                  }
    else if (theme === 'clouds_midnight')         { loading = import('ace-builds/src-noconflict/theme-clouds_midnight');         }
    else if (theme === 'cobalt')                  { loading = import('ace-builds/src-noconflict/theme-cobalt');                  }
    else if (theme === 'crimson_editor')          { loading = import('ace-builds/src-noconflict/theme-crimson_editor');          }
    else if (theme === 'dawn')                    { loading = import('ace-builds/src-noconflict/theme-dawn');                    }
    else if (theme === 'dracula')                 { loading = import('ace-builds/src-noconflict/theme-dracula');                 }
    else if (theme === 'dreamweaver')             { loading = import('ace-builds/src-noconflict/theme-dreamweaver');             }
    else if (theme === 'eclipse')                 { loading = import('ace-builds/src-noconflict/theme-eclipse');                 }
    else if (theme === 'github')                  { loading = import('ace-builds/src-noconflict/theme-github');                  }
    else if (theme === 'gob')                     { loading = import('ace-builds/src-noconflict/theme-gob');                     }
    else if (theme === 'gruvbox')                 { loading = import('ace-builds/src-noconflict/theme-gruvbox');                 }
    else if (theme === 'idle_fingers')            { loading = import('ace-builds/src-noconflict/theme-idle_fingers');            }
    else if (theme === 'iplastic')                { loading = import('ace-builds/src-noconflict/theme-iplastic');                }
    else if (theme === 'katzenmilch')             { loading = import('ace-builds/src-noconflict/theme-katzenmilch');             }
    else if (theme === 'kr_theme')                { loading = import('ace-builds/src-noconflict/theme-kr_theme');                }
    else if (theme === 'kuroir')                  { loading = import('ace-builds/src-noconflict/theme-kuroir');                  }
    else if (theme === 'merbivore')               { loading = import('ace-builds/src-noconflict/theme-merbivore');               }
    else if (theme === 'merbivore_soft')          { loading = import('ace-builds/src-noconflict/theme-merbivore_soft');          }
    else if (theme === 'mono_industrial')         { loading = import('ace-builds/src-noconflict/theme-mono_industrial');         }
    else if (theme === 'monokai')                 { loading = import('ace-builds/src-noconflict/theme-monokai');                 }
    else if (theme === 'nord_dark')               { loading = import('ace-builds/src-noconflict/theme-nord_dark');               }
    else if (theme === 'pastel_on_dark')          { loading = import('ace-builds/src-noconflict/theme-pastel_on_dark');          }
    else if (theme === 'solarized_dark')          { loading = import('ace-builds/src-noconflict/theme-solarized_dark');          }
    else if (theme === 'solarized_light')         { loading = import('ace-builds/src-noconflict/theme-solarized_light');         }
    else if (theme === 'sqlserver')               { loading = import('ace-builds/src-noconflict/theme-sqlserver');               }
    else if (theme === 'terminal')                { loading = import('ace-builds/src-noconflict/theme-terminal');                }
    else if (theme === 'textmate')                { loading = import('ace-builds/src-noconflict/theme-textmate');                }
    else if (theme === 'tomorrow')                { loading = import('ace-builds/src-noconflict/theme-tomorrow');                }
    else if (theme === 'tomorrow_night')          { loading = import('ace-builds/src-noconflict/theme-tomorrow_night');          }
    else if (theme === 'tomorrow_night_blue')     { loading = import('ace-builds/src-noconflict/theme-tomorrow_night_blue');     }
    else if (theme === 'tomorrow_night_bright')   { loading = import('ace-builds/src-noconflict/theme-tomorrow_night_bright');   }
    else if (theme === 'tomorrow_night_eighties') { loading = import('ace-builds/src-noconflict/theme-tomorrow_night_eighties'); }
    else if (theme === 'twilight')                { loading = import('ace-builds/src-noconflict/theme-twilight');                }
    else if (theme === 'vibrant_ink')             { loading = import('ace-builds/src-noconflict/theme-vibrant_ink');             }
    else if (theme === 'xcode')                   { loading = import('ace-builds/src-noconflict/theme-xcode');                   }

    if (loading) {
      loading.then(() => {
	this.editor!.setTheme(`ace/theme/${theme}`);
      });
    }
    else {
      this.editor!.setTheme(null);
    }
  }

  setKeybinding(keybinding: string) {
    if (keybinding === 'default') {
      this.editor!.setKeyboardHandler(null);
    }
    else if (keybinding === 'emacs') {
      import('ace-builds/src-noconflict/keybinding-emacs').then(() => {
        ace.config.loadModule("ace/keyboard/emacs", function() {
          // Do nothing
        });
        this.editor!.setKeyboardHandler('ace/keyboard/emacs');
      });
    }
    else if (keybinding === 'sublime') {
      import('ace-builds/src-noconflict/keybinding-sublime').then(() => {
        ace.config.loadModule("ace/keyboard/sublime", function() {
          // Do nothing
        });
        this.editor!.setKeyboardHandler('ace/keyboard/sublime');
      });
    }
    else if (keybinding === 'vim') {
      import('ace-builds/src-noconflict/keybinding-vim').then(() => {
        ace.config.loadModule("ace/keyboard/vim", function() {
          // Do nothing
        });
        this.editor!.setKeyboardHandler('ace/keyboard/vim');
      });
    }
    else if (keybinding === 'vim-modified') {
      import('ace-builds/src-noconflict/keybinding-vim').then(() => {
        ace.config.loadModule("ace/keyboard/vim", function(m) {
          // Remove <C-d> for the insert mode from the default keymap
          const i = m.handler.defaultKeymap.findIndex((entry: any) => entry.keys === '<C-d>' && entry.context === 'insert');
          m.handler.defaultKeymap.splice(i, 1);
        });
        this.editor!.setKeyboardHandler('ace/keyboard/vim');
        // Adjust keybindings
        this.adjustKeybindings(this.editor);
      });
    }
    else if (keybinding === 'vscode') {
      import('ace-builds/src-noconflict/keybinding-vscode').then(() => {
        ace.config.loadModule("ace/keyboard/vscode", function() {
          // Do nothing
        });
        this.editor!.setKeyboardHandler('ace/keyboard/vscode');
      });
    }
  }

  adjustKeybindings(editor: any) {
    // Ctrl-a
    editor.commands.removeCommand('gotolinestart', false);
    editor.commands.addCommand({
      name: "gotolinestart",
      description: "Go to line start",
      bindKey: { win: "Alt-Left|Home|Ctrl-A", mac: "Command-Left|Home|Ctrl-A" },
      exec: function(editor: any) { editor.navigateLineStart(); },
      multiSelectAction: "forEach",
      scrollIntoView: "cursor",
      readOnly: true
    });
    // Ctrl-e
    editor.commands.removeCommand('gotolineend', false);
    editor.commands.addCommand({
      name: "gotolineend",
      description: "Go to line end",
      bindKey: { win: "Alt-Right|End|Ctrl-E", mac: "Command-Right|End|Ctrl-E" },
      exec: function(editor: any) { editor.navigateLineEnd(); },
      multiSelectAction: "forEach",
      scrollIntoView: "cursor",
      readOnly: true
    });
    // Ctrl-f
    editor.commands.removeCommand('gotoright', false);
    editor.commands.addCommand({
      name: "gotoright",
      description: "Go to right",
      bindKey: { win: "Right|Ctrl-F", mac: "Right|Ctrl-F" },
      exec: function(editor: any, args: any) { editor.navigateRight(args.times); },
      multiSelectAction: "forEach",
      scrollIntoView: "cursor",
      readOnly: true
    });
    // Ctrl-b
    editor.commands.removeCommand('gotoleft', false);
    editor.commands.addCommand({
      name: "gotoleft",
      description: "Go to left",
      bindKey: { win: "Left|Ctrl-B", mac: "Left|Ctrl-B" },
      exec: function(editor: any, args: any) { editor.navigateLeft(args.times); },
      multiSelectAction: "forEach",
      scrollIntoView: "cursor",
      readOnly: true
    });
    // Ctrl-d
    editor.commands.removeCommand('del', false);
    editor.commands.addCommand({
      name: "del",
      description: "Delete",
      bindKey: { win: "Delete|Ctrl-D", mac: "Delete|Ctrl-D|Shift-Delete" },
      exec: function(editor: any) { editor.remove("right"); },
      multiSelectAction: "forEach",
      scrollIntoView: "cursor"
    });
    // Ctrl-h
    editor.commands.removeCommand('backspace', false);
    editor.commands.addCommand({
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
    editor.commands.removeCommand('blockindent', false);
    editor.commands.addCommand({
      name: "blockindent",
      description: "Block indent",
      bindKey: { win: "Ctrl-]|Alt-Right", mac: "Ctrl-]|Alt-Right" },
      exec: function(editor: any) { editor.blockIndent(); },
      multiSelectAction: "forEachLine",
      scrollIntoView: "selectionPart"
    });
    // Alt-Left
    editor.commands.removeCommand('blockoutdent', false);
    editor.commands.addCommand({
      name: "blockoutdent",
      description: "Block outdent",
      bindKey: { win: "Ctrl-[|Alt-Left", mac: "Ctrl-[|Alt-Left" },
      exec: function(editor: any) { editor.blockOutdent(); },
      multiSelectAction: "forEachLine",
      scrollIntoView: "selectionPart"
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
