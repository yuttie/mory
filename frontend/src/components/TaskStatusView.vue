<template>
    <div
        class="status-view groups"
        v-bind:class="{ dragging: draggedFrom !== null }"
    >
        <TaskGroup
            v-for="column of COLUMNS"
            v-bind:key="column.kind"
            class="group"
            v-bind:title="STATUS_LABEL[column.kind]"
            v-bind:class="{
                origin: column.kind === draggedFrom,
                refused: draggedFrom !== null && !canTransition(draggedFrom, column.kind),
            }"
        >
            <!-- `model-value` rather than `list`: the lists are derived from the listing, so a drop
                 is reported and the parent writes it; nothing here moves a task itself.
                 `force-fallback` because Sortable scrolls near an edge only for a drag it runs
                 itself. A native drag leaves that to the browser, and a touch drag in a browser
                 that has native ones is scrolled by neither -- and on a phone each column is the
                 width of the screen, so no other column could be reached.
                 `fallback-on-body` because on iOS Sortable positions that copy absolutely inside
                 the column it left, and the column's scrolling body clips it: it vanished as soon
                 as it left its column.
                 Each task is a link made undraggable, or the browser would start a drag of its own
                 to carry off the address, and Sortable's would stop at the first move. Said here,
                 away from `draggable`, because a comment in the `item` slot is a second node in a
                 development build, and vuedraggable refuses a slot with more than one. -->
            <draggable
                class="task-list"
                item-key="uuid"
                v-bind:model-value="taskStatuses[column.kind]"
                v-bind:group="column.group"
                v-bind:sort="false"
                v-bind:force-fallback="true"
                v-bind:fallback-on-body="true"
                v-bind:delay="500"
                v-bind:delay-on-touch-only="true"
                v-on:start="draggedFrom = column.kind"
                v-on:end="draggedFrom = null"
                v-on:clone="onClone"
                v-on:change="onChange(column.kind, $event)"
            >
                <template v-slot:item="{ element: task }">
                    <div class="task-list-entry">
                        <TaskListItemNext
                            v-bind:value="task"
                            v-bind:to="routeFor(task)"
                            v-bind:list-root="listRoot"
                            v-bind:status="column.kind"
                            draggable="false"
                            v-on:pointerdown="onPointerDown"
                            v-on:contextmenu="onContextMenu"
                        />
                    </div>
                </template>
            </draggable>
        </TaskGroup>
        <v-dialog
            v-bind:model-value="awaiting !== null"
            max-width="500px"
            v-on:update:model-value="awaiting = null"
        >
            <v-card v-if="awaiting !== null">
                <v-form
                    ref="formRef"
                    v-on:submit.prevent="onFieldsSubmit"
                >
                    <v-card-title>Move to {{ STATUS_LABEL[awaiting.status.kind] }}</v-card-title>
                    <v-card-subtitle>{{ awaiting.task.title }}</v-card-subtitle>
                    <v-card-text>
                        <TaskStatusFields
                            v-model="awaiting.status"
                            v-bind:known-contacts="knownContacts"
                            autofocus
                        />
                    </v-card-text>
                    <v-card-actions>
                        <v-spacer />
                        <v-btn
                            variant="text"
                            v-on:click="awaiting = null"
                        >
                            Cancel
                        </v-btn>
                        <v-btn
                            type="submit"
                            color="primary"
                        >
                            Move
                        </v-btn>
                    </v-card-actions>
                </v-form>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import draggable from 'vuedraggable';
import type { VForm } from 'vuetify/components';

import { type TaskNode } from '@/task-forest';
import { type UUID, type Status, type StatusKind, STATUS_KINDS, STATUS_LABEL, canTransition, hasFields, makeDefaultStatus, withoutBlanks } from '@/task';

// Props
defineProps<{
    taskStatuses: Record<StatusKind, TaskNode[]>;
    knownContacts: [string, number][];
    routeFor: (task: TaskNode) => RouteLocationRaw;
    listRoot?: UUID;
}>();

// Emits
const emit = defineEmits<{
    (e: 'status-change', task: TaskNode, status: Status): void;
}>();

// Reactive states
// The column a drag started in. Its kind stands for the task's status, since that is the column
// the status put it in; only the kind decides a transition.
const draggedFrom = ref<StatusKind | null>(null);
// A drop on a status with fields of its own, shown to be filled in before it is written.
const awaiting = ref<{ task: TaskNode; status: Status } | null>(null);

// The columns, left to right, each with its group, made once. Sortable tells the column a drag
// started in from the others by its group, and remakes the group every time the option is set --
// which vuedraggable does for every attribute of `<draggable>` whenever any of them changes. Once
// remade mid-drag, the column stops counting as the task's own, and Sortable moves the task about
// in it as if it had come from elsewhere. Starting a drag re-renders this view, so nothing passed
// to `<draggable>` may change from one render to the next: a group written into the template would
// be a new object each time.
// `pull: 'clone'` leaves a copy at the task's place while it is over another column, so that place
// stays open wherever the task is held (see `onClone`).
// A drop obeys the transitions the editor offers while locked. Unlocking is an exception made
// deliberately, one edit at a time, so reopening a finished task stays the editor's to do.
const COLUMNS = STATUS_KINDS.map((kind) => ({
    kind,
    group: {
        name: 'tasks',
        pull: 'clone',
        put: () => draggedFrom.value !== null && canTransition(draggedFrom.value, kind),
    },
}));

