<template>
    <div id="health">
        <AppBarContent>
            <v-toolbar-title class="ms-3">
                Health
            </v-toolbar-title>
            <v-icon-btn
                v-bind:icon="mdiReload"
                v-bind:loading="busy"
                title="Check again"
                class="me-2"
                v-on:click="check"
            />
        </AppBarContent>
        <v-sheet class="sheet pa-4">
            <p class="text-body-2 text-medium-emphasis mb-4">
                What is verified across the whole repository, whichever view would otherwise report a
                problem<span v-if="checkedAt !== null">: {{ fileCount.toLocaleString() }} files checked at
                    {{ dayjs(checkedAt).format('YYYY-MM-DD HH:mm') }}</span>.
            </p>
            <v-alert
                v-if="listingError !== null"
                type="error"
                density="compact"
                class="mb-4"
            >
                <template v-if="checked">
                    The file listing cannot be refreshed, so nothing else was read again either: the
                    checks below are the last recorded.
                </template>
                <template v-else>
                    The file listing cannot be refreshed, so nothing could be checked.
                </template>
                <div class="text-caption">
                    {{ listingError }}
                </div>
            </v-alert>
            <p
                v-if="!checked && listingError === null"
                class="text-body-2 text-medium-emphasis"
            >
                {{ busy ? 'Checking…' : 'Not checked yet.' }}
            </p>
            <section
                v-for="section of sections"
                v-bind:key="section.id"
                class="mb-6"
            >
                <h2 class="text-h6 d-flex align-center ga-2 mb-2">
                    <v-icon
                        v-bind:icon="iconOf(statusOf(section.checks))"
                        v-bind:color="colorOf(statusOf(section.checks))"
                        size="small"
                    />
                    {{ section.title }}
                </h2>
                <div
                    v-for="item of section.checks"
                    v-bind:key="item.id"
                    class="check d-flex mb-3"
                >
                    <span
                        v-if="checking"
                        class="label text-body-2 text-medium-emphasis"
                    >…</span>
                    <span
                        v-else
                        class="label text-body-2 font-weight-bold"
                        v-bind:class="`text-${colorOf(statusOf([item]))}`"
                    >{{ statusOf([item]).toUpperCase() }}</span>
                    <div class="body">
                        <div class="text-body-2">
                            <span class="font-weight-medium">{{ item.title }}</span>
                            <span
                                v-if="item.problems.length > 0"
                                class="text-medium-emphasis ms-1"
                            >({{ countOf(item) }})</span>
                        </div>
                        <div class="text-caption text-medium-emphasis">
                            {{ item.description }}
                        </div>
                        <v-list
                            v-if="item.problems.length > 0"
                            density="compact"
                            class="py-0"
                        >
                            <v-list-item
                                v-for="group of groupsOf(item)"
                                v-bind:key="group.path ?? ''"
                                v-bind:to="group.path === undefined ? undefined : routeOf(group.path)"
                                class="px-0 py-1"
                            >
                                <v-list-item-title
                                    v-if="group.path !== undefined"
                                    class="font-weight-medium"
                                >
                                    {{ titleOf(group.path) }}
                                    <span
                                        v-if="titleOf(group.path) !== group.path"
                                        class="text-caption text-medium-emphasis"
                                    >{{ group.path }}</span>
                                </v-list-item-title>
                                <div
                                    v-for="(problem, index) of group.problems"
                                    v-bind:key="index"
                                    class="problem text-body-2"
                                >
                                    {{ problem.message }}
                                </div>
                            </v-list-item>
                        </v-list>
                    </div>
                </div>
            </section>
        </v-sheet>
    </div>
</template>

<script lang="ts" setup>
import { computed, onMounted } from 'vue';

import {
    mdiAlert,
    mdiAlertCircle,
    mdiCheckCircle,
    mdiReload,
} from '@mdi/js';

import dayjs from 'dayjs';
import { storeToRefs } from 'pinia';

import AppBarContent from '@/components/AppBarContent.vue';
import { routeForMime } from '@/file-route';
import { statusOf } from '@/health';
import type { HealthCheck, HealthProblem, HealthStatus } from '@/health';
import { useFilesStore } from '@/stores/files';
import { useHealthStore } from '@/stores/health';

const files = useFilesStore();
const health = useHealthStore();
const { busy, checked, checkedAt, checking, fileCount, listingError, sections } = storeToRefs(health);

const entryOf = computed(() => new Map(files.entries.map((entry) => [entry.path, entry])));

function iconOf(status: HealthStatus): string {
    return { error: mdiAlertCircle, warning: mdiAlert, ok: mdiCheckCircle }[status];
}

function colorOf(status: HealthStatus): string {
    return { error: 'error', warning: 'warning', ok: 'success' }[status];
}

// Files where the problems have them, and problems where some belong to no file, such as a feed:
// three dead feeds are not one file.
function countOf(item: HealthCheck): string {
    const plural = (count: number, noun: string) => `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
    return item.problems.every((problem) => problem.path !== undefined)
        ? plural(groupsOf(item).length, 'file')
        : plural(item.problems.length, 'problem');
}

// One row per file, in the order the files are first met, so a note with several problems is one
// link rather than several.
function groupsOf(item: HealthCheck): { path?: string; problems: HealthProblem[] }[] {
    const groups = new Map<string | undefined, HealthProblem[]>();
    for (const problem of item.problems) {
        const group = groups.get(problem.path);
        if (group === undefined) {
            groups.set(problem.path, [problem]);
        }
        else {
            group.push(problem);
        }
    }
    return [...groups].map(([path, problems]) => ({ path, problems }));
}

function titleOf(path: string): string {
    return entryOf.value.get(path)?.title ?? path;
}

function routeOf(path: string) {
    return routeForMime(path, entryOf.value.get(path)?.mime_type ?? 'text/markdown');
}

// The button's loading state stops a click but not Enter or Space on it; the store runs a check
// asked for while one runs once that one ends.
function check(): void {
    void health.check();
}

// Opening the page shows what was last recorded, and checks only what no tab has checked yet; the
// button checks again regardless.
onMounted(() => {
    document.title = `Health | ${import.meta.env.VITE_APP_NAME}`;
    void health.checkIfStale();
});
</script>

<style scoped lang="scss">
#health {
    height: 100%;
}

.sheet {
    min-height: 100%;
}

// A column of its own, so a title that wraps stays clear of it, as Neovim indents a check's advice.
.label {
    flex: 0 0 5.5em;
}

.body {
    flex: 1 1 auto;
    min-width: 0;
}

.problem {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
</style>
