<template>
  <div id="editable-viewer">
    <template v-if="notFound">
      <div>
        <h1>Not Found</h1>
      </div>
    </template>
    <template v-else>
      <div
        v-show="!isLoading"
        style="position: fixed; right: 0; transform: translateY(40px); display: flex; flex-direction: column; z-index: 3;"
        class="toolbar mx-2 my-2"
      >
        <v-btn tile icon v-bind:color="!editorIsVisible &&  viewerIsVisible ? 'primary' : 'normal'" v-on:click="editorIsVisible = false; viewerIsVisible = true; "><v-icon>mdi-file-document</v-icon></v-btn>
        <v-btn tile icon v-bind:color=" editorIsVisible &&  viewerIsVisible ? 'primary' : 'normal'" v-on:click="editorIsVisible = true;  viewerIsVisible = true; "><v-icon>mdi-file-document-edit</v-icon></v-btn>
        <v-btn tile icon v-bind:color=" editorIsVisible && !viewerIsVisible ? 'primary' : 'normal'" v-on:click="editorIsVisible = true;  viewerIsVisible = false;"><v-icon>mdi-pencil</v-icon></v-btn>

        <v-btn tile icon color="gray" class="mt-5" v-on:click="lockScroll = !lockScroll;">
          <template v-if="lockScroll">
            <v-icon>mdi-lock</v-icon>
          </template>
          <template v-else>
            <v-icon>mdi-lock-open</v-icon>
          </template>
        </v-btn>

        <v-btn tile icon color="gray" class="mt-5" v-on:click="notifyUpstreamState">
          <v-icon>mdi-compare-vertical</v-icon>
        </v-btn>
        <v-btn tile icon color="gray" class="mt-0"                    v-bind:disabled="needSave" v-on:click="reload"><v-icon>mdi-reload</v-icon></v-btn>
        <v-btn tile icon color="pink" class="mt-0"                    v-bind:disabled="!needSave" v-bind:loading="isSaving" v-on:click.stop="saveIfNeeded"><v-icon>mdi-content-save</v-icon></v-btn>
        <v-btn tile icon color="gray" class="mt-0" id="rename-toggle" v-bind:disabled="!noteHasUpstream" v-bind:loading="isRenaming"><v-icon>mdi-rename-box</v-icon></v-btn>
      </div>
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
              <v-icon>mdi-format-header-2</v-icon>
            </v-btn>
            <v-btn icon tile v-on:click="insertText('* ')">
              <v-icon>mdi-format-list-bulleted</v-icon>
            </v-btn>
            <v-btn icon tile v-on:click="encloseText('*', '*')">
              <v-icon>mdi-format-italic</v-icon>
            </v-btn>
            <v-btn icon tile v-on:click="encloseText('**', '**')">
              <v-icon>mdi-format-bold</v-icon>
            </v-btn>
            <v-btn icon tile v-on:click="encloseText('`', '`')">
              <v-icon>mdi-xml</v-icon>
            </v-btn>
            <v-btn icon tile v-on:click="encloseText('> ', '')">
              <v-icon>mdi-format-quote-close</v-icon>
            </v-btn>
            <v-btn icon tile v-on:click="encloseText('[', ']()')">
              <v-icon>mdi-link-variant</v-icon>
            </v-btn>
            <v-btn icon tile v-on:click="formatTable">
              <v-icon>mdi-table-check</v-icon>
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
          v-on:transitionend="onViewerPaneResize"
        >
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
          <div ref="shadowDomRootElement" style="user-select: text">
          </div>
        </div>
        <div
          class="sidebar"
          v-bind:class="rightSidebarState"
        >
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
                  <template v-if="rendered.metadata.hasOwnProperty('validationErrors')">
                    <v-tooltip bottom color="success">
                      <template v-slot:activator="{ on, attrs }">
                        <v-icon color="success" v-bind="attrs" v-on="on">
                          mdi-check
                        </v-icon>
                      </template>
                      <span>YAML parse succeeded</span>
                    </v-tooltip>
                    <template v-if="rendered.metadata.validationErrors === null">
                      <v-tooltip bottom color="success">
                        <template v-slot:activator="{ on, attrs }">
                          <v-icon color="success" v-bind="attrs" v-on="on">
                            mdi-check
                          </v-icon>
                        </template>
                        <span>Schema validation succeeded</span>
                      </v-tooltip>
                    </template>
                    <template v-else>
                      <v-tooltip bottom color="error">
                        <template v-slot:activator="{ on, attrs }">
                          <v-icon color="error" v-bind="attrs" v-on="on">
                            mdi-alert
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
                          mdi-alert
                        </v-icon>
                      </template>
                      <span>YAML parse failed</span>
                    </v-tooltip>
                  </template>
                </span>
              </v-expansion-panel-header>
              <v-expansion-panel-content>
                <template v-if="rendered.metadata.hasOwnProperty('validationErrors')">
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
                <ol class="tree">
                  <li v-for="h1 of toc" v-bind:key="h1.title" class="level1">
                    <a v-bind:href="h1.href" v-on:click="jumpTo(h1.href)">{{ h1.title }}</a>
                    <ol>
                      <li v-for="h2 of h1.children" v-bind:key="h2.title" class="level2">
                        <a v-bind:href="h2.href" v-on:click="jumpTo(h2.href)">{{ h2.title }}</a>
                        <ol>
                          <li v-for="h3 of h2.children" v-bind:key="h3.title" class="level3">
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
    <v-snackbar v-model="error" color="error" top timeout="5000">{{ errorText }}</v-snackbar>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick, defineEmits } from 'vue';

