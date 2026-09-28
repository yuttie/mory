<template>
    <div class="editable-viewer">
        <div class="panes" v-bind:class="panesState">
            <div class="editor-pane"
                v-on:transitionend="onEditorPaneResize"
            >
                <v-sheet class="d-flex flex-wrap align-center flex-grow-0">
                    <v-icon-btn v-bind:icon="mdiFormatHeader2"      v-bind:disabled="aiActionRunning" v-on:click="insertText('## ')"      ></v-icon-btn>
                    <v-icon-btn v-bind:icon="mdiFormatListBulleted" v-bind:disabled="aiActionRunning" v-on:click="insertText('* ')"       ></v-icon-btn>
                    <v-icon-btn v-bind:icon="mdiFormatItalic"       v-bind:disabled="aiActionRunning" v-on:click="encloseText('*', '*')"  ></v-icon-btn>
                    <v-icon-btn v-bind:icon="mdiFormatBold"         v-bind:disabled="aiActionRunning" v-on:click="encloseText('**', '**')"></v-icon-btn>
                    <v-icon-btn v-bind:icon="mdiXml"                v-bind:disabled="aiActionRunning" v-on:click="encloseText('`', '`')"  ></v-icon-btn>
                    <v-icon-btn v-bind:icon="mdiFormatQuoteClose"   v-bind:disabled="aiActionRunning" v-on:click="encloseText('> ', '')"  ></v-icon-btn>
                    <v-icon-btn v-bind:icon="mdiLinkVariant"        v-bind:disabled="aiActionRunning" v-on:click="encloseText('[', ']()')"></v-icon-btn>
                    <v-icon-btn v-bind:icon="mdiTableCheck"         v-bind:disabled="aiActionRunning" v-on:click="formatTable"            ></v-icon-btn>
                    <AiActionMenu
                        v-bind:actions="aiActions"
                        v-bind:running="aiActionRunning"
                        v-on:open="reloadAiActions"
                        v-on:ad-hoc="openAdHocDialog"
                        v-on:run="runAiAction"
                    ></AiActionMenu>
                    <!-- Only CodeMirror wraps: see `.simple-editor`. -->
                    <template v-if="!useSimpleEditor">
                        <!-- Everything before this edits the text; what follows changes only how it is shown. -->
                        <v-divider
                            vertical
                            inset
                            class="mx-1"
                        ></v-divider>
                        <v-icon-btn
                            v-bind:icon="mdiWrap"
                            v-bind:title="lineWrapping ? 'Disable line wrapping' : 'Enable line wrapping'"
                            v-bind:active="lineWrapping ? true : undefined"
                            v-on:click="lineWrapping = !lineWrapping"
                        ></v-icon-btn>
                    </template>
                </v-sheet>
                <template v-if="useSimpleEditor">
                    <textarea
                        v-bind:value="modelValue"
                        v-bind:readonly="aiActionRunning"
                        v-on:input="onEditorChange($event.target.value)"
                        class="editor simple-editor"
                        ref="editor"
                    ></textarea>
                </template>
                <template v-else>
                    <Editor
                        v-bind:value="modelValue"
                        v-bind:mode="language"
                        v-bind:readonly="aiActionRunning"
                        v-bind:line-wrapping="lineWrapping"
                        v-on:change="onEditorChange"
                        v-on:scroll="onEditorScroll"
                        ref="editor"
                    ></Editor>
                </template>
            </div>
            <div class="viewer-pane"
                ref="viewer"
                v-on:scroll="handleDocumentScroll"
                v-on:transitionend="onViewerPaneResize"
            >
                <div ref="shadowDomRootElement" style="user-select: text">
                </div>
            </div>
        </div>
        <AiActionAdHocDialog
            v-model="adHocDialogIsVisible"
            v-bind:existing-ids="aiActions.map((action) => action.id)"
            v-bind:has-selection="adHocHasSelection"
            v-on:run="runAdHocAiAction"
        ></AiActionAdHocDialog>
        <AiActionInputDialog
            v-model="inputDialogIsVisible"
            v-bind:action-name="inputDialogActionName"
            v-on:resolve="resolveInputDialog"
            v-on:update:model-value="onInputDialogToggle"
        ></AiActionInputDialog>
        <v-snackbar v-model="error" color="error" location="top" timeout="5000">{{ errorText }}</v-snackbar>
    </div>
