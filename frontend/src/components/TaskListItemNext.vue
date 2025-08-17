<template>
    <div
        v-on:click="$emit('click', $event)"
        class="task-list-item"
    >
        <v-simple-checkbox
            color="primary"
            v-bind:value="done"
            v-on:input="$emit('toggle-done', $event)"
        />
        <div>
            <span
                class="tag"
                v-for="tag of value.metadata.tags"
                v-bind:key="tag"
            >{{ tag }}</span>
            <span class="title-text">{{ value.title }}</span>
            <span
                class="additional-info"
                v-if="value.note"
            >
                <v-tooltip bottom>
                    <template v-slot:activator="{ on, attrs }">
                        <v-icon small v-bind="attrs" v-on="on">{{ mdiNoteTextOutline }}</v-icon>
                    </template>
                    <div class="note-tooltip">{{ value.note }}</div>
                </v-tooltip>
            </span>
            <span
                class="additional-info"
                v-if="startAt"
                v-bind:style="startAtStyle"
            >
                <v-tooltip bottom>
                    <template v-slot:activator="{ on, attrs }">
                        <span v-bind="attrs" v-on="on">
                            <v-icon small v-bind:style="startAtStyle" class="mr-1">{{ mdiCalendar }}</v-icon>{{ startAtText }}
                        </span>
                    </template>
                    <div>{{ startAt }}</div>
                </v-tooltip>
            </span>
            <span
                class="additional-info"
                v-if="dueBy"
                v-bind:style="dueByStyle"
            >
                <v-tooltip bottom>
                    <template v-slot:activator="{ on, attrs }">
                        <span v-bind="attrs" v-on="on">
                            <v-icon small v-bind:style="dueByStyle" class="mr-1">{{ mdiCalendar }}</v-icon>{{ dueByText }}
                        </span>
                    </template>
                    <div>{{ dueBy }}</div>
                </v-tooltip>
            </span>
            <span
                class="additional-info"
                v-if="deadline"
                v-bind:style="deadlineStyle"
            >
                <v-tooltip bottom>
                    <template v-slot:activator="{ on, attrs }">
                        <span v-bind="attrs" v-on="on">
                            <v-icon small v-bind:style="deadlineStyle" class="mr-1">{{ mdiCalendar }}</v-icon>{{ deadlineText }}
                        </span>
                    </template>
                    <div>{{ deadline }}</div>
                </v-tooltip>
            </span>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';

import {
    mdiCalendar,
    mdiNoteTextOutline,
} from '@mdi/js';

import type { TreeNodeRecord } from '@/stores/taskForest';

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime, {
    thresholds: [
        { l: 's', r: 1 },
        { l: 'm', r: 1 },
        { l: 'mm', r: 59, d: 'minute' },
        { l: 'h', r: 1 },
        { l: 'hh', r: 23, d: 'hour' },
        { l: 'd', r: 1 },
        { l: 'dd', d: 'day' },
        { l: 'M' },
        { l: 'MM', d: 'month' },
        { l: 'y' },
        { l: 'yy', d: 'year' }
    ],
});

// Props
const props = defineProps<{
    value: TreeNodeRecord;
}>();

// Emits
const emit = defineEmits<{
    (e: 'click', event: Event): void;
    (e: 'toggle-done', event: Event): void;
}>();

// Computed properties
const done = computed<boolean>(() => {
    return props.value.metadata?.task?.status?.kind === 'done';
});

const startAt = computed<string | null>(() => {
    return props.value.metadata?.task?.start_at ?? null;
});

const startAtText = computed<string>(() => {
    return startAt.value ? dayjs(startAt.value).endOf('day').fromNow() : '';
});

const startAtStyle = computed<Record<string, string>>(() => {
    if (!done.value && startAt.value) {
        const now = dayjs();
        const daysLeft = dayjs(props.value.metadata.task.start_at).diff(now, 'day');
        const g = daysLeft < 3 ? 127 : 0;
        const b = daysLeft < 3 ? 255 : 0;
        const color = `rgb(0, ${g}, ${b})`;
        return {
            color: color,
        };
    }
    else {
        return {};
    }
});

const dueBy = computed<string | null>(() => {
    return props.value.metadata?.task?.due_by ?? null;
});

const dueByText = computed<string>(() => {
    return dueBy.value ? dayjs(dueBy.value).endOf('day').fromNow() : '';
});

const dueByStyle = computed<Record<string, string>>(() => {
    if (!done.value && dueBy.value) {
        const now = dayjs();
        const daysLeft = dayjs(props.value.metadata.task.due_by).diff(now, 'day');
        const r = daysLeft < 3 ? 255 : 0;
        const g = daysLeft < 3 ? 127 : 0;
        const color = `rgb(${r}, ${g}, 0)`;
        return {
            color: color,
        };
    }
    else {
        return {};
    }
});

const deadline = computed<string | null>(() => {
    return props.value.metadata?.task?.deadline ?? null;
});

const deadlineText = computed<string>(() => {
    return deadline.value ? dayjs(deadline.value).endOf('day').fromNow() : '';
});

const deadlineStyle = computed<Record<string, string>>(() => {
    if (!done.value && deadline.value) {
        const now = dayjs();
        const daysLeft = dayjs(props.value.metadata.task.deadline).diff(now, 'day');
        const r = daysLeft < 7 ? 255 : 0;
        const color = `rgb(${r}, 0, 0)`;
        return {
            color: color,
        };
    }
    else {
        return {};
    }
});
</script>

<style scoped lang="scss">
.task-list-item {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    font-size: 14px;
    padding: 4px 4px;
    cursor: pointer;
    word-break: break-all;

    &:hover {
        background: #eeeeee;
    }

    &.sortable-chosen {
        background: unset;
    }

    &.sortable-drag {
        background: unset;
    }

    &.sortable-ghost {
        visibility: hidden;
    }

    & > * {
        display: inline;
        vertical-align: middle;
    }
}
.v-simple-checkbox {
    align-self: unset;  /* Override default value of 'center' */
}
.additional-info {
    display: inline-block;
    margin-left: 4px;
    opacity: 0.5;
}
.tag {
    color: #888;
    background: #fafafa;
    padding: 1px 2px;
    border: 1px solid #eee;
    margin-right: 3px;
}
.note-tooltip {
    white-space: pre-wrap;
}
</style>
