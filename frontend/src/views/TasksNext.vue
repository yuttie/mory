<template>
    <div id="tasks-next" class="d-flex" v-bind:class="{ 'flex-column': !$vuetify.display.smAndUp, 'flex-row': $vuetify.display.smAndUp }">
        <!-- Outside the check for a loaded store, so the app bar does not show the route's name
             until the tasks arrive. -->
        <AppBarContent>
            <v-toolbar-title class="ms-5">
                <div
                    v-if="store.isLoaded"
                    class="app-bar-title"
                >
                    <!-- First, so it stays put while the selection changes what follows it.
                         Opened by a tap as well as by hovering, since a phone cannot hover. -->
                    <v-menu
                        open-on-hover
                        open-on-click
                        location="bottom start"
                    >
                        <template v-slot:activator="{ props: statisticsProps }">
                            <span
                                v-bind="statisticsProps"
                                class="app-bar-count"
                            >
                                {{ tasksLeftText }}
                            </span>
                        </template>
                        <!-- Counted from the Status view's columns, so a task naming no status is
                             Backlog here as it is there. -->
                        <v-list>
                            <v-list-subheader>Statistics</v-list-subheader>
                            <v-list-item>
                                <v-list-item-title v-for="kind of STATUS_KINDS" v-bind:key="kind">
                                    {{ STATUS_LABEL[kind] }}: {{ taskStatuses[kind].length }}
                                </v-list-item-title>
                            </v-list-item>
                        </v-list>
                    </v-menu>
                    <v-divider
                        vertical
                        class="mx-3"
                    />
                    <template v-if="selectedNode">
                        <!-- Links, so a task up the path is one click away and can be opened in a
                             new tab. The root is what clears the selection: a row in the tree is a
                             link to its task, so clicking the selected one again keeps it. -->
                        <span class="app-bar-ancestors text-medium-emphasis">
                            <router-link
                                v-bind:to="tasksRoute(undefined, descendantsViewMode)"
                                class="app-bar-link"
                            >All tasks</router-link>
                            <template
                                v-for="node of selectedNodeAncestors"
                                v-bind:key="node.uuid"
                            >
                                <span class="app-bar-separator">›</span>
                                <!-- The view stays: going up lists the ancestor's descendants in
                                     the view they were listed in. -->
                                <router-link
                                    v-bind:to="tasksRoute(node.uuid, descendantsViewMode)"
                                    class="app-bar-link"
                                >{{ node.title || 'Untitled' }}</router-link>
                            </template>
                        </span>
                        <span class="app-bar-separator text-medium-emphasis">›</span>
                        <span class="app-bar-current">{{ selectedNode.title || 'Untitled' }}</span>
                    </template>
                    <!-- The root alone, so the path still says what the list holds with nothing
                         selected, and the root does not come and go with the selection. -->
                    <span
                        v-else
                        class="app-bar-current"
                    >All tasks</span>
                </div>
            </v-toolbar-title>
        </AppBarContent>
        <template v-if="store.isLoaded">
            <v-sheet class="d-flex flex-column task-tree-container"><!-- NOTE: Necessary for <TaskTree> to have vertical scrollbar -->
                <div class="tree-search d-flex align-center flex-grow-0">
                    <v-text-field
                        v-model="treeQuery"
                        v-bind:prepend-inner-icon="mdiMagnify"
                        label="Search tasks"
                        single-line
                        density="compact"
                        variant="outlined"
                        hide-details
                        clearable
                        autocomplete="off"
                    />
                    <!-- Counts the statuses left out, so a tree missing tasks says why. Named
                         outright, as the badge would otherwise name the button after itself. -->
                    <v-menu
                        v-bind:close-on-content-click="false"
                        location="bottom end"
                    >
                        <template v-slot:activator="{ props: filterProps }">
                            <v-icon-btn
                                v-bind="filterProps"
                                class="ml-1"
                                title="Choose which statuses are shown"
                                aria-label="Choose which statuses are shown"
                            >
                                <v-badge
                                    v-bind:model-value="hiddenTreeStatuses.length > 0"
                                    v-bind:content="hiddenTreeStatuses.length"
                                    label="Statuses hidden"
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
                                    v-on:click="hiddenTreeStatuses = togglePreset(hiddenTreeStatuses, preset.kinds)"
                                >
                                    <template v-slot:prepend>
                                        <v-checkbox-btn
                                            v-bind:model-value="presetStates[index] === 'shown'"
                                            v-bind:indeterminate="presetStates[index] === 'mixed'"
                                            class="mr-1"
                                            tabindex="-1"
                                        />
                                    </template>
                                    <template v-slot:append>
                                        <v-icon
                                            v-for="kind of preset.kinds"
                                            v-bind:key="kind"
                                            v-bind:icon="statusIcon(kind, false)"
                                            v-bind:color="statusColor(kind, taskSettings.resolvedStatusColors)"
                                            size="small"
                                            class="ml-1"
                                        />
                                    </template>
                                </v-list-item>
                                <v-divider />
                                <v-list-item
                                    v-for="kind of STATUS_KINDS"
                                    v-bind:key="kind"
                                    v-bind:title="STATUS_LABEL[kind]"
                                    v-on:click="toggleTreeStatus(kind)"
                                >
                                    <template v-slot:prepend>
                                        <v-checkbox-btn
                                            v-bind:model-value="!hiddenTreeStatuses.includes(kind)"
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
                                    v-bind:disabled="hiddenTreeStatuses.length === 0"
                                    title="Show all"
                                    v-on:click="hiddenTreeStatuses = []"
                                />
                            </v-list>
                        </v-card>
                    </v-menu>
                </div>
                <div
                    v-if="filteredForestWithTags.length === 0 && store.treeWithTagGroups.length > 0"
                    class="text-medium-emphasis pa-4"
                >
                    No tasks match.
                </div>
                <TaskTree
                    v-bind:items="filteredForestWithTags"
                    v-bind:active="activeNodeId"
                    v-bind:route-for="treeRouteFor"
                    v-bind:open="treeOpenNodes"
                    v-bind:highlight="treeTerms"
                    show-add-child
                    show-edit
                    movable
                    v-on:update:open="treeOpenNodes = $event"
                    v-on:add-child-task="onAddChildTask"
                    v-on:edit-task="onEditTask"
                    v-on:move="onTaskMove"
                    style="flex: 1 1 0"
                />
            </v-sheet>
            <div class="item-view d-flex flex-column">
                <v-toolbar flat border color="transparent" class="item-toolbar flex-grow-0">
                    <!-- View mode selector -->
                    <v-btn-toggle
                        v-bind:model-value="descendantsViewMode"
                        v-on:update:model-value="onViewModeChange"
                        mandatory
                        class="ml-2"
                    >
                        <v-btn
                            v-for="{ text, icon, value } of viewModeOptions"
                            v-bind:key="value"
                            v-bind:value="value"
                            v-bind:title="text"
                            class="toolbar-button"
                        >
                            <v-icon>{{ icon }}</v-icon>
                            <span class="toolbar-label">{{ text }}</span>
                        </v-btn>
                    </v-btn-toggle>
                    <!-- The selected task, in its editor over its list. A link, matched with its
                         query as a task in the list is, or it would be the current page on the
                         list itself; never drawn as current even so, as the dialog it opens covers
                         it. All tasks and a tag group are no task to edit, and it stays in its
                         place for them, so the buttons after it do not move with the selection. -->
                    <v-btn
                        title="Edit"
                        color="primary"
                        variant="outlined"
                        class="toolbar-button ml-3"
                        v-bind:to="listRoot === undefined ? undefined : taskRoute(listRoot, descendantsViewMode)"
                        exact
                        v-bind:disabled="listRoot === undefined"
                        v-bind:active="false"
                    >
                        <v-icon>{{ mdiPencil }}</v-icon>
                        <span class="toolbar-label">Edit</span>
                    </v-btn>
                    <!-- New task button -->
                    <v-btn
                        title="Add"
                        color="primary"
                        variant="outlined"
                        class="toolbar-button ml-2"
                        v-on:click="newTask"
                    >
                        <v-icon>{{ mdiPlus }}</v-icon>
                        <span class="toolbar-label">Add</span>
                    </v-btn>
                    <!-- Under the selected task, or with the selected group's tag, as Add
                         puts one. A phone has no room for it beside the view modes, so
                         there it is in the menu. -->
                    <v-btn
                        v-if="!$vuetify.display.xs"
                        title="Quick add"
                        color="primary"
                        variant="outlined"
                        class="toolbar-button ml-2"
                        v-on:click="openQuickAdd"
                    >
                        <v-icon>{{ mdiFormatListChecks }}</v-icon>
                        <span class="toolbar-label">Quick add</span>
                    </v-btn>
                    <v-spacer />
                    <v-menu
                        v-model="itemViewMenuIsVisible"
                        v-bind:close-on-content-click="false"
                    >
                        <template v-slot:activator="{ props: menuProps }">
                            <v-icon-btn
                                v-bind:icon="mdiDotsVertical"
                                v-bind="menuProps"
                                class="mr-2"
                            ></v-icon-btn>
                        </template>
                        <v-list>
                            <v-list-item
                                v-if="$vuetify.display.xs"
                                v-bind:prepend-icon="mdiFormatListChecks"
                                title="Quick add"
                                v-on:click="openQuickAdd"
                            ></v-list-item>
                            <v-list-subheader>Config</v-list-subheader>
                            <v-list-item title="Hide completed tasks in item view">
                                <template v-slot:prepend>
                                    <v-switch
                                        v-model="hideCompletedInItemView"
                                        hide-details
                                        class="mt-0 mr-2"
                                    ></v-switch>
                                </template>
                            </v-list-item>
                        </v-list>
                    </v-menu>
                </v-toolbar>
                <v-alert v-if="planHistoryError" type="warning">{{ planHistoryError }}</v-alert>
                <v-alert v-for="problem of taskSettings.problems" v-bind:key="problem" type="warning">{{ problem }}</v-alert>
                <div class="view-container flex-grow-1">
                    <!-- Status view -->
                    <TaskStatusView
                        v-if="descendantsViewMode === 'status'"
                        v-bind:task-statuses="taskStatuses"
                        v-bind:known-contacts="store.knownContacts"
                        v-bind:route-for="listRouteFor"
                        v-bind:list-root="listRoot"
                        v-on:status-change="onTaskStatusChange"
                    />
                    <!-- Schedule view -->
                    <TaskScheduleView
                        v-else-if="descendantsViewMode === 'schedule'"
                        v-bind:candidates="filteredSelectedNodeDescendants"
                        v-bind:route-for="listRouteFor"
                        v-bind:list-root="listRoot"
                    />
                    <!-- Eisenhower Matrix view -->
                    <TaskEisenhowerView
                        v-else-if="descendantsViewMode === 'eisenhower'"
                        v-bind:eisenhower-quadrants="eisenhowerQuadrants"
                        v-bind:route-for="listRouteFor"
                        v-bind:list-root="listRoot"
                    />
                </div>
            </div>
        </template>
        <!-- Drawn by the view rather than as a v-overlay: Vuetify puts an overlay opened over another
             just above it, so a dialog or a menu opened while the tasks loaded came out under the
             app bar and the drawer, which this stays beneath to leave them usable. -->
        <v-fade-transition>
            <div
                v-if="store.isLoading"
                class="loading d-flex align-center justify-center"
            >
                <v-progress-circular indeterminate size="64" />
            </div>
        </v-fade-transition>
        <v-snackbar v-model="error" color="error" location="top" timeout="5000">{{ error }}</v-snackbar>

        <!-- The task the address names, in its editor over the list, which stays as it was. A save
             leaves it open for the next change. Closes like any dialog while nothing is unsaved;
             from then on only its own buttons do, and `keepUnsavedEdit` refuses Back, so a stray
             click, Escape or Back cannot throw an edit away. Back changes the address, which
             closes it by itself: Vuetify's own handling of Back would cancel that and close it a
             second time. -->
        <v-dialog
            ref="editorDialogRef"
            v-bind:model-value="editedNode !== undefined"
            v-bind:fullscreen="$vuetify.display.smAndDown"
            v-bind:persistent="taskEditorRef?.isModified ?? false"
            v-bind:close-on-back="false"
            max-width="1400"
            height="100%"
            v-on:update:model-value="closeEditor"
            v-on:after-leave="returnFocus"
        >
            <v-progress-linear
                v-bind:active="saving || moving"
                indeterminate
                absolute
                color="primary"
                style="z-index: 1;"
            />
            <TaskEditorNext
                ref="taskEditorRef"
                v-bind:task-path="editedPath"
                v-bind:known-tags="store.knownTags"
                v-bind:known-contacts="store.knownContacts"
                v-bind:writing="saving || moving"
                v-on:save="onEditedTaskSave"
                v-on:delete="onEditedTaskDelete"
                v-on:cancel="closeEditor"
                v-on:change-parent="showChangeParentDialog"
                v-on:add-subtask="onAddSubtask"
                v-on:quick-add="onQuickAddSubtasks"
            />
        </v-dialog>
        <NewTaskDialog
            ref="newTaskDialogRef"
            v-model="newTaskDialogIsVisible"
            v-bind:initial-parent="newTaskStart.parent"
            v-bind:tag="newTaskStart.tag"
        />
        <QuickAddTasksDialog
            v-model="quickAddDialogIsVisible"
            v-bind:initial-parent="quickAddStart.parent"
            v-bind:tag="quickAddStart.tag"
        />

        <!-- Parent Selection Dialog -->
        <ParentSelectionDialog
            v-model="showParentDialog"
            mode="move"
            v-bind:parent="editedNode?.parent ?? null"
            v-bind:exclude="editedNode?.uuid"
            v-bind:task-title="editedNode?.title || 'Untitled'"
            v-bind:items="store.tree"
            v-on:choose="onParentChosen"
        />
    </div>
