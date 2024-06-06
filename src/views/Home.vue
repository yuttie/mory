<template>
  <div id="home">
    <v-card
      v-for="category of categorizedEntries.entries()"
      v-bind:key="category[0]"
      class="ma-5"
      outlined
    >
      <v-card-title>{{ category[0] }}</v-card-title>
      <v-card-text>
        <ul>
          <li
            v-for="entry of category[1]"
            v-bind:key="entry.path"
            ><router-link v-bind:to="{ name: 'Note', params: { path: entry.path } }">{{ entry.path }}</router-link></li>
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
import { ref, computed, watch, onMounted, onUnmounted, nextTick, defineProps, defineEmits, defineExpose } from 'vue';
import type { Ref } from 'vue';

import { useRouter, useRoute } from '@/composables/vue-router';
import { useVuetify } from '@/composables/vuetify';

import * as api from '@/api';
import { ListEntry } from '@/api';
import Color from 'color';
import materialColors from 'vuetify/lib/util/colors';
import XXH from 'xxhashjs';

// Emits
const emit = defineEmits<{
  (e: 'tokenExpired', callback: () => void): void;
}>();

// Reactive states
const entries: ListEntry[] = ref([]);
const isLoading = ref(false);
const error = ref(false);
const errorText = ref('');

// Computed properties
const categorizedEntries = computed(() => {
  const categorized: Map<string, ListEntry[]> = new Map();
  for (const entry of entries.value) {
    if (entry.metadata !== null) {
      if (Object.prototype.hasOwnProperty.call(entry.metadata, 'tags') && Array.isArray(entry.metadata.tags)) {
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
  document.title = `Home | ${process.env.VUE_APP_NAME}`;

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

// Expose properties
defineExpose({
  load,
});
</script>

<style scoped lang="scss">
#home {
  user-select: text;
}
</style>
