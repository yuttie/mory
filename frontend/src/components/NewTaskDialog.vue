<template>
    <!-- Closes like any dialog until something is typed; from then on only the editor's Cancel
         does, so a stray click, Escape or the phone's Back gesture cannot throw a draft away. As
         tall as the screen allows, like the editor in the task view, whose panes fill the height
         they are given rather than sizing to their content. -->
    <v-dialog
        ref="dialogRef"
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
            v-bind:selected-tag="placedUnder === null ? tag : undefined"
            v-on:save="onSave"
            v-on:cancel="isOpen = false"
            v-on:change-parent="onChooseParent"
        />
    </v-dialog>
    <!-- Only while the editor is open: the tree it lists is the whole task forest, which no page
         should rebuild on every sync for a dialog nobody has opened. -->
    <ParentSelectionDialog
        v-if="isOpen"
        v-model="parentDialogIsVisible"
        mode="choose"
        v-bind:parent="placedUnder"
        v-bind:exclude="taskUuid"
        v-bind:items="tasks.tree"
        v-on:choose="parent = $event"
    />
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

import ParentSelectionDialog from '@/components/ParentSelectionDialog.vue';
import TaskEditorNext from '@/components/TaskEditorNext.vue';
import type { VDialog } from 'vuetify/components';

import type { Task, UUID } from '@/task';
import { taskRoute } from '@/task-route';
import { SavedUnlisted, useTasksStore } from '@/stores/tasks';

// Props
const props = defineProps<{
    // The task a draft starts under when the dialog opens, or `null` for the top.
    initialParent?: UUID | null;
    // The tag a draft at the top starts with, as the task view gives one started from a tag group:
    // `null` for the Untagged group, which has none to give. Under a task it is no group's
    // heading, so the editor is told of it only at the top.
    tag?: string | null;
}>();

// Composables
const router = useRouter();
const tasks = useTasksStore();

const isOpen = defineModel<boolean>({ required: true });

// Reactive states
const taskUuid = ref<UUID>(crypto.randomUUID());
// The task to create the new one under, or `null` for a root task. Each draft starts where the host
// says, which from the drawer is the root, until another is chosen.
const parent = ref<UUID | null>(null);
const parentDialogIsVisible = ref(false);
// The drafts being written, by UUID. A save can outlast its draft: Cancel and Add again during
// one, and the next draft is open by the time it ends.
const saving = reactive(new Set<UUID>());
const error = ref(false);
const errorText = ref('');
const successMessage = ref(false);
const successText = ref('');
const createdTaskUuid = ref<UUID | null>(null);

// Template refs
const dialogRef = ref<InstanceType<typeof VDialog> | null>(null);
const editorRef = ref<InstanceType<typeof TaskEditorNext> | null>(null);

// Computed properties
// The parent chosen, while the listing still holds it: one deleted meanwhile leaves the task at the
// root, which the editor's heading then says too.
const placedUnder = computed<UUID | null>(() => {
    return parent.value !== null && tasks.node(parent.value) !== undefined ? parent.value : null;
});

// Choosing another parent changes the path but not the UUID, which is what keeps the editor from
// starting the task afresh.
const taskPath = computed<string>(() => tasks.pathUnder(placedUnder.value, taskUuid.value));

// Watchers
// Every opening is another task. The dialog drops the editor once closed, so the next one mounts
// afresh on the new path.
watch(isOpen, (open) => {
    if (open) {
        taskUuid.value = crypto.randomUUID();
        parent.value = props.initialParent ?? null;
    }
});

// Methods
// Not while a save runs: it writes to the path it started with, and a parent chosen meanwhile would
// be dropped without a word.
function onChooseParent(): void {
    if (!saving.has(taskUuid.value)) {
        parentDialogIsVisible.value = true;
    }
}

async function onSave(task: Task): Promise<void> {
    // The write and the sync after it take a moment, and a second press would write the task again.
    if (saving.has(task.uuid)) {
        return;
    }
    saving.add(task.uuid);
    let unlisted: SavedUnlisted | null = null;
    try {
        await tasks.save(task, taskPath.value);
    }
    catch (e) {
        if (!(e instanceof SavedUnlisted)) {
            // The editor stays open with what was typed, so it can be tried again.
            errorText.value = `Failed to create task: ${e instanceof Error ? e.message : String(e)}`;
            error.value = true;
            return;
        }
        // Created all the same, so it is not offered to be created again.
        unlisted = e;
    }
    finally {
        saving.delete(task.uuid);
    }
    // Only the draft that was saved: one opened since holds what is being typed now.
    if (taskUuid.value === task.uuid) {
        isOpen.value = false;
    }
    successText.value = unlisted === null
        ? `Task "${task.title}" created successfully!`
        : `Task "${task.title}" created, but ${unlisted.message}`;
    createdTaskUuid.value = task.uuid;
    successMessage.value = true;
}

function openCreatedTask(): void {
    if (createdTaskUuid.value !== null) {
        router.push(taskRoute(createdTaskUuid.value));
    }
    successMessage.value = false;
}

// Expose
// For a host that a navigation may take the dialog away with: Vuetify keeps a draft from Back by
// itself, but not from a Back to an entry a replace made, such as the first one in a tab.
defineExpose({
    isModified: computed<boolean>(() => isOpen.value && (editorRef.value?.isModified ?? false)),
    bounce: (): void => {
        dialogRef.value?.animateClick();
    },
});
</script>
