<template>
    <div
        id="search"
        class="d-flex flex-column"
    >
        <v-sheet class="pt-13 pb-3 px-3">
            <v-form v-on:submit.prevent="submit">
                <div class="d-flex ga-2 align-start">
                    <v-text-field
                        ref="queryEl"
                        v-model="draftQuery"
                        variant="filled"
                        rounded
                        single-line
                        clearable
                        type="text"
                        label="Search"
                        autocomplete="off"
                        hide-details="auto"
                        class="flex-grow-1"
                        v-on:click:clear="clearQuery"
                        v-on:keydown.enter="submitFromKeyboard"
                    />
                    <v-select
                        v-model="draftMode"
                        v-bind:items="modeItems"
                        item-title="title"
                        item-value="value"
                        label="Mode"
                        variant="filled"
                        hide-details
                        class="mode-select"
                    />
                </div>
            </v-form>
            <p class="text-caption text-medium-emphasis mt-2 mb-0">
                {{ modeHelp }}
            </p>
            <p
                v-if="draftMode !== 'grep'"
                class="text-caption text-medium-emphasis mb-0"
            >
                Syntax: terms, <code>"phrases"</code>, <code>+required</code>, <code>-excluded</code>,
                and <code>path:</code>, <code>title:</code>, or <code>body:</code> filters.
            </p>
        </v-sheet>

        <v-sheet class="px-3 pb-2">
            <v-alert
                v-if="statusMessage"
                v-bind:type="statusType"
                variant="tonal"
                density="compact"
                class="mb-2"
            >
                {{ statusMessage }}
            </v-alert>
            <v-alert
                v-for="warning of response?.warnings ?? []"
                v-bind:key="warning.code"
                type="warning"
                variant="tonal"
                density="compact"
                class="mb-2"
            >
                {{ warning.message }}
            </v-alert>
        </v-sheet>

        <v-list
            class="flex-grow-1 overflow-y-auto"
            lines="three"
        >
            <v-list-item
                v-for="item of response?.hits ?? []"
                v-bind:key="`${item.path}:${item.passage_id}`"
                v-bind:to="routeForMime(item.path, item.mime_type)"
            >
                <v-list-item-title>{{ item.title || item.path }}</v-list-item-title>
                <v-list-item-subtitle class="result-meta">
                    {{ item.path }}<template v-if="lineLabel(item)">
                        · {{ lineLabel(item) }}
                    </template>
                    · {{ item.sources.join(' + ') }}
                </v-list-item-subtitle>
                <div
                    v-if="item.content_kind === 'image_description'"
                    class="text-caption text-warning mb-1"
                >
                    AI-generated image description
                </div>
                <div class="result-snippet">
                    {{ item.snippet }}
                </div>
            </v-list-item>
            <v-list-item v-if="hasSearched && !isLoading && response?.hits.length === 0">
                <v-list-item-title>No results</v-list-item-title>
            </v-list-item>
        </v-list>

        <v-overlay
            v-bind:model-value="isLoading"
            z-index="10"
            scrim="transparent"
            class="align-center justify-center"
        >
            <v-progress-circular
                indeterminate
                color="blue-grey-lighten-3"
                size="64"
            />
        </v-overlay>
        <v-snackbar
            v-model="showError"
            color="error"
            location="top"
            timeout="5000"
        >
            {{ errorText }}
        </v-snackbar>
    </div>
</template>

<script lang="ts" setup>
/* global AbortController, clearTimeout, document, HTMLElement, KeyboardEvent, setTimeout, window */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Ref } from 'vue';
import axios from 'axios';
import { useRoute, useRouter } from 'vue-router';

import type {
    SearchHit,
    SearchMode,
    SearchResponse,
    SearchStatusResponse,
} from '@/api';
import { routeForMime } from '@/file-route';
import { useFilesStore } from '@/stores/files';

const emit = defineEmits<{
    (e: 'tokenExpired', callback: () => void): void;
}>();

const router = useRouter();
const route = useRoute();
const files = useFilesStore();