</template>

<script lang="ts" setup>
// An editor and a rendered view of one text, which its owner holds through `v-model`: loading and
// saving the text, and what surrounds the two panes, are the owner's. The note page and the task
// editor both show a note this way.
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';

import {
    mdiFormatBold,
    mdiFormatHeader2,
    mdiFormatItalic,
    mdiFormatListBulleted,
    mdiFormatQuoteClose,
    mdiLinkVariant,
    mdiTableCheck,
    mdiWrap,
    mdiXml,
} from '@mdi/js';

import { useAppStore } from '@/stores/app';
import { useLocalStorage } from '@/composables/localStorage';

import AiActionAdHocDialog from './AiActionAdHocDialog.vue';
import AiActionInputDialog from './AiActionInputDialog.vue';
import AiActionMenu from './AiActionMenu.vue';
import { runAiAction as runAiActionRequest } from '@/api';
import { useFilesStore } from '@/stores/files';
import { fillPrompt, hasInputPlaceholder, loadAiActions, saveAiActions } from '@/ai-actions';
import type { AiAction } from '@/ai-actions';
import { loadConfigValue } from '@/config';
import { CliPrettify } from 'markdown-table-prettify';
import { chunkMarkdownByHeadings } from '@/markdown-utils';
import { buildScrollMap, lineAtOffset, offsetAtLine, type ScrollAnchor } from '@/scroll-map';
import { renderMarkdown } from '@/markdown';

// Props
const props = withDefaults(defineProps<{
    modelValue: string;
    language?: string;
    editorVisible: boolean;
    viewerVisible: boolean;
    lockScroll?: boolean;
}>(), {
    language: 'markdown',
    lockScroll: false,
});

// Emits
const emit = defineEmits<{
    (e: 'update:modelValue', value: string): void;
    // Once per step of a render, which lands a chunk at a time: the frontmatter as parsed, and the
    // HTML rendered so far.
    (e: 'rendered', value: { metadata: unknown, parseError: unknown, content: string }): void;
    (e: 'viewer-scroll'): void;
}>();

// Composables
const appStore = useAppStore();
const files = useFilesStore();

// Reactive states
const useSimpleEditor = ref(loadConfigValue('use-simple-editor', false));
// Switched from the toolbar rather than the config page, so it is saved the moment it changes, as
// one setting for every note and the task editor alike.
const lineWrapping = useLocalStorage('editor-line-wrapping', true);
const error = ref(false);
const errorText = ref('');
const renderTimeoutId = ref(null as null | number);
const aiActions = ref([] as AiAction[]);
const aiActionRunning = ref(false);
const adHocDialogIsVisible = ref(false);
// Captured when the ad-hoc dialog opens, so the dialog can offer its "use the
// selected text" checkbox and the run afterwards acts on the very same range.
const adHocSelection = ref(null as null | { from: number, to: number, text: string });
const inputDialogIsVisible = ref(false);
const inputDialogActionName = ref('');

// Non-reactive state for internal rendering control
let chunkRenderController: AbortController | null = null;
let markdownChunks: Array<{ content: string; startLine: number }> = [];
let renderedChunks: string[] = [];
let chunkElements: HTMLElement[] = [];
let pendingProgrammaticViewerScrollPosition: { top: number; left: number } | null = null;

// The render last started, so a jump can wait for the headings it looks for.
let latestRender: Promise<void> = Promise.resolve();

// The text this component last reported through `update:modelValue`. When the owner passes it back,
// the change is typing, whose render is already scheduled; any other value is the owner replacing
// the text, such as loading a note, which is shown at once.
let lastEmittedValue: string | null = null;

// Resolver of the promise `askForInput()` is waiting on, held while the input
// dialog is open.
let pendingInputResolve: ((input: string | null) => void) | null = null;

// Template Refs
const editor = ref(null);
const viewer = ref(null);
const shadowDomRootElement = ref(null);
const shadowRoot = ref(null);
const renderedContentDiv = ref(null);

// Computed properties
const panesState = computed(() => {
    return {
        onlyEditor: props.editorVisible && !props.viewerVisible,
        onlyViewer: !props.editorVisible && props.viewerVisible,
        both: props.editorVisible && props.viewerVisible,
    };
});

const adHocHasSelection = computed((): boolean => {
    return adHocSelection.value !== null && adHocSelection.value.text !== '';
});

