<template>
    <div id="search" class="d-flex flex-column">
        <div class="mx-3 mt-15 d-flex flex-row align-center" style="gap: 1em;">
            <v-text-field
                v-model="queryText"
                filled
                rounded
                single-line
                clearable
                v-on:click:clear="clearQuery"
                type="text"
                label="Search"
                autocomplete="off"
                hide-details="auto"
                ref="queryEl"
                class="flex-grow-1"
            >
            </v-text-field>
            <v-btn v-on:click="search" class="flex-grow-0 align-self-middle">Search</v-btn>
        </div>
        <ul>
            <li v-for="item of results">
                <router-link v-bind:to="{ name: 'Note', params: { path: item.file } }">{{ item.file }}</router-link>
                <span>{{ item.number }}</span>
                <span>{{ item.content.slice(0, 100) }}</span>
            </li>
        </ul>
        <v-overlay v-bind:value="isLoading" z-index="10" opacity="0">
            <v-progress-circular indeterminate color="blue-grey lighten-3" size="64"></v-progress-circular>
        </v-overlay>
        <v-snackbar v-model="error" color="error" top timeout="5000">{{ errorText }}</v-snackbar>
    </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import type { Ref } from 'vue';

import { useRoute, useRouter } from 'vue-router/composables';

import {
} from '@mdi/js';

import * as api from '@/api';

// Emits
const emit = defineEmits<{
    (e: 'tokenExpired', callback: () => void): void;
}>();

// Composables
const router = useRouter();
const route = useRoute();

// Reactive states
const results: Ref<{ file: string, line: number, content: string }[]> = ref([]);
const queryText = ref('');
const isLoading = ref(false);
const error = ref(false);
const errorText = ref('');

// Template Refs
const queryEl = ref(null);

// Lifecycle hooks
onMounted(() => {
    document.title = `Search | ${import.meta.env.VITE_APP_NAME}`;

    window.addEventListener('keydown', handleKeydown);

    if (route.query.q) {
        queryText.value = route.query.q as string;
    }
});

onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown);
});

// Methods
function search() {
    isLoading.value = true;
    results.value = [];
    api.searchNotes(queryText.value)
        .then(res => {
            console.log(res);
            results.value = res.data;
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

function handleKeydown(e: KeyboardEvent) {
    if (e.key === '/') {
        (queryEl as HTMLInputElement).focus();
        e.preventDefault();
    }
}

function clearQuery(_e: MouseEvent) {
    queryText.value = '';
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
</script>

<style scoped lang="scss">
#search {
    height: 100%;
}
</style>
