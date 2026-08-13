<template>
    <v-dialog
        v-bind:model-value="modelValue"
        v-on:update:model-value="$emit('update:modelValue', $event)"
        max-width="600px"
        persistent
    >
        <v-card>
            <v-card-title>
                <span class="text-h5">Ad hoc AI Action</span>
            </v-card-title>
            <v-card-text>
                <v-textarea
                    v-model="prompt"
                    label="Prompt"
                    rows="6"
                    auto-grow
                    autofocus
                    v-bind:hint="promptHint"
                    persistent-hint
                ></v-textarea>
                <v-checkbox
                    v-model="save"
                    label="Save as a predefined AI Action"
                    hide-details="auto"
                    class="mt-2"
                ></v-checkbox>
                <template v-if="save">
                    <v-text-field
                        v-model="id"
                        label="Identifier"
                        v-bind:rules="[idValidationResult]"
                        hint="Used as the key in .mory/ai-actions.toml."
                        persistent-hint
                        class="mt-2"
                    ></v-text-field>
                    <v-text-field
                        v-model="name"
                        label="Display name"
                        v-bind:rules="[nameValidationResult]"
                        hint="A / nests the action in the menu, e.g. Text/Translate/English."
                        persistent-hint
                        class="mt-2"
                    ></v-text-field>
                </template>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn
                    variant="text"
                    v-on:click="$emit('update:modelValue', false)"
                >
                    Cancel
                </v-btn>
                <v-btn
                    color="primary"
                    v-bind:disabled="!canRun"
                    v-on:click="run"
                >
                    Run
                </v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from 'vue';

// Props
const props = defineProps<{
    modelValue: boolean;
    existingIds: string[];
}>();

// Emits
const emit = defineEmits<{
    // `preset` is non-null when the prompt should also be saved as a predefined
    // action. The parent persists it before the run, so a failing run does not
    // discard the prompt that was just written.
    (e: 'update:modelValue', value: boolean): void;
    (e: 'run', prompt: string, preset: { id: string, name: string } | null): void;
}>();

// Bound rather than written inline in the template, so the placeholder's own
// braces cannot be read as an interpolation.
const promptHint = '{{input}} is replaced by the selected text. Without it, the prompt is sent as-is and the result is inserted at the cursor.';

// Reactive state
const prompt = ref('');
const save = ref(false);
const id = ref('');
const name = ref('');

// Computed properties
const idValidationResult = computed((): boolean | string => {
    if (id.value === '') {
        return 'Required';
    }
    else if (!/^[A-Za-z0-9._-]+$/.test(id.value)) {
        return 'Only letters, digits, ., _ and - are allowed';
    }
    else if (props.existingIds.includes(id.value)) {
        return 'Already taken';
    }
    else {
        return true;
    }
});

const nameValidationResult = computed((): boolean | string => {
    if (name.value.trim() === '') {
        return 'Required';
    }
    else {
        return true;
    }
});

const canRun = computed((): boolean => {
    if (prompt.value.trim() === '') {
        return false;
    }
    if (save.value) {
        return idValidationResult.value === true && nameValidationResult.value === true;
    }
    return true;
});

// Methods
function run(): void {
    if (!canRun.value) {
        return;
    }
    emit('run', prompt.value, save.value ? { id: id.value, name: name.value.trim() } : null);
    emit('update:modelValue', false);
}

// Watchers
watch(() => props.modelValue, (isOpen: boolean) => {
    if (isOpen) {
        prompt.value = '';
        save.value = false;
        id.value = '';
        name.value = '';
    }
});
</script>
