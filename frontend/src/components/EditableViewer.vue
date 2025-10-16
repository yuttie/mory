<template>
    <div class="editable-viewer">
        <template v-if="notFound">
            <div>
                <h1>Not Found</h1>
            </div>
        </template>
        <template v-else>
            <v-dialog
                v-model="showConfirmationDialog"
                max-width="25em"
            >
                <v-card>
                    <template v-if="upstreamState === 'different'">
                        <v-card-title class="headline">
                            Really overwrite note?
                        </v-card-title>
                        <v-card-text>
                            Upstream has been modified since the note was loaded.
                            Those changes will be lost if you continue to save the note.
                        </v-card-text>
                    </template>
                    <template v-else-if="upstreamState === 'deleted'">
                        <v-card-title class="headline">
                            Really create a new note?
                        </v-card-title>
                        <v-card-text>
                            Upstream has been deleted.
                            A new note will be created if you continue to save the note.
                        </v-card-text>
                    </template>
                    <template v-else>
                        <v-card-title class="headline">
                            Something is wrong.
                        </v-card-title>
                        <v-card-text>
                            This message should not be shown to you...
                        </v-card-text>
                    </template>
                    <v-card-actions>
                        <v-spacer></v-spacer>
                        <v-btn
                            text
                            v-on:click="showConfirmationDialog = false;"
                        >
                            Cancel
                        </v-btn>

                        <v-btn
                            color="error darken-1"
                            text
                            v-on:click="showConfirmationDialog = false; save();"
                        >
                            OK
                        </v-btn>
                    </v-card-actions>
                </v-card>
            </v-dialog>
            <div class="panes" v-bind:class="panesState">
                <div class="editor-pane"
                    v-on:transitionend="onEditorPaneResize"
                >
                    <v-sheet outlined class="flex-grow-0">
                        <v-btn icon tile v-on:click="insertText('## ')">
                            <v-icon>{{ mdiFormatHeader2 }}</v-icon>
                        </v-btn>
                        <v-btn icon tile v-on:click="insertText('* ')">
                            <v-icon>{{ mdiFormatListBulleted }}</v-icon>
                        </v-btn>
                        <v-btn icon tile v-on:click="encloseText('*', '*')">
                            <v-icon>{{ mdiFormatItalic }}</v-icon>
                        </v-btn>
                        <v-btn icon tile v-on:click="encloseText('**', '**')">
                            <v-icon>{{ mdiFormatBold }}</v-icon>
                        </v-btn>
                        <v-btn icon tile v-on:click="encloseText('`', '`')">
                            <v-icon>{{ mdiXml }}</v-icon>
                        </v-btn>
                        <v-btn icon tile v-on:click="encloseText('> ', '')">
                            <v-icon>{{ mdiFormatQuoteClose }}</v-icon>
                        </v-btn>
                        <v-btn icon tile v-on:click="encloseText('[', ']()')">
                            <v-icon>{{ mdiLinkVariant }}</v-icon>
                        </v-btn>
                        <v-btn icon tile v-on:click="formatTable">
                            <v-icon>{{ mdiTableCheck }}</v-icon>
                        </v-btn>
                    </v-sheet>
                    <template v-if="useSimpleEditor">
                        <textarea
                            v-bind:value="text"
                            v-on:input="onEditorChange($event.target.value)"
                            class="editor simple-editor"
                            ref="editor"
                        ></textarea>
                    </template>
                    <template v-else>
                        <Editor
                            v-bind:value="text"
                            v-bind:mode="editorMode"
                            v-on:change="onEditorChange"
                            v-on:scroll="onEditorScroll"
                            ref="editor"
                        ></Editor>
                    </template>
                </div>
                <div class="viewer-pane"
                    ref="viewer"
                    v-on:transitionend="onViewerPaneResize"
                >
                    <div ref="shadowDomRootElement" style="user-select: text">
                    </div>
                </div>
                <v-navigation-drawer
                    right
                    app
                    clipped
                    v-bind:mini-variant="miniSubSidebar"
                    v-bind:expand-on-hover="miniSubSidebar"
                    permanent
                    width="312"
                    class="sidebar"
                >
                    <v-list dense nav>
                        <v-list-item>
                            <v-btn
                                v-if="!miniSubSidebar"
                                icon
                                tile
                                v-on:click.stop="miniSubSidebar = true"
                            ><v-icon>{{ mdiChevronDoubleRight }}</v-icon></v-btn>
                        </v-list-item>
                        <v-list-item
                            v-if="miniSubSidebar"
                            v-on:click="miniSubSidebar = false"
                        >
                            <v-list-item-icon>
                                <v-icon>{{ mdiChevronDoubleLeft }}</v-icon>
                            </v-list-item-icon>
                            <v-list-item-content><!-- Necessary for proper alignment and layout of v-list-item when only an icon is present --></v-list-item-content>
                        </v-list-item>
                    </v-list>
                    <v-row
                        no-gutters
                    >
                        <v-col style="overflow: hidden;">
                            <div class="sidebar-contents">
                                <v-expansion-panels
                                    accordion
                                    multiple
                                    flat
                                    tile
                                    hover
                                    v-model="sidebarPanelState"
                                >
                                    <v-expansion-panel
                                        class="metadata"
                                        v-if="rendered.metadata"
                                    >
                                        <v-expansion-panel-header>
                                            <span>
                                                Metadata
                                                <template v-if="Object.hasOwn(rendered.metadata, 'validationErrors')">
                                                    <v-tooltip bottom color="success">
                                                        <template v-slot:activator="{ on, attrs }">
                                                            <v-icon color="success" v-bind="attrs" v-on="on">
                                                                {{ mdiCheck }}
                                                            </v-icon>
                                                        </template>
                                                        <span>YAML parse succeeded</span>
                                                    </v-tooltip>
                                                    <template v-if="rendered.metadata.validationErrors === null">
                                                        <v-tooltip bottom color="success">
                                                            <template v-slot:activator="{ on, attrs }">
                                                                <v-icon color="success" v-bind="attrs" v-on="on">
                                                                    {{ mdiCheck }}
                                                                </v-icon>
                                                            </template>
                                                            <span>Schema validation succeeded</span>
                                                        </v-tooltip>
                                                    </template>
                                                    <template v-else>
                                                        <v-tooltip bottom color="error">
                                                            <template v-slot:activator="{ on, attrs }">
                                                                <v-icon color="error" v-bind="attrs" v-on="on">
                                                                    {{ mdiAlert }}
                                                                </v-icon>
                                                            </template>
                                                            <span>Schema validation failed</span>
                                                        </v-tooltip>
                                                    </template>
                                                </template>
                                                <template v-else>
                                                    <v-tooltip bottom color="error">
                                                        <template v-slot:activator="{ on, attrs }">
                                                            <v-icon color="error" v-bind="attrs" v-on="on">
                                                                {{ mdiAlert }}
                                                            </v-icon>
                                                        </template>
                                                        <span>YAML parse failed</span>
                                                    </v-tooltip>
                                                </template>
                                            </span>
                                        </v-expansion-panel-header>
                                        <v-expansion-panel-content>
                                            <template v-if="Object.hasOwn(rendered.metadata, 'validationErrors')">
                                                <template v-if="rendered.metadata.validationErrors !== null">
                                                    <ul>
                                                        <li v-for="error of rendered.metadata.validationErrors" v-bind:key="error.dataPath + error.schemaPath">
                                                            <span class="font-weight-bold">{{error.dataPath}}: <span class="error--text">error:</span> {{error.message}}</span> (schema path: {{error.schemaPath}})
                                                        </li>
                                                    </ul>
                                                </template>
                                                <pre class="metadata-content">{{ JSON.stringify(rendered.metadata.value, null, 2) }}</pre>
                                            </template>
                                            <template v-else>
                                                <span class="error--text font-weight-bold">{{ rendered.metadata.parseError.toString() }}</span>
                                            </template>
                                        </v-expansion-panel-content>
                                    </v-expansion-panel>
                                    <v-expansion-panel
                                        class="toc"
                                    >
                                        <v-expansion-panel-header>
                                            Table of Contents
                                        </v-expansion-panel-header>
                                        <v-expansion-panel-content>
                                            <ol class="tree" ref="tocEl">
                                                <li v-for="h1 of toc" v-bind:key="h1.href" class="level1">
                                                    <a v-bind:href="h1.href" v-on:click="jumpTo(h1.href)">{{ h1.title }}</a>
                                                    <ol>
                                                        <li v-for="h2 of h1.children" v-bind:key="h2.href" class="level2">
                                                            <a v-bind:href="h2.href" v-on:click="jumpTo(h2.href)">{{ h2.title }}</a>
                                                            <ol>
                                                                <li v-for="h3 of h2.children" v-bind:key="h3.href" class="level3">
                                                                    <a v-bind:href="h3.href" v-on:click="jumpTo(h3.href)">{{ h3.title }}</a>
                                                                </li>
                                                            </ol>
                                                        </li>
                                                    </ol>
                                                </li>
                                            </ol>
                                        </v-expansion-panel-content>
                                    </v-expansion-panel>
                                </v-expansion-panels>
                            </div>
                        </v-col>
                        <v-navigation-drawer
                            mini-variant
                            permanent
                            right
                        >
                            <v-list dense nav>
                                <v-list-item-group
                                    mandatory
                                    color="primary"
                                    v-bind:value="selectedMode"
                                >
                                    <v-list-item v-on:click="editorIsVisible = false; viewerIsVisible = true; "><v-list-item-icon><v-icon dense>{{ mdiFileDocument     }}</v-icon></v-list-item-icon><v-list-item-content><!-- Necessary for proper alignment and layout of v-list-item when only an icon is present --></v-list-item-content></v-list-item>
                                    <v-list-item v-on:click="editorIsVisible = true;  viewerIsVisible = true; "><v-list-item-icon><v-icon dense>{{ mdiFileDocumentEdit }}</v-icon></v-list-item-icon><v-list-item-content><!-- Necessary for proper alignment and layout of v-list-item when only an icon is present --></v-list-item-content></v-list-item>
                                    <v-list-item v-on:click="editorIsVisible = true;  viewerIsVisible = false;"><v-list-item-icon><v-icon dense>{{ mdiPencil           }}</v-icon></v-list-item-icon><v-list-item-content><!-- Necessary for proper alignment and layout of v-list-item when only an icon is present --></v-list-item-content></v-list-item>
                                </v-list-item-group>
                            </v-list>

                            <v-divider></v-divider>

                            <v-list dense nav>
                                <v-list-item v-on:click="lockScroll = !lockScroll;">
                                    <v-list-item-icon>
                                        <template v-if="lockScroll">
                                            <v-icon dense>{{ mdiLock }}</v-icon>
                                        </template>
                                        <template v-else>
                                            <v-icon dense>{{ mdiLockOpen }}</v-icon>
                                        </template>
                                    </v-list-item-icon>
                                    <v-list-item-content><!-- Necessary for proper alignment and layout of v-list-item when only an icon is present --></v-list-item-content>
                                </v-list-item>

                                <v-list-item v-on:click="notifyUpstreamState">
                                    <v-list-item-icon><v-icon dense>{{ mdiCompareVertical }}</v-icon></v-list-item-icon>
                                    <v-list-item-content><!-- Necessary for proper alignment and layout of v-list-item when only an icon is present --></v-list-item-content>
                                </v-list-item>
                                <v-list-item                                            v-bind:disabled="needSave"         v-bind:style="needSave ? { opacity: '0.3' } : {}" v-on:click="reload"                                      ><v-list-item-icon><v-icon dense>{{ mdiReload      }}</v-icon></v-list-item-icon><v-list-item-content><!-- Necessary for proper alignment and layout of v-list-item when only an icon is present --></v-list-item-content></v-list-item>
                                <v-list-item color="pink" v-bind:input-value="needSave" v-bind:disabled="!needSave"        v-bind:style="!needSave ? { opacity: '0.3' } : {}" v-bind:loading="isSaving" v-on:click.stop="saveIfNeeded"><v-list-item-icon><v-icon dense>{{ mdiContentSave }}</v-icon></v-list-item-icon><v-list-item-content><!-- Necessary for proper alignment and layout of v-list-item when only an icon is present --></v-list-item-content></v-list-item>
                                <v-list-item link         id="rename-toggle"            v-bind:disabled="!noteHasUpstream" v-bind:style="!noteHasUpstream ? { opacity: '0.3' } : {}" v-bind:loading="isRenaming"                      ><v-list-item-icon><v-icon dense>{{ mdiRenameBox   }}</v-icon></v-list-item-icon><v-list-item-content><!-- Necessary for proper alignment and layout of v-list-item when only an icon is present --></v-list-item-content></v-list-item>
                            </v-list>
                        </v-navigation-drawer>
                    </v-row>
                </v-navigation-drawer>
            </div>
            <v-menu
                v-model="renameMenuIsVisible"
                activator="#rename-toggle"
                v-bind:close-on-content-click="false"
            >
                <v-card
                    min-width="30em"
                >
                    <v-card-text>
                        <v-text-field
                            label="New path"
                            v-model="newPath"
                            v-bind:rules="[newPathValidationResult]"
                            v-on:focus="$event.target.select()"
                            v-on:keydown="onNewPathKeydown"
                            v-on:input="onNewPathInput"
                            autofocus
                        ></v-text-field>
                    </v-card-text>
                    <v-card-actions>
                        <v-spacer></v-spacer>
                        <v-btn
                            text
                            v-on:click="renameMenuIsVisible = false;"
                        >Cancel</v-btn>
                        <v-btn
                            text
                            color="primary"
                            v-on:click="rename(); renameMenuIsVisible = false;"
                            v-bind:disabled="newPathConflicting"
                        >Rename</v-btn>
                    </v-card-actions>
                </v-card>
            </v-menu>
            <v-overlay v-bind:value="isLoading" z-index="10" opacity="0">
                <v-progress-circular indeterminate color="blue-grey lighten-3" size="64"></v-progress-circular>
            </v-overlay>
        </template>
        <v-snackbar top timeout="1000" v-model="showUpstreamState" v-bind:color="upstreamStateSnackbarColor">
            <template v-if="upstreamState === 'different'">
                Upstream has been modified since it was loaded.
            </template>
            <template v-else-if="upstreamState === 'deleted'">
                Upstream has been deleted.
            </template>
            <template v-else>
                This is the latest version.
            </template>
        </v-snackbar>
        <v-snackbar v-model="error" color="error" top timeout="5000">{{ errorText }}</v-snackbar>
    </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';