const modeItems: { title: string, value: SearchMode }[] = [
    { title: 'Grep', value: 'grep' },
    { title: 'Text', value: 'text' },
    { title: 'Semantic', value: 'semantic' },
    { title: 'Hybrid', value: 'hybrid' },
];
const validModes = new Set<SearchMode>(modeItems.map((item) => item.value));
const draftQuery = ref('');
const draftMode = ref<SearchMode>('text');
const committedQuery = ref('');
const committedMode = ref<SearchMode>('text');
const response: Ref<SearchResponse | null> = ref(null);
const status: Ref<SearchStatusResponse | null> = ref(null);
const isLoading = ref(false);
const hasSearched = ref(false);
const showError = ref(false);
const errorText = ref('');
const queryEl = ref<{ focus: () => void } | null>(null);

let requestGeneration = 0;
let statusRequestGeneration = 0;
let requestController: AbortController | null = null;
let statusController: AbortController | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let mounted = false;
let lastReadyGeneration: string | null = null;
let waitingGeneration: string | null = null;
let lastSemanticState: SearchStatusResponse['semantic']['state'] | null = null;

const modeHelp = computed(() => ({
    grep: 'Regular-expression search across every text file, including raw YAML syntax.',
    text: 'Fast local ranked search across Markdown outside .mory/, plus indexed image descriptions.',
    semantic: 'Meaning-based Markdown and image-description search. Content and this query are sent to OpenAI when enabled.',
    hybrid: 'Combines local ranked Text results with Semantic similarity; falls back to Text when Semantic is unavailable.',
})[draftMode.value]);

const statusMessage = computed(() => {
    const current = status.value ?? response.value;
    if (current === null) {
        return '';
    }
    if (current.lexical.state === 'updating') {
        return 'The local Text index is updating.';
    }
    if (current.lexical.state === 'error') {
        return current.lexical.message ?? 'The local Text index encountered an error and will retry.';
    }
    if (committedMode.value === 'semantic' && current.semantic.state === 'disabled') {
        return 'Semantic search is disabled by the server administrator.';
    }
    if (['semantic', 'hybrid'].includes(committedMode.value) && current.semantic.state === 'indexing') {
        return `Semantic indexing: ${current.semantic.indexed} of ${current.semantic.total} passages ready`;
    }
    if (current.semantic.failed > 0 && ['semantic', 'hybrid'].includes(committedMode.value)) {
        return `${current.semantic.failed} passages could not be embedded; coverage is partial.`;
    }
    return '';
});

const statusType = computed(() => {
    const current = status.value ?? response.value;
    return current?.lexical.state === 'error' || current?.semantic.state === 'error' ? 'error' : 'info';
});

onMounted(() => {
    mounted = true;
    document.title = `Search | ${import.meta.env.VITE_APP_NAME}`;
    window.addEventListener('keydown', handleKeydown);
    pollStatus();
});

onUnmounted(() => {
    mounted = false;
    window.removeEventListener('keydown', handleKeydown);
    requestController?.abort();
    statusController?.abort();
    requestGeneration += 1;
    statusRequestGeneration += 1;
    if (pollTimer !== null) {
        clearTimeout(pollTimer);
    }
});

function submit(): void {
    const query = draftQuery.value?.trim() ?? '';
    if (query === committedQuery.value && draftMode.value === committedMode.value) {
        execute();
        pollStatus();
        return;
    }
    router.push({ query: query ? { q: query, mode: draftMode.value } : { mode: draftMode.value } });
}

function submitFromKeyboard(event: KeyboardEvent): void {
    if (event.isComposing) {
        return;
    }
    event.preventDefault();
    submit();
}

function clearQuery(): void {
    draftQuery.value = '';
    router.push({ query: { mode: draftMode.value } });
}

function modeFromRoute(value: unknown): SearchMode {
    return typeof value === 'string' && validModes.has(value as SearchMode)
        ? value as SearchMode
        : 'text';
}