// Lifecycle hooks
onMounted(async () => {
    // Attach a shadow DOM
    shadowRoot.value = shadowDomRootElement.value.attachShadow({ mode: 'open' });

    // Created before the styles below are awaited: the owner may hand over a text to render while
    // they load. Each style is inserted ahead of it, in the order they arrive.
    renderedContentDiv.value = document.createElement('div');
    renderedContentDiv.value.setAttribute('class', 'rendered-content flex-grow-1');
    shadowRoot.value.appendChild(renderedContentDiv.value);

    updateRendered();
    reloadAiActions();

    // Load CSSs that are used within the shadow DOM
    const highlightjsTheme = loadConfigValue('highlightjs-theme', 'default');
    await loadHighlightjsTheme(highlightjsTheme)
    .then((themeCss) => {
        const styleElement = document.createElement('style');
        styleElement.textContent = themeCss;
        shadowRoot.value.insertBefore(styleElement, renderedContentDiv.value);
    })
    .catch((err) => {
        console.error(err);
    });
    await loadCustomNoteCss()
    .then((customNoteCss) => {
        const styleElement = document.createElement('style');
        styleElement.textContent = customNoteCss;
        shadowRoot.value.insertBefore(styleElement, renderedContentDiv.value);
    })
    .catch((err) => {
        console.error(err);
    });

    const linkElement = document.createElement('link');
    linkElement.rel = 'stylesheet';
    linkElement.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
    shadowRoot.value.insertBefore(linkElement, renderedContentDiv.value);
});

onUnmounted(() => {
    if (renderTimeoutId.value) {
        window.clearTimeout(renderTimeoutId.value);
        renderTimeoutId.value = null;
    }

    // Cancel any ongoing chunked rendering
    if (chunkRenderController) {
        chunkRenderController.abort();
        chunkRenderController = null;
    }
});

// Methods

// Resolves once the text last handed over is rendered in full. That text reaches the watcher below
// only on the next tick, and a render it starts may be replaced by another before it finishes.
async function whenRendered() {
    await nextTick();
    let render;
    do {
        render = latestRender;
        await render;
    } while (render !== latestRender);
}

async function jumpTo(id: string) {
    await whenRendered();
    const element = shadowRoot.value?.querySelector(`[id="${id.slice(1)}"]`);
    if (element) {
        element.scrollIntoView();
    }
}

async function loadHighlightjsTheme(themeName: string): Promise<string> {
    const modules = import.meta.glob('../../node_modules/highlight.js/styles/**/*.min.css', { query: '?raw' });
    const path = `../../node_modules/highlight.js/styles/${themeName}.min.css`;
    try {
        const module = await modules[path]();
        return module.default;
    }
    catch (err) {
        throw new Error(`Failed to load Highlight.js theme CSS: ${err}`, { cause: err });
    }
}

// TODO (known issue, tracked separately): in Simple Editor mode the textarea
// branches of `insertText`, `encloseText` and `formatTable` assign to
// `textArea.value` directly and never call `onEditorChange`, so `text` keeps
// the old content: the edit never reaches the viewer and is lost on save. The
// fix is to route the new value through `onEditorChange`, as
// `replaceEditorRange` below already does.
function insertText(newText: string) {
    if (useSimpleEditor.value) {
        const textArea = editor.value as HTMLTextAreaElement;
        textArea.value = textArea.value.slice(0, textArea.selectionStart) + newText + textArea.value.slice(textArea.selectionEnd);
    }
    else {
        const editorComponent = editor.value as Editor;
        editorComponent.replaceSelection(newText);
    }
}

function encloseText(before: string, after: string) {
    if (useSimpleEditor.value) {
        const textArea = editor.value as HTMLTextAreaElement;
        const selectedText = textArea.value.slice(textArea.selectionStart, textArea.selectionEnd);
        const formattedText = before + selectedText + after;
        textArea.value = textArea.value.slice(0, textArea.selectionStart) + formattedText + textArea.value.slice(textArea.selectionEnd);
    }
    else {
        const editorComponent = editor.value as Editor;
        const selectedText = editorComponent.getSelection();
        const formattedText = before + selectedText + after;
        editorComponent.replaceSelection(formattedText);
    }
}