</template>

<script lang="ts" setup>
import { readImportance, isUrgent, compareUrgency } from '@/urgency';
import { useTaskSettingsStore } from '@/stores/taskSettings';
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { usePlansStore } from '@/stores/plans';
import {
    type RouteLocationNormalized,
    type RouteLocationRaw,
    onBeforeRouteLeave,
    onBeforeRouteUpdate,
    useRoute,
    useRouter,
} from 'vue-router';
import type { VDialog } from 'vuetify/components';
import { useDisplay } from 'vuetify';
import { useLocalStorage } from '@/composables/localStorage';
import AppBarContent from '@/components/AppBarContent.vue';
import type NewTaskDialog from '@/components/NewTaskDialog.vue';

import {
    mdiCalendarMultiselectOutline,
    mdiDotsVertical,
    mdiFilterVariant,
    mdiFormatListChecks,
    mdiGridLarge,
    mdiMagnify,
    mdiPencil,
    mdiPlus,
    mdiTrafficLightOutline,
} from '@mdi/js';

import { type TaskNode } from '@/task-forest';
import {
    STATUS_PRESETS,
    type PresetState,
    branchIds,
    filterTaskTree,
    presetState,
    searchTerms,
    togglePreset,
} from '@/task-tree-filter';
import { statusColor } from '@/status-color';
import { statusIcon } from '@/status-icon';
import { taskRoute, tasksRoute } from '@/task-route';
import { SavedUnlisted, isTagGroupId, isUntaggedGroupId, tagGroupId, tagNameOf, useTasksStore } from '@/stores/tasks';