import {
    mdiAlert,
    mdiCheck,
    mdiChevronDoubleLeft,
    mdiChevronDoubleRight,
    mdiCompareVertical,
    mdiContentSave,
    mdiFileDocument,
    mdiFileDocumentEdit,
    mdiFormatBold,
    mdiFormatHeader2,
    mdiFormatItalic,
    mdiFormatListBulleted,
    mdiFormatQuoteClose,
    mdiLinkVariant,
    mdiLock,
    mdiLockOpen,
    mdiPencil,
    mdiReload,
    mdiRenameBox,
    mdiTableCheck,
    mdiXml,
} from '@mdi/js';

import { useRoute, useRouter } from 'vue-router/composables';
import { useVuetify } from '@/composables/vuetify';
import { useAppStore } from '@/stores/app';

import metadataSchema from '@/metadata-schema.json';

import Ajv from 'ajv';
import type { DefinedError } from 'ajv';
import * as api from '@/api';
import { loadConfigValue } from '@/config';
import { CliPrettify } from 'markdown-table-prettify';
import { chunkMarkdownByHeadings, renderMarkdown } from '@/markdown';

const ajv = new Ajv();
const validateMetadata = ajv.compile(metadataSchema);

// Emits
const emit = defineEmits<{
    (e: 'tokenExpired', callback: () => void): void;
}>();

