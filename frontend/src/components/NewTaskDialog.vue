<template>
    <!-- Closes like any dialog until something is typed; from then on only the editor's Cancel
         does, so a stray click, Escape or the phone's Back gesture cannot throw a draft away. As
         tall as the screen allows, like the editor in the task view, whose panes fill the height
         they are given rather than sizing to their content. -->
    <v-dialog
        v-model="isOpen"
        v-bind:fullscreen="$vuetify.display.smAndDown"
        v-bind:persistent="editorRef?.isModified ?? false"
        max-width="1400"
        height="100%"
    >
        <v-progress-linear
            v-bind:active="saving.has(taskUuid)"
            indeterminate
            absolute
            color="primary"
            style="z-index: 1;"
        ></v-progress-linear>
        <TaskEditorNext
            ref="editorRef"
            v-bind:task-path="taskPath"
            v-bind:known-tags="tasks.knownTags"
            v-bind:known-contacts="tasks.knownContacts"
            v-on:save="onSave"
            v-on:cancel="isOpen = false"
        />
    </v-dialog>
    <v-snackbar
        v-model="error"
        color="error"
        location="top"
        timeout="5000"
    >
        {{ errorText }}
    </v-snackbar>
    <v-snackbar
        v-model="successMessage"
        color="success"
        location="top"
        timeout="5000"
    >
        {{ successText }}
        <template v-slot:actions>
            <v-btn
                variant="text"
                v-on:click="openCreatedTask"
            >
                Open
            </v-btn>
        </template>
    </v-snackbar>
</template>

<script lang="ts" setup>
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import TaskEditorNext from '@/components/TaskEditorNext.vue';
import type { Task, UUID } from '@/task';
import { taskRoute } from '@/task-route';
import { useTasksStore } from '@/stores/tasks';

// Composables
const router = useRouter();
const tasks = useTasksStore();

const isOpen = defineModel<boolean>({ required: true });

// Reactive states
const taskUuid = ref<UUID>(crypto.randomUUID());
// The drafts being written, by UUID. A save can outlast its draft: Cancel and Add again during
// one, and the next draft is open by the time it ends.
const saving = reactive(new Set<UUID>());
const error = ref(false);
const errorText = ref('');
const successMessage = ref(false);
const successText = ref('');
const createdTaskUuid = ref<UUID | null>(null);

// Template refs
const editorRef = ref<InstanceType<typeof TaskEditorNext> | null>(null);

// Computed properties
// A root task: the drawer has no task selected to put it under.
const taskPath = computed<string>(() => tasks.pathUnder(null, taskUuid.value));

// Watchers
// Every opening is another task. The dialog drops the editor once closed, so the next one mounts
// afresh on the new path.
watch(isOpen, (open) => {
    if (open) {
        taskUuid.value = crypto.randomUUID();
    }
});

// Methods
async function onSave(task: Task): Promise<void> {
    // The write and the sync after it take a moment, and a second press would write the task again.
    if (saving.has(task.uuid)) {
        return;
    }
    saving.add(task.uuid);
    try {
        await tasks.save(task, taskPath.value);
    }
    catch (e) {
        // The editor stays open with what was typed, so it can be tried again.
        errorText.value = `Failed to create task: ${e instanceof Error ? e.message : String(e)}`;
        error.value = true;
        return;
    }
    finally {
        saving.delete(task.uuid);
    }
    // Only the draft that was saved: one opened since holds what is being typed now.
    if (taskUuid.value === task.uuid) {
        isOpen.value = false;
    }
    successText.value = `Task "${task.title}" created successfully!`;
    createdTaskUuid.value = task.uuid;
    successMessage.value = true;
}

function openCreatedTask(): void {
    if (createdTaskUuid.value !== null) {
        router.push(taskRoute(createdTaskUuid.value));
    }
    successMessage.value = false;
}
</script>