import { type UUID, type Status, type StatusKind, type Task, STATUS_KINDS, STATUS_LABEL } from '@/task';
import axios from 'axios';
import dayjs from 'dayjs';

// Stores
const store = useTasksStore();
const taskSettings = useTaskSettingsStore();
const planHistoryError = ref('');
void taskSettings.load();

// Router
const router = useRouter();
const route = useRoute();

const display = useDisplay();

// Emits
const emit = defineEmits<{
    (e: 'tokenExpired', callback: () => void): void;
}>();

// Reactive states
const taskEditorRef = ref<any>(null);
const editorDialogRef = ref<InstanceType<typeof VDialog> | null>(null);
const newTaskDialogRef = ref<InstanceType<typeof NewTaskDialog> | null>(null);
const openNodes = ref<UUID[]>([]);
// What the search field holds. Null once cleared, as a clearable field leaves it.
const treeQuery = ref<string | null>('');
// What the tree is searched for: the field's text once typing pauses. Each search draws the tree
// anew, and over the 490 tasks of the real notes a broad one drawing 290 rows took Firefox 0.9 s:
// on every key, that would stall the typing, and each step an input method takes towards a word.
const treeSearch = ref('');
// The branches open while a search is under way, apart from `openNodes`, so clearing the search
// leaves the tree as it was before it.
const searchOpenNodes = ref<string[]>([]);
const newTaskDialogIsVisible = ref(false);
// Where the next new task starts: from Add, under the selected task or with the selected group's
// tag; from a row's own button, under that row's task or with its group's tag.
const newTaskStart = ref<{ parent: UUID | null; tag?: string | null }>({ parent: null });
const error = ref<string | null>(null);
// The statuses the tree leaves out, by name rather than by those it shows, so a status added
// later is shown until it is unticked.
const hiddenTreeStatuses = useLocalStorage<string[]>('task-tree-hidden-statuses', hiddenBySwitch());
const hideCompletedInItemView = useLocalStorage('hide-completed-in-item-view', false);
const showParentDialog = ref<boolean>(false);
// A save waits for the listing to show it and the editor to read it again, and a second press
// meanwhile would write the task again.
const saving = ref(false);
// A move of the task in the editor, until the listing shows it where it went. A save meanwhile
// would write it back to the path it left.
const moving = ref(false);
const quickAddDialogIsVisible = ref(false);
// Where the next outline starts, as `newTaskStart` for a single task: from Quick add, under the
// selected task or with the selected group's tag; from the editor, under the task it holds.
const quickAddStart = ref<{ parent: UUID | null; tag?: string | null }>({ parent: null });
const itemViewMenuIsVisible = ref(false);
// Statuses dropped in the status view and still being written, by task. The task is drawn where it
// was dropped until the listing shows the write, rather than jumping back to its old column.
const droppedStatuses = reactive(new Map<UUID, StatusKind>());

