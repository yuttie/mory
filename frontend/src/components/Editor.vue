<template>
    <div class="editor">
        <div ref="editorEl"></div>
    </div>
</template>

<script lang="ts" setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import type { Ref } from 'vue';

import { loadConfigValue } from '@/config';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { EditorState, Extension } from '@codemirror/state';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { vim } from '@replit/codemirror-vim';
import { emacs } from '@replit/codemirror-emacs';

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
const editor: Ref<EditorView | null> = ref(null);
const ignoreNextScrollEvent = ref(false);

// Template Refs
const editorEl = ref<HTMLElement | null>(null);

// Lifecycle hooks
onMounted(() => {
    if (!editorEl.value) return;

    const fontSize = loadConfigValue('editor-font-size', 14);
    const fontFamily = loadConfigValue('editor-font-family', 'Menlo, monospace');
    const theme = loadConfigValue('editor-theme', 'default');
    const keybinding = loadConfigValue('editor-keybinding', 'default');

    const extensions: Extension[] = [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        keymap.of([...defaultKeymap, indentWithTab]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                emit('change', update.state.doc.toString());
            }
            if (update.view.scrollDOM.scrollTop !== update.startState.scrollSnapshot?.top) {
                if (!ignoreNextScrollEvent.value) {
                    const topLine = update.view.viewportLineBlocks[0];
                    if (topLine) {
                        const lineNumber = update.view.state.doc.lineAt(topLine.from).number - 1;
                        emit('scroll', lineNumber);
                    }
                } else {
                    ignoreNextScrollEvent.value = false;
                }
            }
        }),
    ];

    // Add language support
    if (props.mode === 'markdown') {
        extensions.push(markdown());
    }

    // Add theme
    const themeExtension = getThemeExtension(theme);
    if (themeExtension) {
        extensions.push(themeExtension);
    }

    // Add keybinding
    const keybindingExtension = getKeybindingExtension(keybinding);
    if (keybindingExtension) {
        extensions.push(keybindingExtension);
    }

    const state = EditorState.create({
        doc: props.value,
        extensions,
    });

    editor.value = new EditorView({
        state,
        parent: editorEl.value,
    });

    // Apply font settings
    if (editor.value.dom) {
        editor.value.dom.style.fontSize = `${fontSize}px`;
        editor.value.dom.style.fontFamily = fontFamily;
    }
});

onBeforeUnmount(() => {
    if (editor.value) {
        editor.value.destroy();
    }
});

// Methods
function focus() {
    editor.value?.focus();
}

function blur() {
    if (editor.value?.contentDOM) {
        editor.value.contentDOM.blur();
    }
}

function resize() {
    // CodeMirror 6 handles resizing automatically
}

function scrollTo(lineNumber: number) {
    if (!editor.value) return;
    
    ignoreNextScrollEvent.value = true;
    const line = editor.value.state.doc.line(lineNumber + 1);
    editor.value.dispatch({
        effects: EditorView.scrollIntoView(line.from, { y: 'start' })
    });
}

function getSelection(): string {
    if (!editor.value) return '';
    
    const selection = editor.value.state.selection.main;
    return editor.value.state.doc.sliceString(selection.from, selection.to);
}

function replaceSelection(newText: string) {
    if (!editor.value) return;
    
    const selection = editor.value.state.selection.main;
    editor.value.dispatch({
        changes: { from: selection.from, to: selection.to, insert: newText },
        selection: { anchor: selection.from + newText.length }
    });
}

function getThemeExtension(theme: string): Extension | null {
    // Map Ace themes to CodeMirror themes
    // For now, we only support oneDark theme, others will use default
    const darkThemes = [
        'ambiance', 'chaos', 'clouds_midnight', 'cobalt', 'dracula', 
        'gob', 'gruvbox', 'idle_fingers', 'kr_theme', 'merbivore', 
        'merbivore_soft', 'mono_industrial', 'monokai', 'nord_dark', 
        'pastel_on_dark', 'solarized_dark', 'terminal', 'tomorrow_night', 
        'tomorrow_night_blue', 'tomorrow_night_bright', 'tomorrow_night_eighties', 
        'twilight', 'vibrant_ink'
    ];
    
    if (darkThemes.includes(theme)) {
        return oneDark;
    }
    
    return null;
}

function getKeybindingExtension(keybinding: string): Extension | null {
    if (keybinding === 'vim' || keybinding === 'vim-modified') {
        // For vim-modified, we'll use the standard vim extension
        // CodeMirror's vim extension has good defaults
        return vim();
    } else if (keybinding === 'emacs') {
        return emacs();
    }
    // 'sublime' and 'vscode' keybindings are not available in CodeMirror 6
    // They will fall back to default
    return null;
}

// Watchers
watch(() => props.value, (value: string) => {
    if (!editor.value) {
        return;
    }

    const currentValue = editor.value.state.doc.toString();
    if (value !== currentValue) {
        const selection = editor.value.state.selection.main;
        editor.value.dispatch({
            changes: { from: 0, to: currentValue.length, insert: value },
            selection: { anchor: Math.min(selection.anchor, value.length) }
        });

        // Note: Metadata folding can be added later with CodeMirror's folding extension
        // For now, we'll skip this feature to keep the migration minimal
    }
});

watch(() => props.mode, (mode: string) => {
    // Mode changes are not dynamically supported in this minimal implementation
    // The mode is set during initialization
    // A full implementation would require reconfiguring the editor
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
    height: 100%;

    & > * {
        flex: 1 1 0;
    }

    :deep(.cm-editor) {
        height: 100%;
        font-size: inherit;
        font-family: inherit;
    }

    :deep(.cm-scroller) {
        overflow: auto;
    }
}
</style>
