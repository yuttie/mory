<template>
    <div class="editor">
        <div ref="editorEl"></div>
    </div>
</template>

<script lang="ts" setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';

import { loadConfigValue } from '@/config';
import { EditorState, Extension } from '@codemirror/state';
import { EditorView, keymap, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, lineNumbers, highlightActiveLine, highlightActiveLineGutter, scrollPastEnd } from '@codemirror/view';
import { defaultHighlightStyle, syntaxHighlighting, indentOnInput, indentUnit, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language';
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
let lastKnownScrollTop = 0;

// `scrollTo()` applies its scroll asynchronously over one or more measure
// cycles, and a scroll that moves nothing never produces an event at all, so a
// one-shot guard would either miss the scroll it meant to suppress or linger.
// Suppress by deadline instead: long enough to cover the measure cycles the
// programmatic scroll settles over, short enough that it cannot swallow a scroll
// the user makes afterwards.
const PROGRAMMATIC_SCROLL_SUPPRESSION_MS = 100;
let suppressScrollEventsUntil = 0;

// Report the first line visible at the top of the scroller, as a 1-based
// document line number.
function emitScroll(view: EditorView) {
    // The scroll handler also runs for intersection changes, which move
    // nothing, so only an actual change of position counts as scrolling.
    const scrollTop = view.scrollDOM.scrollTop;
    if (scrollTop === lastKnownScrollTop) {
        return;
    }
    lastKnownScrollTop = scrollTop;

    // One `scrollTo()` can settle over several measure passes in a long
    // document, so suppress the whole window rather than only the first
    // scroll event it produces.
    if (performance.now() < suppressScrollEventsUntil) {
        return;
    }

    // `scrollTop` is a distance within the scroller, while `lineBlockAtHeight()`
    // takes a height relative to `documentTop` (the top of the first line, in
    // screen coordinates). The two share neither an origin nor, once the editor
    // has top padding, a zero point, so convert through screen coordinates
    // rather than passing `scrollTop` in directly.
    const viewportTop = view.scrollDOM.getBoundingClientRect().top;
    const block = view.lineBlockAtHeight(viewportTop - view.documentTop);
    emit('scroll', view.state.doc.lineAt(block.from).number);
}

// Template Refs
const editorEl = ref<HTMLElement | null>(null);

// Lifecycle hooks
onMounted(async () => {
    if (!editorEl.value) return;

    const fontSize = loadConfigValue('editor-font-size', 14);
    const fontFamily = loadConfigValue('editor-font-family', 'Menlo, monospace');
    const theme = loadConfigValue('editor-theme', 'default');
    const keybinding = loadConfigValue('editor-keybinding', 'default');
    const indentSize = loadConfigValue('editor-indent-size', 2);
    const enableEmacsStyleBindings = loadConfigValue('editor-enable-emacs-style-bindings', false);
    const vimInsertUnmapCtCd = loadConfigValue('editor-vim-insert-unmap-ct-cd', false);

    const extensions: Extension[] = [
        lineNumbers(),
        foldGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        indentUnit.of(" ".repeat(indentSize)),
        syntaxHighlighting(defaultHighlightStyle),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSelectionMatches(),
        scrollPastEnd(),
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
        }),
        // Report scrolling from the DOM event rather than from the update
        // listener: CodeMirror only produces an update when a scroll moves its
        // viewport, so updates miss most scrolls, and reading the layout from
        // within an update listener forces a synchronous measure.
        EditorView.domEventHandlers({
            scroll: (_event, view) => {
                emitScroll(view);
            },
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
    if (keybinding !== 'emacs' && enableEmacsStyleBindings) {
        const { emacsStyleKeymap } = await import('@codemirror/commands');
        extensions.unshift(keymap.of(emacsStyleKeymap.filter(({ key }) => /^Ctrl-(b|f|p|n|a|e|d|h)$/.test(key))));
    }
    const keybindingExtension = await getKeybindingExtension(keybinding);
    if (keybindingExtension) {
        // Vim and Emacs keybindings must be included before other keymaps
        extensions.unshift(keybindingExtension);
    }

    if (keybinding === 'vim' && vimInsertUnmapCtCd) {
        const { Vim } = await import('@replit/codemirror-vim');
        Vim.unmap('<C-t>', 'insert');
        Vim.unmap('<C-d>', 'insert');
    }

    const state = EditorState.create({
        doc: props.value,
        extensions,
    });

    editor = new EditorView({
        state,
        parent: editorEl.value,
    });
    lastKnownScrollTop = editor.scrollDOM.scrollTop;

    // Apply font settings
    if (editor.dom) {
        editor.dom.style.fontSize = `${fontSize}pt`;
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

    suppressScrollEventsUntil = performance.now() + PROGRAMMATIC_SCROLL_SUPPRESSION_MS;
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
    if (keybinding === 'vim') {
        const { vim } = await import('@replit/codemirror-vim');
        return vim();
    }
    else if (keybinding === 'emacs') {
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
    overflow: auto;

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