function formatTable() {
    if (useSimpleEditor.value) {
        const textArea = editor.value as HTMLTextAreaElement;
        const selectedText = textArea.value.slice(textArea.selectionStart, textArea.selectionEnd);
        const formattedText = CliPrettify.prettify(selectedText);
        textArea.value = textArea.value.slice(0, textArea.selectionStart) + formattedText + textArea.value.slice(textArea.selectionEnd);
    }
    else {
        const editorComponent = editor.value as Editor;
        const selectedText = editorComponent.getSelection();
        const formattedText = CliPrettify.prettify(selectedText);
        editorComponent.replaceSelection(formattedText);
    }
}

function getEditorSelection(): { from: number, to: number, text: string } {
    if (useSimpleEditor.value) {
        const textArea = editor.value as HTMLTextAreaElement;
        return {
            from: textArea.selectionStart,
            to: textArea.selectionEnd,
            text: textArea.value.slice(textArea.selectionStart, textArea.selectionEnd),
        };
    }
    else {
        const editorComponent = editor.value as Editor;
        const range = editorComponent.getSelectionRange();
        return { ...range, text: editorComponent.getSelection() };
    }
}

function replaceEditorRange(from: number, to: number, newText: string) {
    if (useSimpleEditor.value) {
        const textArea = editor.value as HTMLTextAreaElement;
        // The document may have been edited since the range was captured.
        const start = Math.min(from, textArea.value.length);
        const end = Math.min(Math.max(to, start), textArea.value.length);
        // Through `onEditorChange`, so `text` and the rendered viewer follow the
        // edit; assigning to `textArea.value` alone would not reach either.
        onEditorChange(textArea.value.slice(0, start) + newText + textArea.value.slice(end));
        nextTick(() => {
            textArea.selectionStart = start + newText.length;
            textArea.selectionEnd = start + newText.length;
        });
    }
    else {
        const editorComponent = editor.value as Editor;
        editorComponent.replaceRange(from, to, newText);
    }
}

async function reloadAiActions() {
    try {
        aiActions.value = await loadAiActions();
    }
    catch (err) {
        error.value = true;
        errorText.value = `Failed to load AI Actions: ${err}`;
    }
}

// Resolves to `null` on cancellation. An empty string is a valid input, so the
// two must not be conflated.
function askForInput(actionName: string): Promise<string | null> {
    inputDialogActionName.value = actionName;
    inputDialogIsVisible.value = true;
    return new Promise((resolve) => {
        pendingInputResolve = resolve;
    });
}

function resolveInputDialog(input: string | null) {
    const resolve = pendingInputResolve;
    pendingInputResolve = null;
    if (resolve) {
        resolve(input);
    }
}

function onInputDialogToggle(isOpen: boolean) {
    if (!isOpen) {
        // Closing by any route other than the dialog's own buttons still has to
        // settle the promise, or the action would hang forever.
        resolveInputDialog(null);
    }
}

function openAdHocDialog() {
    // Captured before the dialog opens rather than when it is confirmed: the
    // checkbox it shows depends on there being a selection.
    adHocSelection.value = getEditorSelection();
    adHocDialogIsVisible.value = true;
}

function runAiAction(action: AiAction) {
    // The selection is captured before any await: the user is free to move the
    // cursor while the input dialog is open and while the request is in flight.
    return executeAiAction(action, getEditorSelection());
}

async function executeAiAction(
    action: { name?: string, prompt: string },
    selection: { from: number, to: number, text: string },
) {
    let prompt = action.prompt;
    if (hasInputPlaceholder(action.prompt)) {
        const input = selection.text !== '' ? selection.text : await askForInput(action.name ?? 'AI Action');
        if (input === null) {
            return;
        }
        prompt = fillPrompt(action.prompt, input);
    }

    aiActionRunning.value = true;
    try {
        const result = await runAiActionRequest(prompt);
        // An empty range is an insertion at the cursor, so this covers both
        // replacing a selection and generating at the cursor.
        replaceEditorRange(selection.from, selection.to, result);
    }
    catch (err) {
        error.value = true;
        errorText.value = `AI Action failed: ${err}`;
    }
    finally {
        aiActionRunning.value = false;
    }
}

