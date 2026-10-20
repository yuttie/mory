<template>
    <div id="health">
        <AppBarContent>
            <v-toolbar-title class="ms-3">
                Health
            </v-toolbar-title>
            <v-icon-btn
                v-bind:icon="mdiReload"
                v-bind:loading="checking"
                title="Check again"
                class="me-2"
                v-on:click="check"
            />
        </AppBarContent>
        <v-sheet class="sheet pa-4">
            <p class="text-body-2 text-medium-emphasis mb-4">
                What is verified across the whole repository, whichever view would otherwise report a
                problem: {{ files.entries.length.toLocaleString() }} files checked.
            </p>
            <v-alert
                v-if="listingError !== null"
                type="error"
                density="compact"
                class="mb-4"
            >
                The file listing cannot be refreshed, so the checks below cover only the
                {{ files.entries.length.toLocaleString() }} files listed before: {{ listingError }}
            </v-alert>
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
                        v-if="checking && item.problems.length === 0"
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
import { computed, onMounted, ref } from 'vue';

import {
    mdiAlert,
    mdiAlertCircle,
    mdiCheckCircle,
    mdiReload,
} from '@mdi/js';

import dayjs from 'dayjs';

import AppBarContent from '@/components/AppBarContent.vue';
import { routeForMime } from '@/file-route';
import { eventChecks, frontmatterChecks, guardChecks, planMonthOf, settingsChecks, taskChecks } from '@/health';
import type { HealthCheck, HealthProblem, HealthSeverity } from '@/health';
import { CALENDARS_PATH, useCalendarsStore } from '@/stores/calendars';
import { useFilesStore } from '@/stores/files';
import { usePlansStore } from '@/stores/plans';
import { TASK_SETTINGS_PATH, useTaskSettingsStore } from '@/stores/taskSettings';

interface Section {
    id: string;
    title: string;
    checks: HealthCheck[];
}

type Status = HealthSeverity | 'ok';

const files = useFilesStore();
const calendars = useCalendarsStore();
const taskSettings = useTaskSettingsStore();
const plans = usePlansStore();

const checking = ref(false);
// What could not be read at all, which no store holds a problem for.
const listingError = ref<string | null>(null);
const calendarsReadError = ref<string | null>(null);

// The calendar draws a few months at a time; a year either side covers what anyone is planning
// around without expanding every series without end.
const today = dayjs();
const eventWindow = {
    from: today.subtract(1, 'year').format('YYYY-MM-DD'),
    to: today.add(1, 'year').format('YYYY-MM-DD'),
};

const planPaths = computed(() => files.entries
    .map((entry) => entry.path)
    .filter((path) => path.startsWith('.mory/plans/')));

const entryOf = computed(() => new Map(files.entries.map((entry) => [entry.path, entry])));

const sections = computed<Section[]>(() => [
    {
        id: 'frontmatter',
        title: 'Frontmatter',
        checks: guardChecks('frontmatter', 'Frontmatter can be checked', () => frontmatterChecks(files.entries)),
    },
    {
        id: 'events',
        title: `Events and task dates, ${eventWindow.from} to ${eventWindow.to}`,
        checks: guardChecks('events', 'Events and task dates can be checked', () => eventChecks(files.entries, eventWindow, {
            categories: calendars.categoryMap,
            alarmDefaults: calendars.alarmDefaults,
        })),
    },
    {
        id: 'tasks',
        title: 'Tasks',
        checks: guardChecks('tasks', 'Tasks can be checked', () => taskChecks(files.entries)),
    },
    {
        id: 'settings',
        title: 'Settings and plans',
        checks: guardChecks('settings', 'Settings and plans can be checked', () => settingsChecks({
            calendarsPath: CALENDARS_PATH,
            calendarErrors: calendarsReadError.value === null
                ? calendars.errors
                : [`${CALENDARS_PATH}: It cannot be read: ${calendarsReadError.value}`, ...calendars.errors],
            tasksPath: TASK_SETTINGS_PATH,
            taskSettingsProblems: taskSettings.problems,
            planPaths: planPaths.value,
            planErrors: plans.errors,
        })),
    },
]);

function statusOf(checks: readonly HealthCheck[]): Status {
    const problems = checks.flatMap((item) => item.problems);
    if (problems.some((problem) => problem.severity === 'error')) {
        return 'error';
    }
    return problems.length > 0 ? 'warning' : 'ok';
}

function iconOf(status: Status): string {
    return { error: mdiAlertCircle, warning: mdiAlert, ok: mdiCheckCircle }[status];
}

function colorOf(status: Status): string {
    return { error: 'error', warning: 'warning', ok: 'success' }[status];
}

function countOf(item: HealthCheck): string {
    const count = groupsOf(item).length;
    return count === 1 ? '1 file' : `${count.toLocaleString()} files`;
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

// Each store keeps what it last read, and reading again is what makes a fix show up here. Every
// read is caught on its own: one that fails leaves the checks on what the others found, and the
// page says so rather than staying in its checking state.
async function check(): Promise<void> {
    checking.value = true;
    listingError.value = null;
    calendarsReadError.value = null;
    await Promise.all([
        files.refresh().catch((error) => {
            listingError.value = String(error);
        }).then(readPlans),
        calendars.loadConfiguration().catch((error) => {
            calendarsReadError.value = String(error);
        }),
        // Never rejects: the store reports a file it cannot read among its problems.
        taskSettings.load(),
    ]);
    checking.value = false;
}

// Each listed month on its own, after the listing that names them: the store's own `loadAll` stops
// at the first month it cannot read, and the months after it would read as clean. A month that
// fails is in `plans.errors`.
async function readPlans(): Promise<void> {
    for (const path of planPaths.value) {
        const month = planMonthOf(path);
        if (month !== null) {
            await plans.loadMonths([month]).catch(() => undefined);
        }
    }
}

onMounted(() => {
    document.title = `Health | ${import.meta.env.VITE_APP_NAME}`;
    check();
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
