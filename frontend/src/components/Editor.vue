<template>
    <div class="editor">
        <div ref="editorEl"></div>
    </div>
</template>

<script lang="ts" setup>
import { ref, watch, onMounted } from 'vue';
import type { Ref } from 'vue';

import { loadConfigValue } from '@/config';
import ace from 'ace-builds';

// Props
const props = defineProps<{
    value: string;
    mode: string;
}>();

// Emits
const emit = defineEmits<{
    (e: 'change', value: string): void;
    (e: 'scroll', lineNumber: number): void;
}>();

// Reactive states
const editor: Ref<any> = ref(null);  // eslint-disable-line @typescript-eslint/no-explicit-any
const ignoreNextChangeScrollTopEvent = ref(false);

// Template Refs
const editorEl = ref(null);

// Lifecycle hooks
onMounted(() => {
    editor.value = ace.edit(editorEl.value as Element, {
        fontSize: loadConfigValue('editor-font-size', 14),
        fontFamily: loadConfigValue('editor-font-family', 'Menlo, monospace'),
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
        scrollPastEnd: 1.0,
        animatedScroll: false,
    });
    editor.value!.on('change', () => {  // eslint-disable-line @typescript-eslint/no-non-null-assertion
        emit('change', editor.value!.getValue());  // eslint-disable-line @typescript-eslint/no-non-null-assertion
    });
    editor.value!.getSession().on('changeScrollTop', (_e: any) => {  // eslint-disable-line @typescript-eslint/no-non-null-assertion
        if (!ignoreNextChangeScrollTopEvent.value) {
            const lineNumber = editor.value!.renderer.getFirstFullyVisibleRow();
            emit('scroll', lineNumber);  // eslint-disable-line @typescript-eslint/no-non-null-assertion
        }
        else {
            ignoreNextChangeScrollTopEvent.value = false;
        }
    });

    const theme = loadConfigValue('editor-theme', 'default');
    setTheme(theme);

    const modeModules = import.meta.glob('../../node_modules/ace-builds/src-noconflict/mode-*.js');
    const modeModulePath = `../../node_modules/ace-builds/src-noconflict/mode-${props.mode}.js`;
    modeModules[modeModulePath]().then((_mod) => {
        editor.value!.getSession().setMode(`ace/mode/${props.mode}`);
    });

    const keybinding = loadConfigValue('editor-keybinding', 'default');
    setKeybinding(keybinding);
});

// Methods
function focus() {
    editor.value!.focus();  // eslint-disable-line @typescript-eslint/no-non-null-assertion
}

function blur() {
    editor.value!.blur();  // eslint-disable-line @typescript-eslint/no-non-null-assertion
}

function resize() {
    editor.value!.resize();  // eslint-disable-line @typescript-eslint/no-non-null-assertion
}

function scrollTo(lineNumber: number) {
    editor.value!.scrollToLine(lineNumber, false, false, null);
    ignoreNextChangeScrollTopEvent.value = true;
}

function getSelection(): string {
    const range = editor.value!.getSelectionRange();
    return editor.value!.session.getTextRange(range);
}

function replaceSelection(newText: string) {
    const range = editor.value!.getSelectionRange();
    editor.value!.session.remove(range);
    editor.value!.insert(newText);
}

function setTheme(theme: string) {
    let loading = null;

    const modules = import.meta.glob('../../node_modules/ace-builds/src-noconflict/theme-*.js');
    const path = `../../node_modules/ace-builds/src-noconflict/theme-${theme}.js`;
    if (Object.hasOwn(modules, path)) {
        modules[path]().then((_mod) => {
            editor.value!.setTheme(`ace/theme/${theme}`);
        });
    }
    else {
        editor.value!.setTheme(null);
    }
}

function setKeybinding(keybinding: string) {
    if (keybinding === 'default') {
        editor.value!.setKeyboardHandler(null);
        return;
    }
    const mapName = (name) => name === 'vim-modified' ? 'vim' : name;
    const modules = import.meta.glob('../../node_modules/ace-builds/src-noconflict/keybinding-*.js');
    const path = `../../node_modules/ace-builds/src-noconflict/keybinding-${mapName(keybinding)}.js`;
    modules[path]().then(() => {
        if (keybinding === 'vim-modified') {
            const keybinding = ace.require('ace/keyboard/vim');  // NOTE: `ace.require()` does not fetch the module. We need the dynamic import for actual loading.
            adjustKeybindings(keybinding.Vim);
            editor.value!.setKeyboardHandler(keybinding.handler);
        }
        else {
            editor.value!.setKeyboardHandler(`ace/keyboard/${keybinding}`);
        }
    });
}

function adjustKeybindings(Vim: any) {
    Vim.map("j", "gj", "normal");
    Vim.map("k", "gk", "normal");
    Vim.map("<C-a>", "<Home>", "insert");
    Vim.map("<C-e>", "<End>", "insert");
    Vim.mapCommand("<C-b>", "motion", "moveByCharacters", { forward: false }, { context: "insert" });
    Vim.mapCommand("<C-f>", "motion", "moveByCharacters", { forward: true }, { context: "insert" });
    Vim.map("<C-d>", "<Del>", "insert");
    Vim.map("<C-h>", "<BS>", "insert");
}

// Watchers
watch(() => props.value, (value: string) => {
    if (editor.value === null) {
        throw new Error('Editor has not been created yet.');
    }

    if (value !== editor.value.getValue()) {  // eslint-disable-line @typescript-eslint/no-non-null-assertion
        const cursor = editor.value.getCursorPosition();  // eslint-disable-line @typescript-eslint/no-non-null-assertion
        editor.value.session.setValue(value);  // eslint-disable-line @typescript-eslint/no-non-null-assertion
        editor.value.moveCursorToPosition(cursor);  // eslint-disable-line @typescript-eslint/no-non-null-assertion

        // Fold metadata
        const MARKER = '---';
        if (value.startsWith(MARKER + '\n')) {
            const lines = value.split('\n');
            let endLine = null;
            for (let i = 1; i < lines.length; ++i) {
                if (lines[i] === MARKER) {
                    endLine = i;
                    break;
                }
            }
            if (endLine !== null) {
                editor.value.getSession().addFold(
                    MARKER,
                    new ace.Range(0, MARKER.length, endLine, Infinity),
                );
            }
        }
    }
});

watch(() => props.mode, (mode: string) => {
    const modeModules = import.meta.glob('../../node_modules/ace-builds/src-noconflict/mode-*.js');
    const path = `../../node_modules/ace-builds/src-noconflict/mode-${mode}.js`;
    modeModules[path]().then((_mod) => {
        editor.value!.getSession().setMode(`ace/mode/${mode}`);
    });
});

defineExpose({
    focus,
    blur,
    resize,
    getSelection,
    replaceSelection,
    scrollTo,
});
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
