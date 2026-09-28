<template>
    <div class="editor">
        <div ref="editorEl"></div>
    </div>
</template>

<script lang="ts" setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';

import { loadConfigValue } from '@/config';
import { Compartment, EditorState, Extension, Prec, SelectionRange } from '@codemirror/state';
import { EditorView, keymap, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, lineNumbers, highlightActiveLine, highlightActiveLineGutter, scrollPastEnd, BlockInfo } from '@codemirror/view';
import { defaultHighlightStyle, syntaxHighlighting, indentOnInput, indentUnit, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language';
import { defaultKeymap, emacsStyleKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';

// Props
const props = withDefaults(defineProps<{
    value: string;
    mode: string;
    readonly?: boolean;
    lineWrapping?: boolean;
}>(), {
    // Vue reads an absent boolean prop as `false`, which here would silently
    // turn wrapping off.
    lineWrapping: true,
});

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

function suppressScrollEvents() {
    suppressScrollEventsUntil = performance.now() + PROGRAMMATIC_SCROLL_SUPPRESSION_MS;
}

// Where `scrollTo()` or the wrapping watcher is putting the top of the
// scroller, until `scrollWithinEditor()` has done so: `line` is a 1-based
// document line, possibly fractional, and `from` the start of its line block,
// which the scroll they dispatch targets.
let pendingScrollTarget: { line: number, from: number } | null = null;

// Let the buffer be locked and unlocked, and its lines wrapped or not, without
// rebuilding the editor, which would lose the undo history, the scroll position
// and the selection.
const editableCompartment = new Compartment();
const lineWrappingCompartment = new Compartment();

// Ctrl+Enter and Shift+Enter toggle the editor and the viewer panes, and that
// is decided by a window-level handler in the parent. CodeMirror runs its own
// keymaps first, though, so without claiming these keys here both of them reach
// the default `Enter` binding and insert a newline before the pane ever
// toggles. Claiming them makes CodeMirror do nothing and call
// `preventDefault()`; the event still bubbles to the window handler, which is
// what performs the toggle. Highest precedence so the Vim and Emacs keymaps,
// which are prepended to the extensions, cannot take these first.
const shortcutKeymap = Prec.highest(keymap.of([
    { key: 'Ctrl-Enter', run: () => true },
    { key: 'Shift-Enter', run: () => true },
]));

// `readOnly` stops the editing commands, including the Vim and Emacs ones, and
// `editable` stops typing and pasting straight into the DOM. Neither blocks the
// transactions this component dispatches on a caller's behalf, so a locked
// editor still accepts `replaceRange()`.
function editableExtension(isReadonly: boolean): Extension {
    return isReadonly
        ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
        : [];
}

function lineWrappingExtension(isWrapping: boolean): Extension {
    return isWrapping ? EditorView.lineWrapping : [];
}

// `scrollIntoView` scrolls every scrollable ancestor as well, and when the
// editor is already in place it asks the next one to put the line at its top
// instead. In the task editor below `lg` that scrolls the form around the
// editor and carries the toolbar out of sight. The lines `scrollTo()` and the
// wrapping watcher put at the top belong at the top of the editor's own
// scroller and nowhere else.
//
// A fractional line puts that fraction of the line's height above the edge. A
// wrapped line is as many rows tall as it wraps to, so a line number alone
// would leave the viewer's position within a long paragraph out.
//
// The target is placed here rather than before dispatching because only here,
// with the scroll under way, is its line drawn and measured: a line far from
// the viewport has only an estimated height.
function scrollWithinEditor(view: EditorView, range: SelectionRange): boolean {
    const target = pendingScrollTarget;
    pendingScrollTarget = null;
    if (target === null || range.head !== target.from) {
        return false;
    }

    // The start of the first line is the top of the document, and putting it
    // at the edge would scroll the content's top padding away.
    if (target.line <= 1) {
        view.scrollDOM.scrollTop = 0;
        return true;
    }

    // A folded range is one block of several lines, so measure the fraction
    // against every line the block holds.
    const block = view.lineBlockAt(target.from);
    const firstLine = view.state.doc.lineAt(block.from).number;
    const lastLine = view.state.doc.lineAt(block.to).number;
    const fraction = (target.line - firstLine) / (lastLine - firstLine + 1);
    const top = view.documentTop + block.top + fraction * block.height;
    view.scrollDOM.scrollTop += top - view.scrollDOM.getBoundingClientRect().top;
    return true;
}

// The line block at the top of the scroller, read `inset` pixels below its
// edge. `scrollTop` is a distance within the scroller, while
// `lineBlockAtHeight()` takes a height relative to `documentTop` (the top of
// the first line, in screen coordinates). The two share neither an origin nor,
// once the editor has top padding, a zero point, so convert through screen
// coordinates rather than passing `scrollTop` in directly.
function topLineBlock(view: EditorView, inset = 0): BlockInfo {
    const viewportTop = view.scrollDOM.getBoundingClientRect().top + inset;
    return view.lineBlockAtHeight(viewportTop - view.documentTop);
}

// The 1-based document line at the top of the scroller, plus the fraction of
// its height scrolled past the edge. A wrapped line is as many rows tall as it
// wraps to, so without the fraction the viewer would stand still through a
// long paragraph and then jump past it.
//
// The block is read `inset` pixels below the edge, and the fraction measured
// from the edge itself, so a line starting less than `inset` below the edge
// counts as at the top rather than as the end of the line before it.
function lineAtTop(view: EditorView, inset = 0): number {
    const block = topLineBlock(view, inset);
    const edge = view.scrollDOM.getBoundingClientRect().top - view.documentTop;
    // Above the first line lies the content's top padding, which counts as
    // the start of that line.
    const fraction = block.height > 0 ? Math.max(edge - block.top, 0) / block.height : 0;
    // A folded range is one block of several lines, and the fraction runs
    // through all of them.
    const firstLine = view.state.doc.lineAt(block.from).number;
    const lastLine = view.state.doc.lineAt(block.to).number;
    return firstLine + Math.min(fraction, 1) * (lastLine - firstLine + 1);
}

// Report the line at the top of the scroller.
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

    emit('scroll', lineAtTop(view));
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
        shortcutKeymap,
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
        EditorView.scrollHandler.of(scrollWithinEditor),
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

    // Pushed after the awaits above rather than declared with the rest, so the
    // editor starts in whatever lock and wrapping state holds once it is
    // actually created.
    extensions.push(editableCompartment.of(editableExtension(props.readonly === true)));
    extensions.push(lineWrappingCompartment.of(lineWrappingExtension(props.lineWrapping)));

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

// The target for `scrollWithinEditor()` that puts `lineNumber`, a 1-based
// document line, possibly fractional, at the top of the scroller.
function scrollTargetAt(view: EditorView, lineNumber: number): { line: number, from: number } {
    // `doc.line()` rejects anything past the end of the document, and the end
    // of the last line is as far as it goes.
    const doc = view.state.doc;
    const line = Math.min(Math.max(lineNumber, 1), doc.lines + 1);
    return { line, from: view.lineBlockAt(doc.line(Math.min(Math.floor(line), doc.lines)).from).from };
}

// Put `lineNumber`, a 1-based document line interpolated between two rendered
// elements and so usually fractional, at the top of the scroller.
function scrollTo(lineNumber: number) {
    if (!editor) return;

    suppressScrollEvents();
    pendingScrollTarget = scrollTargetAt(editor, lineNumber);
    editor.dispatch({
        effects: EditorView.scrollIntoView(pendingScrollTarget.from, { y: 'start' }),
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

function getSelectionRange(): { from: number, to: number } {
    if (!editor) return { from: 0, to: 0 };

    const selection = editor.state.selection.main;
    return { from: selection.from, to: selection.to };
}

// Replace an explicitly given range rather than the current selection, for
// callers that captured a range before an await and must not act on wherever
// the user has since moved the cursor.
function replaceRange(from: number, to: number, newText: string) {
    if (!editor) return;

    // The document may have been edited since the range was captured.
    const length = editor.state.doc.length;
    const start = Math.min(from, length);
    const end = Math.min(Math.max(to, start), length);
    editor.dispatch({
        changes: { from: start, to: end, insert: newText },
        selection: { anchor: start + newText.length }
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

watch(() => props.readonly, (isReadonly?: boolean) => {
    if (!editor) {
        return;
    }

    editor.dispatch({
        effects: editableCompartment.reconfigure(editableExtension(isReadonly === true)),
    });
});

watch(() => props.lineWrapping, (isWrapping: boolean) => {
    if (!editor) {
        return;
    }

    const effects = [lineWrappingCompartment.reconfigure(lineWrappingExtension(isWrapping))];
    // Unwrapping can shrink the document below the scroll position, and the
    // browser clamps `scrollTop` before CodeMirror's scroll anchoring corrects
    // it, relative to the clamped value, to far above where the reader was.
    // Even unclamped, the anchoring, like `scrollSnapshot()`, keeps how many
    // pixels of the top line are scrolled past, which carries the view several
    // lines on once a long paragraph becomes one row. So put the top back
    // explicitly, as far into its line as it was, which is also where a synced
    // viewer still is. But not at the very top: there is nothing to restore.
    if (editor.scrollDOM.scrollTop > 0) {
        // Read a pixel below the edge: a line put there by the last switch can
        // sit a fraction of a pixel lower, and would otherwise count as the end
        // of the line before it, which the switch can make many rows tall.
        pendingScrollTarget = scrollTargetAt(editor, lineAtTop(editor, 1));
        effects.push(EditorView.scrollIntoView(pendingScrollTarget.from, { y: 'start', yMargin: 0 }));
    }

    // Only the layout changes, not which line is at the top, so there is
    // nothing for a synced viewer to follow.
    suppressScrollEvents();
    editor.dispatch({ effects });
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
    getSelectionRange,
    replaceRange,
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
        // A flex item is otherwise never narrower than its content, and an
        // unwrapped line would widen it past the pane: the wrapper would then
        // scroll sideways instead of CodeMirror, taking the line numbers along
        // and leaving a cursor at the end of a long line out of sight.
        min-width: 0;
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
