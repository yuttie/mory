<template>
  <div id="find" class="d-flex flex-column">
    <v-menu
      v-model="showingTagList"
      v-bind:close-on-content-click="false"
      offset-y
      bottom
    >
      <template v-slot:activator="{ on }">
        <v-text-field
          v-model="queryText"
          filled
          rounded
          single-line
          clearable
          prepend-inner-icon="mdi-magnify"
          append-icon="mdi-tag"
          v-on:click:clear="clearQuery"
          v-on:click:append="on.click"
          type="text"
          label="Search"
          autocomplete="off"
          hide-details="auto"
          ref="queryEl"
          class="mx-3 mt-3 flex-grow-0"
        >
        </v-text-field>
      </template>
      <v-card>
        <v-card-text class="all-tags d-flex flex-row align-center flex-wrap">
          <v-chip
            small
            class="ma-1"
            v-for="tag of tags"
            v-bind:key="tag"
            v-bind:color="tagColor(tag)"
            v-bind:outlined="tagOutlined(tag)"
            v-on:click="handleTagClick(tag, $event)"
          >{{ tag }}</v-chip>
        </v-card-text>
      </v-card>
    </v-menu>
    <v-data-table
      v-bind:headers="headers"
      v-bind:items="matchedEntries"
      v-model="selected"
      v-bind:items-per-page="100"
      mobile-breakpoint="0"
      item-key="path"
      hide-default-footer
      sortBy="time"
      sort-desc
      must-sort
      show-select
      class="mt-3 flex-grow-1"
    >
      <template v-slot:top="{ pagination, options, updateOptions }">
        <v-toolbar flat style="border-bottom: thin solid rgba(0, 0, 0, 0.12);">
          <v-btn
            v-bind:disabled="selected.length === 0"
            v-on:click="deleteSelected"
            icon
            color="pink"
          >
            <v-icon>mdi-delete</v-icon>
          </v-btn>
          <v-spacer></v-spacer>
          <v-data-footer
            v-bind:items-per-page-options="[100, 200, 500, 1000, -1]"
            v-bind:pagination="pagination"
            v-bind:options="options"
            v-on:update:options="updateOptions"
            items-per-page-text=""
            style="border: none; flex-wrap: nowrap;"
            ></v-data-footer>
        </v-toolbar>
      </template>
      <template v-slot:item.path="{ item }">
        <span class="path"><v-icon class="mr-1">mdi-file-document-outline</v-icon><router-link v-bind:to="{ path: `/note/${item.path}` }">{{ item.path }}</router-link></span>
      </template>
      <template v-slot:item.time="{ item }">
        <div class="modified text-no-wrap">{{ item.time.format('YYYY-MM-DD HH:mm:ss') }}</div>
      </template>
      <template v-slot:item.size="{ item }">
        <div class="size text-no-wrap">{{ formatFileSize(item.size) }}</div>
      </template>
      <template v-slot:item.mimeType="{ item }">
        <div class="mime-type text-no-wrap">{{ item.mimeType }}</div>
      </template>
      <template v-slot:item.tags="{ item }">
        <div class="tags">
          <v-chip
            small
            class="ma-1"
            v-for="tag of item.tags"
            v-bind:key="tag"
            v-bind:color="tagColor(tag)"
            v-bind:outlined="tagOutlined(tag)"
            v-on:click="handleTagClick(tag, $event)"
            >{{ tag }}</v-chip>
        </div>
      </template>
    </v-data-table>
    <v-overlay v-bind:value="isLoading" z-index="10" opacity="0">
      <v-progress-circular indeterminate color="blue-grey lighten-3" size="64"></v-progress-circular>
    </v-overlay>
    <v-snackbar v-model="error" color="error" top timeout="5000">{{ errorText }}</v-snackbar>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted, defineEmits, defineExpose } from 'vue';
import type { Ref } from 'vue';

import { useRouter, useRoute } from '@/composables/vue-router';

import * as api from '@/api';
import { compareTags } from '@/api';
import type { ListEntry2 } from '@/api';

import dayjs from 'dayjs';

// Emits
const emit = defineEmits<{
  (e: 'tokenExpired', callback: () => void): void;
}>();

// Composables
const router = useRouter();
const route = useRoute();

// Reactive states
const entries: Ref<ListEntry2[]> = ref([]);
const queryText = ref('');
const isLoading = ref(false);
const error = ref(false);
const errorText = ref('');
const selected = ref([] as any[]);
const showingTagList = ref(false);