// URL-derived state (single source of truth)
const selectedNode = computed<TaskNode | undefined>(() => {
    if (route.name === 'TasksNextWithParams' && route.params.selectedNodeId) {
        const nodeId = route.params.selectedNodeId === '_' ? undefined : route.params.selectedNodeId as string;
        return nodeId ? store.node(nodeId) : undefined;
    }
    return undefined;
});

const descendantsViewMode = computed<'status' | 'schedule' | 'eisenhower'>(() => {
    if (route.name === 'TasksNextWithParams' && route.params.viewMode) {
        return route.params.viewMode as 'status' | 'schedule' | 'eisenhower';
    }
    return 'status';
});

// The task open in the editor over the list, which the address names. A tag group is no task to
// edit, and a task the listing does not hold has no path to read it from: not yet, while the first
// listing is on its way, and the editor opens once it lands.
const editedNode = computed<TaskNode | undefined>(() => {
    const id = route.query.task;
    return typeof id === 'string' && !isTagGroupId(id) ? store.node(id) : undefined;
});

// The edited task's path, kept after the editor closes: the dialog still draws it while it fades.
const editedPath = ref('');
watch(editedNode, (node) => {
    if (node) {
        editedPath.value = node.path;
    }
}, { immediate: true });

// What had focus when the editor opened, to have it again once the editor has closed: Vuetify gives
// it back only to a dialog's own activator, and the address opens this one.
let focusBeforeEditor: HTMLElement | null = null;
watch(() => editedNode.value !== undefined, (open) => {
    const element = document.activeElement;
    if (open && element instanceof HTMLElement && element !== document.body) {
        focusBeforeEditor = element;
    }
});

// Computed properties
const activeNodeId = computed<string | undefined>(() => {
    return selectedNode.value?.uuid;
});

const isTagGroupSelected = computed<boolean>(() => {
    return activeNodeId.value !== undefined && isTagGroupId(activeNodeId.value);
});

// The tasks above the selected node, root first. A tag group has none.
const selectedNodeAncestors = computed<TaskNode[]>(() => {
    return selectedNode.value ? store.ancestorsOf(selectedNode.value.uuid) : [];
});

// The task whose descendants the item view lists. A tag group's members are no task's descendants.
const listRoot = computed<UUID | undefined>(() => {
    return isTagGroupSelected.value ? undefined : activeNodeId.value;
});

const selectedTagName = computed<string | null>(() => {
    if (activeNodeId.value && isTagGroupSelected.value) {
        return tagNameOf(selectedNode.value.uuid);
    }
    return null;
});

// The tag a task created from the selected group starts with: `null` for the Untagged group, which
// has none to give, and `undefined` when no group is selected.
const newTaskTag = computed<string | null | undefined>(() => {
    if (activeNodeId.value === undefined || !isTagGroupId(activeNodeId.value)) {
        return undefined;
    }
    if (isUntaggedGroupId(activeNodeId.value)) {
        return null;
    }
    return selectedTagName.value ?? undefined;
});

// The task a new one is created under: the selected task, or none when a tag group or nothing is
// selected.
const newTaskParent = computed<UUID | null>(() => {
    if (selectedNode.value === undefined || isTagGroupSelected.value) {
        return null;
    }
    return selectedNode.value.uuid;
});