// Composables
const router = useRouter();
const route = useRoute();
const vuetify = useVuetify();
const appStore = useAppStore();

// Reactive states
const text = ref('');
const initialText = ref('');
const upstreamState = ref('same');
const showUpstreamState = ref(false);
const rendered = ref({ metadata: null as null | any, content: '' });
const useSimpleEditor = ref(loadConfigValue('use-simple-editor', false));
const lockScroll = ref(loadConfigValue('lock-scroll', false));
const ignoreNext = ref(false);
const noteHasUpstream = ref(false);
const editorIsVisible = ref(false);
const viewerIsVisible = ref(true);
const miniSubSidebar = ref(true);
const sidebarPanelState = ref([0]);
const renameMenuIsVisible = ref(false);
const newPath = ref(null as null | string);
const newPathConflicting = ref(true);
const isLoading = ref(false);
const isSaving = ref(false);
const isRenaming = ref(false);
const notFound = ref(false);
const showConfirmationDialog = ref(false);
const error = ref(false);
const errorText = ref('');
const renderTimeoutId = ref(null as null | number);

// Non-reactive state for internal rendering control
let chunkRenderController: AbortController | null = null;
let markdownChunks: Array<{ content: string; startLine: number }> = [];
let renderedChunks: string[] = [];
let chunkElements: HTMLElement[] = [];