async function runAdHocAiAction(prompt: string, preset: { id: string, name: string } | null) {
    const selection = adHocSelection.value ?? getEditorSelection();
    if (preset) {
        // Persisted before the run, so a failing request does not discard the
        // prompt the user just wrote.
        const saved = [...aiActions.value, { id: preset.id, name: preset.name, prompt: prompt }];
        try {
            await saveAiActions(saved);
            aiActions.value = saved;
        }
        catch (err) {
            error.value = true;
            errorText.value = `Failed to save the AI Action: ${err}`;
        }
    }
    await executeAiAction({ name: preset?.name, prompt: prompt }, selection);
}

function updateRendered(): Promise<void> {
    // Cancel any ongoing chunked rendering
    if (chunkRenderController) {
        chunkRenderController.abort();
        chunkRenderController = null;
    }

    // Use chunked rendering for all documents
    // Short markdown is automatically treated as a single chunk
    latestRender = updateRenderedChunked();
    return latestRender;
}

async function updateRenderedChunked() {
    // Create abort controller to cancel this render if a new one starts
    const controller = new AbortController();
    chunkRenderController = controller;

    // Split markdown into chunks by headings
    const { frontmatter, chunks: newMarkdownChunks } = chunkMarkdownByHeadings(props.modelValue);

    let metadata: any = null;
    let parseError: any = null;

    try {
        // Extract metadata from frontmatter if present
        if (frontmatter) {
            try {
                const frontmatterFile = await renderMarkdown(frontmatter);
                metadata = frontmatterFile.data.matter;
                parseError = frontmatterFile.data.matterParseError;
            } catch (error) {
                parseError = error;
            }
        }

        // Render each chunk progressively
        const newRenderedChunks = [];
        for (let i = 0; i < newMarkdownChunks.length; i++) {
            // Check if rendering was aborted
            if (controller.signal.aborted) {
                return;
            }

            const markdownChunkInfo = newMarkdownChunks[i];

            // Check if chunk content changed (for caching optimization)
            const chunkChanged = i >= markdownChunks.length ||
                                 markdownChunkInfo.content !== markdownChunks[i].content;

            let chunkHtml: string;
            if (chunkChanged) {
                // Render changed chunk
                const renderedFile = await renderMarkdown(markdownChunkInfo.content);
                chunkHtml = String(renderedFile);
            } else {
                // Reuse cached HTML (before line adjustment)
                chunkHtml = renderedChunks[i] || '';
            }

            // Store raw HTML for caching and reuse
            newRenderedChunks.push(chunkHtml);

            // A chunk whose text is unchanged still moves when one above it
            // gains or loses lines, and its line numbers must move with it.
            const showChunk = () => {
                if (chunkChanged) {
                    updateChunkInDisplay(i, chunkHtml, markdownChunkInfo.startLine);
                }
                else {
                    renumberChunk(i, markdownChunkInfo.startLine);
                }
            };

            // Display chunks progressively for better perceived performance
            if (i === 0 || i === newMarkdownChunks.length - 1) {
                // First and last chunks render immediately for quick feedback
                showChunk();
                updateRenderedState(metadata, parseError, newRenderedChunks);
            } else {
                // Intermediate chunks render during idle time to avoid blocking UI
                await new Promise<void>((resolve) => {
                    if ('requestIdleCallback' in window) {
                        requestIdleCallback(() => {
                            if (!controller.signal.aborted) {
                                showChunk();
                                updateRenderedState(metadata, parseError, newRenderedChunks);
                            }
                            resolve();
                        });
                    } else {
                        // Fallback for browsers without requestIdleCallback
                        setTimeout(() => {
                            if (!controller.signal.aborted) {
                                showChunk();
                                updateRenderedState(metadata, parseError, newRenderedChunks);
                            }
                            resolve();
                        }, 0);
                    }
                });
            }
        }
        renderedChunks = newRenderedChunks;

        // Remove extra chunk elements if document got shorter
        while (chunkElements.length > newMarkdownChunks.length) {
            const extraElement = chunkElements.pop();
            if (extraElement && extraElement.parentNode) {
                extraElement.parentNode.removeChild(extraElement);
            }
        }

        // Store current chunks for next comparison
        markdownChunks = newMarkdownChunks;
    } finally {
        if (chunkRenderController === controller) {
            chunkRenderController = null;
        }
    }
}