// Refs
const queryEl = ref(null);

// Computed properties
const headers = computed(() => {
  return [
    { text: 'Path', value: 'path' },
    { text: 'Modified', value: 'time', sort: (a: any, b: any) => a - b },
    { text: 'Size', value: 'size' },
    { text: 'Type', value: 'mimeType' },
    { text: 'Tags', value: 'tags', sortable: false },
  ];
});

const tags = computed(() => {
  const tags = new Set();
  for (const entry of entries.value) {
    if (entry.metadata !== null) {
      if (Object.hasOwn(entry.metadata, 'tags') && Array.isArray(entry.metadata.tags)) {
        for (const tag of entry.metadata.tags.map(String)) {
          tags.add(tag);
        }
      }
    }
  }
  return Array.from(tags).sort(compareTags as (a: any, b: any) => number) as string[];
});

const query = computed(() => {
  const queryPaths = new Set();
  const queryTags = new Set();
  const queryAny = new Set();
  for (const match of queryText.value.matchAll(/"([^"]+)"|([^\s]+)/g)) {
    const text = match[1] || match[2];
    if (text.startsWith('#')) {
      queryTags.add(text.slice(1));
    }
    else if (text.startsWith('/')) {
      queryPaths.add(text.slice(1));
    }
    else {
      queryAny.add(text);
    }
  }

  return {
    paths: queryPaths,
    tags: queryTags,
    any: queryAny,
  };
});

const matchedEntries = computed(() => {
  const matched = [];

  const queryPaths: string[] = [...query.value.paths].map(x => x.toLowerCase());
  const queryTags: string[] = [...query.value.tags].map(x => x.toLowerCase());
  const queryAny: string[] = [...query.value.any].map(x => x.toLowerCase());

  for (const entry of entries.value) {
    const entryPath = entry.path.toLowerCase();
    const entryTags = (() => {
      if (entry.metadata === null) {
        return [];
      }
      else if (!Object.hasOwn(entry.metadata, 'tags')) {
        return [];
      }
      else if (!Array.isArray(entry.metadata.tags)) {
        return [];
      }
      else {
        return entry.metadata.tags.map((tag: any) => String(tag).toLowerCase());
      }
    })();
    // Check if all conditions are met or notl
    if (queryPaths.some(kw => !entryPath.includes(kw))) {
      continue;
    }
    if (queryTags.some(tag => !entryTags.some(entryTag => entryTag.includes(tag)))) {
      continue;
    }
    if (queryAny.some(kw => !entryPath.includes(kw) && !entryTags.some(entryTag => entryTag.includes(kw)))) {
      continue;
    }
    // OK, this entry matches all the queries
    matched.push({
      path: entry.path,
      size: entry.size,
      mimeType: entry.mime_type,
      tags: ((entry.metadata || {}).tags || []).map(String).sort(compareTags),
      time: dayjs(entry.time),
    });
  }

  return matched;
});