// Utility function to sort tasks by due date/deadline
function sortTasksByDueDate(tasks: TaskNode[]): TaskNode[] {
    return tasks.slice().sort((task1, task2) => {
        // First sort by completion status (incomplete tasks first)
        const isDone1 = task1.metadata?.task?.status?.kind === 'done' || task1.metadata?.task?.status?.kind === 'canceled';
        const isDone2 = task2.metadata?.task?.status?.kind === 'done' || task2.metadata?.task?.status?.kind === 'canceled';
        
        if (isDone1 && !isDone2) {
            return 1; // task1 is done, task2 is not - task2 should come first
        }
        if (!isDone1 && isDone2) {
            return -1; // task2 is done, task1 is not - task1 should come first
        }
        
        // Both tasks have same completion status, sort by dates
        const dueBy1 = task1.metadata?.task?.due_by;
        const dueBy2 = task2.metadata?.task?.due_by;
        const deadline1 = task1.metadata?.task?.deadline;
        const deadline2 = task2.metadata?.task?.deadline;
        
        // Get the earliest relevant date for each task (prioritize due_by over deadline)
        const date1 = dueBy1 || deadline1;
        const date2 = dueBy2 || deadline2;
        
        // If both have dates, sort by earliest first
        if (date1 && date2) {
            // Normalize dates: if no time portion, treat as end of day (23:59:59.999)
            const normalizeDate = (dateStr: string) => {
                const parsed = dayjs(dateStr);
                // Check if the date string contains time information
                // If it's just a date (YYYY-MM-DD format), set to end of day
                if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
                    return parsed.endOf('day');
                }
                return parsed;
            };
            
            const dayjs1 = normalizeDate(date1);
            const dayjs2 = normalizeDate(date2);
            
            if (dayjs1.isBefore(dayjs2)) {
                return -1; // task1 is earlier
            } else if (dayjs1.isAfter(dayjs2)) {
                return 1; // task2 is earlier
            } else {
                return 0; // same date
            }
        }
        
        // If only one has a date, prioritize the one with the date
        if (date1 && !date2) {
            return -1; // task1 has date, task2 doesn't - task1 comes first
        }
        if (!date1 && date2) {
            return 1; // task2 has date, task1 doesn't - task2 comes first
        }
        
        // Neither has dates, maintain original order
        return 0;
    });
}

const taskStatuses = computed<Record<StatusKind, TaskNode[]>>(() => {
    const statuses = Object.fromEntries(
        STATUS_KINDS.map((kind) => [kind, [] as TaskNode[]]),
    ) as Record<StatusKind, TaskNode[]>;

    for (const task of selectedNodeDescendants.value) {
        // A task that names no status is read as Backlog, as the editor reads it, so the column
        // it sits in and the status it opens with agree.
        const kind: StatusKind = droppedStatuses.get(task.uuid) ?? task.metadata?.task?.status?.kind ?? 'backlog';
        // A kind with no column is not drawn: the frontmatter is whatever the file said.
        statuses[kind]?.push(task);
    }

    // Sort each status group by due date/deadline
    for (const kind of STATUS_KINDS) {
        statuses[kind] = sortTasksByDueDate(statuses[kind]);
    }
    return statuses;
});

// Cleared at once: clearing is a single press, and the tree it gives back is the one left before.
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(treeQuery, (query) => {
    clearTimeout(searchTimer);
    const text = query ?? '';
    if (searchTerms(text).length === 0) {
        treeSearch.value = text;
        return;
    }
    searchTimer = setTimeout(() => {
        treeSearch.value = text;
    }, 250);
});
onUnmounted(() => clearTimeout(searchTimer));

const treeTerms = computed<string[]>(() => searchTerms(treeSearch.value));

// Computed property for filtered forest with tags
const filteredForestWithTags = computed(() => {
    return filterTaskTree(store.treeWithTagGroups, { query: treeSearch.value, hiddenStatuses: hiddenTreeStatuses.value });
});

// A search opens every branch it keeps, each being there for a task found under it. Opened again
// only when the branches change, so a branch closed meanwhile stays closed while what was found
// stays the same.
const searchBranches = computed<string[]>(() => treeTerms.value.length > 0 ? branchIds(filteredForestWithTags.value) : []);
watch(() => searchBranches.value.join('\n'), () => {
    searchOpenNodes.value = searchBranches.value;
});

const treeOpenNodes = computed<string[]>({
    get: () => treeTerms.value.length > 0 ? searchOpenNodes.value : openNodes.value,
    set: (ids) => {
        if (treeTerms.value.length > 0) {
            searchOpenNodes.value = ids;
        }
        else {
            openNodes.value = ids;
        }
    },
});

const presetStates = computed<PresetState[]>(() => STATUS_PRESETS.map((preset) => presetState(hiddenTreeStatuses.value, preset.kinds)));

function toggleTreeStatus(kind: StatusKind) {
    hiddenTreeStatuses.value = hiddenTreeStatuses.value.includes(kind)
        ? hiddenTreeStatuses.value.filter((hidden) => hidden !== kind)
        : [...hiddenTreeStatuses.value, kind];
}

// Where the statuses start for a browser that has not chosen any yet: what the switch they replace
// hid, Done and Canceled, if it was on. Its key is dropped, having nothing left to say.
function hiddenBySwitch(): StatusKind[] {
    const hidden = localStorage.getItem('hide-completed-in-tree-view') === 'true';
    localStorage.removeItem('hide-completed-in-tree-view');
    return hidden ? ['done', 'canceled'] : [];
}

// Helper function to filter task list based on status
function filterTasksByStatus(tasks: TaskNode[], hideCompleted: boolean): TaskNode[] {
    return tasks.filter(task => {
        const kind: StatusKind = task.metadata?.task?.status?.kind ?? 'backlog';
        if (hideCompleted && (kind === 'done' || kind === 'canceled')) return false;
        return true;
    });
}

