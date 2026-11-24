<!-- The field a task tree or a list of tasks is searched with. It gives the words to search for,
     as `searchTerms` splits them, once an input method has given the word it composes and, given
     a delay, once typing pauses. -->
<template>
    <v-text-field
        v-model="query"
        v-bind:prepend-inner-icon="mdiMagnify"
        v-bind:label="label"
        single-line
        density="compact"
        variant="outlined"
        hide-details
        clearable
        autocomplete="off"
        v-on:compositionstart="onCompositionStart"
        v-on:compositionend="onCompositionEnd"
    />
</template>

<script lang="ts" setup>
import { mdiMagnify } from '@mdi/js';
import { onUnmounted, ref, watch } from 'vue';

import { searchTerms } from '@/task-tree-filter';

// Props
const props = defineProps<{
    // Names the field, and its clear button too: "Clear Search tasks" for "Search tasks".
    label: string;
    // How long typing must pause, in milliseconds, before the words are searched for, where a
    // search costs too much to run on every key. Without it, every key searches.
    delay?: number;
}>();

// The words to search for, one space apart.
const words = defineModel<string>({ required: true });

// What the field holds, the reading of a word an input method composes included. Null once
// cleared, as a clearable field leaves it.
const query = ref<string | null>(words.value);

let searchTimer: ReturnType<typeof setTimeout> | undefined;
// Set while an input method composes a word. The field takes its reading and each candidate as
// they come, but what is searched for is the word chosen: not every step towards it, nor, with a
// delay, the one dwelt on while choosing.
let composing = false;

function applySearch(text: string | null) {
    clearTimeout(searchTimer);
    if (composing) {
        return;
    }
    // By its words alone, so that a space typed or taken out between them searches for nothing new.
    const next = searchTerms(text ?? '').join(' ');
    // Cleared at once: clearing is a single press, and what it gives back is what was there before.
    if (props.delay === undefined || next === '' || next === words.value) {
        words.value = next;
        return;
    }
    searchTimer = setTimeout(() => {
        words.value = next;
    }, props.delay);
}

watch(query, applySearch);
onUnmounted(() => clearTimeout(searchTimer));

function onCompositionStart() {
    composing = true;
    clearTimeout(searchTimer);
}

// The word the input method gives is searched as typed text is. Whether the input event carrying
// it comes before this or after differs between browsers, and either way it is searched for.
function onCompositionEnd() {
    composing = false;
    applySearch(query.value);
}
</script>
