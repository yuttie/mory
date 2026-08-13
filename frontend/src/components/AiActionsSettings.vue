<template>
    <v-card class="mt-6">
        <v-card-text>
            <v-card-title>AI Actions</v-card-title>
            <v-alert variant="tonal" type="info" class="mb-4">
                Unlike the settings above, AI Actions are stored in the repository
                as <code>{{ AI_ACTIONS_PATH }}</code> and are shared across browsers.
            </v-alert>

            <v-list v-if="sortedActions.length > 0" density="compact">
                <v-list-item
                    v-for="action of sortedActions"
                    v-bind:key="action.id"
                    v-bind:title="action.name"
                    v-bind:subtitle="action.id"
                >
                    <template v-slot:append>
                        <v-btn
                            icon
                            variant="text"
                            size="small"
                            v-on:click="openEditDialog(action)"
                        >
                            <v-icon>{{ mdiPencil }}</v-icon>
                        </v-btn>
                        <v-btn
                            icon
                            variant="text"
                            size="small"
                            v-on:click="openDeleteDialog(action)"
                        >
                            <v-icon>{{ mdiDelete }}</v-icon>
                        </v-btn>
                    </template>
                </v-list-item>
            </v-list>
            <p v-else class="text-medium-emphasis">
                No AI Actions defined yet.
            </p>

            <v-btn
                class="mt-2"
                v-bind:prepend-icon="mdiPlus"
                v-on:click="openAddDialog"
            >Add</v-btn>
        </v-card-text>

        <v-dialog
            v-model="editDialogIsVisible"
            max-width="600px"
            persistent
        >
            <v-card>
                <v-card-title>
                    <span class="text-h5">{{ editingAction === null ? 'Add AI Action' : 'Edit AI Action' }}</span>
                </v-card-title>
                <v-card-text>
                    <v-text-field
                        v-model="draftId"
                        label="Identifier"
                        v-bind:rules="[idValidationResult]"
                        v-bind:hint="`Used as the key in ${AI_ACTIONS_PATH}.`"
                        persistent-hint
                    ></v-text-field>
                    <v-text-field
                        v-model="draftName"
                        label="Display name"
                        v-bind:rules="[nameValidationResult]"
                        hint="A / nests the action in the menu, e.g. Text/Translate/English."
                        persistent-hint
                        class="mt-4"
                    ></v-text-field>
                    <v-textarea
                        v-model="draftPrompt"
                        label="Prompt"
                        rows="6"
                        auto-grow
                        v-bind:rules="[promptValidationResult]"
                        v-bind:hint="promptHint"
                        persistent-hint
                        class="mt-4"
                    ></v-textarea>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn
                        variant="text"
                        v-on:click="editDialogIsVisible = false"
                    >Cancel</v-btn>
                    <v-btn
                        color="primary"
                        v-bind:disabled="!canSave"
                        v-on:click="saveDraft"
                    >Save</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <v-dialog
            v-model="deleteDialogIsVisible"
            max-width="25em"
        >
            <v-card>
                <v-card-title class="text-h5">
                    Really delete this AI Action?
                </v-card-title>
                <v-card-text>
                    <strong>{{ deletingAction?.name }}</strong> will be removed.
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn
                        variant="text"
                        v-on:click="deleteDialogIsVisible = false"
                    >Cancel</v-btn>
                    <v-btn
                        color="error"
                        variant="text"
                        v-on:click="confirmDelete"
                    >Delete</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <v-snackbar v-model="error" color="error" location="top" timeout="5000">{{ errorText }}</v-snackbar>
    </v-card>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue';
import { mdiDelete, mdiPencil, mdiPlus } from '@mdi/js';

import { AI_ACTIONS_PATH, loadAiActions, saveAiActions } from '@/ai-actions';
import type { AiAction } from '@/ai-actions';

// Bound rather than written inline in the template, so the placeholder's own
// braces cannot be read as an interpolation.
const promptHint = '{{input}} is replaced by the selected text. Without it, the prompt is sent as-is and the result is inserted at the cursor.';

// Reactive states
const actions = ref([] as AiAction[]);
const editDialogIsVisible = ref(false);
const deleteDialogIsVisible = ref(false);
// The action being edited, or null when adding a new one.
const editingAction = ref(null as null | AiAction);
const deletingAction = ref(null as null | AiAction);
const draftId = ref('');
const draftName = ref('');
const draftPrompt = ref('');
const error = ref(false);
const errorText = ref('');

// Computed properties
const sortedActions = computed((): AiAction[] => {
    return [...actions.value].sort((a, b) => a.name.localeCompare(b.name));
});

const idValidationResult = computed((): boolean | string => {
    if (draftId.value === '') {
        return 'Required';
    }
    else if (!/^[A-Za-z0-9._-]+$/.test(draftId.value)) {
        return 'Only letters, digits, ., _ and - are allowed';
    }
    else if (actions.value.some((action) => action.id === draftId.value && action.id !== editingAction.value?.id)) {
        return 'Already taken';
    }
    else {
        return true;
    }
});

const nameValidationResult = computed((): boolean | string => {
    if (draftName.value.trim() === '') {
        return 'Required';
    }
    else {
        return true;
    }
});

const promptValidationResult = computed((): boolean | string => {
    if (draftPrompt.value.trim() === '') {
        return 'Required';
    }
    else {
        return true;
    }
});

const canSave = computed((): boolean => {
    return idValidationResult.value === true
        && nameValidationResult.value === true
        && promptValidationResult.value === true;
});

// Lifecycle hooks
onMounted(async () => {
    await reload();
});

// Methods
async function reload() {
    try {
        actions.value = await loadAiActions();
    }
    catch (err) {
        error.value = true;
        errorText.value = `Failed to load AI Actions: ${err}`;
    }
}

// Returns whether the write succeeded, so callers can keep their dialog open
// rather than dismissing it over a failure.
async function persist(newActions: AiAction[]): Promise<boolean> {
    try {
        await saveAiActions(newActions);
        actions.value = newActions;
        return true;
    }
    catch (err) {
        error.value = true;
        errorText.value = `Failed to save AI Actions: ${err}`;
        return false;
    }
}

function openAddDialog() {
    editingAction.value = null;
    draftId.value = '';
    draftName.value = '';
    draftPrompt.value = '';
    editDialogIsVisible.value = true;
}

function openEditDialog(action: AiAction) {
    editingAction.value = action;
    draftId.value = action.id;
    draftName.value = action.name;
    draftPrompt.value = action.prompt;
    editDialogIsVisible.value = true;
}

function openDeleteDialog(action: AiAction) {
    deletingAction.value = action;
    deleteDialogIsVisible.value = true;
}

async function saveDraft() {
    if (!canSave.value) {
        return;
    }

    const draft = {
        id: draftId.value,
        name: draftName.value.trim(),
        prompt: draftPrompt.value,
    };
    const edited = editingAction.value;
    // A rename changes the identifier, so match on the original one and keep
    // the action where it was in the file rather than appending it again.
    const newActions = edited === null
        ? [...actions.value, draft]
        : actions.value.map((action) => action.id === edited.id ? draft : action);

    // Only dismissed once the write is safely in the repository: the dialog holds
    // the only copy of what was typed, and the snackbar alone is easy to miss.
    if (await persist(newActions)) {
        editDialogIsVisible.value = false;
    }
}

async function confirmDelete() {
    const deleted = deletingAction.value;
    if (deleted === null) {
        deleteDialogIsVisible.value = false;
        return;
    }
    if (await persist(actions.value.filter((action) => action.id !== deleted.id))) {
        deleteDialogIsVisible.value = false;
    }
}
</script>
