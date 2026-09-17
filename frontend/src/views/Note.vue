<template>
    <div id="note">
        <template v-if="notFound">
            <div>
                <h1>Not Found</h1>
            </div>
        </template>
        <template v-else>
            <AppBarContent>
                <v-toolbar-title class="ms-5">{{ title }}</v-toolbar-title>
                <v-btn-toggle
                    v-bind:model-value="selectedMode"
                    mandatory
                    class="mr-1"
                    border
                    divided
                    v-on:update:model-value="setMode"
                >
                    <v-btn class="px-5" v-bind:value="0" icon title="Viewer"           ><v-icon size="small">{{ mdiFileDocument     }}</v-icon></v-btn>
                    <v-btn class="px-5" v-bind:value="1" icon title="Editor and viewer"><v-icon size="small">{{ mdiFileDocumentEdit }}</v-icon></v-btn>
                    <v-btn class="px-5" v-bind:value="2" icon title="Editor"           ><v-icon size="small">{{ mdiPencil           }}</v-icon></v-btn>
                </v-btn-toggle>
                <!-- A phone's app bar cannot fit every action beside the title, so the ones not
                     needed while writing wait in a menu there. -->
                <template v-if="$vuetify.display.smAndUp">
                    <v-icon-btn v-bind:icon="lockScroll ? mdiLock : mdiLockOpen" v-bind:title="lockScroll ? 'Unlock scroll' : 'Lock scroll'" v-on:click="lockScroll = !lockScroll"></v-icon-btn>
                    <v-icon-btn v-bind:icon="mdiCompareVertical" title="Compare with upstream" v-on:click="notifyUpstreamState"></v-icon-btn>
                    <v-icon-btn v-bind:icon="mdiReload" title="Reload" v-bind:disabled="needSave" v-on:click="reload"></v-icon-btn>
                </template>
                <v-icon-btn
                    v-bind:icon="mdiContentSave"
                    title="Save"
                    v-bind:color="needSave ? 'pink' : undefined"
                    v-bind:active="needSave"
                    v-bind:disabled="!needSave"
                    v-on:click.stop="saveIfNeeded"
                ></v-icon-btn>
                <v-menu
                    v-model="renameMenuIsVisible"
                    v-bind:close-on-content-click="false"
                >
                    <template v-slot:activator="{ props: menuProps }">
                        <v-icon-btn
                            v-bind="menuProps"
                            v-bind:icon="mdiRenameBox"
                            title="Rename"
                            v-bind:disabled="!noteHasUpstream"
                        ></v-icon-btn>
                    </template>
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
                                variant="text"
                                v-on:click="renameMenuIsVisible = false;"
                            >Cancel</v-btn>
                            <v-btn
                                variant="text"
                                color="primary"
                                v-on:click="rename(); renameMenuIsVisible = false;"
                                v-bind:disabled="newPathConflicting"
                            >Rename</v-btn>
                        </v-card-actions>
                    </v-card>
                </v-menu>
                <v-icon-btn
                    v-if="$vuetify.display.smAndUp"
                    v-bind:icon="mdiPageLayoutSidebarRight"
                    class="mr-2"
                    v-bind:title="sidebarIsVisible ? 'Hide metadata and contents' : 'Show metadata and contents'"
                    v-bind:active="sidebarIsVisible"
                    v-on:click="sidebarIsVisible = !sidebarIsVisible"
                ></v-icon-btn>
                <v-menu v-else location="bottom end">
                    <template v-slot:activator="{ props: menuProps }">
                        <v-icon-btn
                            v-bind="menuProps"
                            v-bind:icon="mdiDotsVertical"
                            title="More"
                            class="mr-2"
                        ></v-icon-btn>
                    </template>
                    <v-list>
                        <v-list-item
                            v-bind:title="lockScroll ? 'Unlock scroll' : 'Lock scroll'"
                            v-bind:prepend-icon="lockScroll ? mdiLock : mdiLockOpen"
                            v-on:click="lockScroll = !lockScroll"
                        ></v-list-item>
                        <v-list-item
                            title="Compare with upstream"
                            v-bind:prepend-icon="mdiCompareVertical"
                            v-on:click="notifyUpstreamState"
                        ></v-list-item>
                        <v-list-item
                            title="Reload"
                            v-bind:prepend-icon="mdiReload"
                            v-bind:disabled="needSave"
                            v-on:click="reload"
                        ></v-list-item>
                        <v-list-item
                            v-bind:title="sidebarIsVisible ? 'Hide metadata and contents' : 'Show metadata and contents'"
                            v-bind:prepend-icon="mdiPageLayoutSidebarRight"
                            v-on:click="sidebarIsVisible = !sidebarIsVisible"
                        ></v-list-item>
                    </v-list>
                </v-menu>
            </AppBarContent>
            <v-dialog
                v-model="showConfirmationDialog"
                max-width="25em"
            >
                <v-card>
                    <template v-if="upstreamState === 'different'">
                        <v-card-title class="text-h5">
                            Really overwrite note?
                        </v-card-title>
                        <v-card-text>
                            Upstream has been modified since the note was loaded.
                            Those changes will be lost if you continue to save the note.
                        </v-card-text>
                    </template>
                    <template v-else-if="upstreamState === 'deleted'">
                        <v-card-title class="text-h5">
                            Really create a new note?
                        </v-card-title>
                        <v-card-text>
                            Upstream has been deleted.
                            A new note will be created if you continue to save the note.
                        </v-card-text>
                    </template>
                    <template v-else>
                        <v-card-title class="text-h5">
                            Something is wrong.
                        </v-card-title>
                        <v-card-text>
                            This message should not be shown to you...
                        </v-card-text>
                    </template>
                    <v-card-actions>
                        <v-spacer></v-spacer>
                        <v-btn
                            variant="text"
                            v-on:click="showConfirmationDialog = false;"
                        >
                            Cancel
                        </v-btn>

                        <v-btn
                            color="error"
                            variant="text"
                            v-on:click="showConfirmationDialog = false; save();"
                        >
                            OK
                        </v-btn>
                    </v-card-actions>
                </v-card>
            </v-dialog>
            <EditableViewer
                v-model="text"
                v-bind:language="editorMode"
                v-bind:editor-visible="editorIsVisible"
                v-bind:viewer-visible="viewerIsVisible"
                v-bind:lock-scroll="lockScroll"
                v-on:rendered="onRendered"
                v-on:viewer-scroll="highlightVisibleTOCItems"
                ref="editableViewer"
            ></EditableViewer>
            <!-- Ordered after the app bar, so the bar spans the whole width above it: layout
                 items of equal order are stacked by their place in the component tree, and
                 this one is inside `v-main`, ahead of the bar. -->
            <v-navigation-drawer
                v-bind:model-value="sidebarIsVisible"
                location="end"
                permanent
                width="256"
                order="1"
                class="sidebar"
            >
                <div class="sidebar-contents">
                    <v-expansion-panels
                        variant="accordion"
                        multiple
                        elevation="0"
                        tile
                        v-model="sidebarPanelState"
                    >
                        <v-expansion-panel
                            class="metadata"
                            v-if="rendered.metadata"
                        >
                            <v-expansion-panel-title>
                                <span>
                                    Metadata
                                    <template v-if="Object.hasOwn(rendered.metadata, 'validationErrors')">
                                        <v-tooltip location="bottom" color="success">
                                            <template v-slot:activator="{ props: tooltipProps }">
                                                <v-icon color="success" v-bind="tooltipProps">
                                                    {{ mdiCheck }}
                                                </v-icon>
                                            </template>
                                            <span>YAML parse succeeded</span>
                                        </v-tooltip>
                                        <template v-if="rendered.metadata.validationErrors === null">
                                            <v-tooltip location="bottom" color="success">
                                                <template v-slot:activator="{ props: tooltipProps }">
                                                    <v-icon color="success" v-bind="tooltipProps">
                                                        {{ mdiCheck }}
                                                    </v-icon>
                                                </template>
                                                <span>Schema validation succeeded</span>
                                            </v-tooltip>
                                        </template>
                                        <template v-else>
                                            <v-tooltip location="bottom" color="error">
                                                <template v-slot:activator="{ props: tooltipProps }">
                                                    <v-icon color="error" v-bind="tooltipProps">
                                                        {{ mdiAlert }}
                                                    </v-icon>
                                                </template>
                                                <span>Schema validation failed</span>
                                            </v-tooltip>
                                        </template>
                                    </template>
                                    <template v-else>
                                        <v-tooltip location="bottom" color="error">
                                            <template v-slot:activator="{ props: tooltipProps }">
                                                <v-icon color="error" v-bind="tooltipProps">
                                                    {{ mdiAlert }}
                                                </v-icon>
                                            </template>
                                            <span>YAML parse failed</span>
                                        </v-tooltip>
                                    </template>
                                </span>
                            </v-expansion-panel-title>
                            <v-expansion-panel-text>
                                <template v-if="Object.hasOwn(rendered.metadata, 'validationErrors')">
                                    <template v-if="rendered.metadata.validationErrors !== null">
                                        <ul>
                                            <li v-for="error of rendered.metadata.validationErrors" v-bind:key="error.dataPath + error.schemaPath">
                                                <span class="font-weight-bold">{{error.dataPath}}: <span class="text-error">error:</span> {{error.message}}</span> (schema path: {{error.schemaPath}})
                                            </li>
                                        </ul>
                                    </template>
                                    <pre class="metadata-content">{{ JSON.stringify(rendered.metadata.value, null, 2) }}</pre>
                                </template>
                                <template v-else>
                                    <span class="text-error font-weight-bold">{{ rendered.metadata.parseError.toString() }}</span>
                                </template>
                            </v-expansion-panel-text>
                        </v-expansion-panel>
                        <v-expansion-panel
                            class="toc"
                        >
                            <v-expansion-panel-title>
                                Table of Contents
                            </v-expansion-panel-title>
                            <v-expansion-panel-text>
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
                            </v-expansion-panel-text>
                        </v-expansion-panel>
                    </v-expansion-panels>
                </div>
            </v-navigation-drawer>
            <v-overlay v-bind:model-value="isLoading" z-index="10" scrim="transparent" class="align-center justify-center">
                <v-progress-circular indeterminate color="blue-grey-lighten-3" size="64"></v-progress-circular>
            </v-overlay>
        </template>
        <v-snackbar location="top" timeout="1000" v-model="showUpstreamState" v-bind:color="upstreamStateSnackbarColor">
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
        <v-snackbar v-model="error" color="error" location="top" timeout="5000">{{ errorText }}</v-snackbar>
    </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';

