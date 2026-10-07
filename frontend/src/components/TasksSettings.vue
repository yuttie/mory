<template>
    <v-card class="mt-6">
        <v-card-text>
            <v-card-title>Tasks</v-card-title>
            <v-card-subtitle class="px-0">
                Status colours
            </v-card-subtitle>
            <p class="text-medium-emphasis mb-4">
                The colour each status is drawn in: its icon in the task tree, and the ground of its
                cards in the Status, Schedule and Eisenhower views. Stored in the repository as
                <code>{{ TASK_SETTINGS_PATH }}</code>, so they follow the notes rather than the
                browser. Leave one empty for its default.
            </p>
            <div class="status-colors">
                <ColorField
                    v-for="kind of STATUS_KINDS"
                    v-bind:key="kind"
                    v-model="draft[kind]"
                    v-bind:fallback="DEFAULT_STATUS_COLOR[kind]"
                    v-bind:label="STATUS_LABEL[kind]"
                />
            </div>
            <v-btn
                v-bind:disabled="!changed"
                v-bind:loading="isSaving"
                variant="tonal"
                v-on:click="save"
            >
                Save colours
            </v-btn>
            <v-alert
                v-if="error"
                class="mt-4"
                type="error"
                variant="tonal"
            >
                {{ error }}
            </v-alert>
            <!-- What reading the file dropped. Saving rewrites the colours from the fields, so a
                 colour dropped here is gone from the file after the next save. -->
            <v-alert
                v-for="problem of taskSettings.problems"
                v-bind:key="problem"
                class="mt-4"
                type="warning"
                variant="tonal"
            >
                {{ TASK_SETTINGS_PATH }}: {{ problem }}
            </v-alert>
        </v-card-text>
    </v-card>
</template>

<script lang="ts" setup>
import { computed, reactive, ref, watch } from 'vue';

import ColorField from '@/components/ColorField.vue';
import { DEFAULT_STATUS_COLOR, parseStatusColor, type StatusColorEdits, type StatusColors } from '@/status-color';
import { TASK_SETTINGS_PATH, useTaskSettingsStore } from '@/stores/taskSettings';
import { STATUS_KINDS, STATUS_LABEL, type StatusKind } from '@/task';

// Stores
const taskSettings = useTaskSettingsStore();

// Reactive states
// Edited as text, so an empty field can mean "the default" rather than an unset key.
const draft = reactive(Object.fromEntries(STATUS_KINDS.map((kind) => [kind, ''])) as Record<StatusKind, string>);
const isSaving = ref(false);
const error = ref('');

// Computed properties
const changed = computed(() => STATUS_KINDS.some(
    (kind) => draft[kind].trim() !== (taskSettings.statusColors[kind] ?? ''),
));

// The colours the fields were last filled from.
let base: StatusColors = {};

// Watchers
// The file is read after this component mounts, and again on every commit -- a save elsewhere on
// this page included -- so the fields follow what it holds rather than what it held at setup. A
// field the user has edited keeps the edit, or a reload would throw away what they typed.
watch(() => taskSettings.statusColors, (colors) => {
    for (const kind of STATUS_KINDS) {
        if (draft[kind].trim() === (base[kind] ?? '')) {
            draft[kind] = colors[kind] ?? '';
        }
    }
    base = colors;
}, { immediate: true });

// Methods
async function save() {
    // Only the fields edited, so a colour set in the file meanwhile is not put back to what this
    // page last read.
    const edits: StatusColorEdits = {};
    for (const kind of STATUS_KINDS) {
        const value = draft[kind].trim();
        if (value === (base[kind] ?? '')) {
            continue;
        }
        if (value === '') {
            edits[kind] = null;
            continue;
        }
        // Read as the views read it, so a typo is refused here rather than saved and then drawn
        // as the default, which would look as if it had been ignored.
        if (parseStatusColor(value) === null) {
            error.value = `"${value}" is not an opaque colour this can draw.`;
            return;
        }
        edits[kind] = value;
    }

    isSaving.value = true;
    error.value = '';
    try {
        await taskSettings.saveStatusColors(edits);
    }
    catch (err) {
        error.value = `Could not save ${TASK_SETTINGS_PATH}: ${err}`;
    }
    finally {
        isSaving.value = false;
    }
}
</script>

<style scoped lang="scss">
// Side by side where there is room, so the colours are compared rather than read in turn.
.status-colors {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14em, 1fr));
    gap: 0 1rem;
}
</style>
