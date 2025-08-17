<template>
  <div id="home">
    <v-card
      v-for="category of sortedCategorizedEntries.entries()"
      v-bind:key="category[0]"
      class="ma-5"
      outlined
    >
      <v-card-title>{{ category[0] }}</v-card-title>
      <v-card-text>
        <div class="text-center mb-3">
          <v-btn
            text
            x-small
            v-on:click="changeSortOrder(category[0], 'title')"
          ><v-icon x-small v-if="sortOrders.get(category[0])[0] === 'title'">{{ sortOrders.get(category[0])[1] ? mdiSortDescending : mdiSortAscending }}</v-icon>sort by title</v-btn>
          <v-btn
            text
            x-small
            v-on:click="changeSortOrder(category[0], 'time')"
          ><v-icon x-small v-if="sortOrders.get(category[0])[0] === 'time'">{{ sortOrders.get(category[0])[1] ? mdiSortDescending : mdiSortAscending }}</v-icon>sort by time</v-btn>
        </div>
        <ul>
          <li
            v-for="entry of category[1]"
            v-bind:key="entry.path"
          >
            <router-link v-bind:to="{ name: 'Note', params: { path: entry.path } }">{{ entry.title || entry.path }}</router-link>
            <span class="age ml-1">({{ formatDistanceToNow(parseISO(entry.time)) }})</span>
          </li>
        </ul>
      </v-card-text>
    </v-card>
    <v-overlay v-bind:value="isLoading" z-index="10" opacity="0">
      <v-progress-circular indeterminate color="blue-grey lighten-3" size="64"></v-progress-circular>
    </v-overlay>
    <v-snackbar v-model="error" color="error" top timeout="5000">{{ errorText }}</v-snackbar>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue';
import type { Ref } from 'vue';

import {
    mdiSortAscending,
    mdiSortDescending,
} from '@mdi/js';

import * as api from '@/api';
import type { ListEntry2 } from '@/api';
import { by } from '@/utils';

import { formatDistanceToNow, parseISO } from 'date-fns';

// Emits
const emit = defineEmits<{
  (e: 'tokenExpired', callback: () => void): void;
}>();

// Reactive states
const entries: Ref<ListEntry2[]> = ref([]);
const isLoading = ref(false);
const error = ref(false);
const errorText = ref('');
const sortOrders: Ref<Map<string, [string, boolean]>> = ref(new Map());

// Computed properties
const sortedCategorizedEntries = computed(() => {
  // Copy the unsorted map
  const categorized: Map<string, ListEntry2[]> = new Map(
    Array.from(categorizedEntries.value, ([cat, entries]) => [cat, [...entries]])
  );

  for (const [category, entries] of categorized) {
    // Default value
    if (!sortOrders.value.has(category)) {
      sortOrders.value.set(category, ['title', false]);
    }

    const [kind, descending] = sortOrders.value.get(category);
    if (kind === 'title') {
      sortByTitle(entries, descending);
    }
    else if (kind === 'time') {
      sortByTime(entries, descending);
    }
  }

  return categorized;
});
const categorizedEntries = computed(() => {
  // Categorize entries
  const categorized: Map<string, ListEntry2[]> = new Map();
  for (const entry of entries.value) {
    if (entry.metadata !== null) {
      if (Object.hasOwn(entry.metadata, 'tags') && Array.isArray(entry.metadata.tags)) {
        for (const tag of entry.metadata.tags.map(String)) {
          const match = tag.match(/^home:(.+)$/);
          if (match) {
            const category = match[1];
            if (!categorized.has(category)) {
              categorized.set(category, []);
            }
            categorized.get(category)!.push(entry);
          }
        }
      }
    }
  }

  return categorized;
});

// Lifecycle hooks
onMounted(() => {
  document.title = `Home | ${import.meta.env.VITE_APP_NAME}`;

  load();
});

// Methods
function load() {
  isLoading.value = true;
  api.listNotes()
    .then(res => {
      entries.value = res.data;
      isLoading.value = false;
    }).catch(error => {
      if (error.response) {
        if (error.response.status === 401) {
          // Unauthorized
          emit('tokenExpired', () => load());
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

function sortByTitle(entries: ListEntry2[], descending: boolean = false) {
  if (descending) {
    entries.sort((a, b) => -by((entry) => entry.title)(a, b));
  }
  else {
    entries.sort(by((entry) => entry.title));
  }
}

function sortByTime(entries: ListEntry2[], descending: boolean = false) {
  if (descending) {
    entries.sort((a, b) => -by((entry) => parseISO(entry.time))(a, b));
  }
  else {
    entries.sort(by((entry) => parseISO(entry.time)));
  }
}

function changeSortOrder(category: string, kind: strig) {
  // Copy the map
  const newSortOrders = new Map(sortOrders.value);

  const [curKind, curDescending] = newSortOrders.get(category);
  if (kind === curKind) {
    newSortOrders.set(category, [kind, !curDescending]);
  }
  else {
    newSortOrders.set(category, [kind, curDescending]);
  }

  sortOrders.value = newSortOrders;
}
</script>

<style scoped lang="scss">
#home {
  user-select: text;
}
</style>