function updateChunkInDisplay(chunkIndex: number, chunkHtml: string, startLine: number) {
    // Reuse existing chunk element or create new one
    let chunkDiv = chunkElements[chunkIndex];

    if (!chunkDiv) {
        // Create container div for this chunk
        chunkDiv = document.createElement('div');
        chunkDiv.className = 'rendered-chunk';
        chunkElements[chunkIndex] = chunkDiv;

        // Insert at correct position in DOM
        if (chunkIndex < renderedContentDiv.value.children.length) {
            renderedContentDiv.value.insertBefore(chunkDiv, renderedContentDiv.value.children[chunkIndex]);
        } else {
            renderedContentDiv.value.appendChild(chunkDiv);
        }
    }

    // Update chunk content
    chunkDiv.innerHTML = chunkHtml;

    // Adjust line numbers for scroll synchronization: the rendered ones count
    // from the chunk's own first line.
    chunkDiv.dataset['startLine'] = '1';
    renumberChunk(chunkIndex, startLine);

    // Prevent images from being dragged and dropped within the page
    const images = chunkDiv.querySelectorAll('img');
    for (const img of images) {
        img.addEventListener('dragstart', (event) => {
            appStore.draggingViewerContent = true;
        });
        img.addEventListener('dragend', (event) => {
            appStore.draggingViewerContent = false;
        });
    }
}

// Move a displayed chunk's line numbers to count from `startLine`, the line the
// chunk starts on in the note. The chunk element records the line they count
// from now, so that renumbering twice, as a render cancelled part-way and
// started over may do, moves them only once.
function renumberChunk(chunkIndex: number, startLine: number) {
    const chunkDiv = chunkElements[chunkIndex];
    if (!chunkDiv) {
        return;
    }

    const shift = startLine - parseInt(chunkDiv.dataset['startLine'] ?? '1');
    if (shift !== 0) {
        for (const element of chunkDiv.querySelectorAll('[data-line]')) {
            for (const attribute of ['data-line', 'data-line-end']) {
                const line = element.getAttribute(attribute);
                if (line) {
                    element.setAttribute(attribute, (parseInt(line) + shift).toString());
                }
            }
        }
    }
    chunkDiv.dataset['startLine'] = startLine.toString();
}

function updateRenderedState(metadata: any, parseError: any, chunks: string[]) {
    emit('rendered', {
        metadata: metadata,
        parseError: parseError,
        content: chunks.join(''),
    });
}

async function loadCustomNoteCss(): Promise<string> {
    try {
        // Try CSS file first
        // CSS file exists, return directly
        return await files.read('.mory/custom-note.css');
    } catch (error) {
        if (error.response && error.response.status === 404) {
            // CSS file not found, try LESS file
            return await loadCustomNoteLess();
        }
        else {
            // Re-throw other errors
            throw error;
        }
    }
}

async function loadCustomNoteLess(): Promise<string> {
    // Start both operations in parallel
    const [source, { default: less }] = await Promise.all([
        files.read('.mory/custom-note.less'),
        import('less'),
    ]);

    const output = await less.render(source, {
        globalVars: {
            'nav-height': '64px',
        },
    });

    return output.css;
}

function updateRenderedLazy() {
    if (renderTimeoutId.value) {
        window.clearTimeout(renderTimeoutId.value);
        renderTimeoutId.value = null;
    }
    renderTimeoutId.value = window.setTimeout(async () => {
        await updateRendered();
    }, 500);
}

function editorScrollTo(lineNumber: number) {
    if (useSimpleEditor.value) {
        const textArea = editor.value as HTMLTextAreaElement;
        const style = window.getComputedStyle(textArea);
        const lineHeight = parseFloat(style.getPropertyValue('line-height'));
        textArea.scrollTo({ top: lineNumber * lineHeight });
    }
    else {
        const editorComponent = editor.value as Editor;
        editorComponent.scrollTo(lineNumber);
    }
}

// The last element of the section a heading opens, which runs up to the next heading of the same
// or a higher level. The viewer renders each H1 and H2 section into a chunk of its own, so read
// the elements across the chunks: an H1's section goes on through the chunks of its H2s.
function findLastElementOfSection(headingElement: HTMLElement, level: number): HTMLElement {
    const chunks = headingElement.parentElement?.parentElement?.children ?? [];
    const elements = [...chunks].flatMap((chunk) => [...chunk.children]);
    const start = elements.indexOf(headingElement);
    let current: HTMLElement = headingElement;
    if (start < 0) {
        return current;
    }

    for (const next of elements.slice(start + 1)) {
        const match = /H([1-6])/.exec(next.tagName);
        if (match) {
            const nextLevel = parseInt(match[1]);
            if (nextLevel <= level) {
                return current;
            }
        }
        current = next as HTMLElement;
    }
    return current;
}