// Template Refs
const editor = ref(null);
const viewer = ref(null);
const tocEl = ref(null);
const shadowDomRootElement = ref(null);
const shadowRoot = ref(null);
const renderedContentDiv = ref(null);

// Computed properties
const editorMode = computed(() => {
    if (/\.css$/i.test(route.params.path)) {
        return 'css';
    }
    else if (/\.less$/i.test(route.params.path)) {
        return 'less';
    }
    else {
        return 'markdown';
    }
});

const selectedMode = computed(() => {
    if (viewerIsVisible.value && !editorIsVisible.value) {
        return 0;
    }
    else if (viewerIsVisible.value && editorIsVisible.value) {
        return 1;
    }
    else if (!viewerIsVisible.value && editorIsVisible.value) {
        return 2;
    }
});

const panesState = computed(() => {
    return {
        onlyEditor: editorIsVisible.value && !viewerIsVisible.value,
        onlyViewer: !editorIsVisible.value && viewerIsVisible.value,
        both: editorIsVisible.value && viewerIsVisible.value,
        smAndUp: vuetify.breakpoint.smAndUp,
        mdAndUp: vuetify.breakpoint.mdAndUp,
        lgAndUp: vuetify.breakpoint.lgAndUp,
    };
});

const title = computed(() => {
    const root = document.createElement('div');
    root.innerHTML = rendered.value.content;
    const h1 = root.querySelector('h1');
    if (h1) {
        return h1.textContent;
    }
    else {
        return route.params.path;
    }
});

const toc = computed(() => {
    const root = document.createElement('div');
    root.innerHTML = rendered.value.content;

    const toc: any = [];
    const stack = [{ level: 0, title: '/', children: toc }];
    for (const hx of [...root.children].filter(el => /^H\d+$/.test(el.tagName))) {
        const level = parseInt(hx.tagName.slice(1));

        // Find the parent of the header
        while (level <= stack[stack.length - 1].level) {
            stack.pop();
        }

        const parent = stack[stack.length - 1];
        const child = {
            level: level,
            title: (hx as HTMLElement).innerText,
            href: hx.querySelector('a.header-anchor')?.getAttribute('href'),
            children: [],
        };
        parent.children.push(child);
        stack.push(child);
    }

    return toc;
});

const isModified = computed((): boolean => {
    return text.value !== initialText.value;
});

const upstreamStateSnackbarColor = computed((): string => {
    if (upstreamState.value === 'different') {
        return 'error';
    }
    else if (upstreamState.value === 'deleted') {
        return 'warning';
    }
    else if (upstreamState.value === 'same') {
        return 'success';
    }
    else {
        throw 'Invalid upstream state!';
    }
});

const needSave = computed((): boolean => {
    if (noteHasUpstream.value) {
        if (isModified.value) {
            return true;
        }
        else {
            return false;
        }
    }
    else {
        return true;
    }
});

const newPathValidationResult = computed((): boolean | string => {
    if (newPathConflicting.value) {
        return 'Conflicting with existing path';
    }
    else {
        return true;
    }
});

// Lifecycle hooks
onMounted(async () => {
    // Attach a shadow DOM
    shadowRoot.value = shadowDomRootElement.value.attachShadow({ mode: 'open' });

    // Load CSSs that are used within the shadow DOM
    const highlightjsTheme = loadConfigValue('highlightjs-theme', 'default');
    await loadHighlightjsTheme(highlightjsTheme)
    .then((themeCss) => {
        const styleElement = document.createElement('style');
        styleElement.textContent = themeCss;
        shadowRoot.value.appendChild(styleElement);
    })
    .catch((err) => {
        console.error(err);
    });
    await loadCustomNoteCss()
    .then((customNoteCss) => {
        const styleElement = document.createElement('style');
        styleElement.textContent = customNoteCss;
        shadowRoot.value.appendChild(styleElement);
    })
    .catch((err) => {
        console.error(err);
    });

    const linkElement = document.createElement('link');
    linkElement.rel = 'stylesheet';
    linkElement.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
    shadowRoot.value.appendChild(linkElement);

    // Setup <div> that displays a rendered notes
    renderedContentDiv.value = document.createElement('div');
    renderedContentDiv.value.setAttribute('class', 'rendered-content flex-grow-1');
    shadowRoot.value.appendChild(renderedContentDiv.value);

    document.title = `${title.value} | ${import.meta.env.VITE_APP_NAME}`;

    window.addEventListener('focus', notifyUpstreamState);
    window.addEventListener('focus', focusOrBlurEditor);

    window.addEventListener('beforeunload', onBeforeunload);

    window.addEventListener('keydown', handleKeydown);

    if (route.query.mode === 'create') {
        if (route.query.template) {
            await loadTemplate(route.query.template as string);
        }
        else {
            text.value = `---
tags:
events:
---

# ${route.params.path}`;
            initialText.value = text.value;
            editorIsVisible.value = true;
            (editor.value as Editor | HTMLTextAreaElement).focus();

            // Update immediately
            updateRendered();
        }
        editorIsVisible.value = true;
        viewerIsVisible.value = true;
    }
    else {
        await load(route.params.path);
        if (/\.(md|markdown)$/i.test(route.params.path)) {
            // Show only viewer for files with rendering support
            editorIsVisible.value = false;
            viewerIsVisible.value = true;
        }
        else {
            // Otherwise, show only editor
            editorIsVisible.value = true;
            viewerIsVisible.value = false;
        }
    }
    focusOrBlurEditor();

    viewer.value.addEventListener('scroll', handleDocumentScroll);
});

