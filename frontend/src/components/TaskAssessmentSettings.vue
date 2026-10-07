<template>
    <section>
        <h2 class="text-title-medium mb-4">
            Task Assessment
        </h2>
        <StoredInRepository v-bind:path="TASK_ASSESSMENT_PROMPT_PATH" />
        <p class="text-medium-emphasis mb-4">
            What the task editor's assessment looks for, and how it words its answer. The task,
            today's date and the titles of the tasks above it are sent after this prompt, and the
            answer always comes back as a score, suggestions, feedback and note suggestions,
            whatever the prompt asks. {{ assessment.custom === null ? 'The default is in use.' : 'A prompt of your own is in use.' }}
        </p>
        <!-- Capped, so the buttons stay in reach of a long prompt, as on a phone. -->
        <v-textarea
            ref="field"
            v-model="draft"
            label="Prompt"
            rows="12"
            max-rows="20"
            auto-grow
            hint="Leave it empty for the default."
            persistent-hint
        />
        <div class="d-flex flex-wrap ga-2 mt-4">
            <v-btn
                v-bind:disabled="!changed || conflict"
                v-bind:loading="isSaving"
                variant="tonal"
                v-on:click="save"
            >
                Save prompt
            </v-btn>
            <v-btn
                v-bind:disabled="draft.trim() === DEFAULT_TASK_ASSESSMENT_PROMPT"
                v-bind:prepend-icon="mdiRestore"
                variant="text"
                v-on:click="reset"
            >
                Reset to default
            </v-btn>
        </div>
        <!-- A reset replaces the field programmatically, which the textarea's own undo does not
             reach, and a long prompt is costly to type again. -->
        <v-alert
            v-if="beforeReset !== null"
            class="mt-4"
            type="info"
            variant="tonal"
            role="status"
        >
            The default is in the field; save to use it.
            <template #append>
                <v-btn
                    variant="text"
                    v-on:click="undoReset"
                >
                    Undo
                </v-btn>
            </template>
        </v-alert>
        <!-- The file is replaced whole, so saving now would replace a change its author has not
             seen here. -->
        <v-alert
            v-if="conflict"
            class="mt-4"
            type="warning"
            variant="tonal"
        >
            {{ TASK_ASSESSMENT_PROMPT_PATH }} changed since this prompt was read. Load it to see the
            change, dropping your edits, or keep yours to replace it when you save.
            <div class="d-flex flex-wrap ga-2 mt-2">
                <v-btn
                    variant="tonal"
                    v-on:click="fill"
                >
                    Load the file's prompt
                </v-btn>
                <v-btn
                    variant="text"
                    v-on:click="keepMine"
                >
                    Keep mine
                </v-btn>
            </div>
        </v-alert>
        <v-alert
            v-if="error"
            class="mt-4"
            type="error"
            variant="tonal"
        >
            {{ error }}
        </v-alert>
        <!-- The editor holds its assessments back, or keeps the prompt last read, so say why. -->
        <v-alert
            v-if="assessment.error"
            class="mt-4"
            type="warning"
            variant="tonal"
        >
            Could not read {{ TASK_ASSESSMENT_PROMPT_PATH }}: {{ assessment.error }}
        </v-alert>
    </section>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { mdiRestore } from '@mdi/js';
import type { VTextarea } from 'vuetify/components';

import StoredInRepository from '@/components/StoredInRepository.vue';
import { TaskAssessmentPromptConflict, useTaskAssessmentStore } from '@/stores/taskAssessment';
import { DEFAULT_TASK_ASSESSMENT_PROMPT, TASK_ASSESSMENT_PROMPT_PATH, readTaskAssessmentPrompt } from '@/task-assessment';

// Stores
const assessment = useTaskAssessmentStore();

// Reactive states
const draft = ref(assessment.prompt);
const isSaving = ref(false);
const error = ref('');
// Whether the file moved on under an edited field.
const conflict = ref(false);
// What the field held before a reset, while that can still be undone.
const beforeReset = ref<string | null>(null);

// Template refs
const field = ref<InstanceType<typeof VTextarea> | null>(null);

// Computed properties
// What saving the field would make the prompt.
const drafted = computed(() => readTaskAssessmentPrompt(draft.value) ?? DEFAULT_TASK_ASSESSMENT_PROMPT);
const changed = computed(() => drafted.value !== assessment.prompt);

// The prompt the field was filled from, and the file's version it came from, which a save
// replaces: not whatever the store read since, or a change made meanwhile would be saved over
// unseen.
let base = assessment.prompt;
let basedOn = assessment.version;

// Watchers
// The file is read after this component mounts, and again on every commit, so the field follows
// what it holds rather than what it held at setup. An edited field keeps the edit, or a reload
// would throw away what was typed, and says the file moved instead.
watch(() => [assessment.prompt, assessment.version], followFile);

watch(draft, (value) => {
    if (value !== DEFAULT_TASK_ASSESSMENT_PROMPT) {
        beforeReset.value = null;
    }
});

// Methods
function followFile() {
    if (isSaving.value || assessment.version === basedOn) {
        return;
    }
    // Compared as prompts, so a line break typed at the end is not an edit to keep.
    if (drafted.value === base || drafted.value === assessment.prompt) {
        fill();
    }
    else {
        conflict.value = true;
    }
}

function fill() {
    draft.value = assessment.prompt;
    base = assessment.prompt;
    basedOn = assessment.version;
    conflict.value = false;
    beforeReset.value = null;
}

async function keepMine() {
    // The version a refused save just asked to be read again, rather than the one it was refused
    // over.
    await assessment.ready();
    base = assessment.prompt;
    basedOn = assessment.version;
    conflict.value = false;
}

// Only the field: resetting is an edit like any other, kept by saving it.
function reset() {
    beforeReset.value = draft.value;
    draft.value = DEFAULT_TASK_ASSESSMENT_PROMPT;
    // The button just pressed is now disabled, which would leave the focus nowhere.
    field.value?.focus();
}

function undoReset() {
    draft.value = beforeReset.value ?? draft.value;
    beforeReset.value = null;
    field.value?.focus();
}

async function save() {
    isSaving.value = true;
    error.value = '';
    try {
        await assessment.save(draft.value, basedOn);
        fill();
    }
    catch (err) {
        if (err instanceof TaskAssessmentPromptConflict) {
            conflict.value = true;
        }
        else {
            error.value = `Could not save ${TASK_ASSESSMENT_PROMPT_PATH}: ${err}`;
        }
    }
    finally {
        isSaving.value = false;
    }
    // A commit read while saving was passed over.
    followFile();
}
</script>