function findHeadingElement(level: number, href: string): HTMLElement {
    const hx = renderedContentDiv.value.querySelector(`h${level}:has(> a[href="${href}"])`);
    return hx;
}

// Where the viewer's scroll origin is on screen: an element whose top is at `y` on screen
// reaches the viewer's top edge when `scrollTop` is `y` minus this. Positions within the viewer
// are measured this way rather than by adding up `offsetTop` through the offset parents, which
// runs all the way to the page and so also counts the toolbar above the viewer.
function viewerScrollOrigin(): number {
    const viewerElement: HTMLElement = viewer.value!;
    return viewerElement.getBoundingClientRect().top + viewerElement.clientTop - viewerElement.scrollTop;
}

// The span from the top of one element to the bottom of another, as the `scrollTop` values that
// bring each edge to the viewer's top edge.
function computeRangeOf(element1: HTMLElement, element2: HTMLElement): [number, number] {
    const origin = viewerScrollOrigin();
    return [
        element1.getBoundingClientRect().top - origin,
        element2.getBoundingClientRect().bottom - origin,
    ];
}

function computeSectionRange(heading: { level: number, href: string }): [number, number] {
    const hx = findHeadingElement(heading.level, heading.href);
    let last = findLastElementOfSection(hx, heading.level);
    return computeRangeOf(hx, last);
}

// Whether any part of the section a heading opens is scrolled into the viewer, for a table of
// contents to mark.
function sectionIsVisible(heading: { level: number, href: string }): boolean {
    const range = computeSectionRange(heading);
    const scrollTop = viewer.value.scrollTop;
    const clientHeight = viewer.value.clientHeight;
    const scrollHeight = viewer.value.scrollHeight;
    const viewportRange = [scrollTop, scrollTop + clientHeight];
    return range[0] < viewportRange[1] && (range[1] || scrollHeight) > viewportRange[0];
}

// Where each numbered element of the rendered note starts and ends, for scroll
// sync, as the `scrollTop` that brings that edge to the viewer's top edge.
//
// Both edges count because the margin between two elements belongs to
// neither. With tops alone, the lines from one element's top to the next's
// were spread evenly over the element and the margin below it together: a
// one-line paragraph and the blank line after it each got half of both.
//
// The note's two ends are anchors as well. Nothing is drawn for the
// frontmatter, so without them the lines above the first element, and those
// below the last, would have nowhere to sync to, and the other pane would stay
// wherever it was.
function collectScrollAnchors(): ScrollAnchor[] {
    const viewerElement: HTMLElement = viewer.value!;
    const origin = viewerScrollOrigin();
    const elements = [...renderedContentDiv.value.querySelectorAll<HTMLElement>('[data-line]')]
        // An element that is not drawn, such as one a note's custom CSS hides,
        // measures as a zero rect at the viewport's corner, which would put it
        // wherever the viewer happens to be scrolled.
        .filter((el) => el.getClientRects().length > 0)
        .flatMap((el) => {
            const rect = el.getBoundingClientRect();
            return [
                { line: parseInt(el.dataset['line'] as string), offset: rect.top - origin },
                { line: parseInt(el.dataset['lineEnd'] as string), offset: rect.bottom - origin },
            ];
        });
    return [
        { line: 1, offset: 0 },
        ...elements,
        { line: props.modelValue.split('\n').length + 1, offset: viewerElement.scrollHeight },
    ];
}

function handleDocumentScroll() {
    emit('viewer-scroll');

    const programmaticScrollPosition = pendingProgrammaticViewerScrollPosition;
    pendingProgrammaticViewerScrollPosition = null;

    if (!props.lockScroll) {
        return;
    }
    if (programmaticScrollPosition !== null
        && viewer.value.scrollTop === programmaticScrollPosition.top
        && viewer.value.scrollLeft === programmaticScrollPosition.left) {
        return;
    }

    const lineNumber = lineAtOffset(buildScrollMap(collectScrollAnchors()), viewer.value.scrollTop);
    if (lineNumber !== null) {
        editorScrollTo(lineNumber);
    }
}