import {
    mdiAlert,
    mdiCheck,
    mdiCompareVertical,
    mdiContentSave,
    mdiDotsVertical,
    mdiFileDocument,
    mdiFileDocumentEdit,
    mdiLock,
    mdiLockOpen,
    mdiPageLayoutSidebarRight,
    mdiPencil,
    mdiReload,
    mdiRenameBox,
} from '@mdi/js';

import { useRoute, useRouter } from 'vue-router';

import metadataSchema from '@/metadata-schema.json';

import Ajv from 'ajv';
import type { DefinedError } from 'ajv';
import AppBarContent from '@/components/AppBarContent.vue';
import EditableViewer from '@/components/EditableViewer.vue';
import { useFilesStore } from '@/stores/files';
import { loadConfigValue } from '@/config';

const ajv = new Ajv();
const validateMetadata = ajv.compile(metadataSchema);

// Emits
const emit = defineEmits<{
    (e: 'tokenExpired', callback: () => void): void;
}>();

// Composables
const router = useRouter();
const route = useRoute();
const files = useFilesStore();

// The repeatable :path* route parameter is an array of path segments in Vue Router 4
const notePath = computed<string>(() => {
    const path = route.params.path;
    return Array.isArray(path) ? path.join('/') : (path ?? '');
});

// Reactive states
const text = ref('');
const initialText = ref('');
const upstreamState = ref('same');
const showUpstreamState = ref(false);
const rendered = ref({ metadata: null as null | any, content: '' });
const lockScroll = ref(loadConfigValue('lock-scroll', false));
const noteHasUpstream = ref(false);
const editorIsVisible = ref(false);
const viewerIsVisible = ref(true);
const sidebarIsVisible = ref(false);
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