// What the list beside the tree holds: the list root's descendants, a tag group's members, or every task.
// Taken from `listRoot`, so the items' paths start below the task the list is really under.
const selectedNodeDescendants = computed<TaskNode[]>(() => {
    if (listRoot.value !== undefined) {
        return store.flattenDescendants(listRoot.value);
    }
    if (isTagGroupSelected.value && selectedTagName.value) {
        return store.childrenOf(tagGroupId(selectedTagName.value));
    }
    return store.allTasks;
});

const filteredSelectedNodeDescendants = computed<TaskNode[]>(() => {
    return filterTasksByStatus(selectedNodeDescendants.value, hideCompletedInItemView.value);
});

// Among the tasks the list holds, so the count follows the selection. A task in the backlog is not
// taken on yet and a done or canceled one is over, so neither is left, whatever the list and the
// tree hide. Counted from the Status view's columns, as the popover is, so the two agree on
// where a task naming no status belongs.
const tasksLeftCount = computed<number>(() => {
    return STATUS_KINDS
        .filter((kind) => kind !== 'backlog' && kind !== 'done' && kind !== 'canceled')
        .reduce((count, kind) => count + taskStatuses.value[kind].length, 0);
});

// On a phone the selected node's path follows the count and needs the room: "7 left".
const tasksLeftText = computed<string>(() => {
    const count = tasksLeftCount.value;
    if (selectedNode.value !== undefined && display.xs.value) {
        return `${count} left`;
    }
    return `${count} ${count === 1 ? 'task' : 'tasks'} left`;
});

// Eisenhower Matrix computed properties
const eisenhowerQuadrants = computed(() => {
    const quadrants = {
        doFirst: [] as TaskNode[],      // High importance, High urgency
        schedule: [] as TaskNode[],     // High importance, Low urgency
        delegate: [] as TaskNode[],     // Low importance, High urgency
        unrated: [] as TaskNode[],
        eliminate: [] as TaskNode[],    // Low importance, Low urgency
    };

    for (const task of filteredSelectedNodeDescendants.value) {
        const importance = readImportance(task.metadata?.task?.importance);
        const isHighImportance = importance === 'medium' || importance === 'high';
        const isHighUrgency = isUrgent(store.urgency(task.uuid));
        if (!importance) {
            quadrants.unrated.push(task);
            continue;
        }

        if (isHighImportance && isHighUrgency) {
            quadrants.doFirst.push(task);
        } else if (isHighImportance && !isHighUrgency) {
            quadrants.schedule.push(task);
        } else if (!isHighImportance && isHighUrgency) {
            quadrants.delegate.push(task);
        } else {
            quadrants.eliminate.push(task);
        }
    }

    for (const tasks of Object.values(quadrants)) {
        tasks.sort((a, b) => compareUrgency(store.urgency(a.uuid), store.urgency(b.uuid)) || a.uuid.localeCompare(b.uuid));
    }
    return quadrants;
});

const viewModeOptions = computed(() => [
    { text: 'Status', icon: mdiTrafficLightOutline, value: 'status' },
    { text: 'Schedule', icon: mdiCalendarMultiselectOutline, value: 'schedule' },
    { text: 'Eisenhower Matrix', icon: mdiGridLarge, value: 'eisenhower' },
]);

// URL management functions

// Where choosing a row in the tree goes: what is under it, listed in the view it is in. The editor
// would cover that list, so a task's row opens it from its own button instead.
function treeRouteFor(node: TaskNode): RouteLocationRaw {
    return tasksRoute(node.uuid, descendantsViewMode.value);
}

// Where choosing a task in the list goes: its editor, over the list as it is.
function listRouteFor(node: TaskNode): RouteLocationRaw {
    return tasksRoute(activeNodeId.value, descendantsViewMode.value, node.uuid);
}

function navigateToState(selectedNodeId?: string, viewMode?: string) {
    router.push(tasksRoute(selectedNodeId, viewMode));
}

// Set while the view closes the editor itself, as Cancel and Delete do, for the navigation
// that closes it to pass `keepUnsavedEdit`.
let closingEditor = false;

// Closing the editor goes back to the list it was opened over: back through history when it was
// opened from that list, so Forward opens it again, and in place otherwise, as when a link in
// another view opened it, so that Back still leaves for that view.
function closeEditor(): void {
    if (route.query.task === undefined) {
        return;
    }
    const query = { ...route.query };
    delete query.task;
    const list = router.resolve({ path: route.path, query, hash: route.hash });
    closingEditor = true;
    if (router.options.history.state.back === list.fullPath) {
        router.back();
    }
    else {
        router.replace(list);
    }
}

// Focus back where it was before the editor opened, unless it has gone elsewhere meanwhile. A row's
// buttons in the tree are hidden until the row is hovered or holds focus, and a hidden button takes
// none, so its row takes it instead.
function returnFocus(): void {
    const element = focusBeforeEditor;
    focusBeforeEditor = null;
    if (element === null || !element.isConnected || (document.activeElement !== null && document.activeElement !== document.body)) {
        return;
    }
    element.focus();
    if (document.activeElement !== element) {
        element.parentElement?.closest<HTMLElement>('a[href], [tabindex]')?.focus();
    }
}

// The editor's button a dialog over it was opened from, to have focus again once that closes:
// Vuetify gives it back only to a dialog's own activator, and these open from the editor's events.
let focusInEditor: HTMLElement | null = null;
watch(() => newTaskDialogIsVisible.value || quickAddDialogIsVisible.value, async (open) => {
    const element = focusInEditor;
    if (open || element === null) {
        return;
    }
    focusInEditor = null;
    // A tick after the dialog closes, as Vuetify gives an activator its focus back.
    await nextTick();
    if (element.isConnected) {
        element.focus();
    }
});