function onEditorChange(newText: string) {
    lastEmittedValue = newText;
    emit('update:modelValue', newText);
    if (props.viewerVisible) {
        // Update lazily
        updateRenderedLazy();
    }
}

function onEditorScroll(lineNumber: number) {
    if (!props.lockScroll) {
        return;
    }

    const offset = offsetAtLine(buildScrollMap(collectScrollAnchors()), lineNumber);
    if (offset !== null) {
        const previousScrollTop = viewer.value.scrollTop;
        const previousScrollLeft = viewer.value.scrollLeft;
        viewer.value.scrollTo({ top: offset, left: 0, behavior: 'auto' });
        if (viewer.value.scrollTop === previousScrollTop && viewer.value.scrollLeft === previousScrollLeft) {
            pendingProgrammaticViewerScrollPosition = null;
        }
        else {
            // Use the browser's actual position in case the requested offset was clamped.
            pendingProgrammaticViewerScrollPosition = {
                top: viewer.value.scrollTop,
                left: viewer.value.scrollLeft,
            };
        }
    }
}

function onEditorPaneResize() {
    (editor.value as Editor).resize();
}

function onViewerPaneResize() {
    // Nothing to do here as of now
}

function focus() {
    (editor.value as Editor | HTMLTextAreaElement).focus();
}

function blur() {
    (editor.value as Editor | HTMLTextAreaElement).blur();
}

// Watchers
watch(() => props.modelValue, (value: string) => {
    if (value === lastEmittedValue) {
        return;
    }
    // Whatever was scheduled for the previous text is moot.
    if (renderTimeoutId.value) {
        window.clearTimeout(renderTimeoutId.value);
        renderTimeoutId.value = null;
    }
    updateRendered();
});

watch(() => props.viewerVisible, async (newValue: boolean, oldValue: boolean) => {
    if (!oldValue && newValue) {
        await updateRendered();
    }
});

defineExpose({
    focus,
    blur,
    whenRendered,
    jumpTo,
    sectionIsVisible,
});
</script>

<style scoped lang="scss">
// Wide enough for two panes of 350px or more. Measured on the component rather than the window, since
// what it is given depends on where it is placed: the whole of a note page, or a column of a task.
$side-by-side-width: 700px;

.editable-viewer {
    flex: 1 1 0;
    overflow: hidden;
    // Also sizes it by where it is placed, never by what it shows: an unbroken URL in either pane
    // would otherwise widen every flex row it sits in, up to the screen around it.
    container-type: inline-size;

    display: flex;
}

.panes {
    flex: 1 1 0;
    min-width: 0;

    display: flex;
    flex-direction: column;
    @container (min-width: #{$side-by-side-width}) {
        flex-direction: row;
    }
}

.editor-pane {
    flex: 1 1 0;
    overflow: hidden;

    display: flex;
    flex-direction: column;

    .editor {
        flex: 1 1 0;
    }

    .editor.simple-editor {
        padding: 0.5em;
        border: none;
        outline: none;
        font-size: 13px;
        font-family: Menlo, monospace;
        // Never wrapped, so the toolbar offers no wrapping switch here: `editorScrollTo()` puts a
        // line at `lineNumber * lineHeight`, which holds only while every line is one row.
        white-space: pre;
        overflow: auto;
        resize: none;
    }
}

.viewer-pane {
    flex: 1 1 0;
    overflow: hidden auto;
    // What a note positions absolutely, such as KaTeX's hidden MathML or the heading links a custom
    // note CSS hangs beside each heading, is placed against the nearest positioned ancestor. Unless
    // that is this pane, it lies outside the pane: it neither scrolls with the note nor is clipped
    // by it, and it stretches the app around the page instead, which `overflow: hidden` keeps from
    // showing a scroll bar but not from being scrolled.
    position: relative;

    .rendered-content {
        user-select: text;
    }
}

.panes.onlyEditor {
    .viewer-pane {
        display: none;
    }
}

.panes.onlyViewer {
    .editor-pane {
        display: none;
    }
}

.panes.both {
    .editor-pane {
        border-bottom: thin solid #ccc;
        @container (min-width: #{$side-by-side-width}) {
            border-bottom: none;
            border-right: thin solid #ccc;
        }
    }
}

.rendered-content {
    width: 100%;
}
</style>
