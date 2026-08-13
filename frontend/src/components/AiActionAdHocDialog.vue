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
                <!-- Only when there is something for it to decide: no selection
                     means no input to append, and a prompt that already spells the
                     placeholder out positions the input itself. -->
                <v-checkbox
                    v-if="hasSelection && !promptPlacesInputItself"
                    v-model="useSelectionAsInput"
                    label="Use the selected text as input"
                    hide-details="auto"
                    class="mt-2"
                ></v-checkbox>
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

import { appendInputPlaceholder, hasInputPlaceholder } from '@/ai-actions';

// Props
const props = defineProps<{
    modelValue: boolean;
    existingIds: string[];
    hasSelection: boolean;
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
const promptHint = 'Type {{input}} to choose where the input goes; otherwise it is appended to the end.';

// Reactive state
const prompt = ref('');
const useSelectionAsInput = ref(true);
const save = ref(false);
const id = ref('');
const name = ref('');

// Computed properties
const promptPlacesInputItself = computed((): boolean => {
    return hasInputPlaceholder(prompt.value);
});

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
    // Appended to the emitted prompt rather than only to the one that is sent, so
    // a prompt saved as a predefined action carries the placeholder too and keeps
    // consuming the selection when it is re-run from the menu.
    const finalPrompt = props.hasSelection && useSelectionAsInput.value
        ? appendInputPlaceholder(prompt.value)
        : prompt.value;
    emit('run', finalPrompt, save.value ? { id: id.value, name: name.value.trim() } : null);
    emit('update:modelValue', false);
}

// Watchers
watch(() => props.modelValue, (isOpen: boolean) => {
    if (isOpen) {
        prompt.value = '';
        useSelectionAsInput.value = true;
        save.value = false;
        id.value = '';
        name.value = '';
    }
});
</script>