function rememberFocusInEditor(): void {
    const element = document.activeElement;
    focusInEditor = element instanceof HTMLElement ? element : null;
}

// Back and Forward change the address, which closes the editor or puts another task in it. With an
// edit unsaved, that is refused as Escape and a click outside are, unless the view is closing the
// editor itself. A new task's draft goes with the view, and is kept from leaving it too.
function keepUnsavedEdit(to: RouteLocationNormalized): boolean {
    const closing = closingEditor;
    closingEditor = false;
    if (newTaskDialogRef.value?.isModified) {
        newTaskDialogRef.value.bounce();
        return false;
    }
    if (closing || editedNode.value === undefined || !taskEditorRef.value?.isModified) {
        return true;
    }
    if (to.name === 'TasksNextWithParams' && to.query.task === route.query.task) {
        return true;
    }
    editorDialogRef.value?.animateClick();
    return false;
}

onBeforeRouteUpdate(keepUnsavedEdit);
onBeforeRouteLeave(keepUnsavedEdit);
// A navigation another guard refuses never reaches `keepUnsavedEdit`, as when a dialog over the
// editor takes Back for itself, and the flag would let the next one through.
onUnmounted(router.afterEach(() => {
    closingEditor = false;
}));

// Opens the tree down to the task `id`, so that its row is drawn.
function openUpTo(id: UUID) {
    const next = new Set(openNodes.value);
    let parent = store.parentOf(id);
    while (parent) {
        next.add(parent);
        parent = store.parentOf(parent);
    }
    openNodes.value = [...next];
}

// Watchers for opening tree nodes when selected node changes
watch(selectedNode, (node) => {
    if (node) {
        openUpTo(node.uuid);
    }
});

// Lifecycle hooks
onMounted(async () => {
    document.title = `Tasks | ${import.meta.env.VITE_APP_NAME}`;
    window.addEventListener('focus', onWindowFocus);
    await load(true);
    try {
        await usePlansStore().loadAll();
    }
    catch (failure) {
        planHistoryError.value = String(failure);
    }
});

onUnmounted(() => {
    window.removeEventListener('focus', onWindowFocus);
});

function onWindowFocus() {
    load();
}

// Event handlers for UI interactions
function onViewModeChange(newViewMode: string) {
    navigateToState(selectedNode.value?.uuid, newViewMode);
}

// Methods
function newTask() {
    newTaskStart.value = { parent: newTaskParent.value, tag: newTaskTag.value };
    newTaskDialogIsVisible.value = true;
}

function onAddChildTask(id: UUID) {
    // A tag group is not a directory. Its task is a root task, which the group's tag files under it.
    newTaskStart.value = isTagGroupId(id)
        ? { parent: null, tag: isUntaggedGroupId(id) ? null : tagNameOf(id) }
        : { parent: id };
    newTaskDialogIsVisible.value = true;
}

// From the editor: a task under the one it holds, in the new-task dialog over it.
function onAddSubtask() {
    if (editedNode.value) {
        rememberFocusInEditor();
        newTaskStart.value = { parent: editedNode.value.uuid };
        newTaskDialogIsVisible.value = true;
    }
}

// From a row's own button: the task's editor over the list as it is, as from the list.
function onEditTask(id: UUID) {
    router.push(tasksRoute(activeNodeId.value, descendantsViewMode.value, id));
}

// The menu stays open for its switch, so it is closed here rather than left over the dialog.
function openQuickAdd() {
    itemViewMenuIsVisible.value = false;
    quickAddStart.value = { parent: newTaskParent.value, tag: newTaskTag.value };
    quickAddDialogIsVisible.value = true;
}

// From the editor: tasks under the one it holds, in the quick-add dialog over it.
function onQuickAddSubtasks() {
    if (editedNode.value) {
        rememberFocusInEditor();
        quickAddStart.value = { parent: editedNode.value.uuid };
        quickAddDialogIsVisible.value = true;
    }
}

async function onEditedTaskSave(task: Task) {
    const node = editedNode.value;
    if (node === undefined || saving.value || moving.value) {
        return;
    }
    saving.value = true;
    let written: string | undefined;
    try {
        // The forest is derived from the file listing, so there is nothing to update by hand:
        // saving waits until the write is visible in the listing, and the tree follows from that.
        written = await store.save(task, node.path);
    }
    catch (e) {
        if (!(e instanceof SavedUnlisted)) {
            // The editor stays open with what was typed, so it can be tried again.
            error.value = `Could not save "${task.title}": ${e instanceof Error ? e.message : String(e)}`;
            saving.value = false;
            return;
        }
        // Saved all the same, so the editor counts its next change from this write.
        written = e.written;
        error.value = `Saved "${task.title}", but ${e.message}`;
    }
    // The editor stays open for the next change, unless Cancel closed it meanwhile, and reads the
    // note again to count that change from. Until then it still holds this one as unsaved.
    try {
        if (editedNode.value?.uuid === task.uuid) {
            await taskEditorRef.value?.saved(task, written);
        }
    }
    catch (e) {
        error.value = `Saved "${task.title}", but could not read it again: ${e instanceof Error ? e.message : String(e)}`;
    }
    finally {
        saving.value = false;
    }
}

