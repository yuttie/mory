<!-- Nothing may sit beside the root element, a comment included: a development build keeps template
     comments as nodes, and beside a second root node the attributes and listeners a list puts on a
     task -- `draggable`, `variant`, its pointer handlers -- would reach neither. -->
<template>
    <v-card
        class="task-list-item"
        v-bind:to="to"
        v-bind:class="{ 'text-disabled': !urgency.actionable }"
        v-bind:style="{ backgroundColor: ground }"
    >
        <div class="title">
            <span class="status-icon">
                <v-icon v-bind:color="color">
                    {{ icon }}
                </v-icon>
            </span>
            <span
                class="title-text"
                v-bind:class="{ strikethrough: canceled }"
            >{{ value.title || 'Untitled' }}</span>
        </div>
        <div
            v-if="ancestorTitles.length > 0"
            class="ancestors"
        >
            <v-icon>{{ mdiFileTreeOutline }}</v-icon>
            {{ ancestorTitles.join(' › ') }}
        </div>
        <div
            v-if="tags.length > 0"
            class="tags"
        >
            <v-icon>{{ mdiTagOutline }}</v-icon>
            <span
                v-for="tag of tags"
                v-bind:key="tag"
                class="tag"
            >{{ tag }}</span>
        </div>
        <TaskDateCues v-bind:value="value" />
        <v-chip size="x-small">
            {{ URGENCY_LABEL[urgency.level] }}
        </v-chip>
        <span v-if="progress !== undefined">{{ Math.round(progress) }}%</span>
        <span
            v-if="plans.missedCount(value.uuid) >= 3"
            class="text-warning"
        >Consider splitting or re-rating importance ({{ plans.missedCount(value.uuid) }} missed days)</span>
        <span
            v-if="urgency.short_window"
            class="text-warning"
        >Window shorter than lead time</span>
        <slot />
    </v-card>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { RouteLocationRaw } from 'vue-router';

import {
    mdiFileTreeOutline,
    mdiTagOutline,
} from '@mdi/js';

import type { StatusKind, UUID } from '@/task';
import type { TaskNode } from '@/task-forest';
import { useTasksStore } from '@/stores/tasks';
import { URGENCY_LABEL } from '@/urgency';
import { usePlansStore } from '@/stores/plans';
import { useTaskSettingsStore } from '@/stores/taskSettings';
import { statusColor, statusGround } from '@/status-color';
import { statusIcon } from '@/status-icon';

import TaskDateCues from '@/components/TaskDateCues.vue';

// Props
const props = defineProps<{
    value: TaskNode;
    // Where choosing the task goes. The item is a link to it, so a task can be opened in a new tab
    // or its address copied, as from the tree.
    to: RouteLocationRaw;
    // The task whose descendants the list holds, if it holds only those.
    listRoot?: UUID;
    // The status the list files the task under, where it knows better than the note: a task just
    // dropped in another column is drawn there before its note is written, and drawn as its new
    // status there.
    status?: StatusKind;
}>();

// Stores
const store = useTasksStore();
const plans = usePlansStore();
const taskSettings = useTaskSettingsStore();
const urgency = computed(() => store.urgency(props.value.uuid));
const progress = computed(() => store.progress(props.value.uuid));

// Computed properties
// A list gathers tasks from anywhere in the tree, and a title alone often does not say which
// project it belongs to: "Write the report" could be under any of them.
const ancestorTitles = computed<string[]>(() => {
    return store.ancestorsOf(props.value.uuid, props.listRoot).map((node) => node.title || 'Untitled');
});

const tags = computed<string[]>(() => {
    return props.value.metadata?.tags ?? [];
});

const kind = computed(() => props.status ?? props.value.metadata?.task?.status?.kind);

// The status as the task tree draws it: the same icon in the same colour, beside the title.
const icon = computed<string>(() => {
    return statusIcon(kind.value, store.childrenOf(props.value.uuid).length > 0);
});

const color = computed<string | undefined>(() => {
    return statusColor(kind.value, taskSettings.resolvedStatusColors);
});

// Tinted by the task's status, in the colour of its icon.
const ground = computed<string | undefined>(() => {
    return statusGround(kind.value, taskSettings.resolvedStatusColors);
});

const canceled = computed<boolean>(() => {
    return kind.value === 'canceled';
});
</script>

<style scoped lang="scss">
.task-list-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 8px;
    font-size: 14px;
    word-break: break-all;
}
.title {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    font-size: 1.2em;
}
/* One line of the title tall, so the icon is centred on the first line however many the title
   wraps onto. */
.status-icon {
    display: flex;
    align-items: center;
    height: 1lh;
}
.title-text {
    font-weight: bold;
}
.tag {
    color: #888;
    background: #fafafa;
    padding: 1px 2px;
    border: 1px solid #eee;
    margin-right: 3px;
}
.strikethrough {
    text-decoration-line: line-through;
}
.ancestors {
    font-size: 12px;
    color: #888;
}
</style>