async function execute(): Promise<void> {
    const query = committedQuery.value;
    const generation = ++requestGeneration;
    if (query === '') {
        requestController?.abort();
        response.value = null;
        hasSearched.value = false;
        isLoading.value = false;
        return;
    }
    requestController?.abort();
    requestController = new AbortController();
    response.value = null;
    isLoading.value = true;
    hasSearched.value = true;
    try {
        const found = await files.search({ query, mode: committedMode.value, limit: 50 }, requestController.signal);
        if (generation === requestGeneration) {
            response.value = found;
        }
    }
    catch (error: unknown) {
        if (axios.isCancel(error) || generation !== requestGeneration) {
            return;
        }
        if (axios.isAxiosError(error) && error.response?.status === 401) {
            emit('tokenExpired', execute);
            return;
        }
        const code = axios.isAxiosError(error)
            ? (error.response?.data as { code?: string } | undefined)?.code
            : undefined;
        if (code === 'lexical_index_updating' || code === 'semantic_index_updating') {
            pollStatus();
        }
        showError.value = true;
        errorText.value = axios.isAxiosError(error)
            ? (error.response?.data as { message?: string } | undefined)?.message ?? error.message
            : String(error);
    }
    finally {
        if (generation === requestGeneration) {
            isLoading.value = false;
        }
    }
}

async function pollStatus(): Promise<void> {
    if (!mounted) {
        return;
    }
    if (pollTimer !== null) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
    statusController?.abort();
    statusController = new AbortController();
    const generation = ++statusRequestGeneration;
    try {
        const next = await files.searchStatus(statusController.signal);
        if (generation !== statusRequestGeneration || !mounted) {
            return;
        }
        const wasReady = lastReadyGeneration;
        const previousSemanticState = lastSemanticState;
        status.value = next;
        let shouldRerun = false;
        const selectedReady = next.lexical.state === 'ready' && next.lexical.indexed_commit === next.commit;
        if (selectedReady) {
            lastReadyGeneration = next.commit;
            if ((waitingGeneration === next.commit || (wasReady !== null && wasReady !== next.commit))
                && committedQuery.value !== '') {
                shouldRerun = true;
            }
            waitingGeneration = null;
        }
        else if (next.lexical.state === 'updating') {
            waitingGeneration = next.commit;
        }
        lastSemanticState = next.semantic.state;
        if (previousSemanticState === 'indexing' && next.semantic.state === 'ready'
            && ['semantic', 'hybrid'].includes(committedMode.value) && committedQuery.value !== '') {
            shouldRerun = true;
        }
        if (shouldRerun) {
            execute();
        }
        const active = next.lexical.state === 'updating'
            || (next.semantic.state === 'indexing' && ['semantic', 'hybrid'].includes(committedMode.value));
        if (active && mounted) {
            pollTimer = setTimeout(pollStatus, 2000);
        }
    }
    catch (error: unknown) {
        if (!axios.isCancel(error) && generation === statusRequestGeneration && mounted) {
            pollTimer = setTimeout(pollStatus, 2000);
        }
    }
}

function handleKeydown(event: KeyboardEvent): void {
    const target = event.target;
    const isEditing = target instanceof HTMLElement
        && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName));
    if (event.key === '/' && !isEditing) {
        queryEl.value?.focus();
        event.preventDefault();
    }
}

function lineLabel(hit: SearchHit): string {
    if (hit.start_line === undefined) {
        return '';
    }
    return hit.end_line !== undefined && hit.end_line !== hit.start_line
        ? `lines ${hit.start_line}–${hit.end_line}`
        : `line ${hit.start_line}`;
}

watch(
    () => [route.query.q, route.query.mode] as const,
    ([query, mode]) => {
        const nextQuery = typeof query === 'string' ? query : '';
        const nextMode = modeFromRoute(mode);
        draftQuery.value = nextQuery;
        draftMode.value = nextMode;
        committedQuery.value = nextQuery;
        committedMode.value = nextMode;
        execute();
        if (mounted) {
            pollStatus();
        }
    },
    { immediate: true },
);

watch(draftMode, (mode) => {
    if (mode !== committedMode.value) {
        router.push({
            query: committedQuery.value === ''
                ? { mode }
                : { q: committedQuery.value, mode },
        });
    }
});
</script>

<style scoped lang="scss">
#search {
    height: 100%;
}

.mode-select {
    max-width: 10rem;
}

.result-meta {
    opacity: 0.75;
}

.result-snippet {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
</style>