// Set right before a note path change that we've already handled locally
// (e.g. after a rename), so the route watcher below doesn't reload the note again.
let skipNextPathWatch = false;

// Template Refs
const editableViewer = ref<InstanceType<typeof EditableViewer> | null>(null);
const tocEl = ref<HTMLElement | null>(null);

// Computed properties
const editorMode = computed(() => {
    if (/\.css$/i.test(notePath.value)) {
        return 'css';
    }
    else if (/\.less$/i.test(notePath.value)) {
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

const title = computed(() => {
    const root = document.createElement('div');
    root.innerHTML = rendered.value.content;
    const h1 = root.querySelector('h1');
    if (h1) {
        return h1.textContent;
    }
    else {
        return notePath.value;
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

// Load (or initialize, in create mode) the note pointed to by the current route.
// Vue Router reuses this component instance when navigating between two routes
// that resolve to the same 'Note' route record (e.g. clicking "New note" while
// already viewing a note), so this must be re-run on route changes, not just on mount.
async function loadNoteFromRoute() {
    error.value = false;
    errorText.value = '';

    if (route.query.mode === 'create') {
        // A newly created note has no saved copy on the server yet, so the
        // save button must stay enabled regardless of leftover state from
        // whatever note was previously open in this component instance.
        noteHasUpstream.value = false;
        notFound.value = false;

        if (route.query.template) {
            await loadTemplate(route.query.template as string);
        }
        else {
            text.value = `---
tags:
events:
---

# ${notePath.value}`;
            initialText.value = text.value;
            editorIsVisible.value = true;
            editableViewer.value?.focus();
        }
        editorIsVisible.value = true;
        viewerIsVisible.value = true;
    }
    else {
        await load(notePath.value);
        if (/\.(md|markdown)$/i.test(notePath.value)) {
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
}

// Lifecycle hooks
onMounted(async () => {
    document.title = `${title.value} | ${import.meta.env.VITE_APP_NAME}`;

    window.addEventListener('focus', notifyUpstreamState);
    window.addEventListener('focus', focusOrBlurEditor);

    window.addEventListener('beforeunload', onBeforeunload);

    window.addEventListener('keydown', handleKeydown);

    await loadNoteFromRoute();
});

onUnmounted(() => {
    window.removeEventListener('focus', notifyUpstreamState);
    window.removeEventListener('focus', focusOrBlurEditor);

    window.removeEventListener('beforeunload', onBeforeunload);

    window.removeEventListener('keydown', handleKeydown);
});

// Methods
function jumpTo(id: string) {
    editableViewer.value?.jumpTo(id);
}

function highlightVisibleTOCItems() {
    // The TOC list only exists once its expansion panel has been opened, because
    // <v-expansion-panel-text> renders its content lazily
    const list = tocEl.value;
    const viewer = editableViewer.value;
    if (list === null || viewer === null) {
        return;
    }

    for (const l1Heading of toc.value) {
        highlightTOCItem(list, viewer, l1Heading);
        for (const l2Heading of l1Heading.children) {
            highlightTOCItem(list, viewer, l2Heading);
            for (const l3Heading of l2Heading.children) {
                highlightTOCItem(list, viewer, l3Heading);
            }
        }
    }
}

function highlightTOCItem(
    list: HTMLElement,
    viewer: InstanceType<typeof EditableViewer>,
    heading: { level: number, href: string },
) {
    const target = list.querySelector<HTMLElement>(`li:has(> a[href="${heading.href}"])`);
    if (viewer.sectionIsVisible(heading)) {
        target?.classList.add('visible');
    }
    else {
        target?.classList.remove('visible');
    }
}

function onRendered({ metadata, parseError, content }: { metadata: unknown, parseError: unknown, content: string }) {
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

    // Set this.rendered
    if (metadata !== null) {
        // Metadata could be parsed correctly
        rendered.value = {
            metadata: {
                validationErrors: validationErrors,
                value: metadata
            },
            content: content,
        };
    }
    else if (parseError !== null) {
        // YAML parse error
        rendered.value = {
            metadata: {
                parseError: parseError,
                value: null,
            },
            content: content,
        };
    }
    else {
        // Metadata part does not exist
        rendered.value = {
            metadata: null,
            content: content,
        };
    }

    // Update the page title
    document.title = `${title.value} | ${import.meta.env.VITE_APP_NAME}`;
}

function checkUpstreamState() {
    const path = notePath.value;
    return files.read(path)
        .then(content => {
            if (content === initialText.value) {
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
    await files.read(path)
    .then(async content => {
        text.value = content;
        initialText.value = text.value;
        upstreamState.value = 'same';
        noteHasUpstream.value = true;

        await editableViewer.value?.whenRendered();

        // Jump to a header if specified
        if (route.hash) {
            const anchorSelector = decodeURIComponent(route.hash);
            jumpTo(anchorSelector);
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
    await files.read(path)
    .then(async content => {
        text.value = content;
        initialText.value = text.value;
        editorIsVisible.value = true;
        editableViewer.value?.focus();

        await editableViewer.value?.whenRendered();

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
    await load(notePath.value);
}

// Shows the panes a mode button in the app bar stands for, numbered as `selectedMode` numbers them.
function setMode(mode: number) {
    editorIsVisible.value = mode !== 0;
    viewerIsVisible.value = mode !== 2;
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
}

function focusOrBlurEditor() {
    nextTick(() => {
        if (editorIsVisible.value) {
            editableViewer.value?.focus();
        }
        else {
            editableViewer.value?.blur();
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
                editableViewer.value?.focus();
            });
            // Prevent 'e' from being input if editor is already focused
            e.preventDefault();
        }
    }
    else if (e.ctrlKey && e.key === 'Enter') {
        toggleEditor();
        // Otherwise the textarea of the Simple Editor also inserts a newline.
        // The rich editor swallows the key itself, see `shortcutKeymap` in
        // Editor.vue.
        e.preventDefault();
    }
    else if (e.shiftKey && e.key === 'Enter') {
        toggleViewer();
        e.preventDefault();
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
    const path = notePath.value;
    const content = text.value;
    files.write(
        path,
        content
    ).then(() => {
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
    files.exists(path).then(taken => {
        newPathConflicting.value = taken;
    }).catch(() => {
            newPathConflicting.value = false;
        });
}

function rename() {
    const oldPath = notePath.value;

    if (newPath.value !== null && newPath.value !== oldPath) {
        isRenaming.value = true;
        files.rename(
            oldPath,
            newPath.value,
        ).then(() => {
                skipNextPathWatch = true;
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
watch(renameMenuIsVisible, (isVisible: boolean) => {
    if (isVisible) {
        newPath.value = notePath.value;
        newPathConflicting.value = true;
    }
});

watch(toc, () => {
    highlightVisibleTOCItems();
});

watch(notePath, async (newPath, oldPath) => {
    if (skipNextPathWatch) {
        skipNextPathWatch = false;
        return;
    }
    if (newPath !== oldPath) {
        await loadNoteFromRoute();
    }
});
</script>

<style scoped lang="scss">
#note {
    position: relative;
    // The window less the layout's bars, as in the Calendar view: `100vh` pushed the bottom of both
    // panes under the edge of the window by the height of the app bar.
    height: calc(100dvh - var(--v-layout-top, 0px) - var(--v-layout-bottom, 0px));
    display: flex;
}

.sidebar {
}

.sidebar-contents {
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