import { useRouter, useRoute } from '@/composables/vue-router';
import { useVuetify } from '@/composables/vuetify';

import Editor from '@/components/Editor.vue';
import metadataSchema from '@/metadata-schema.json';

import Ajv from 'ajv';
import type { DefinedError } from 'ajv';
import * as api from '@/api';
import { loadConfigValue } from '@/config';
import { CliPrettify } from 'markdown-table-prettify';
import { renderMarkdown } from '@/markdown';
import less from 'less';

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

// Refs
const editor = ref(null);
const shadowDomRootElement = ref(null);
const shadowRoot = ref(null);
const renderedContentDiv = ref(null);

// Computed properties
const editorMode = computed(() => {
  if (/\.less$/i.test(route.params.path)) {
    return 'less';
  }
  else {
    return 'markdown';
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

const rightSidebarState = computed(() => {
  return {
    smAndDown: !vuetify.breakpoint.mdAndUp,
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
  }
  else {
    await load(route.params.path);
  }

  if (!/\.(md|markdown)$/i.test(route.params.path)) {
    editorIsVisible.value = true;
    viewerIsVisible.value = false;
    focusOrBlurEditor();
  }

  document.addEventListener('scroll', handleDocumentScroll);
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

  document.removeEventListener('scroll', handleDocumentScroll);
});

// Methods
function jumpTo(id: string) {
  const element = shadowRoot.value.querySelector(`[id="${id.slice(1)}"]`);
  if (element !== null) {
    element.scrollIntoView();
    // Compensate for the app bar height
    const appBarHeight = document.querySelector('#app-bar')?.clientHeight || 0;
    window.scrollBy(0, -appBarHeight);
  }
}

async function loadHighlightjsTheme(themeName: string): Promise<string> {
  const loaders = {
    'a11y-dark': () => { return import('highlight.js/styles/a11y-dark.min.css?raw'); },
    'a11y-light': () => { return import('highlight.js/styles/a11y-light.min.css?raw'); },
    'agate': () => { return import('highlight.js/styles/agate.min.css?raw'); },
    'androidstudio': () => { return import('highlight.js/styles/androidstudio.min.css?raw'); },
    'an-old-hope': () => { return import('highlight.js/styles/an-old-hope.min.css?raw'); },
    'arduino-light': () => { return import('highlight.js/styles/arduino-light.min.css?raw'); },
    'arta': () => { return import('highlight.js/styles/arta.min.css?raw'); },
    'ascetic': () => { return import('highlight.js/styles/ascetic.min.css?raw'); },
    'atom-one-dark': () => { return import('highlight.js/styles/atom-one-dark.min.css?raw'); },
    'atom-one-dark-reasonable': () => { return import('highlight.js/styles/atom-one-dark-reasonable.min.css?raw'); },
    'atom-one-light': () => { return import('highlight.js/styles/atom-one-light.min.css?raw'); },
    'base16/3024': () => { return import('highlight.js/styles/base16/3024.min.css?raw'); },
    'base16/apathy': () => { return import('highlight.js/styles/base16/apathy.min.css?raw'); },
    'base16/apprentice': () => { return import('highlight.js/styles/base16/apprentice.min.css?raw'); },
    'base16/ashes': () => { return import('highlight.js/styles/base16/ashes.min.css?raw'); },
    'base16/atelier-cave-light': () => { return import('highlight.js/styles/base16/atelier-cave-light.min.css?raw'); },
    'base16/atelier-cave': () => { return import('highlight.js/styles/base16/atelier-cave.min.css?raw'); },
    'base16/atelier-dune-light': () => { return import('highlight.js/styles/base16/atelier-dune-light.min.css?raw'); },
    'base16/atelier-dune': () => { return import('highlight.js/styles/base16/atelier-dune.min.css?raw'); },
    'base16/atelier-estuary-light': () => { return import('highlight.js/styles/base16/atelier-estuary-light.min.css?raw'); },
    'base16/atelier-estuary': () => { return import('highlight.js/styles/base16/atelier-estuary.min.css?raw'); },
    'base16/atelier-forest-light': () => { return import('highlight.js/styles/base16/atelier-forest-light.min.css?raw'); },
    'base16/atelier-forest': () => { return import('highlight.js/styles/base16/atelier-forest.min.css?raw'); },
    'base16/atelier-heath-light': () => { return import('highlight.js/styles/base16/atelier-heath-light.min.css?raw'); },
    'base16/atelier-heath': () => { return import('highlight.js/styles/base16/atelier-heath.min.css?raw'); },
    'base16/atelier-lakeside-light': () => { return import('highlight.js/styles/base16/atelier-lakeside-light.min.css?raw'); },
    'base16/atelier-lakeside': () => { return import('highlight.js/styles/base16/atelier-lakeside.min.css?raw'); },
    'base16/atelier-plateau-light': () => { return import('highlight.js/styles/base16/atelier-plateau-light.min.css?raw'); },
    'base16/atelier-plateau': () => { return import('highlight.js/styles/base16/atelier-plateau.min.css?raw'); },
    'base16/atelier-savanna-light': () => { return import('highlight.js/styles/base16/atelier-savanna-light.min.css?raw'); },
    'base16/atelier-savanna': () => { return import('highlight.js/styles/base16/atelier-savanna.min.css?raw'); },
    'base16/atelier-seaside-light': () => { return import('highlight.js/styles/base16/atelier-seaside-light.min.css?raw'); },
    'base16/atelier-seaside': () => { return import('highlight.js/styles/base16/atelier-seaside.min.css?raw'); },
    'base16/atelier-sulphurpool-light': () => { return import('highlight.js/styles/base16/atelier-sulphurpool-light.min.css?raw'); },
    'base16/atelier-sulphurpool': () => { return import('highlight.js/styles/base16/atelier-sulphurpool.min.css?raw'); },
    'base16/atlas': () => { return import('highlight.js/styles/base16/atlas.min.css?raw'); },
    'base16/bespin': () => { return import('highlight.js/styles/base16/bespin.min.css?raw'); },
    'base16/black-metal-bathory': () => { return import('highlight.js/styles/base16/black-metal-bathory.min.css?raw'); },
    'base16/black-metal-burzum': () => { return import('highlight.js/styles/base16/black-metal-burzum.min.css?raw'); },
    'base16/black-metal-dark-funeral': () => { return import('highlight.js/styles/base16/black-metal-dark-funeral.min.css?raw'); },
    'base16/black-metal-gorgoroth': () => { return import('highlight.js/styles/base16/black-metal-gorgoroth.min.css?raw'); },
    'base16/black-metal-immortal': () => { return import('highlight.js/styles/base16/black-metal-immortal.min.css?raw'); },
    'base16/black-metal-khold': () => { return import('highlight.js/styles/base16/black-metal-khold.min.css?raw'); },
    'base16/black-metal-marduk': () => { return import('highlight.js/styles/base16/black-metal-marduk.min.css?raw'); },
    'base16/black-metal-mayhem': () => { return import('highlight.js/styles/base16/black-metal-mayhem.min.css?raw'); },
    'base16/black-metal': () => { return import('highlight.js/styles/base16/black-metal.min.css?raw'); },
    'base16/black-metal-nile': () => { return import('highlight.js/styles/base16/black-metal-nile.min.css?raw'); },
    'base16/black-metal-venom': () => { return import('highlight.js/styles/base16/black-metal-venom.min.css?raw'); },
    'base16/brewer': () => { return import('highlight.js/styles/base16/brewer.min.css?raw'); },
    'base16/bright': () => { return import('highlight.js/styles/base16/bright.min.css?raw'); },
    'base16/brogrammer': () => { return import('highlight.js/styles/base16/brogrammer.min.css?raw'); },
    'base16/brush-trees-dark': () => { return import('highlight.js/styles/base16/brush-trees-dark.min.css?raw'); },
    'base16/brush-trees': () => { return import('highlight.js/styles/base16/brush-trees.min.css?raw'); },
    'base16/chalk': () => { return import('highlight.js/styles/base16/chalk.min.css?raw'); },
    'base16/circus': () => { return import('highlight.js/styles/base16/circus.min.css?raw'); },
    'base16/classic-dark': () => { return import('highlight.js/styles/base16/classic-dark.min.css?raw'); },
    'base16/classic-light': () => { return import('highlight.js/styles/base16/classic-light.min.css?raw'); },
    'base16/codeschool': () => { return import('highlight.js/styles/base16/codeschool.min.css?raw'); },
    'base16/colors': () => { return import('highlight.js/styles/base16/colors.min.css?raw'); },
    'base16/cupcake': () => { return import('highlight.js/styles/base16/cupcake.min.css?raw'); },
    'base16/cupertino': () => { return import('highlight.js/styles/base16/cupertino.min.css?raw'); },
    'base16/danqing': () => { return import('highlight.js/styles/base16/danqing.min.css?raw'); },
    'base16/darcula': () => { return import('highlight.js/styles/base16/darcula.min.css?raw'); },
    'base16/darkmoss': () => { return import('highlight.js/styles/base16/darkmoss.min.css?raw'); },
    'base16/darktooth': () => { return import('highlight.js/styles/base16/darktooth.min.css?raw'); },
    'base16/dark-violet': () => { return import('highlight.js/styles/base16/dark-violet.min.css?raw'); },
    'base16/decaf': () => { return import('highlight.js/styles/base16/decaf.min.css?raw'); },
    'base16/default-dark': () => { return import('highlight.js/styles/base16/default-dark.min.css?raw'); },
    'base16/default-light': () => { return import('highlight.js/styles/base16/default-light.min.css?raw'); },
    'base16/dirtysea': () => { return import('highlight.js/styles/base16/dirtysea.min.css?raw'); },
    'base16/dracula': () => { return import('highlight.js/styles/base16/dracula.min.css?raw'); },
    'base16/edge-dark': () => { return import('highlight.js/styles/base16/edge-dark.min.css?raw'); },
    'base16/edge-light': () => { return import('highlight.js/styles/base16/edge-light.min.css?raw'); },
    'base16/eighties': () => { return import('highlight.js/styles/base16/eighties.min.css?raw'); },
    'base16/embers': () => { return import('highlight.js/styles/base16/embers.min.css?raw'); },
    'base16/equilibrium-dark': () => { return import('highlight.js/styles/base16/equilibrium-dark.min.css?raw'); },
    'base16/equilibrium-gray-dark': () => { return import('highlight.js/styles/base16/equilibrium-gray-dark.min.css?raw'); },
    'base16/equilibrium-gray-light': () => { return import('highlight.js/styles/base16/equilibrium-gray-light.min.css?raw'); },
    'base16/equilibrium-light': () => { return import('highlight.js/styles/base16/equilibrium-light.min.css?raw'); },
    'base16/espresso': () => { return import('highlight.js/styles/base16/espresso.min.css?raw'); },
    'base16/eva-dim': () => { return import('highlight.js/styles/base16/eva-dim.min.css?raw'); },
    'base16/eva': () => { return import('highlight.js/styles/base16/eva.min.css?raw'); },
    'base16/flat': () => { return import('highlight.js/styles/base16/flat.min.css?raw'); },
    'base16/framer': () => { return import('highlight.js/styles/base16/framer.min.css?raw'); },
    'base16/fruit-soda': () => { return import('highlight.js/styles/base16/fruit-soda.min.css?raw'); },
    'base16/gigavolt': () => { return import('highlight.js/styles/base16/gigavolt.min.css?raw'); },
    'base16/github': () => { return import('highlight.js/styles/base16/github.min.css?raw'); },
    'base16/google-dark': () => { return import('highlight.js/styles/base16/google-dark.min.css?raw'); },
    'base16/google-light': () => { return import('highlight.js/styles/base16/google-light.min.css?raw'); },
    'base16/grayscale-dark': () => { return import('highlight.js/styles/base16/grayscale-dark.min.css?raw'); },
    'base16/grayscale-light': () => { return import('highlight.js/styles/base16/grayscale-light.min.css?raw'); },
    'base16/green-screen': () => { return import('highlight.js/styles/base16/green-screen.min.css?raw'); },
    'base16/gruvbox-dark-hard': () => { return import('highlight.js/styles/base16/gruvbox-dark-hard.min.css?raw'); },
    'base16/gruvbox-dark-medium': () => { return import('highlight.js/styles/base16/gruvbox-dark-medium.min.css?raw'); },
    'base16/gruvbox-dark-pale': () => { return import('highlight.js/styles/base16/gruvbox-dark-pale.min.css?raw'); },
    'base16/gruvbox-dark-soft': () => { return import('highlight.js/styles/base16/gruvbox-dark-soft.min.css?raw'); },
    'base16/gruvbox-light-hard': () => { return import('highlight.js/styles/base16/gruvbox-light-hard.min.css?raw'); },
    'base16/gruvbox-light-medium': () => { return import('highlight.js/styles/base16/gruvbox-light-medium.min.css?raw'); },
    'base16/gruvbox-light-soft': () => { return import('highlight.js/styles/base16/gruvbox-light-soft.min.css?raw'); },
    'base16/hardcore': () => { return import('highlight.js/styles/base16/hardcore.min.css?raw'); },
    'base16/harmonic16-dark': () => { return import('highlight.js/styles/base16/harmonic16-dark.min.css?raw'); },
    'base16/harmonic16-light': () => { return import('highlight.js/styles/base16/harmonic16-light.min.css?raw'); },
    'base16/heetch-dark': () => { return import('highlight.js/styles/base16/heetch-dark.min.css?raw'); },
    'base16/heetch-light': () => { return import('highlight.js/styles/base16/heetch-light.min.css?raw'); },
    'base16/helios': () => { return import('highlight.js/styles/base16/helios.min.css?raw'); },
    'base16/hopscotch': () => { return import('highlight.js/styles/base16/hopscotch.min.css?raw'); },
    'base16/horizon-dark': () => { return import('highlight.js/styles/base16/horizon-dark.min.css?raw'); },
    'base16/horizon-light': () => { return import('highlight.js/styles/base16/horizon-light.min.css?raw'); },
    'base16/humanoid-dark': () => { return import('highlight.js/styles/base16/humanoid-dark.min.css?raw'); },
    'base16/humanoid-light': () => { return import('highlight.js/styles/base16/humanoid-light.min.css?raw'); },
    'base16/ia-dark': () => { return import('highlight.js/styles/base16/ia-dark.min.css?raw'); },
    'base16/ia-light': () => { return import('highlight.js/styles/base16/ia-light.min.css?raw'); },
    'base16/icy-dark': () => { return import('highlight.js/styles/base16/icy-dark.min.css?raw'); },
    'base16/ir-black': () => { return import('highlight.js/styles/base16/ir-black.min.css?raw'); },
    'base16/isotope': () => { return import('highlight.js/styles/base16/isotope.min.css?raw'); },
    'base16/kimber': () => { return import('highlight.js/styles/base16/kimber.min.css?raw'); },
    'base16/london-tube': () => { return import('highlight.js/styles/base16/london-tube.min.css?raw'); },
    'base16/macintosh': () => { return import('highlight.js/styles/base16/macintosh.min.css?raw'); },
    'base16/marrakesh': () => { return import('highlight.js/styles/base16/marrakesh.min.css?raw'); },
    'base16/material-darker': () => { return import('highlight.js/styles/base16/material-darker.min.css?raw'); },
    'base16/material-lighter': () => { return import('highlight.js/styles/base16/material-lighter.min.css?raw'); },
    'base16/material': () => { return import('highlight.js/styles/base16/material.min.css?raw'); },
    'base16/material-palenight': () => { return import('highlight.js/styles/base16/material-palenight.min.css?raw'); },
    'base16/material-vivid': () => { return import('highlight.js/styles/base16/material-vivid.min.css?raw'); },
    'base16/materia': () => { return import('highlight.js/styles/base16/materia.min.css?raw'); },
    'base16/mellow-purple': () => { return import('highlight.js/styles/base16/mellow-purple.min.css?raw'); },
    'base16/mexico-light': () => { return import('highlight.js/styles/base16/mexico-light.min.css?raw'); },
    'base16/mocha': () => { return import('highlight.js/styles/base16/mocha.min.css?raw'); },
    'base16/monokai': () => { return import('highlight.js/styles/base16/monokai.min.css?raw'); },
    'base16/nebula': () => { return import('highlight.js/styles/base16/nebula.min.css?raw'); },
    'base16/nord': () => { return import('highlight.js/styles/base16/nord.min.css?raw'); },
    'base16/nova': () => { return import('highlight.js/styles/base16/nova.min.css?raw'); },
    'base16/oceanicnext': () => { return import('highlight.js/styles/base16/oceanicnext.min.css?raw'); },
    'base16/ocean': () => { return import('highlight.js/styles/base16/ocean.min.css?raw'); },
    'base16/onedark': () => { return import('highlight.js/styles/base16/onedark.min.css?raw'); },
    'base16/one-light': () => { return import('highlight.js/styles/base16/one-light.min.css?raw'); },
    'base16/outrun-dark': () => { return import('highlight.js/styles/base16/outrun-dark.min.css?raw'); },
    'base16/papercolor-dark': () => { return import('highlight.js/styles/base16/papercolor-dark.min.css?raw'); },
    'base16/papercolor-light': () => { return import('highlight.js/styles/base16/papercolor-light.min.css?raw'); },
    'base16/paraiso': () => { return import('highlight.js/styles/base16/paraiso.min.css?raw'); },
    'base16/pasque': () => { return import('highlight.js/styles/base16/pasque.min.css?raw'); },
    'base16/phd': () => { return import('highlight.js/styles/base16/phd.min.css?raw'); },
    'base16/pico': () => { return import('highlight.js/styles/base16/pico.min.css?raw'); },
    'base16/pop': () => { return import('highlight.js/styles/base16/pop.min.css?raw'); },
    'base16/porple': () => { return import('highlight.js/styles/base16/porple.min.css?raw'); },
    'base16/qualia': () => { return import('highlight.js/styles/base16/qualia.min.css?raw'); },
    'base16/railscasts': () => { return import('highlight.js/styles/base16/railscasts.min.css?raw'); },
    'base16/rebecca': () => { return import('highlight.js/styles/base16/rebecca.min.css?raw'); },
    'base16/ros-pine-dawn': () => { return import('highlight.js/styles/base16/ros-pine-dawn.min.css?raw'); },
    'base16/ros-pine': () => { return import('highlight.js/styles/base16/ros-pine.min.css?raw'); },
    'base16/ros-pine-moon': () => { return import('highlight.js/styles/base16/ros-pine-moon.min.css?raw'); },
    'base16/sagelight': () => { return import('highlight.js/styles/base16/sagelight.min.css?raw'); },
    'base16/sandcastle': () => { return import('highlight.js/styles/base16/sandcastle.min.css?raw'); },
    'base16/seti-ui': () => { return import('highlight.js/styles/base16/seti-ui.min.css?raw'); },
    'base16/shapeshifter': () => { return import('highlight.js/styles/base16/shapeshifter.min.css?raw'); },
    'base16/silk-dark': () => { return import('highlight.js/styles/base16/silk-dark.min.css?raw'); },
    'base16/silk-light': () => { return import('highlight.js/styles/base16/silk-light.min.css?raw'); },
    'base16/snazzy': () => { return import('highlight.js/styles/base16/snazzy.min.css?raw'); },
    'base16/solar-flare-light': () => { return import('highlight.js/styles/base16/solar-flare-light.min.css?raw'); },
    'base16/solar-flare': () => { return import('highlight.js/styles/base16/solar-flare.min.css?raw'); },
    'base16/solarized-dark': () => { return import('highlight.js/styles/base16/solarized-dark.min.css?raw'); },
    'base16/solarized-light': () => { return import('highlight.js/styles/base16/solarized-light.min.css?raw'); },
    'base16/spacemacs': () => { return import('highlight.js/styles/base16/spacemacs.min.css?raw'); },
    'base16/summercamp': () => { return import('highlight.js/styles/base16/summercamp.min.css?raw'); },
    'base16/summerfruit-dark': () => { return import('highlight.js/styles/base16/summerfruit-dark.min.css?raw'); },
    'base16/summerfruit-light': () => { return import('highlight.js/styles/base16/summerfruit-light.min.css?raw'); },
    'base16/synth-midnight-terminal-dark': () => { return import('highlight.js/styles/base16/synth-midnight-terminal-dark.min.css?raw'); },
    'base16/synth-midnight-terminal-light': () => { return import('highlight.js/styles/base16/synth-midnight-terminal-light.min.css?raw'); },
    'base16/tango': () => { return import('highlight.js/styles/base16/tango.min.css?raw'); },
    'base16/tender': () => { return import('highlight.js/styles/base16/tender.min.css?raw'); },
    'base16/tomorrow': () => { return import('highlight.js/styles/base16/tomorrow.min.css?raw'); },
    'base16/tomorrow-night': () => { return import('highlight.js/styles/base16/tomorrow-night.min.css?raw'); },
    'base16/twilight': () => { return import('highlight.js/styles/base16/twilight.min.css?raw'); },
    'base16/unikitty-dark': () => { return import('highlight.js/styles/base16/unikitty-dark.min.css?raw'); },
    'base16/unikitty-light': () => { return import('highlight.js/styles/base16/unikitty-light.min.css?raw'); },
    'base16/vulcan': () => { return import('highlight.js/styles/base16/vulcan.min.css?raw'); },
    'base16/windows-10-light': () => { return import('highlight.js/styles/base16/windows-10-light.min.css?raw'); },
    'base16/windows-10': () => { return import('highlight.js/styles/base16/windows-10.min.css?raw'); },
    'base16/windows-95-light': () => { return import('highlight.js/styles/base16/windows-95-light.min.css?raw'); },
    'base16/windows-95': () => { return import('highlight.js/styles/base16/windows-95.min.css?raw'); },
    'base16/windows-high-contrast-light': () => { return import('highlight.js/styles/base16/windows-high-contrast-light.min.css?raw'); },
    'base16/windows-high-contrast': () => { return import('highlight.js/styles/base16/windows-high-contrast.min.css?raw'); },
    'base16/windows-nt-light': () => { return import('highlight.js/styles/base16/windows-nt-light.min.css?raw'); },
    'base16/windows-nt': () => { return import('highlight.js/styles/base16/windows-nt.min.css?raw'); },
    'base16/woodland': () => { return import('highlight.js/styles/base16/woodland.min.css?raw'); },
    'base16/xcode-dusk': () => { return import('highlight.js/styles/base16/xcode-dusk.min.css?raw'); },
    'base16/zenburn': () => { return import('highlight.js/styles/base16/zenburn.min.css?raw'); },
    'brown-paper': () => { return import('highlight.js/styles/brown-paper.min.css?raw'); },
    'codepen-embed': () => { return import('highlight.js/styles/codepen-embed.min.css?raw'); },
    'color-brewer': () => { return import('highlight.js/styles/color-brewer.min.css?raw'); },
    'dark': () => { return import('highlight.js/styles/dark.min.css?raw'); },
    'default': () => { return import('highlight.js/styles/default.min.css?raw'); },
    'devibeans': () => { return import('highlight.js/styles/devibeans.min.css?raw'); },
    'docco': () => { return import('highlight.js/styles/docco.min.css?raw'); },
    'far': () => { return import('highlight.js/styles/far.min.css?raw'); },
    'felipec': () => { return import('highlight.js/styles/felipec.min.css?raw'); },
    'foundation': () => { return import('highlight.js/styles/foundation.min.css?raw'); },
    'github-dark-dimmed': () => { return import('highlight.js/styles/github-dark-dimmed.min.css?raw'); },
    'github-dark': () => { return import('highlight.js/styles/github-dark.min.css?raw'); },
    'github': () => { return import('highlight.js/styles/github.min.css?raw'); },
    'gml': () => { return import('highlight.js/styles/gml.min.css?raw'); },
    'googlecode': () => { return import('highlight.js/styles/googlecode.min.css?raw'); },
    'gradient-dark': () => { return import('highlight.js/styles/gradient-dark.min.css?raw'); },
    'gradient-light': () => { return import('highlight.js/styles/gradient-light.min.css?raw'); },
    'grayscale': () => { return import('highlight.js/styles/grayscale.min.css?raw'); },
    'hybrid': () => { return import('highlight.js/styles/hybrid.min.css?raw'); },
    'idea': () => { return import('highlight.js/styles/idea.min.css?raw'); },
    'intellij-light': () => { return import('highlight.js/styles/intellij-light.min.css?raw'); },
    'ir-black': () => { return import('highlight.js/styles/ir-black.min.css?raw'); },
    'isbl-editor-dark': () => { return import('highlight.js/styles/isbl-editor-dark.min.css?raw'); },
    'isbl-editor-light': () => { return import('highlight.js/styles/isbl-editor-light.min.css?raw'); },
    'kimbie-dark': () => { return import('highlight.js/styles/kimbie-dark.min.css?raw'); },
    'kimbie-light': () => { return import('highlight.js/styles/kimbie-light.min.css?raw'); },
    'lightfair': () => { return import('highlight.js/styles/lightfair.min.css?raw'); },
    'lioshi': () => { return import('highlight.js/styles/lioshi.min.css?raw'); },
    'magula': () => { return import('highlight.js/styles/magula.min.css?raw'); },
    'mono-blue': () => { return import('highlight.js/styles/mono-blue.min.css?raw'); },
    'monokai': () => { return import('highlight.js/styles/monokai.min.css?raw'); },
    'monokai-sublime': () => { return import('highlight.js/styles/monokai-sublime.min.css?raw'); },
    'night-owl': () => { return import('highlight.js/styles/night-owl.min.css?raw'); },
    'nnfx-dark': () => { return import('highlight.js/styles/nnfx-dark.min.css?raw'); },
    'nnfx-light': () => { return import('highlight.js/styles/nnfx-light.min.css?raw'); },
    'nord': () => { return import('highlight.js/styles/nord.min.css?raw'); },
    'obsidian': () => { return import('highlight.js/styles/obsidian.min.css?raw'); },
    'panda-syntax-dark': () => { return import('highlight.js/styles/panda-syntax-dark.min.css?raw'); },
    'panda-syntax-light': () => { return import('highlight.js/styles/panda-syntax-light.min.css?raw'); },
    'paraiso-dark': () => { return import('highlight.js/styles/paraiso-dark.min.css?raw'); },
    'paraiso-light': () => { return import('highlight.js/styles/paraiso-light.min.css?raw'); },
    'pojoaque': () => { return import('highlight.js/styles/pojoaque.min.css?raw'); },
    'purebasic': () => { return import('highlight.js/styles/purebasic.min.css?raw'); },
    'qtcreator-dark': () => { return import('highlight.js/styles/qtcreator-dark.min.css?raw'); },
    'qtcreator-light': () => { return import('highlight.js/styles/qtcreator-light.min.css?raw'); },
    'rainbow': () => { return import('highlight.js/styles/rainbow.min.css?raw'); },
    'routeros': () => { return import('highlight.js/styles/routeros.min.css?raw'); },
    'school-book': () => { return import('highlight.js/styles/school-book.min.css?raw'); },
    'shades-of-purple': () => { return import('highlight.js/styles/shades-of-purple.min.css?raw'); },
    'srcery': () => { return import('highlight.js/styles/srcery.min.css?raw'); },
    'stackoverflow-dark': () => { return import('highlight.js/styles/stackoverflow-dark.min.css?raw'); },
    'stackoverflow-light': () => { return import('highlight.js/styles/stackoverflow-light.min.css?raw'); },
    'sunburst': () => { return import('highlight.js/styles/sunburst.min.css?raw'); },
    'tokyo-night-dark': () => { return import('highlight.js/styles/tokyo-night-dark.min.css?raw'); },
    'tokyo-night-light': () => { return import('highlight.js/styles/tokyo-night-light.min.css?raw'); },
    'tomorrow-night-blue': () => { return import('highlight.js/styles/tomorrow-night-blue.min.css?raw'); },
    'tomorrow-night-bright': () => { return import('highlight.js/styles/tomorrow-night-bright.min.css?raw'); },
    'vs2015': () => { return import('highlight.js/styles/vs2015.min.css?raw'); },
    'vs': () => { return import('highlight.js/styles/vs.min.css?raw'); },
    'xcode': () => { return import('highlight.js/styles/xcode.min.css?raw'); },
    'xt256': () => { return import('highlight.js/styles/xt256.min.css?raw'); },
  };
  return loaders[themeName]()
    .then((module) => {
      return module.default;
    })
    .catch((err) => {
      throw new Error(`Failed to load Highlight.js theme CSS: ${err}`);
    });
}

function insertText(newText: string) {
  if (useSimpleEditor.value) {
    const textArea = editor.value as HTMLTextAreaElement;
    textArea.value = textArea.value.slice(0, textArea.selectionStart) + newText + textArea.value.slice(textArea.selectionEnd);
  }
  else {
    const aceEditor = (editor.value as Editor).editor;
    aceEditor.session.remove(aceEditor.getSelectionRange());
    aceEditor.insert(newText);
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
    const aceEditor = (editor.value as Editor).editor;
    const selectedText = aceEditor.session.getTextRange(aceEditor.getSelectionRange());
    const formattedText = before + selectedText + after;
    aceEditor.session.remove(aceEditor.getSelectionRange());
    aceEditor.insert(formattedText);
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
    const aceEditor = (editor.value as Editor).editor;
    const selectedText = aceEditor.session.getTextRange(aceEditor.getSelectionRange());
    const formattedText = CliPrettify.prettify(selectedText);
    aceEditor.session.remove(aceEditor.getSelectionRange());
    aceEditor.insert(formattedText);
  }
}

async function updateRendered() {
  // Render the body
  const renderedFile = await renderMarkdown(text.value);
  const renderedHtml = String(renderedFile);
  const metadata = renderedFile.data.matter;
  const parseError = renderedFile.data.matterParseError;
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

  // We have to update the innerHTML immediately here instead of letting Vue
  // update it reactively, otherwise MathJax will not be able to see the new
  // content.
  renderedContentDiv.value.innerHTML = rendered.value.content;

  // Update the page title
  document.title = `${title.value} | ${import.meta.env.VITE_APP_NAME}`;
}

function loadCustomNoteCss(): Promise<string> {
  return api.getNote('.mory/custom-note.less')
    .then(res => {
      return less.render(res.data, {
        globalVars: {
          'nav-height': '64px',
        },
      });
    })
    .then(output => {
      return output.css;
    });
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
    const aceEditor = editor.value as Editor;
    aceEditor.scrollTo(lineNumber);
  }
}

function nextSiblingHeadingOfSameOrHigherLevel(element: HTMLElement, level: number): { same: HTMLElement | null, higher: HTMLElement | null } {
  let next = element.nextElementSibling;
  while (next) {
    const match = /H([1-6])/.exec(next.tagName);
    if (match) {
      const nextLevel = parseInt(match[1]);
      if (nextLevel === level) {
        return { same: next as HTMLElement, higher: null };
      }
      else if (nextLevel < level) {
        return { same: null, higher: next as HTMLElement };
      }
    }
    next = next.nextElementSibling;
  }
  return { same: null, higher: null };
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

function computeRangeBetween(element1: HTMLElement, element2: HTMLElement | null): [number, number | null] {
  const range: [number, number | null] = [
    computeOffset(element1),
    element2 ? computeOffset(element2) : null,
  ];
  return range;
}

function computeRangeOf(heading: { level: number, href: string }): [number, number | null] {
  const hx = findHeadingElement(heading.level, heading.href);
  let next = nextSiblingHeadingOfSameOrHigherLevel(hx, heading.level);
  const range = computeRangeBetween(hx, next.same || next.higher);
  return range;
}

function highlightVisibleTOCItems() {
  // Heading coverages
  const ranges = [];
  for (const l1Heading of toc.value) {
    ranges.push({ href: l1Heading.href, range: computeRangeOf(l1Heading) })
    for (const l2Heading of l1Heading.children) {
      ranges.push({ href: l2Heading.href, range: computeRangeOf(l2Heading) })
      for (const l3Heading of l2Heading.children) {
        ranges.push({ href: l3Heading.href, range: computeRangeOf(l3Heading) })
      }
    }
  }

  // Highlight visible ranges
  const scrollTop = document.documentElement.scrollTop;
  const clientHeight = document.documentElement.clientHeight;
  const scrollHeight = document.documentElement.scrollHeight;
  const viewportRange = [scrollTop, scrollTop + clientHeight];
  for (const { href, range } of ranges) {
    const target = document.querySelector(`.toc li:has(> a[href="${href}"])`);
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
  const scrollTop = document.documentElement.scrollTop;
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
    document.documentElement.scrollTo({ top: offset, left: 0, behavior: 'auto' });
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
          console.log('Unhandled error: {}', error.response);
          isLoading.value = false;
        }
      }
      else {
        error.value = true;
        errorText.value = error.toString();
        console.log('Unhandled error: {}', error);
        isLoading.value = false;
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
          console.log('Unhandled error: {}', error.response);
          isLoading.value = false;
        }
      }
      else {
        error.value = true;
        errorText.value = error.toString();
        console.log('Unhandled error: {}', error);
        isLoading.value = false;
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
          console.log('Unhandled error: {}', error.response);
        }
      }
      else {
        error.value = true;
        errorText.value = error.toString();
        console.log('Unhandled error: {}', error);
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
            console.log('Unhandled error: {}', error.response);
          }
        }
        else {
          error.value = true;
          errorText.value = error.toString();
          console.log('Unhandled error: {}', error);
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
    // Remove 'mode' query parameter
    const newQuery = { ...route.query };
    delete newQuery.mode;
    router.replace({ query: newQuery });
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
        console.log('Unhandled error: {}', error.response);
        isSaving.value = false;
      }
    }
    else {
      error.value = true;
      errorText.value = error.toString();
      console.log('Unhandled error: {}', error);
      isSaving.value = false;
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
          console.log('Unhandled error: {}', error.response);
          isRenaming.value = false;
        }
      }
      else {
        error.value = true;
        errorText.value = error.toString();
        console.log('Unhandled error: {}', error);
        isRenaming.value = false;
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
$app-bar-height: 48px;
$navigation-drawer-width: 56px;

#editable-viewer {
  position: relative;
}

