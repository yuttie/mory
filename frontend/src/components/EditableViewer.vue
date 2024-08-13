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
          <div ref="shadowDomRootElement">
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
              class="toc"
            >
              <v-expansion-panel-header>
                Table of Contents
              </v-expansion-panel-header>
              <v-expansion-panel-content>
                <ol class="tree">
                  <li v-for="h1 of toc" v-bind:key="h1.title"><a v-bind:href="h1.href">{{ h1.title }}</a>
                    <ol>
                      <li v-for="h2 of h1.children" v-bind:key="h2.title"><a v-bind:href="h2.href">{{ h2.title }}</a>
                        <ol>
                          <li v-for="h3 of h2.children" v-bind:key="h3.title"><a v-bind:href="h3.href">{{ h3.title }}</a>
                          </li>
                        </ol>
                      </li>
                    </ol>
                  </li>
                </ol>
              </v-expansion-panel-content>
            </v-expansion-panel>
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

import Ajv, { JSONSchemaType, DefinedError } from 'ajv';
import * as api from '@/api';
import { loadConfigValue, saveConfigValue } from '@/config';
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

  document.title = `${title.value} | ${process.env.VUE_APP_NAME}`;

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
async function loadHighlightjsTheme(themeName: string): Promise<string> {
  const loaders = {
    'a11y-dark': () => { return import('!!raw-loader!highlight.js/styles/a11y-dark.css'); },
    'a11y-light': () => { return import('!!raw-loader!highlight.js/styles/a11y-light.css'); },
    'agate': () => { return import('!!raw-loader!highlight.js/styles/agate.css'); },
    'an-old-hope': () => { return import('!!raw-loader!highlight.js/styles/an-old-hope.css'); },
    'androidstudio': () => { return import('!!raw-loader!highlight.js/styles/androidstudio.css'); },
    'arduino-light': () => { return import('!!raw-loader!highlight.js/styles/arduino-light.css'); },
    'arta': () => { return import('!!raw-loader!highlight.js/styles/arta.css'); },
    'ascetic': () => { return import('!!raw-loader!highlight.js/styles/ascetic.css'); },
    'atelier-cave-dark': () => { return import('!!raw-loader!highlight.js/styles/atelier-cave-dark.css'); },
    'atelier-cave-light': () => { return import('!!raw-loader!highlight.js/styles/atelier-cave-light.css'); },
    'atelier-dune-dark': () => { return import('!!raw-loader!highlight.js/styles/atelier-dune-dark.css'); },
    'atelier-dune-light': () => { return import('!!raw-loader!highlight.js/styles/atelier-dune-light.css'); },
    'atelier-estuary-dark': () => { return import('!!raw-loader!highlight.js/styles/atelier-estuary-dark.css'); },
    'atelier-estuary-light': () => { return import('!!raw-loader!highlight.js/styles/atelier-estuary-light.css'); },
    'atelier-forest-dark': () => { return import('!!raw-loader!highlight.js/styles/atelier-forest-dark.css'); },
    'atelier-forest-light': () => { return import('!!raw-loader!highlight.js/styles/atelier-forest-light.css'); },
    'atelier-heath-dark': () => { return import('!!raw-loader!highlight.js/styles/atelier-heath-dark.css'); },
    'atelier-heath-light': () => { return import('!!raw-loader!highlight.js/styles/atelier-heath-light.css'); },
    'atelier-lakeside-dark': () => { return import('!!raw-loader!highlight.js/styles/atelier-lakeside-dark.css'); },
    'atelier-lakeside-light': () => { return import('!!raw-loader!highlight.js/styles/atelier-lakeside-light.css'); },
    'atelier-plateau-dark': () => { return import('!!raw-loader!highlight.js/styles/atelier-plateau-dark.css'); },
    'atelier-plateau-light': () => { return import('!!raw-loader!highlight.js/styles/atelier-plateau-light.css'); },
    'atelier-savanna-dark': () => { return import('!!raw-loader!highlight.js/styles/atelier-savanna-dark.css'); },
    'atelier-savanna-light': () => { return import('!!raw-loader!highlight.js/styles/atelier-savanna-light.css'); },
    'atelier-seaside-dark': () => { return import('!!raw-loader!highlight.js/styles/atelier-seaside-dark.css'); },
    'atelier-seaside-light': () => { return import('!!raw-loader!highlight.js/styles/atelier-seaside-light.css'); },
    'atelier-sulphurpool-dark': () => { return import('!!raw-loader!highlight.js/styles/atelier-sulphurpool-dark.css'); },
    'atelier-sulphurpool-light': () => { return import('!!raw-loader!highlight.js/styles/atelier-sulphurpool-light.css'); },
    'atom-one-dark-reasonable': () => { return import('!!raw-loader!highlight.js/styles/atom-one-dark-reasonable.css'); },
    'atom-one-dark': () => { return import('!!raw-loader!highlight.js/styles/atom-one-dark.css'); },
    'atom-one-light': () => { return import('!!raw-loader!highlight.js/styles/atom-one-light.css'); },
    'brown-paper': () => { return import('!!raw-loader!highlight.js/styles/brown-paper.css'); },
    'codepen-embed': () => { return import('!!raw-loader!highlight.js/styles/codepen-embed.css'); },
    'color-brewer': () => { return import('!!raw-loader!highlight.js/styles/color-brewer.css'); },
    'darcula': () => { return import('!!raw-loader!highlight.js/styles/darcula.css'); },
    'dark': () => { return import('!!raw-loader!highlight.js/styles/dark.css'); },
    'default': () => { return import('!!raw-loader!highlight.js/styles/default.css'); },
    'docco': () => { return import('!!raw-loader!highlight.js/styles/docco.css'); },
    'dracula': () => { return import('!!raw-loader!highlight.js/styles/dracula.css'); },
    'far': () => { return import('!!raw-loader!highlight.js/styles/far.css'); },
    'foundation': () => { return import('!!raw-loader!highlight.js/styles/foundation.css'); },
    'github-gist': () => { return import('!!raw-loader!highlight.js/styles/github-gist.css'); },
    'github': () => { return import('!!raw-loader!highlight.js/styles/github.css'); },
    'gml': () => { return import('!!raw-loader!highlight.js/styles/gml.css'); },
    'googlecode': () => { return import('!!raw-loader!highlight.js/styles/googlecode.css'); },
    'gradient-dark': () => { return import('!!raw-loader!highlight.js/styles/gradient-dark.css'); },
    'gradient-light': () => { return import('!!raw-loader!highlight.js/styles/gradient-light.css'); },
    'grayscale': () => { return import('!!raw-loader!highlight.js/styles/grayscale.css'); },
    'gruvbox-dark': () => { return import('!!raw-loader!highlight.js/styles/gruvbox-dark.css'); },
    'gruvbox-light': () => { return import('!!raw-loader!highlight.js/styles/gruvbox-light.css'); },
    'hopscotch': () => { return import('!!raw-loader!highlight.js/styles/hopscotch.css'); },
    'hybrid': () => { return import('!!raw-loader!highlight.js/styles/hybrid.css'); },
    'idea': () => { return import('!!raw-loader!highlight.js/styles/idea.css'); },
    'ir-black': () => { return import('!!raw-loader!highlight.js/styles/ir-black.css'); },
    'isbl-editor-dark': () => { return import('!!raw-loader!highlight.js/styles/isbl-editor-dark.css'); },
    'isbl-editor-light': () => { return import('!!raw-loader!highlight.js/styles/isbl-editor-light.css'); },
    'kimbie.dark': () => { return import('!!raw-loader!highlight.js/styles/kimbie.dark.css'); },
    'kimbie.light': () => { return import('!!raw-loader!highlight.js/styles/kimbie.light.css'); },
    'lightfair': () => { return import('!!raw-loader!highlight.js/styles/lightfair.css'); },
    'lioshi': () => { return import('!!raw-loader!highlight.js/styles/lioshi.css'); },
    'magula': () => { return import('!!raw-loader!highlight.js/styles/magula.css'); },
    'mono-blue': () => { return import('!!raw-loader!highlight.js/styles/mono-blue.css'); },
    'monokai-sublime': () => { return import('!!raw-loader!highlight.js/styles/monokai-sublime.css'); },
    'monokai': () => { return import('!!raw-loader!highlight.js/styles/monokai.css'); },
    'night-owl': () => { return import('!!raw-loader!highlight.js/styles/night-owl.css'); },
    'nnfx-dark': () => { return import('!!raw-loader!highlight.js/styles/nnfx-dark.css'); },
    'nnfx': () => { return import('!!raw-loader!highlight.js/styles/nnfx.css'); },
    'nord': () => { return import('!!raw-loader!highlight.js/styles/nord.css'); },
    'obsidian': () => { return import('!!raw-loader!highlight.js/styles/obsidian.css'); },
    'ocean': () => { return import('!!raw-loader!highlight.js/styles/ocean.css'); },
    'paraiso-dark': () => { return import('!!raw-loader!highlight.js/styles/paraiso-dark.css'); },
    'paraiso-light': () => { return import('!!raw-loader!highlight.js/styles/paraiso-light.css'); },
    'pojoaque': () => { return import('!!raw-loader!highlight.js/styles/pojoaque.css'); },
    'purebasic': () => { return import('!!raw-loader!highlight.js/styles/purebasic.css'); },
    'qtcreator_dark': () => { return import('!!raw-loader!highlight.js/styles/qtcreator_dark.css'); },
    'qtcreator_light': () => { return import('!!raw-loader!highlight.js/styles/qtcreator_light.css'); },
    'railscasts': () => { return import('!!raw-loader!highlight.js/styles/railscasts.css'); },
    'rainbow': () => { return import('!!raw-loader!highlight.js/styles/rainbow.css'); },
    'routeros': () => { return import('!!raw-loader!highlight.js/styles/routeros.css'); },
    'school-book': () => { return import('!!raw-loader!highlight.js/styles/school-book.css'); },
    'shades-of-purple': () => { return import('!!raw-loader!highlight.js/styles/shades-of-purple.css'); },
    'solarized-dark': () => { return import('!!raw-loader!highlight.js/styles/solarized-dark.css'); },
    'solarized-light': () => { return import('!!raw-loader!highlight.js/styles/solarized-light.css'); },
    'srcery': () => { return import('!!raw-loader!highlight.js/styles/srcery.css'); },
    'stackoverflow-dark': () => { return import('!!raw-loader!highlight.js/styles/stackoverflow-dark.css'); },
    'stackoverflow-light': () => { return import('!!raw-loader!highlight.js/styles/stackoverflow-light.css'); },
    'sunburst': () => { return import('!!raw-loader!highlight.js/styles/sunburst.css'); },
    'tomorrow-night-blue': () => { return import('!!raw-loader!highlight.js/styles/tomorrow-night-blue.css'); },
    'tomorrow-night-bright': () => { return import('!!raw-loader!highlight.js/styles/tomorrow-night-bright.css'); },
    'tomorrow-night-eighties': () => { return import('!!raw-loader!highlight.js/styles/tomorrow-night-eighties.css'); },
    'tomorrow-night': () => { return import('!!raw-loader!highlight.js/styles/tomorrow-night.css'); },
    'tomorrow': () => { return import('!!raw-loader!highlight.js/styles/tomorrow.css'); },
    'vs': () => { return import('!!raw-loader!highlight.js/styles/vs.css'); },
    'vs2015': () => { return import('!!raw-loader!highlight.js/styles/vs2015.css'); },
    'xcode': () => { return import('!!raw-loader!highlight.js/styles/xcode.css'); },
    'xt256': () => { return import('!!raw-loader!highlight.js/styles/xt256.css'); },
    'zenburn': () => { return import('!!raw-loader!highlight.js/styles/zenburn.css'); },
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
  document.title = `${title.value} | ${process.env.VUE_APP_NAME}`;
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

function handleDocumentScroll() {
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
      const offset = el.offsetTop;
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
      const offset = el.offsetTop;
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
          const anchor = document.querySelector(anchorSelector);
          if (anchor) {
            anchor.scrollIntoView();
          }
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

function editorHasFocus(): boolean {
  if (useSimpleEditor.value) {
    const textarea = editor.value;
    return document.activeElement === textarea;
  }
  else {
    const textarea = (editor.value as Editor).$el.querySelector('textarea');
    return document.activeElement === textarea;
  }
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
  ).then(res => {
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
    ).then(res => {
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
