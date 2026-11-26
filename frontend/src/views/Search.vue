<template>
    <div
        id="search"
        class="d-flex flex-column"
    >
        <AppBarContent>
            <v-form
                class="flex-grow-1 ms-2 me-1"
                v-on:submit.prevent="submit"
            >
                <div class="d-flex ga-2 align-center">
                    <v-text-field
                        ref="queryEl"
                        v-model="draftQuery"
                        variant="solo"
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
                        variant="outlined"
                        hide-details
                        class="mode-select"
                    />
                </div>
            </v-form>
        </AppBarContent>
        <v-sheet class="pb-3 px-3">
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
                v-if="errorText"
                type="error"
                variant="tonal"
                closable
                class="mb-2"
                v-on:click:close="errorText = ''"
            >
                {{ errorText }}
            </v-alert>
            <v-alert
                v-if="statusMessage"
                v-bind:type="statusType"
                variant="tonal"
                class="mb-2"
            >
                {{ statusMessage }}
            </v-alert>
            <v-alert
                v-for="warning of response?.warnings ?? []"
                v-bind:key="warning.code"
                type="warning"
                variant="tonal"
                class="mb-2"
            >
                {{ warning.message }}
            </v-alert>
        </v-sheet>

        <!-- No v-list: a passage is text to select, so a click in one focuses what holds it, and
             a v-list then takes the arrow keys, with Shift or without, to move to its first or
             last link. -->
        <div class="results flex-grow-1 overflow-y-auto">
            <ol
                v-if="groups.length > 0"
                class="result-list"
            >
                <li
                    v-for="group of groups"
                    v-bind:key="group.path"
                    v-bind:aria-label="group.title || group.path"
                    class="result-group"
                >
                    <v-list-item
                        v-bind:to="routeForMime(group.path, group.mimeType)"
                        lines="two"
                        class="result-header"
                    >
                        <v-list-item-title class="result-title">
                            {{ group.title || group.path }}
                        </v-list-item-title>
                        <v-list-item-subtitle class="result-meta">
                            {{ group.path }}
                        </v-list-item-subtitle>
                    </v-list-item>
                    <div
                        v-for="item of group.hits"
                        v-bind:key="item.passage_id"
                        class="result-passage"
                    >
                        <v-list-item-subtitle class="result-meta">
                            <template v-if="lineLabel(item)">
                                {{ lineLabel(item) }} ·
                            </template>
                            {{ item.sources.join(' + ') }}
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
                    </div>
                </li>
            </ol>
            <v-list-item
                v-else-if="hasSearched && !isLoading && response?.hits.length === 0"
                title="No results"
            />
        </div>

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
    </div>
</template>

<script lang="ts" setup>
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
import AppBarContent from '@/components/AppBarContent.vue';
import { isInOverlay, isTyping, useShortcuts } from '@/keyboard';

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
const MODE_NAVIGATION_STATE = 'morySearchModeNavigation';
const draftQuery = ref('');
const draftMode = ref<SearchMode>('text');
const committedQuery = ref('');
const committedMode = ref<SearchMode>('text');
const response: Ref<SearchResponse | null> = ref(null);
const status: Ref<SearchStatusResponse | null> = ref(null);
const isLoading = ref(false);
const hasSearched = ref(false);
const errorText = ref('');
const queryEl = ref<{ focus: () => void } | null>(null);

