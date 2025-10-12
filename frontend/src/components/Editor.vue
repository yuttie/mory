<template>
    <div class="editor">
        <div ref="editorEl"></div>
    </div>
</template>

<script lang="ts" setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';

import { loadConfigValue } from '@/config';
import { EditorState, Extension } from '@codemirror/state';
import { EditorView, keymap, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { defaultHighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';

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

// Non-reactive state
let editor: EditorView | null = null;
let ignoreNextScrollEvent = false;

// Template Refs
const editorEl = ref<HTMLElement | null>(null);

// Lifecycle hooks
onMounted(async () => {
    if (!editorEl.value) return;

    const fontSize = loadConfigValue('editor-font-size', 14);
    const fontFamily = loadConfigValue('editor-font-family', 'Menlo, monospace');
    const theme = loadConfigValue('editor-theme', 'default');
    const keybinding = loadConfigValue('editor-keybinding', 'default');

    const extensions: Extension[] = [
        lineNumbers(),
        foldGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSelectionMatches(),
        keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            indentWithTab,
        ]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                emit('change', update.state.doc.toString());
            }
            if (update.view.scrollDOM.scrollTop !== update.startState.scrollSnapshot?.top) {
                if (!ignoreNextScrollEvent) {
                    const topLine = update.view.viewportLineBlocks[0];
                    if (topLine) {
                        const lineNumber = update.view.state.doc.lineAt(topLine.from).number - 1;
                        emit('scroll', lineNumber);
                    }
                } else {
                    ignoreNextScrollEvent = false;
                }
            }
        }),
    ];

    // Add language support
    const langExtension = await getLangExtension(props.mode);
    if (langExtension) {
        extensions.push(langExtension);
    }

    // Add theme
    const themeExtension = await getThemeExtension(theme);
    if (themeExtension) {
        extensions.push(themeExtension);
    }

    // Add keybinding
    const keybindingExtension = await getKeybindingExtension(keybinding);
    if (keybindingExtension) {
        // Vim and Emacs keybindings must be included before other keymaps
        extensions.unshift(keybindingExtension);
    }

    const state = EditorState.create({
        doc: props.value,
        extensions,
    });

    editor = new EditorView({
        state,
        parent: editorEl.value,
    });

    // Apply font settings
    if (editor.dom) {
        editor.dom.style.fontSize = `${fontSize}px`;
        editor.dom.style.fontFamily = fontFamily;
    }
});

onBeforeUnmount(() => {
    if (editor) {
        editor.destroy();
    }
});

// Methods
function focus() {
    editor?.focus();
}

function blur() {
    if (editor?.contentDOM) {
        editor.contentDOM.blur();
    }
}

function resize() {
    // CodeMirror 6 handles resizing automatically
}

function scrollTo(lineNumber: number) {
    if (!editor) return;

    ignoreNextScrollEvent = true;
    const line = editor.state.doc.line(lineNumber + 1);
    editor.dispatch({
        effects: EditorView.scrollIntoView(line.from, { y: 'start' })
    });
}

function getSelection(): string {
    if (!editor) return '';

    const selection = editor.state.selection.main;
    return editor.state.doc.sliceString(selection.from, selection.to);
}

function replaceSelection(newText: string) {
    if (!editor) return;

    const selection = editor.state.selection.main;
    editor.dispatch({
        changes: { from: selection.from, to: selection.to, insert: newText },
        selection: { anchor: selection.from + newText.length }
    });
}

async function getLangExtension(lang: string): Extension | null {
    if (lang === 'css') {
        const { css } = await import('@codemirror/lang-css');
        return css();
    }
    else if (lang === 'less') {
        const { less } = await import('@codemirror/lang-less');
        return less();
    }
    else if (lang === 'markdown') {
        const { markdown, markdownLanguage } = await import('@codemirror/lang-markdown');
        return markdown({
            base: markdownLanguage,
        });
    }

    return null
}

async function getThemeExtension(theme: string): Extension | null {
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

    if (theme === 'one-dark' || darkThemes.includes(theme)) {
        const { oneDark } = await import('@codemirror/theme-one-dark');
        return oneDark;
    }

    return null;
}

async function getKeybindingExtension(keybinding: string): Extension | null {
    if (keybinding === 'vim' || keybinding === 'vim-modified') {
        // For vim-modified, we'll use the standard vim extension
        // CodeMirror's vim extension has good defaults
        const { vim } = await import('@replit/codemirror-vim');
        return vim();
    } else if (keybinding === 'emacs') {
        const { emacs } = await import('@replit/codemirror-emacs');
        return emacs();
    }
    // 'sublime' and 'vscode' keybindings are not available in CodeMirror 6
    // They will fall back to default
    return null;
}

// Watchers
watch(() => props.value, (value: string) => {
    if (!editor) {
        return;
    }

    const currentValue = editor.state.doc.toString();
    if (value !== currentValue) {
        const selection = editor.state.selection.main;
        editor.dispatch({
            changes: { from: 0, to: currentValue.length, insert: value },
            selection: { anchor: Math.min(selection.anchor, value.length) }
        });

        // Note: Metadata folding can be added later with CodeMirror's folding extension
        // For now, we'll skip this feature to keep the migration minimal
    }
});

watch(() => props.mode, (_mode: string) => {
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