async function onTaskStatusChange(task: TaskNode, status: Status) {
    // A second drop before the first is written would read the note the first is still changing.
    if (droppedStatuses.has(task.uuid)) {
        return;
    }
    droppedStatuses.set(task.uuid, status.kind);
    try {
        await store.setStatus(task.path, status);
    }
    catch (e) {
        error.value = `Could not move "${task.title}" to ${STATUS_LABEL[status.kind]}: ${e instanceof Error ? e.message : String(e)}`;
    }
    finally {
        droppedStatuses.delete(task.uuid);
    }
}

async function onEditedTaskDelete(path: string) {
    const uuid = store.idByPath(path);
    if (!uuid) {
        return;
    }
    try {
        await store.remove(path);
    }
    catch (e) {
        error.value = `Could not delete "${editedNode.value?.title || 'Untitled'}": ${e instanceof Error ? e.message : String(e)}`;
        return;
    }
    // The list of what was under it went with it. Read from the address, as the listing no longer
    // holds the task to select.
    if (route.params.selectedNodeId === uuid) {
        closingEditor = true;
        router.replace(tasksRoute(undefined, descendantsViewMode.value));
    }
    else {
        closeEditor();
    }
}

async function onParentChosen(newParentUuid: UUID | null) {
    if (!editedNode.value) {
        return;
    }

    // The address names the task by its UUID, which a move keeps, so it needs no new one.
    const id = editedNode.value.uuid;
    moving.value = true;
    try {
        await store.move(id, newParentUuid);
        // Where it went, as for a task dropped in the tree, to be seen once the editor closes.
        openUpTo(id);
    } catch (e) {
        console.error('Failed to move task:', e);
        error.value = e instanceof Error ? e.message : 'Failed to move task';
    } finally {
        moving.value = false;
    }
}

// A task dropped on another in the tree.
async function onTaskMove(id: UUID, parent: UUID | null) {
    const title = store.node(id)?.title || 'Untitled';
    try {
        await store.move(id, parent);
        // Where it went, rather than leave it to vanish into a closed task.
        openUpTo(id);
    }
    catch (e) {
        error.value = `Could not move "${title}": ${e instanceof Error ? e.message : String(e)}`;
    }
}

// Not while a save runs, as in the new-task dialog: it writes to the path it started with, which a
// move meanwhile would leave behind. Nor while a move runs, as the editor's button says.
function showChangeParentDialog() {
    if (editedNode.value && !saving.value && !moving.value) {
        showParentDialog.value = true;
    }
}

// `primed` is true only for the very first load, which reads the cached `.tasks/` rows before
// asking the server, so the tree paints without waiting for the whole listing to sync.
async function load(primed = false) {
    error.value = null;
    try {
        await (primed ? store.init() : store.refresh());
    }
    catch (e) {
        if (axios.isAxiosError(e) && e.response?.status === 401) {
            // Unauthorized
            emit('tokenExpired', () => load());
            return;
        }
        // Unhandled errors
        error.value = e.toString();
    }
}
</script>

<style scoped lang="scss">
#tasks-next {
    height: 100%;
    user-select: none;
}

/* Mobile responsive adjustments for main container */
@media (max-width: 959px) { /* md breakpoint in Vuetify 2 */
    #tasks-next {
        padding: 4px;
    }
}

/* The buttons' labels go by the toolbar's own width, not the window's: the list shares the window
   with the drawer and the tree, and labels too wide for the toolbar push the view modes out of it.
   Without them a button is square, as a minimum width kept for a label is room the toolbar runs
   out of on a phone. Labelled, the buttons take 686px. */
.item-toolbar {
    container-type: inline-size;
}

@container (width < 700px) {
    .toolbar-label {
        display: none;
    }

    .toolbar-button {
        min-width: 0;
        padding: 0;
        aspect-ratio: 1;
    }
}

.app-bar-title {
    display: flex;
    align-items: center;
    white-space: nowrap;
}

.app-bar-count,
.app-bar-separator {
    flex: none;
}

.app-bar-separator {
    margin: 0 0.3em;
}

.app-bar-ancestors,
.app-bar-current {
    overflow: hidden;
    text-overflow: ellipsis;
}

/* In the path's own colour, so the selected task still stands out from the ones above it. */
.app-bar-link {
    color: inherit;
    text-decoration: none;

    &:hover,
    &:focus-visible {
        text-decoration: underline;
    }
}

/* The ancestors give way long before the selected task's own title does, which is what the bar is
   about; they keep room for an ellipsis, so the path still reads as one. */
.app-bar-ancestors {
    flex: 0 10000 auto;
    min-width: 1.2em;
}

.app-bar-current {
    flex: 0 1 auto;
    min-width: 0;
}

// Shaded as a v-overlay shades what lies under it.
.loading {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: rgba(0, 0, 0, 0.32);
}

.task-tree {
    width: 300px;
    overflow: hidden auto;
}

.task-tree-container {
    width: 300px;
}

.tree-search {
    padding: 8px 8px 4px;
}

/* Mobile responsive adjustments */
@media (max-width: 599px) { /* sm breakpoint in Vuetify 2 */
    /* With the 52px of the search row above the tree, which keeps the room it had without it. */
    .task-tree-container {
        width: 100%;
        max-height: 252px;
        min-height: 202px;
    }

    .task-tree {
        width: 100%;
    }
}

.item-view {
    flex: 1 1 0;
    min-width: 0;
}

/* Mobile responsive adjustments for item view */
@media (max-width: 959px) { /* md breakpoint in Vuetify 2 */
    .item-view {
        min-height: 0; /* Allow shrinking on mobile */
    }
}

.view-container {
    flex: 1 1 0;
    display: flex;
    flex-direction: row;
    overflow: hidden;
}
</style>