let requestGeneration = 0;
let statusRequestGeneration = 0;
let requestController: AbortController | null = null;
let statusController: AbortController | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let mounted = false;
let lastReadyGeneration: string | null = null;
let waitingGeneration: { commit: string, request: number } | null = null;
let waitingForIndexRequest: number | null = null;
let lastSemanticState: SearchStatusResponse['semantic']['state'] | null = null;
let rerunWhenIdle = false;
let lastStatusErrorText: string | null = null;
let nextModeNavigation = 0;
const pendingModeNavigations = new Set<number>();

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
    if (['semantic', 'hybrid'].includes(committedMode.value)) {
        // An image that was not described is missing from semantic search as a passage that was
        // not embedded is, but what went wrong differs, so they are counted apart.
        const { failed, failed_images: failedImages } = current.semantic;
        const gaps = [
            failed > 0 ? `${failed} ${failed === 1 ? 'passage' : 'passages'} could not be embedded` : '',
            failedImages > 0 ? `${failedImages} ${failedImages === 1 ? 'image' : 'images'} could not be described` : '',
        ].filter((gap) => gap !== '');
        if (gaps.length > 0) {
            return `${gaps.join(' and ')}; coverage is partial.`;
        }
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
    pollStatus();
});

onUnmounted(() => {
    mounted = false;
    requestController?.abort();
    statusController?.abort();
    requestGeneration += 1;
    statusRequestGeneration += 1;
    if (pollTimer !== null) {
        clearTimeout(pollTimer);
    }
});

useShortcuts(handleKeydown);

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
    errorText.value = '';
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
            emit('tokenExpired', () => {
                if (mounted) {
                    execute();
                }
            });
            return;
        }
        const code = axios.isAxiosError(error)
            ? (error.response?.data as { code?: string } | undefined)?.code
            : undefined;
        if (code === 'lexical_index_updating' || code === 'semantic_index_updating') {
            waitingForIndexRequest = generation;
            pollStatus();
        }
        errorText.value = axios.isAxiosError(error)
            ? (error.response?.data as { message?: string } | undefined)?.message ?? error.message
            : String(error);
    }
    finally {
        if (generation === requestGeneration) {
            isLoading.value = false;
            const shouldRerun = rerunWhenIdle && responseNeedsStatusRefresh();
            rerunWhenIdle = false;
            if (shouldRerun) {
                execute();
            }
        }
    }
}

function responseNeedsStatusRefresh(): boolean {
    const current = status.value;
    if (current === null || committedQuery.value === '') {
        return false;
    }
    const selectedReady = current.lexical.state === 'ready'
        && current.lexical.indexed_commit === current.commit;
    if (committedMode.value !== 'grep' && selectedReady && response.value?.commit !== current.commit) {
        return true;
    }
    return ['semantic', 'hybrid'].includes(committedMode.value)
        && current.semantic.state === 'ready'
        && response.value?.semantic.state !== 'ready';
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
        if (lastStatusErrorText !== null && errorText.value === lastStatusErrorText) {
            errorText.value = '';
        }
        lastStatusErrorText = null;
        let shouldRerun = false;
        const selectedReady = next.lexical.state === 'ready' && next.lexical.indexed_commit === next.commit;
        const responseMatchesGeneration = response.value?.commit === next.commit;
        if (selectedReady) {
            lastReadyGeneration = next.commit;
            if (committedMode.value !== 'grep'
                && (waitingForIndexRequest === requestGeneration
                || (waitingGeneration?.commit === next.commit
                    && waitingGeneration.request === requestGeneration)
                || (wasReady !== null && wasReady !== next.commit && !responseMatchesGeneration))
                && committedQuery.value !== '') {
                shouldRerun = true;
            }
            waitingForIndexRequest = null;
            waitingGeneration = null;
        }
        else if (next.lexical.state === 'updating' && committedMode.value !== 'grep') {
            waitingGeneration = { commit: next.commit, request: requestGeneration };
        }
        lastSemanticState = next.semantic.state;
        if (previousSemanticState === 'indexing' && next.semantic.state === 'ready'
            && ['semantic', 'hybrid'].includes(committedMode.value) && committedQuery.value !== ''
            && (!responseMatchesGeneration || response.value?.semantic.state !== 'ready')) {
            shouldRerun = true;
        }
        if (shouldRerun) {
            if (isLoading.value) {
                rerunWhenIdle = true;
            }
            else {
                execute();
            }
        }
        const active = next.lexical.state === 'updating'
            || (next.semantic.state === 'indexing' && ['semantic', 'hybrid'].includes(committedMode.value));
        if (active && mounted) {
            pollTimer = setTimeout(pollStatus, 2000);
        }
    }
    catch (error: unknown) {
        if (axios.isCancel(error) || generation !== statusRequestGeneration || !mounted) {
            return;
        }
        if (axios.isAxiosError(error) && error.response?.status === 401) {
            emit('tokenExpired', pollStatus);
            return;
        }
        const message = axios.isAxiosError(error)
            ? (error.response?.data as { message?: string } | undefined)?.message ?? error.message
            : String(error);
        lastStatusErrorText = message;
        errorText.value = message;
        const semanticIndexing = status.value?.semantic.state === 'indexing'
            && ['semantic', 'hybrid'].includes(committedMode.value);
        if ((waitingForIndexRequest === requestGeneration
            || waitingGeneration?.request === requestGeneration
            || semanticIndexing) && mounted) {
            pollTimer = setTimeout(pollStatus, 2000);
        }
    }
}