// Template refs
const formRef = ref<InstanceType<typeof VForm> | null>(null);

// How a task was last pressed. On a touch screen a long press is what picks a task up, and on a
// link it also opens the browser's menu for the link, which takes over the touch and ends the drag.
// A mouse keeps the menu: its right button picks nothing up. Taken from `pointerdown` because not
// every browser says on `contextmenu` itself what the pointer was.
let pressedWith = '';

// Methods
function onPointerDown(event: { pointerType: string }) {
    pressedWith = event.pointerType;
}

function onContextMenu(event: { preventDefault: () => void }) {
    if (pressedWith === 'touch') {
        event.preventDefault();
    }
}

// Marks the copy Sortable leaves at a task's place while the task is over another column, so it is
// drawn as that place, left open, rather than as the task.
function onClone(event: { clone: { classList: { add: (token: string) => void } } }) {
    event.clone.classList.add('vacated');
}

function onChange(kind: StatusKind, event: { added?: { element: TaskNode } }) {
    // Only the column a drop reached hears of it: with `pull: 'clone'` vuedraggable reports no
    // `removed` to the one it left, and with `sort: false` nothing is ever `moved`.
    const task = event.added?.element;
    if (task === undefined) {
        return;
    }
    const status = makeDefaultStatus(kind);
    // A status with fields has them all shown first, required or optional.
    if (hasFields(kind)) {
        awaiting.value = { task, status };
    }
    else {
        emit('status-change', task, status);
    }
}

async function onFieldsSubmit() {
    const current = awaiting.value;
    const result = await formRef.value?.validate();
    if (current === null || !result?.valid) {
        return;
    }
    emit('status-change', current.task, withoutBlanks(current.status));
    awaiting.value = null;
}
</script>

<style scoped lang="scss">
$group-width: 270px;
$space: 8px;

.groups {
    flex: 1 1 0;
    display: flex;
    width: 0;
    height: 100%;
    overflow-x: auto;
    gap: 16px;
    padding: $space;
}

.group {
    flex: 1 0 auto;
    width: $group-width;
}

/* Mobile responsive adjustments for groups */
@media (max-width: 959px) { /* md breakpoint in Vuetify 2 */
    .groups {
        padding: $space / 2;
        gap: $space / 2;
    }

    .group {
        width: 100%;
    }
}

/* As tall as its column at least, so a task dropped below the last one, or into an empty column,
   still lands in the list. */
.task-list {
    min-height: 100%;
    display: flex;
    flex-direction: column;
}

/* The space between two cards is the upper one's entry's, not a gap of the list's: Sortable takes a
   task held over another task, or past either end of the list, and one held over the list itself
   anywhere else goes nowhere. Below the card, so the hidden copy held at the top of another column
   opens no space above the first task there. */
.task-list-entry:not(:last-child) {
    padding-bottom: 16px;
}

.refused {
    opacity: 0.4;
}

/* The drag styles of the tasks in the columns. */

/* The copy that follows the pointer is Sortable's copy of the task's entry, drawn on the page's body
   and carrying whatever the task held when the drag began -- the ripple of the press that picked it
   up included, which nothing would ever fade there. */
.sortable-drag :deep(.v-ripple__container) {
    display: none;
}

/* iOS answers a long press on a link with its preview of the link, and fires no event that could be
   canceled first, as `onContextMenu` cancels Android's menu. */
.groups :deep(.task-list-item) {
    -webkit-touch-callout: none;
}

/* A task pressed to be picked up shows no hover shade: it is being taken, not pointed at. The
   shade is the card's overlay, drawn at this opacity. */
.groups :deep(.sortable-chosen .task-list-item) {
    --v-hover-opacity: 0;
}

/* A drop decides the column and nothing else, since each column is ordered by date. So a task held
   over another column opens no gap between two of its tasks, as if it could go there; that column
   is marked as a whole instead. The one gap is the place the task left, which stays open in its
   own column wherever it is held: as the task itself while it is over that column (Sortable keeps
   it at its place there), and as the copy left in its stead while it is over another. */
.groups :deep(:is(.sortable-ghost, .vacated)) {
    visibility: hidden;
}

/* Under `.dragging` because Sortable measures the task for the copy that follows the pointer
   before `.dragging` is drawn: hidden at that moment, the copy made from it would be zero-sized. */
.dragging .group:not(.origin) :deep(.sortable-ghost) {
    display: none;
}

/* The tasks a dragged one passes over are not places it can go, so they must not answer the pointer
   as if they were: no hover shade, no pointing hand, no tooltip from a date or note. Only what is
   inside a task stops taking the pointer, which is where the tooltips are. The task itself still
   takes it: Sortable finds the column under the pointer through the task there. */
.dragging :deep(.task-list-item) {
    --v-hover-opacity: 0;
    cursor: inherit;

    & * {
        pointer-events: none;
    }
}

.dragging .group:not(.origin):has(.sortable-ghost) {
    outline: 2px solid rgb(var(--v-theme-primary));
}
</style>