// Lifecycle hooks
onMounted(() => {
  document.title = `Find | ${import.meta.env.VITE_APP_NAME}`;

  window.addEventListener('keydown', handleKeydown);

  load();

  if (route.query.q) {
    queryText.value = route.query.q as string;
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});

// Methods
function load() {
  isLoading.value = true;
  api.listNotes()
    .then(res => {
      entries.value = res.data;
      isLoading.value = false;

      // Check if metadata parse errors exist
      for (const entry of entries.value) {
        if (entry.metadata !== null && Object.hasOwn(entry.metadata, 'error')) {
          console.log(`Failed to parse metadata of ${entry.path}!`);
          console.log(entry);
        }
      }
    }).catch(error => {
      if (error.response) {
        if (error.response.status === 401) {
          // Unauthorized
          emit('tokenExpired', () => load());
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

function handleKeydown(e: KeyboardEvent) {
  if (e.key === '/') {
    (queryEl as HTMLInputElement).focus();
    e.preventDefault();
  }
}

function clearQuery(_e: MouseEvent) {
  queryText.value = '';
}

function handleTagClick(tag: string, e: MouseEvent) {
  if (e.ctrlKey) {
    toggleTag(tag);
  }
  else {
    if (query.value.tags.size === 1 && query.value.tags.has(tag)) {
      removeTag(tag);
    }
    else {
      selectSingleTag(tag);
    }
  }
}

function selectSingleTag(tag: string) {
  let hashtag = '#' + tag;
  if (/\s/.test(hashtag)) {
    hashtag = `"${hashtag}"`;
  }

  let queryElems = [...queryText.value.matchAll(/("[^"]+")|([^\s]+)/g)].map(x => x[1] || x[2]);
  queryElems = queryElems.filter(x => x === hashtag || !(x.startsWith('#') || x.startsWith('"#')));
  if (!query.value.tags.has(tag)) {
    queryElems.push(hashtag);
  }
  queryText.value = queryElems.join(' ');
}

function addTag(tag: string) {
  let hashtag = '#' + tag;
  if (/\s/.test(hashtag)) {
    hashtag = `"${hashtag}"`;
  }

  const queryElems = [...queryText.value.matchAll(/("[^"]+")|([^\s]+)/g)].map(x => x[1] || x[2]);
  if (!query.value.tags.has(tag)) {
    queryElems.push(hashtag);
  }

  queryText.value = queryElems.join(' ');
}

function removeTag(tag: string) {
  let hashtag = '#' + tag;
  if (/\s/.test(hashtag)) {
    hashtag = `"${hashtag}"`;
  }

  let queryElems = [...queryText.value.matchAll(/("[^"]+")|([^\s]+)/g)].map(x => x[1] || x[2]);
  queryElems = queryElems.filter(x => x !== hashtag);

  queryText.value = queryElems.join(' ');
}

function toggleTag(tag: string) {
  if (query.value.tags.has(tag)) {
    removeTag(tag);
  }
  else {
    addTag(tag);
  }
}

function tagOutlined(tag: string) {
  const queryTags: string[] = [...query.value.tags].map(x => x.toLowerCase());
  const queryAny: string[] = [...query.value.any].map(x => x.toLowerCase());
  if (queryTags.some(x => tag.toLowerCase().includes(x)) || queryAny.some(x => tag.toLowerCase().includes(x))) {
    return false;
  }
  else {
    return true;
  }
}

function tagColor(tag: string) {
  const queryTags: string[] = [...query.value.tags].map(x => x.toLowerCase());
  const queryAny: string[] = [...query.value.any].map(x => x.toLowerCase());
  if (queryTags.some(x => tag.toLowerCase().includes(x)) || queryAny.some(x => tag.toLowerCase().includes(x))) {
    return 'primary';
  }
  else {
    return 'normal';
  }
}

function formatFileSize(size: number) {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let i = 0;
  while (size >= 0.9 * 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  if (i === 0) {
    return `${size.toFixed(0)} ${units[i]}`;
  }
  else {
    return `${size.toFixed(1)} ${units[i]}`;
  }
}

function deleteSelected() {
  for (const item of selected.value) {
    api.deleteNote(item.path)
      .then(res => {
        if (res.data === true) {
          const i = entries.value.findIndex(e => e.path === item.path);
          entries.value.splice(i, 1);
        }
        else {
          error.value = true;
          errorText.value = `Something wrong happened when deleting ${item.path}`;
        }
      }).catch(error => {
        if (error.response) {
          if (error.response.status === 401) {
            // Unauthorized
            emit('tokenExpired', () => deleteSelected());
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
}

// Watchers
watch(queryText, (q: string | null) => {
  if (q === null) {
    q = '';
    // Workaround: 'clearable' <v-text-field> sets its model to null
    queryText.value = '';
  }
  if (q !== route.query.q) {
    router.replace({
      query: {
        ...route.query,
        q: q,
      },
    });
  }
});

// Expose properties
defineExpose({
  load,
  handleKeydown,
  clearQuery,
  handleTagClick,
  selectSingleTag,
  addTag,
  removeTag,
  toggleTag,
  tagOutlined,
  tagColor,
  formatFileSize,
  deleteSelected,
});
</script>

<style scoped lang="scss">
#find {
  height: 100%;
}

.all-tags {
  max-height: 30em;
  overflow-y: auto;
}

.path,
.modified,
.size,
.mime-type {
  user-select: text;
}

.path {
  white-space: nowrap;

  a {
    color: rgba(0, 0, 0, 0.87);
    text-decoration: none;

    &:hover {
      color: var(--v-anchor-base);
      text-decoration: underline;
    }
  }
}

.tags {
  white-space: nowrap;
}
</style>
