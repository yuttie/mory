<template>
    <div class="task">
        <v-container>
            <v-row>
                <v-col>
                    <v-textarea
                        label="Name"
                        autofocus
                        hide-details="auto"
                        v-bind:model-value="modelValue.name"
                        v-on:update:model-value="$emit('update:modelValue', { ...modelValue, name: $event })"
                        auto-grow
                        rows="1"
                    >
                        <template v-slot:prepend>
                            <v-icon>{{ mdiPencil }}</v-icon>
                        </template>
                    </v-textarea>
                </v-col>
            </v-row>
            <v-row>
                <v-col>
                    <v-combobox
                        v-bind:model-value="modelValue.tags"
                        v-on:update:model-value="$emit('update:modelValue', { ...modelValue, tags: $event })"
                        v-bind:items="tagItems"
                        v-bind:return-object="false"
                        chips
                        clearable
                        hide-details="auto"
                        label="Tags"
                        multiple
                    >
                        <template v-slot:prepend>
                            <v-icon>{{ mdiTagMultipleOutline }}</v-icon>
                        </template>
                        <template v-slot:chip="{ item, props: chipProps }">
                            <v-chip
                                v-bind="chipProps"
                                closable
                                size="small"
                                v-on:click:close="removeTag(item.value)"
                            >
                                <span>{{ item.value }}</span>
                            </v-chip>
                        </template>
                    </v-combobox>
                </v-col>
            </v-row>
            <v-row>
                <v-col>
                    <v-menu
                        v-model="scheduleMenu"
                        v-bind:close-on-content-click="false"
                        min-width="auto"
                    >
                        <template v-slot:activator="{ props: menuProps }">
                            <v-text-field
                                v-bind:model-value="modelValue.schedule"
                                v-on:update:model-value="$emit('update:modelValue', { ...modelValue, schedule: $event })"
                                label="Schedule on"
                                readonly
                                clearable
                                hide-details="auto"
                                v-bind="menuProps"
                            >
                                <template v-slot:prepend>
                                    <v-icon>{{ mdiCalendar }}</v-icon>
                                </template>
                            </v-text-field>
                        </template>
                        <v-date-picker
                            v-bind:model-value="toDate(modelValue.schedule)"
                            v-on:update:model-value="$emit('update:modelValue', { ...modelValue, schedule: fromDate($event) }); scheduleMenu = false;"
                        ></v-date-picker>
                    </v-menu>
                </v-col>
                <v-col cols="auto">
                    <v-btn
                        variant="text"
                        v-on:click="setScheduleToday"
                    >Today</v-btn>
                </v-col>
            </v-row>
            <v-row>
                <v-col>
                    <v-menu
                        v-model="deadlineMenu"
                        v-bind:close-on-content-click="false"
                        min-width="auto"
                    >
                        <template v-slot:activator="{ props: menuProps }">
                            <v-text-field
                                v-bind:model-value="modelValue.deadline"
                                v-on:update:model-value="$emit('update:modelValue', { ...modelValue, deadline: $event })"
                                label="Deadline"
                                readonly
                                clearable
                                hide-details="auto"
                                v-bind="menuProps"
                            >
                                <template v-slot:prepend>
                                    <v-icon>{{ mdiCalendar }}</v-icon>
                                </template>
                            </v-text-field>
                        </template>
                        <v-date-picker
                            v-bind:model-value="toDate(modelValue.deadline)"
                            v-on:update:model-value="$emit('update:modelValue', { ...modelValue, deadline: fromDate($event) }); deadlineMenu = false;"
                        ></v-date-picker>
                    </v-menu>
                </v-col>
                <v-col cols="auto">
                    <v-checkbox
                        label="Done"
                        v-bind:model-value="modelValue.done"
                        v-on:update:model-value="$emit('update:modelValue', { ...modelValue, done: $event })"
                    ></v-checkbox>
                </v-col>
            </v-row>
            <v-row>
                <v-col>
                    <v-textarea
                        label="Note"
                        hide-details="auto"
                        v-bind:model-value="modelValue.note"
                        v-on:update:model-value="$emit('update:modelValue', { ...modelValue, note: $event })"
                    >
                        <template v-slot:prepend>
                            <v-icon>{{ mdiText }}</v-icon>
                        </template>
                    </v-textarea>
                </v-col>
            </v-row>
        </v-container>
    </div>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';

import {
    mdiCalendar,
    mdiPencil,
    mdiTagMultipleOutline,
    mdiText,
} from '@mdi/js';
import type { Task } from '@/api';

import dayjs from 'dayjs';

// Props
const props = defineProps<{
    modelValue: Task;
    knownTags: [string, number][];
}>();

// Emits
const emit = defineEmits<{
    (e: 'update:modelValue', task: Task): void;
}>();

// Reactive states
const deadlineMenu = ref(false);
const scheduleMenu = ref(false);

// Computed properties
const tagItems = computed((): { title: string; value: string; }[] => {
    return props.knownTags.map(([tag, count]) => {
        return {
            title: `${tag} (${count})`,
            value: tag,
        };
    });
});

// Methods
function toDate(date: string | null | undefined): Date | null {
    return date ? dayjs(date).toDate() : null;
}

function fromDate(date: unknown): string {
    return dayjs(date as Date).format('YYYY-MM-DD');
}

function setScheduleToday() {
    // FIXME We should emit an event instead like we do in template for bidirectional binding
    props.modelValue.schedule = dayjs().format('YYYY-MM-DD');  // eslint-disable-line vue/no-mutating-props
}

function removeTag(tag: string) {
    // FIXME We should emit an event instead like we do in template for bidirectional binding
    props.modelValue.tags.splice(props.modelValue.tags.indexOf(tag), 1);  // eslint-disable-line vue/no-mutating-props
}
</script>

<style scoped lang="scss">
.task {
}
</style>
