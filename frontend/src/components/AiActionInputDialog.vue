<template>
    <v-dialog
        v-bind:model-value="modelValue"
        v-on:update:model-value="$emit('update:modelValue', $event)"
        max-width="600px"
        persistent
    >
        <v-card>
            <v-card-title>
                <span class="text-h5">{{ actionName }}</span>
            </v-card-title>
            <v-card-text>
                <p class="text-caption text-medium-emphasis mb-3">
                    Nothing is selected, so this action needs its input typed in.
                    The result will be inserted at the cursor.
                </p>
                <v-textarea
                    v-model="input"
                    label="Input"
                    rows="6"
                    auto-grow
                    autofocus
                ></v-textarea>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn
                    variant="text"
                    v-on:click="cancel"
                >
                    Cancel
                </v-btn>
                <!-- Deliberately always enabled: an empty input is valid and
                     substitutes as an empty string. Only Cancel aborts. -->
                <v-btn
                    color="primary"
                    v-on:click="run"
                >
                    Run
                </v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue';

// Props
const props = defineProps<{
    modelValue: boolean;
    actionName?: string;
}>();

// Emits
const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    // `null` is cancellation; an empty string is a valid input.
    (e: 'resolve', input: string | null): void;
}>();

// Reactive state
const input = ref('');

// Methods
function cancel(): void {
    emit('resolve', null);
    emit('update:modelValue', false);
}

function run(): void {
    emit('resolve', input.value);
    emit('update:modelValue', false);
}

// Watchers
watch(() => props.modelValue, (isOpen: boolean) => {
    if (isOpen) {
        input.value = '';
    }
});
</script>
