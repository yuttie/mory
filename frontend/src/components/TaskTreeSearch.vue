<template>
    <div class="d-flex align-center">
        <TaskSearchField
            v-model="search"
            label="Search tasks"
            v-bind:delay="250"
        />
        <!-- Counts the statuses left out, so a tree missing tasks says why. Named
             outright, count and all, as the badge would otherwise name the button
             after itself, and announces the count as it changes. -->
        <v-menu
            v-bind:close-on-content-click="false"
            location="bottom end"
        >
            <template v-slot:activator="{ props: filterProps }">
                <v-icon-btn
                    v-bind="filterProps"
                    class="ml-1"
                    title="Choose which statuses are shown"
                    v-bind:aria-label="hiddenStatuses.length === 0 ? 'Choose which statuses are shown' : `Choose which statuses are shown, ${hiddenStatusesText}`"
                >
                    <v-badge
                        v-bind:model-value="hiddenStatuses.length > 0"
                        v-bind:content="hiddenStatuses.length"
                        v-bind:label="hiddenStatusesText"
                        color="grey"
                    >
                        <v-icon>{{ mdiFilterVariant }}</v-icon>
                    </v-badge>
                </v-icon-btn>
            </template>
            <v-card min-width="14em">
                <v-list class="py-0">
                    <v-list-subheader>Statuses</v-list-subheader>
                    <!-- A group at once: ticked while all its statuses are shown, half
                         ticked while some are, with their icons to say which. -->
                    <v-list-item
                        v-for="(preset, index) of STATUS_PRESETS"
                        v-bind:key="preset.title"
                        v-bind:title="preset.title"
                        v-on:click="hiddenStatuses = togglePreset(hiddenStatuses, preset.kinds)"
                    >
                        <template v-slot:prepend>
                            <v-checkbox-btn
                                v-bind:model-value="presetStates[index] === 'shown'"
                                v-bind:indeterminate="presetStates[index] === 'mixed'"
                                class="mr-1"
                                tabindex="-1"
                            />
                        </template>
                        <!-- The icons are drawn alone, so their names are given
                             apart, to a pointer and to a screen reader. -->
                        <template v-slot:append>
                            <v-icon
                                v-for="kind of preset.kinds"
                                v-bind:key="kind"
                                v-bind:icon="statusIcon(kind, false)"
                                v-bind:color="statusColor(kind, taskSettings.resolvedStatusColors)"
                                v-bind:title="STATUS_LABEL[kind]"
                                size="small"
                                class="ml-1"
                            />
                            <span class="d-sr-only">{{ preset.kinds.map((kind) => STATUS_LABEL[kind]).join(', ') }}</span>
                        </template>
                    </v-list-item>
                    <v-divider />
                    <v-list-item
                        v-for="kind of STATUS_KINDS"
                        v-bind:key="kind"
                        v-bind:title="STATUS_LABEL[kind]"
                        v-on:click="toggleStatus(kind)"
                    >
                        <template v-slot:prepend>
                            <v-checkbox-btn
                                v-bind:model-value="!hiddenStatuses.includes(kind)"
                                class="mr-1"
                                tabindex="-1"
                            />
                            <v-icon
                                v-bind:icon="statusIcon(kind, false)"
                                v-bind:color="statusColor(kind, taskSettings.resolvedStatusColors)"
                                class="mr-3"
                            />
                        </template>
                    </v-list-item>
                    <v-divider />
                    <v-list-item
                        v-bind:disabled="hiddenStatuses.length === 0"
                        title="Show all"
                        v-on:click="hiddenStatuses = []"
                    />
                </v-list>
            </v-card>
        </v-menu>
    </div>
</template>

<script lang="ts" setup>
// The search field and the status filter above a task tree. It gives what the tree is searched
// for, the field's words once typing pauses, and the statuses it leaves out; useTaskTreeFilter
// draws the tree from both.

import { mdiFilterVariant } from '@mdi/js';
import { computed } from 'vue';

import TaskSearchField from '@/components/TaskSearchField.vue';
import { useTaskSettingsStore } from '@/stores/taskSettings';
import { type StatusKind, STATUS_KINDS, STATUS_LABEL } from '@/task';
import { STATUS_PRESETS, type PresetState, presetState, togglePreset } from '@/task-tree-filter';
import { statusColor } from '@/status-color';
import { statusIcon } from '@/status-icon';

// What the tree is searched for, once typing pauses. Each search draws the tree anew, and over the
// 490 tasks of the real notes a broad one drawing 290 rows took Firefox 0.9 s: on every key, that
// would stall the typing.
const search = defineModel<string>('search', { required: true });

// The statuses the tree leaves out, by name rather than by those it shows, so a status added
// later is shown until it is unticked.
const hiddenStatuses = defineModel<string[]>('hiddenStatuses', { required: true });

const taskSettings = useTaskSettingsStore();

// Whole words, as the badge's number alone says nothing to a screen reader.
const hiddenStatusesText = computed<string>(() => {
    const count = hiddenStatuses.value.length;
    return `${count} ${count === 1 ? 'status' : 'statuses'} hidden`;
});

const presetStates = computed<PresetState[]>(() => STATUS_PRESETS.map((preset) => presetState(hiddenStatuses.value, preset.kinds)));

function toggleStatus(kind: StatusKind) {
    hiddenStatuses.value = hiddenStatuses.value.includes(kind)
        ? hiddenStatuses.value.filter((hidden) => hidden !== kind)
        : [...hiddenStatuses.value, kind];
}
</script>
