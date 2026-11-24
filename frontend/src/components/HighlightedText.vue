<!-- A title with the terms a search found it by marked, every occurrence of each, as `highlight`
     cuts it. Drawn as its text and marks alone, without an element around them, so it reads as
     the text it stands in for wherever it is put. -->
<template>
    <template
        v-for="(segment, index) of segments"
        v-bind:key="index"
    >
        <mark
            v-if="segment.match"
            class="match"
        >{{ segment.text }}</mark>
        <template v-else>
            {{ segment.text }}
        </template>
    </template>
</template>

<script lang="ts" setup>
import { computed } from 'vue';

import { type TitleSegment, highlight } from '@/task-tree-filter';

// Props
const props = defineProps<{
    text: string;
    // None marks nothing, and draws the text as it is rather than composed.
    terms?: readonly string[];
}>();

const segments = computed<TitleSegment[]>(() => props.terms === undefined || props.terms.length === 0
    ? [{ text: props.text, match: false }]
    : highlight(props.text, props.terms));
</script>

<style scoped lang="scss">
/* A highlighter's yellow, as the theme's primary is all but black. The text keeps its own colour,
   which in a task's title says whether the task can be started yet. */
.match {
    background-color: rgba(var(--v-theme-warning), 0.4);
    color: inherit;
    border-radius: 2px;
}
</style>