.toolbar {
  opacity: 0.2;
  transition: opacity 200ms;

  &:hover {
    opacity: 1;
  }
}

.panes {
  width: 100%;
  overflow: hidden;
}

.editor-pane {
  display: flex;
  flex-direction: column;

  border-right: thin solid rgba(0, 0, 0, 0.12);

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
  .metadata-content,
  .rendered-content {
    user-select: text;
  }
}

.editor-pane {
  position: fixed;
  top: $app-bar-height;
  bottom: 0;
  width: 300px;

  transition-duration: 0.2s;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-property: left, width;
}

.viewer-pane {
  transition-duration: 0.2s;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-property: left, width, margin-left;
}

.panes.onlyEditor {
  .editor-pane {
    width: calc(100% - #{$navigation-drawer-width});
  }
  &.mdAndUp .editor-pane {
    width: calc(100% - 300px - #{$navigation-drawer-width});
  }

  .viewer-pane {
    visibility: hidden;
  }
}

.panes.onlyViewer {
  .editor-pane {
    visibility: hidden;
  }

  .viewer-pane {
    width: 100%;
  }
  &.mdAndUp .viewer-pane,
  &.lgAndUp .viewer-pane {
    width: calc(100% - 300px);
  }
}

.panes.both {
  .editor-pane {
    width: 50%;
  }
  &.smAndUp .editor-pane {
    width: calc((100% - #{$navigation-drawer-width}) / 2);
  }
  &.mdAndUp .editor-pane {
    width: calc((100% - 300px - #{$navigation-drawer-width}) / 2);
  }

  .viewer-pane {
    margin-left: 50%;
    width: 50%;
  }
  &.mdAndUp .viewer-pane,
  &.lgAndUp .viewer-pane {
    margin-left: calc((100% - 300px) / 2);
    width: calc((100% - 300px) / 2);
  }
}

.rendered-content {
  width: 100%;
}

.sidebar {
  position: fixed;
  top: $app-bar-height;
  right: 0;
  bottom: 0;
  width: 300px;

  border-left: 1px solid #ccc;
  flex: 0 0;
  background-color: #ffffff;
  overflow-y: auto;

  transition-duration: 0.2s;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-property: right;
  &.smAndDown {
    right: -300px;
  }
}

.toc {
  ol {
    padding-left: 1.5em;
  }
}
</style>
