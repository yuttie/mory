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
                Problems found across the whole repository, whichever view would otherwise report them:
                {{ files.entries.length.toLocaleString() }} files checked.
            </p>
            <section
                v-for="section of sections"
                v-bind:key="section.id"
                class="mb-6"
            >
                <h2 class="text-h6 d-flex align-center ga-2">
                    <v-icon
                        v-bind:icon="iconOf(statusOf(section))"
                        v-bind:color="colorOf(statusOf(section))"
                        size="small"
                    />
                    {{ section.title }}
                </h2>
                <p class="text-caption text-medium-emphasis mb-2">
                    {{ section.description }}
                </p>
                <p
                    v-if="checking && section.problems.length === 0"
                    class="text-body-2 text-medium-emphasis"
                >
                    Checking…
                </p>
                <p
                    v-else-if="section.problems.length === 0"
                    class="text-body-2"
                >
                    <span class="text-success font-weight-bold">OK</span> No problems found.
                </p>
                <v-list
                    v-else
                    density="compact"
                    class="py-0"
                >
                    <v-list-item
                        v-for="group of groupsOf(section)"
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
                            <span
                                class="font-weight-bold"
                                v-bind:class="`text-${colorOf(problem.severity)}`"
                            >{{ problem.severity.toUpperCase() }}</span>
                            {{ problem.message }}
                        </div>
                    </v-list-item>
                </v-list>
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
import { eventProblems, frontmatterProblems, taskProblems } from '@/health';
import type { HealthProblem, HealthSeverity } from '@/health';
import { CALENDARS_PATH, useCalendarsStore } from '@/stores/calendars';
import { useFilesStore } from '@/stores/files';
import { usePlansStore } from '@/stores/plans';
import { TASK_SETTINGS_PATH, useTaskSettingsStore } from '@/stores/taskSettings';

interface Section {
    id: string;
    title: string;
    description: string;
    problems: HealthProblem[];
}

type Status = HealthSeverity | 'ok';

const files = useFilesStore();
const calendars = useCalendarsStore();
const taskSettings = useTaskSettingsStore();
const plans = usePlansStore();

const checking = ref(false);
// What could not be read at all, which no store holds a problem for.
const failures = ref<HealthProblem[]>([]);

// The calendar draws a few months at a time; a year either side covers what anyone is planning
// around without expanding every series without end.
const today = dayjs();
const eventWindow = {
    from: today.subtract(1, 'year').format('YYYY-MM-DD'),
    to: today.add(1, 'year').format('YYYY-MM-DD'),
};

const entryOf = computed(() => new Map(files.entries.map((entry) => [entry.path, entry])));

const settingsProblems = computed<HealthProblem[]>(() => {
    const problems: HealthProblem[] = [...failures.value];
    const prefix = `${CALENDARS_PATH}: `;
    for (const message of calendars.errors) {
        // A subscribed feed that failed is named by its calendar, and has no file to open.
        problems.push(message.startsWith(prefix)
            ? { severity: 'error', message: message.slice(prefix.length), path: CALENDARS_PATH }
            : { severity: 'error', message });
    }
    for (const message of taskSettings.problems) {
        problems.push({ severity: 'error', message, path: TASK_SETTINGS_PATH });
    }
    for (const [month, message] of Object.entries(plans.errors)) {
        problems.push({ severity: 'error', message, path: `.mory/plans/${month}.yaml` });
    }
    return problems;
});

const sections = computed<Section[]>(() => [
    {
        id: 'frontmatter',
        title: 'Frontmatter',
        description: 'Whether each note\'s frontmatter is YAML that metadata-schema.json accepts.',
        problems: frontmatterProblems(files.entries),
    },
    {
        id: 'events',
        title: 'Events and task dates',
        description: `Whether the calendar can draw them, from ${eventWindow.from} to ${eventWindow.to}.`,
        problems: eventProblems(files.entries, eventWindow, {
            categories: calendars.categoryMap,
            alarmDefaults: calendars.alarmDefaults,
        }),
    },
    {
        id: 'tasks',
        title: 'Tasks',
        description: 'Whether each file under .tasks/ has its place in the task tree, and holds the current task model.',
        problems: taskProblems(files.entries),
    },
    {
        id: 'settings',
        title: 'Settings and plans',
        description: 'Whether the files under .mory/ read cleanly.',
        problems: settingsProblems.value,
    },
]);

function statusOf(section: Section): Status {
    if (section.problems.some((problem) => problem.severity === 'error')) {
        return 'error';
    }
    return section.problems.length > 0 ? 'warning' : 'ok';
}

function iconOf(status: Status): string {
    return { error: mdiAlertCircle, warning: mdiAlert, ok: mdiCheckCircle }[status];
}

function colorOf(status: Status): string {
    return { error: 'error', warning: 'warning', ok: 'success' }[status];
}

// One row per file, in the order the files are first met, so a note with several problems is one
// link rather than several.
function groupsOf(section: Section): { path?: string; problems: HealthProblem[] }[] {
    const groups = new Map<string | undefined, HealthProblem[]>();
    for (const problem of section.problems) {
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

// Each store keeps what it last read, and reading again is what makes a fix show up here.
async function check(): Promise<void> {
    checking.value = true;
    const next: HealthProblem[] = [];
    await Promise.all([
        files.refresh().catch((error) => {
            next.push({ severity: 'error', message: `The file listing cannot be refreshed: ${error}` });
        }),
        calendars.loadConfiguration().catch((error) => {
            next.push({ severity: 'error', message: `Cannot be read: ${error}`, path: CALENDARS_PATH });
        }),
        taskSettings.load(),
        // Each month that fails is in `plans.errors` already.
        plans.loadAll().catch(() => undefined),
    ]);
    failures.value = next;
    checking.value = false;
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

.problem {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
</style>