function handleKeydown(event: KeyboardEvent): void {
    if (isTyping(event) || isInOverlay(event)) {
        return;
    }
    if (event.key === '/') {
        queryEl.value?.focus();
        event.preventDefault();
    }
}

interface ResultGroup {
    path: string;
    title: string | undefined;
    mimeType: string;
    hits: SearchHit[];
}

// Each note once, with its passages under it. A note stands where its best passage ranked, and
// its passages keep the order moried ranked them in, so the grouping reorders nothing but what
// would otherwise interleave with another note's.
const groups = computed<ResultGroup[]>(() => {
    const byPath = new Map<string, ResultGroup>();
    for (const hit of response.value?.hits ?? []) {
        let group = byPath.get(hit.path);
        if (group === undefined) {
            group = { path: hit.path, title: hit.title, mimeType: hit.mime_type, hits: [] };
            byPath.set(hit.path, group);
        }
        group.title ||= hit.title;
        group.hits.push(hit);
    }
    return [...byPath.values()];
});

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
        const navigation = window.history.state?.[MODE_NAVIGATION_STATE];
        const preserveDraft = typeof navigation === 'number'
            && pendingModeNavigations.delete(navigation);
        if (!preserveDraft) {
            draftQuery.value = nextQuery;
        }
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
        const navigation = ++nextModeNavigation;
        pendingModeNavigations.add(navigation);
        router.push({
            query: committedQuery.value === ''
                ? { mode }
                : { q: committedQuery.value, mode },
            state: { [MODE_NAVIGATION_STATE]: navigation },
        }).then((failure) => {
            if (failure !== undefined) {
                pendingModeNavigations.delete(navigation);
            }
        }).catch(() => {
            pendingModeNavigations.delete(navigation);
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

    // A phone's app bar has little room for the two, and the query needs it more than a mode name.
    @media (max-width: 599px) {
        max-width: 7rem;
    }
}

// Drawn as the v-list the results were in, and not as a v-sheet: the custom CSS a repository sets
// may restyle every sheet, and the results never were one.
.results {
    padding: 8px var(--mory-list-inset);
    background: rgba(var(--v-theme-surface));
    color: color-mix(in srgb, rgb(var(--v-theme-on-surface)) calc(var(--v-high-emphasis-opacity) * 100%), transparent);
}

.result-list {
    list-style: none;
    margin: 0;
    padding: 0;
}

.result-group:not(:last-child) {
    margin-bottom: 30px;
}

// A passage is for reading and copying, so it opts back into the selection App.vue turns off. It
// ends where its header's row does.
.result-passage {
    user-select: text;
    max-height: 300px;
    overflow: hidden;
    padding-inline: 32px var(--mory-row-inset);
}

.result-title {
    font-size: 1.5em;
}

.result-meta {
    opacity: 0.75;
}

.result-snippet {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
</style>