onUnmounted(() => {
    window.removeEventListener('focus', notifyUpstreamState);
    window.removeEventListener('focus', focusOrBlurEditor);

    window.removeEventListener('beforeunload', onBeforeunload);

    window.removeEventListener('keydown', handleKeydown);
    if (renderTimeoutId.value) {
        window.clearTimeout(renderTimeoutId.value);
        renderTimeoutId.value = null;
    }

    // Cancel any ongoing chunked rendering
    if (chunkRenderController) {
        chunkRenderController.abort();
        chunkRenderController = null;
    }

    viewer.value.removeEventListener('scroll', handleDocumentScroll);
});

// Methods
function jumpTo(id: string) {
    const element = shadowRoot.value.querySelector(`[id="${id.slice(1)}"]`);
    if (element !== null) {
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
        throw new Error(`Failed to load Highlight.js theme CSS: ${err}`);
    }
}

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

async function updateRendered() {
    // Cancel any ongoing chunked rendering
    if (chunkRenderController) {
        chunkRenderController.abort();
        chunkRenderController = null;
    }

    // Use chunked rendering for all documents
    // Short markdown is automatically treated as a single chunk
    await updateRenderedChunked();
}

async function updateRenderedChunked() {
    // Create abort controller to cancel this render if a new one starts
    const controller = new AbortController();
    chunkRenderController = controller;

    // Split markdown into chunks by headings
    const { frontmatter, chunks: newMarkdownChunks } = chunkMarkdownByHeadings(text.value);

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

            // Display chunks progressively for better perceived performance
            if (i === 0 || i === newMarkdownChunks.length - 1) {
                // First and last chunks render immediately for quick feedback
                if (chunkChanged) {
                    updateChunkInDisplay(i, chunkHtml, markdownChunkInfo.startLine);
                }
                updateDisplay(metadata, parseError);
            } else {
                // Intermediate chunks render during idle time to avoid blocking UI
                await new Promise<void>((resolve) => {
                    if ('requestIdleCallback' in window) {
                        requestIdleCallback(() => {
                            if (!controller.signal.aborted) {
                                if (chunkChanged) {
                                    updateChunkInDisplay(i, chunkHtml, markdownChunkInfo.startLine);
                                }
                                updateDisplay(metadata, parseError);
                            }
                            resolve();
                        });
                    } else {
                        // Fallback for browsers without requestIdleCallback
                        setTimeout(() => {
                            if (!controller.signal.aborted) {
                                if (chunkChanged) {
                                    updateChunkInDisplay(i, chunkHtml, markdownChunkInfo.startLine);
                                }
                                updateDisplay(metadata, parseError);
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

    // Adjust line numbers
    if (startLine > 1) {
        const elementsWithDataLine = chunkDiv.querySelectorAll('[data-line]');
        elementsWithDataLine.forEach((element) => {
            const lineNum = element.getAttribute('data-line');
            if (lineNum) {
                const adjustedLine = parseInt(lineNum) + startLine - 1;
                element.setAttribute('data-line', adjustedLine.toString());
            }
        });
    }

    // Prevent images from being dragged
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

function updateDisplay(metadata: any, parseError: any) {
    ignoreNext.value = true;

    // Validate metadata
    const validationErrors = (() => {
        if (metadata !== null) {
            if (validateMetadata(metadata)) {
                return null;
            }
            else {
                const errors = [];
                for (const err of validateMetadata.errors as DefinedError[]) {
                    errors.push(err);
                }
                errors.sort((a, b) => {
                    if (a.instancePath < b.instancePath) {
                        return -1;
                    }
                    else if (a.instancePath > b.instancePath) {
                        return 1;
                    }
                    else {
                        return 0;
                    }
                });
                return errors;
            }
        }
        else {
            return null;
        }
    })();

    // Get accumulated HTML from chunks for rendered.value.content (used by TOC and title)
    const renderedHtml = renderedChunks.join('');

    // Set this.rendered
    if (metadata !== null) {
        // Metadata could be parsed correctly
        rendered.value = {
            metadata: {
                validationErrors: validationErrors,
                value: metadata
            },
            content: renderedHtml,
        };
    }
    else if (parseError !== null) {
        // YAML parse error
        rendered.value = {
            metadata: {
                parseError: parseError,
                value: null,
            },
            content: renderedHtml,
        };
    }
    else {
        // Metadata part does not exist
        rendered.value = {
            metadata: null,
            content: renderedHtml,
        };
    }

    // Update the page title
    document.title = `${title.value} | ${import.meta.env.VITE_APP_NAME}`;
}

async function loadCustomNoteCss(): Promise<string> {
    try {
        // Try CSS file first
        const res = await api.getNote('.mory/custom-note.css');
        // CSS file exists, return directly
        return res.data;
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
    const [res, { default: less }] = await Promise.all([
        api.getNote('.mory/custom-note.less'),
        import('less'),
    ]);

    const output = await less.render(res.data, {
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
    }, 2000);
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

function findLastElementOfSection(headingElement: HTMLElement, level: number): HTMLElement {
    let current: HTMLElement = headingElement;
    while (current.nextElementSibling) {
        let next = current.nextElementSibling;
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

function computeOffset(element: HTMLElement): number {
    let offsetTop = element.offsetTop;
    let parent = element.offsetParent;
    while (parent) {
        offsetTop += (parent as HTMLElement).offsetTop;
        parent = parent.offsetParent;
    }

    return offsetTop;
}

function computeRangeOf(element1: HTMLElement, element2: HTMLElement): [number, number] {
    return [
        computeOffset(element1),
        computeOffset(element2) + element2.scrollHeight,
    ];
}

function computeSectionRange(heading: { level: number, href: string }): [number, number] {
    const hx = findHeadingElement(heading.level, heading.href);
    let last = findLastElementOfSection(hx, heading.level);
    return computeRangeOf(hx, last);
}

function highlightVisibleTOCItems() {
    // Heading coverages
    const ranges = [];
    for (const l1Heading of toc.value) {
        ranges.push({ href: l1Heading.href, range: computeSectionRange(l1Heading) })
        for (const l2Heading of l1Heading.children) {
            ranges.push({ href: l2Heading.href, range: computeSectionRange(l2Heading) })
            for (const l3Heading of l2Heading.children) {
                ranges.push({ href: l3Heading.href, range: computeSectionRange(l3Heading) })
            }
        }
    }

    // Highlight visible ranges
    const scrollTop = viewer.value.scrollTop;
    const clientHeight = viewer.value.clientHeight;
    const scrollHeight = viewer.value.scrollHeight;
    const viewportRange = [scrollTop, scrollTop + clientHeight];
    for (const { href, range } of ranges) {
        const target = tocEl.value.querySelector<HTMLElement>(`li:has(> a[href="${href}"])`);
        if (range[0] < viewportRange[1] && (range[1] || scrollHeight) > viewportRange[0]) {
            target?.classList.add('visible');
        }
        else {
            target?.classList.remove('visible');
        }
    }
}

function handleDocumentScroll() {
    highlightVisibleTOCItems();

    if (!lockScroll.value) {
        return;
    }
    if (ignoreNext.value) {
        ignoreNext.value = false;
        return;
    }

    // Build scroll map
    const scrollMap: [number, number][] = [...renderedContentDiv.value.querySelectorAll<HTMLElement>('[data-line]')]
        .map((el) => {
            const lineNumber = parseInt(el.dataset['line'] as string);
            const offset = computeOffset(el);
            return [lineNumber, offset];
        })
        .sort((a, b) => {
            if (a[0] < b[0]) {
                return -1;
            }
            if (a[0] > b[0]) {
                return 1;
            }
            return 0;
        }) as [number, number][];

    // Remove non-monotonically increasing entries
    {
        let i = 0;
        while (i < scrollMap.length - 1) {
            if (scrollMap[i][1] > scrollMap[i + 1][1]) {
                // Delete the (i + 1)-th element
                scrollMap.splice(i + 1, 1);
            }
            else {
                ++i;
            }
        }
    }

    // Find the interval where the `scrollTop` belongs to
    const scrollTop = viewer.value.scrollTop;
    let intervalIndex = null;
    for (let i = 0; i < scrollMap.length - 1; ++i) {
        if (scrollMap[i][1] <= scrollTop && scrollTop < scrollMap[i + 1][1]) {
            intervalIndex = i;
            break;
        }
    }
    if (intervalIndex !== null) {
        const [lineNumber1, offset1] = scrollMap[intervalIndex];
        const [lineNumber2, offset2] = scrollMap[intervalIndex + 1];

        // Scroll to the line
        const lineNumber = lineNumber1 + (lineNumber2 - lineNumber1) * (scrollTop - offset1) / (offset2 - offset1);
        editorScrollTo(lineNumber);
        ignoreNext.value = true;
    }
}

function onEditorChange(newText: string) {
    text.value = newText;
    if (viewerIsVisible.value) {
        // Update lazily
        updateRenderedLazy();
    }
}

function onEditorScroll(lineNumber: number) {
    if (lineNumber === 0) {
        // The first scroll invokes this event with line number being 0
        // Just ignore
        return;
    }
    if (!lockScroll.value) {
        return;
    }
    if (ignoreNext.value) {
        ignoreNext.value = false;
        return;
    }

    // Build scroll map
    const scrollMap: [number, number][] = [...renderedContentDiv.value.querySelectorAll<HTMLElement>('[data-line]')]
        .map((el) => {
            const lineNumber = parseInt(el.dataset['line'] as string);
            const offset = computeOffset(el);
            return [lineNumber, offset];
        })
        .sort((a, b) => {
            if (a[0] < b[0]) {
                return -1;
            }
            if (a[0] > b[0]) {
                return 1;
            }
            return 0;
        }) as [number, number][];

    // Remove non-monotonically increasing entries
    {
        let i = 0;
        while (i < scrollMap.length - 1) {
            if (scrollMap[i][1] > scrollMap[i + 1][1]) {
                // Delete the (i + 1)-th element
                scrollMap.splice(i + 1, 1);
            }
            else {
                ++i;
            }
        }
    }

    // Find the interval where the given line number belongs to
    let intervalIndex = null;
    for (let i = 0; i < scrollMap.length - 1; ++i) {
        if (scrollMap[i][0] <= lineNumber && lineNumber < scrollMap[i + 1][0]) {
            intervalIndex = i;
            break;
        }
    }
    if (intervalIndex !== null) {
        const [lineNumber1, offset1] = scrollMap[intervalIndex];
        const [lineNumber2, offset2] = scrollMap[intervalIndex + 1];

        // Scroll by an offset
        const offset = offset1 + (offset2 - offset1) * (lineNumber - lineNumber1) / (lineNumber2 - lineNumber1);
        viewer.value.scrollTo({ top: offset, left: 0, behavior: 'auto' });
        ignoreNext.value = true;
    }
}

function checkUpstreamState() {
    const path = route.params.path;
    return api.getNote(path)
        .then(res => {
            if (res.data === initialText.value) {
                return 'same';
            }
            else {
                return 'different';
            }
        })
        .catch(error => {
            if (error.response) {
                if (error.response.status === 404) {
                    // Not Found
                    return 'deleted';
                }
                else {
                    throw error;
                }
            }
            else {
                throw error;
            }
        });
}

async function load(path: string) {
    isLoading.value = true;
    await api.getNote(path)
    .then(async res => {
        text.value = res.data;
        initialText.value = text.value;
        upstreamState.value = 'same';
        noteHasUpstream.value = true;

        // Update immediately
        await updateRendered();

        // Jump to a header if specified
        if (route.hash) {
            const anchorSelector = decodeURIComponent(route.hash);
            nextTick(() => {
                jumpTo(anchorSelector);
            });
        }

        isLoading.value = false;
        notFound.value = false;
    }).catch(error => {
        if (error.response) {
            if (error.response.status === 401) {
                // Unauthorized
                emit('tokenExpired', async () => {
                    await load(path);
                    focusOrBlurEditor();
                });
            }
            else if (error.response.status === 404) {
                // Not Found
                isLoading.value = false;
                notFound.value = true;
            }
            else {
                error.value = true;
                errorText.value = error.response;
                isLoading.value = false;
                throw error;
            }
        }
        else {
            error.value = true;
            errorText.value = error.toString();
            isLoading.value = false;
            throw error;
        }
    });
}

async function loadTemplate(path: string) {
    isLoading.value = true;
    await api.getNote(path)
    .then(async res => {
        text.value = res.data;
        initialText.value = text.value;
        editorIsVisible.value = true;
        (editor.value as Editor | HTMLTextAreaElement).focus();

        // Update immediately
        await updateRendered();

        isLoading.value = false;
        notFound.value = false;
    }).catch(error => {
        if (error.response) {
            if (error.response.status === 401) {
                // Unauthorized
                emit('tokenExpired', async () => {
                    await load(path);
                    focusOrBlurEditor();
                });
            }
            else if (error.response.status === 404) {
                // Not Found
                isLoading.value = false;
                notFound.value = true;
            }
            else {
                error.value = true;
                errorText.value = error.response;
                isLoading.value = false;
                throw error;
            }
        }
        else {
            error.value = true;
            errorText.value = error.toString();
            isLoading.value = false;
            throw error;
        }
    });
}

async function reload() {
    await load(route.params.path);
}

function toggleEditor() {
    if (viewerIsVisible.value) {
        if (editorIsVisible.value) {
            editorIsVisible.value = false;
        }
        else {
            editorIsVisible.value = true;
        }
    }
    else {
        if (editorIsVisible.value) {
            editorIsVisible.value = false;
            viewerIsVisible.value = true;
        }
        else {
            // Though this case shouldn't happen...
            editorIsVisible.value = true;
        }
    }

    focusOrBlurEditor();

    nextTick(() => {
        onEditorPaneResize();
        onViewerPaneResize();
    });
}

function toggleViewer() {
    if (editorIsVisible.value) {
        if (viewerIsVisible.value) {
            viewerIsVisible.value = false;
        }
        else {
            viewerIsVisible.value = true;
        }
    }
    else {
        if (viewerIsVisible.value) {
            viewerIsVisible.value = false;
            editorIsVisible.value = true;
        }
        else {
            // Though this case shouldn't happen...
            viewerIsVisible.value = true;
        }
    }

    focusOrBlurEditor();

    nextTick(() => {
        onEditorPaneResize();
        onViewerPaneResize();
    });
}

function onEditorPaneResize() {
    (editor.value as Editor).resize();
}

function onViewerPaneResize() {
    // Nothing to do here as of now
}

function focusOrBlurEditor() {
    nextTick(() => {
        if (editorIsVisible.value) {
            (editor.value as Editor | HTMLTextAreaElement).focus();
        }
        else {
            (editor.value as Editor | HTMLTextAreaElement).blur();
        }
    });
}

function notifyUpstreamState(e: FocusEvent) {
    checkUpstreamState()
        .then(state => {
            if (noteHasUpstream.value || state === 'different') {
                upstreamState.value = state;
                showUpstreamState.value = true;
            }
        })
        .catch(error => {
            if (error.response) {
                if (error.response.status === 401) {
                    // Unauthorized
                    emit('tokenExpired', () => {
                        notifyUpstreamState(e);
                    });
                }
                else {
                    error.value = true;
                    errorText.value = error.response;
                    throw error;
                }
            }
            else {
                error.value = true;
                errorText.value = error.toString();
                throw error;
            }
        });
}

function onBeforeunload(e: any) {
    if (isModified.value) {
        // Cancel the event
        e.preventDefault();
        e.returnValue = '';  // Chrome requires returnValue to be set
    }
    else {
        delete e['returnValue'];  // This guarantees the browser unload happens
    }
}

function handleKeydown(e: KeyboardEvent) {
    if (renameMenuIsVisible.value) {
        return;
    }
    if (e.key === 'e') {
        if (editorIsVisible.value) {
            // Do nothing
        }
        else {
            // Show editor
            editorIsVisible.value = true;
            nextTick(() => {
                // Focus editor
                (editor.value as Editor | HTMLTextAreaElement).focus();
                // Resize editor
                (editor.value as Editor).resize();
            });
            // Prevent 'e' from being input if editor is already focused
            e.preventDefault();
        }
    }
    else if (e.ctrlKey && e.key === 'Enter') {
        toggleEditor();
    }
    else if (e.shiftKey && e.key === 'Enter') {
        toggleViewer();
    }
    else if (e.ctrlKey && e.key === 's') {
        saveIfNeeded();
        e.preventDefault();
    }
}

function saveIfNeeded() {
    if (needSave.value) {
        checkUpstreamState()
            .then(state => {
                if (noteHasUpstream.value) {
                    if (state === 'same') {
                        save();
                    }
                    else {
                        upstreamState.value = state;
                        showConfirmationDialog.value = true;
                    }
                }
                else {
                    if (state === 'same' || state === 'deleted') {
                        save();
                    }
                    else {
                        upstreamState.value = state;
                        showConfirmationDialog.value = true;
                    }
                }
            })
            .catch(error => {
                if (error.response) {
                    if (error.response.status === 401) {
                        // Unauthorized
                        emit('tokenExpired', () => {
                            saveIfNeeded();
                        });
                    }
                    else {
                        error.value = true;
                        errorText.value = error.response;
                        throw error;
                    }
                }
                else {
                    error.value = true;
                    errorText.value = error.toString();
                    throw error;
                }
            });
    }
}

function save() {
    isSaving.value = true;
    const path = route.params.path;
    const content = text.value;
    api.addNote(
        path,
        content
    ).then(_res => {
            initialText.value = content;
            noteHasUpstream.value = true;
            isSaving.value = false;
            // Remove 'mode' and 'template' query parameters
            if (Object.hasOwn(route.query, 'mode')) {
                const newQuery = { ...route.query };
                delete newQuery.mode;
                delete newQuery.template;
                router.replace({ query: newQuery });
            }
        }).catch(error => {
            if (error.response) {
                if (error.response.status === 401) {
                    // Unauthorized
                    emit('tokenExpired', () => {
                        save();
                        focusOrBlurEditor();
                    });
                }
                else {
                    error.value = true;
                    errorText.value = error.response;
                    isSaving.value = false;
                    throw error;
                }
            }
            else {
                error.value = true;
                errorText.value = error.toString();
                isSaving.value = false;
                throw error;
            }
        });
}

function onNewPathKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
        rename();
    }
}

function onNewPathInput(path: string) {
    api.getNote(path).then(() => {
        newPathConflicting.value = true;
    }).catch(() => {
            // FIXME Status code should be checked.
            newPathConflicting.value = false;
        });
}

function rename() {
    const oldPath = route.params.path;

    if (newPath.value !== null && newPath.value !== oldPath) {
        isRenaming.value = true;
        api.renameNote(
            oldPath,
            newPath.value,
        ).then(_res => {
                router.replace({
                    path: `/note/${newPath.value}`,
                });
                isRenaming.value = false;
            }).catch(error => {
                if (error.response) {
                    if (error.response.status === 401) {
                        // Unauthorized
                        emit('tokenExpired', () => {
                            rename();
                            focusOrBlurEditor();
                        });
                    }
                    else {
                        error.value = true;
                        errorText.value = error.response;
                        isRenaming.value = false;
                        throw error;
                    }
                }
                else {
                    error.value = true;
                    errorText.value = error.toString();
                    isRenaming.value = false;
                    throw error;
                }
            });
    }
}

// Watchers
watch(viewerIsVisible, async (newValue: boolean, oldValue: boolean) => {
    if (!oldValue && newValue) {
        await updateRendered();
    }
});

watch(renameMenuIsVisible, (isVisible: boolean) => {
    if (isVisible) {
        newPath.value = route.params.path;
        newPathConflicting.value = true;
    }
});

watch(toc, () => {
    highlightVisibleTOCItems();
});
</script>

<style scoped lang="scss">
$navigation-drawer-width: 56px;

.editable-viewer {
    position: relative;
    height: 100vh;
    display: flex;
}

.panes {
    flex: 1 1 0;
    overflow: hidden;

    display: flex;
    flex-direction: column;
    &.mdAndUp {
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
        white-space: pre;
        overflow: auto;
        resize: none;
    }
}

.viewer-pane {
    flex: 1 1 0;
    overflow: hidden auto;

    .metadata-content,
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
    &:not(.mdAndUp) {
        .editor-pane {
            border-bottom: thin solid #ccc;
        }
    }
    &.mdAndUp {
        .editor-pane {
            border-right: thin solid #ccc;
        }
    }
}

.rendered-content {
    width: 100%;
}

.sidebar {
}

.sidebar-contents {
    width: 256px;  /* Keep this in sync with the width of v-navigation-drawer */

    /* Correct z-order of right sidebar's border and v-expansion-panels inside this element */
    position: relative;
    z-index: 0;
}

.toc {
    ol {
        padding-left: 1.5em;
    }
}
</style>
