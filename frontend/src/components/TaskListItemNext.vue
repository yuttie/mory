<!-- Nothing may sit beside the root element, a comment included: a development build keeps template
     comments as nodes, and a second root node leaves vuedraggable unable to tell which task the
     dragged element is, so the status view drops nothing. -->
<template>
    <router-link
        v-bind:to="to"
        class="task-list-item"
        v-bind:class="{ 'text-disabled': !urgency.actionable }"
    >
        <v-icon class="mr-1">
            {{ done ? mdiCheckboxMarkedOutline : canceled ? mdiCheckboxBlankOffOutline : mdiCheckboxBlankOutline }}
        </v-icon>
        <div>
            <span
                class="tag"
                v-for="tag of value.metadata?.tags ?? []"
                v-bind:key="tag"
            >{{ tag }}</span>
            <span class="title-text" v-bind:class="{ strikethrough: canceled }">{{ value.title || 'Untitled' }}</span>
            <TaskDateCues v-bind:value="value" />
            <v-chip size="x-small" class="ml-1">{{ URGENCY_LABEL[urgency.level] }}</v-chip>
            <span v-if="progress !== undefined" class="ml-1">{{ Math.round(progress) }}%</span>
            <span v-if="plans.missedCount(value.uuid) >= 3" class="ml-1 text-warning">Consider splitting or re-rating importance ({{ plans.missedCount(value.uuid) }} missed days)</span>
            <span v-if="urgency.short_window" class="ml-1 text-warning">Window shorter than lead time</span>
            <!-- Below the title rather than before it, so the checkbox stays level with the title
                 and the titles in a column still line up to be scanned. -->
            <div
                v-if="ancestorTitles.length > 0"
                class="ancestors"
            >
                {{ ancestorTitles.join(' › ') }}
            </div>
            <slot />
        </div>
    </router-link>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { RouteLocationRaw } from 'vue-router';

import {
    mdiCheckboxBlankOutline,
    mdiCheckboxMarkedOutline,
    mdiCheckboxBlankOffOutline,
} from '@mdi/js';

import type { UUID } from '@/task';
import type { TaskNode } from '@/task-forest';
import { useTasksStore } from '@/stores/tasks';
import { URGENCY_LABEL } from '@/urgency';
import { usePlansStore } from '@/stores/plans';

import TaskDateCues from '@/components/TaskDateCues.vue';

// Props
const props = defineProps<{
    value: TaskNode;
    // Where choosing the task goes. The item is a link to it, so a task can be opened in a new tab
    // or its address copied, as from the tree.
    to: RouteLocationRaw;
    // The task whose descendants the list holds, if it holds only those.
    listRoot?: UUID;
}>();

// Stores
const store = useTasksStore();
const plans = usePlansStore();
const urgency = computed(() => store.urgency(props.value.uuid));
const progress = computed(() => store.progress(props.value.uuid));

// Computed properties
// A list gathers tasks from anywhere in the tree, and a title alone often does not say which
// project it belongs to: "Write the report" could be under any of them.
const ancestorTitles = computed<string[]>(() => {
    return store.ancestorsOf(props.value.uuid, props.listRoot).map((node) => node.title || 'Untitled');
});

const done = computed<boolean>(() => {
    return props.value.metadata?.task?.status?.kind === 'done';
});

const canceled = computed<boolean>(() => {
    return props.value.metadata?.task?.status?.kind === 'canceled';
});
</script>

<style scoped lang="scss">
.task-list-item {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    font-size: 14px;
    padding: 4px 4px;
    word-break: break-all;
    color: inherit;
    text-decoration: none;

    &:hover {
        background: #eeeeee;
    }

    /* The copy that follows the pointer while the task is dragged. It is drawn over other tasks,
       so it needs a ground of its own to be read against. */
    &.sortable-drag {
        background: rgb(var(--v-theme-surface));
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }

    & > * {
        display: inline;
        vertical-align: middle;
    }
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
.note-tooltip {
    white-space: pre-wrap;
}
</style>
