<template>
    <div class="editor">
        <div ref="editorEl"></div>
    </div>
</template>

<script lang="ts" setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';

import { EDITOR_FONT_SIZE, useConfigValue } from '@/config';
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
let disposed = false;
let themeRevision = 0;
let keybindingRevision = 0;
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
const themeCompartment = new Compartment();
const keybindingCompartment = new Compartment();
const indentCompartment = new Compartment();

const fontSize = useConfigValue('editor-font-size', EDITOR_FONT_SIZE);
const fontFamily = useConfigValue('editor-font-family', 'Menlo, monospace');
const theme = useConfigValue('editor-theme', 'default');
const keybinding = useConfigValue('editor-keybinding', 'default');
const indentSize = useConfigValue('editor-indent-size', 2);
const enableEmacsStyleBindings = useConfigValue('editor-enable-emacs-style-bindings', false);
const vimInsertUnmapCtCd = useConfigValue('editor-vim-insert-unmap-ct-cd', false);

// These pane shortcuts belong to the parent's window handler. Claim them before either a keymap
// or Vim/Emacs's DOM handlers can insert a newline, while still letting the event bubble.
const shortcutHandlers = Prec.highest(EditorView.domEventHandlers({
    keydown: (event) => event.key === 'Enter' && (event.ctrlKey || event.shiftKey),
}));

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
    if (!editorEl.value) {
        return;
    }

    const extensions: Extension[] = [
        Prec.high(keybindingCompartment.of([])),
        themeCompartment.of([]),
        shortcutHandlers,
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
    if (disposed) {
        return;
    }
    if (langExtension) {
        extensions.push(langExtension);
    }

    // Pushed after the awaits above rather than declared with the rest, so the
    // editor starts in whatever lock and wrapping state holds once it is
    // actually created.
    extensions.push(editableCompartment.of(editableExtension(props.readonly === true)));
    extensions.push(lineWrappingCompartment.of(lineWrappingExtension(props.lineWrapping)));
    extensions.push(indentCompartment.of(indentUnit.of(' '.repeat(indentSize.value))));

    const state = EditorState.create({
        doc: props.value,
        extensions,
    });

    editor = new EditorView({
        state,
        parent: editorEl.value,
    });
    lastKnownScrollTop = editor.scrollDOM.scrollTop;

    applyFont();
    applyTheme();
    applyKeybinding();
});

onBeforeUnmount(() => {
    disposed = true;
    if (editor) {
        editor.destroy();
        editor = null;
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
    editor?.requestMeasure();
}

function applyFont() {
    if (editor) {
        editor.dom.style.fontSize = `${fontSize.value}pt`;
        editor.dom.style.fontFamily = fontFamily.value;
        editor.requestMeasure();
    }
}

async function applyTheme() {
    if (!editor) {
        return;
    }
    const revision = ++themeRevision;
    const extension = await getThemeExtension(theme.value);
    // Lazy imports may finish after another choice or after the editor was removed.
    if (editor && revision === themeRevision) {
        editor.dispatch({ effects: themeCompartment.reconfigure(extension ?? []) });
    }
}

async function applyKeybinding() {
    if (!editor) {
        return;
    }
    const revision = ++keybindingRevision;
    const binding = keybinding.value;
    const extension = await getKeybindingExtension(binding);
    if (!editor || revision !== keybindingRevision) {
        return;
    }
    const extensions: Extension[] = [extension ?? []];
    if (binding !== 'emacs' && enableEmacsStyleBindings.value) {
        extensions.push(keymap.of(emacsStyleKeymap.filter(({ key }) => /^Ctrl-(b|f|p|n|a|e|d|h)$/.test(key ?? ''))));
    }
    editor.dispatch({ effects: keybindingCompartment.reconfigure(extensions) });
    await applyVimInsertBindings();
}

async function applyVimInsertBindings() {
    if (keybinding.value !== 'vim') {
        return;
    }
    const { Vim } = await import('@replit/codemirror-vim');
    if (!editor || keybinding.value !== 'vim') {
        return;
    }
    // Vim's mappings are global and survive removing its extension. Restore both defaults when
    // the option is turned off, without replacing the editor or resetting Vim's current mode.
    for (const [key, indentRight] of [['<C-t>', true], ['<C-d>', false]] as const) {
        Vim.unmap(key, 'insert');
        if (!vimInsertUnmapCtCd.value) {
            Vim.mapCommand(key, 'action', 'indent', { indentRight }, { context: 'insert' });
        }
    }
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

async function getLangExtension(lang: string): Promise<Extension | null> {
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

    return null;
}

async function getThemeExtension(theme: string): Promise<Extension | null> {
    // Map Ace themes to CodeMirror themes
    // For now, we only support oneDark theme, others will use default
    const darkThemes = [
        'ambiance', 'chaos', 'clouds_midnight', 'cobalt', 'dracula',
        'gob', 'gruvbox', 'idle_fingers', 'kr_theme', 'merbivore',
        'merbivore_soft', 'mono_industrial', 'monokai', 'nord_dark',
        'pastel_on_dark', 'solarized_dark', 'terminal', 'tomorrow_night',
        'tomorrow_night_blue', 'tomorrow_night_bright', 'tomorrow_night_eighties',
        'twilight', 'vibrant_ink',
    ];

    if (theme === 'one-dark' || darkThemes.includes(theme)) {
        const { oneDark } = await import('@codemirror/theme-one-dark');
        return oneDark;
    }

    return null;
}

async function getKeybindingExtension(keybinding: string): Promise<Extension | null> {
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
watch([fontSize, fontFamily], applyFont);
watch(theme, applyTheme);
watch([keybinding, enableEmacsStyleBindings], applyKeybinding);
watch(vimInsertUnmapCtCd, applyVimInsertBindings);
watch(indentSize, (size) => {
    editor?.dispatch({ effects: indentCompartment.reconfigure(indentUnit.of(' '.repeat(size))) });
});

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
