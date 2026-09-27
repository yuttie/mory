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
                                v-bind:to="routeToState(undefined, 'descendants', descendantsViewMode)"
                                class="app-bar-link"
                            >All tasks</router-link>
                            <template
                                v-for="node of selectedNodeAncestors"
                                v-bind:key="node.uuid"
                            >
                                <span class="app-bar-separator">›</span>
                                <!-- The tab stays: going up from a list lists the ancestor's
                                     descendants, and from the editor edits the ancestor. -->
                                <router-link
                                    v-bind:to="routeToState(node.uuid, itemViewTab, descendantsViewMode)"
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
            <v-menu
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
                    <v-list-subheader>Config</v-list-subheader>
                    <v-list-item title="Hide completed tasks in tree view">
                        <template v-slot:prepend>
                            <v-switch
                                v-model="hideCompletedInTreeView"
                                hide-details
                                class="mt-0 mr-2"
                            ></v-switch>
                        </template>
                    </v-list-item>
                </v-list>
            </v-menu>
        </AppBarContent>
        <template v-if="store.isLoaded">
            <v-sheet class="d-flex flex-column task-tree-container"><!-- NOTE: Necessary for <TaskTree> to have vertical scrollbar -->
                <TaskTree
                    v-bind:items="filteredForestWithTags"
                    v-bind:active="activeNodeId"
                    v-bind:route-for="taskRoute"
                    v-model:open="openNodes"
                    show-add-child
                    v-on:add-child-task="onAddChildTask"
                    style="flex: 1 1 0"
                />
            </v-sheet>
            <div class="item-view d-flex flex-column">
                <div class="d-flex flex-row">
                    <v-tabs
                        v-bind:model-value="itemViewTab"
                        v-on:update:model-value="onTabChange"
                    >
                        <v-tab
                            v-if="newTaskPath || selectedNode && !isTagGroupSelected"
                            value="selected"
                        >
                            {{ newTaskPath ? 'New' : 'Selected' }}
                        </v-tab>
                        <v-tab value="descendants">
                            {{ isTagGroupSelected ? 'Tagged Tasks' : selectedNode ? 'Descendants' : 'All tasks' }}
                        </v-tab>
                    </v-tabs>
                </div>
                <v-window
                    v-bind:model-value="itemViewTab"
                    class="d-flex flex-column"
                    style="flex: 1 1 0; background: transparent;"
                >
                    <v-window-item v-if="newTaskPath || selectedNode && !isTagGroupSelected" value="selected">
                        <TaskEditorNext
                            ref="taskEditorRef"
                            v-bind:task-path="newTaskPath ?? selectedNode.path"
                            v-bind:known-tags="knownTags"
                            v-bind:known-contacts="knownContacts"
                            v-bind:parent-task-title="selectedNodeParentTitle"
                            v-bind:ancestor-titles-for-task-assessment="selectedNodeAncestorTitlesForTaskAssessment"
                            v-bind:selected-tag="newTaskPath ? newTaskTag : undefined"
                            class="ma-4"
                            v-on:save="onSelectedTaskSave"
                            v-on:delete="onSelectedTaskDelete"
                            v-on:cancel="onNewTaskCancel"
                            v-on:change-parent="showChangeParentDialog"
                        />
                    </v-window-item>
                    <v-window-item value="descendants">
                        <v-toolbar flat border color="transparent" class="flex-grow-0">
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
                                >
                                    <v-icon>{{ icon }}</v-icon>
                                    <span v-if="$vuetify.display.mdAndUp">{{ text }}</span>
                                </v-btn>
                            </v-btn-toggle>
                            <!-- New task button -->
                            <v-btn
                                title="Add"
                                color="primary"
                                variant="outlined"
                                class="ml-3"
                                v-bind:class="{ 'pa-0': !$vuetify.display.mdAndUp }"
                                v-on:click="newTask"
                            >
                                <v-icon>{{ mdiPlus }}</v-icon>
                                <span v-if="$vuetify.display.mdAndUp">Add</span>
                            </v-btn>
                            <v-spacer />
                            <v-menu
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
                        <div class="view-container flex-grow-1">
                            <!-- Status view -->
                            <TaskStatusView
                                v-if="descendantsViewMode === 'status'"
                                v-bind:task-statuses="taskStatuses"
                                v-bind:known-contacts="knownContacts"
                                v-bind:route-for="taskRoute"
                                v-bind:list-root="listRoot"
                                v-on:status-change="onTaskStatusChange"
                            />
                            <!-- Schedule view -->
                            <TaskScheduleView
                                v-else-if="descendantsViewMode === 'schedule'"
                                v-bind:scheduled="scheduled"
                                v-bind:route-for="taskRoute"
                                v-bind:list-root="listRoot"
                            />
                            <!-- Eisenhower Matrix view -->
                            <TaskEisenhowerView
                                v-else-if="descendantsViewMode === 'eisenhower'"
                                v-bind:eisenhower-quadrants="eisenhowerQuadrants"
                                v-bind:route-for="taskRoute"
                                v-bind:list-root="listRoot"
                            />
                        </div>
                    </v-window-item>
                </v-window>
            </div>
        </template>
        <v-overlay v-bind:model-value="store.isLoading" z-index="20" class="align-center justify-center">
            <v-progress-circular indeterminate size="64" />
        </v-overlay>
        <v-snackbar v-model="error" color="error" location="top" timeout="5000">{{ error }}</v-snackbar>
        
        <!-- Parent Selection Dialog -->
        <ParentSelectionDialog
            v-model="showParentDialog"
            v-bind:task-uuid="selectedNode?.uuid || null"
            v-bind:task-title="selectedNode?.title || 'Untitled'"
            v-bind:items="store.tree"
            v-on:move="onMoveTask"
        />
    </div>
</template>

<script lang="ts" setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';
import { type RouteLocationRaw, useRoute, useRouter } from 'vue-router';
import { useDisplay } from 'vuetify';
import { useLocalStorage } from '@/composables/localStorage';
import AppBarContent from '@/components/AppBarContent.vue';

import {
    mdiCalendarMultiselectOutline,
    mdiDotsVertical,
    mdiGridLarge,
    mdiPlus,
    mdiTrafficLightOutline,
} from '@mdi/js';

import { type TaskNode, type TaskTreeItem, buildTaskPath } from '@/task-forest';
import { isTagGroupId, isUntaggedGroupId, tagGroupId, tagNameOf, useTasksStore } from '@/stores/tasks';

import { type UUID, type Status, type StatusKind, type Task, STATUS_KINDS, STATUS_LABEL } from '@/task';
import axios from 'axios';
import dayjs from 'dayjs';

// Stores
const store = useTasksStore();

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
const openNodes = ref<UUID[]>([]);
const newTaskPath = ref<string | null>(null);
const error = ref<string | null>(null);
const hideCompletedInTreeView = useLocalStorage('hide-completed-in-tree-view', false);
const hideCompletedInItemView = useLocalStorage('hide-completed-in-item-view', false);
const showParentDialog = ref<boolean>(false);
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

const itemViewTab = computed<string>(() => {
    if (route.name === 'TasksNextWithParams' && route.params.tab) {
        return route.params.tab as string;
    }
    return 'descendants';
});

const descendantsViewMode = computed<'status' | 'schedule' | 'eisenhower'>(() => {
    if (route.name === 'TasksNextWithParams' && route.params.viewMode) {
        return route.params.viewMode as 'status' | 'schedule' | 'eisenhower';
    }
    return 'status';
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

// The tag a task created from the selected group starts with. The Untagged group has none to give.
const newTaskTag = computed<string | undefined>(() => {
    if (activeNodeId.value === undefined || isUntaggedGroupId(activeNodeId.value)) {
        return undefined;
    }
    return selectedTagName.value ?? undefined;
});

// The title of the task the edited one sits under, for the editor's heading.
const selectedNodeParentTitle = computed<string | undefined>(() => {
    if (selectedNode.value === undefined || isTagGroupSelected.value) {
        return undefined;
    }
    // A new task goes under the selected one.
    const parent = newTaskPath.value ? selectedNode.value : selectedNodeAncestors.value.at(-1);
    return parent?.title ?? undefined;
});

// The titles above the edited task, for its assessment. Untitled ones are left out: the backend
// takes the titles as strings and refuses the whole request over a null.
const selectedNodeAncestorTitlesForTaskAssessment = computed<string[]>(() => {
    if (selectedNode.value === undefined || isTagGroupSelected.value) {
        return [];
    }
    // A new task goes under the selected one, which makes that its last ancestor.
    const ancestors = newTaskPath.value
        ? [...selectedNodeAncestors.value, selectedNode.value]
        : selectedNodeAncestors.value;
    return ancestors
        .map((node) => node.title)
        .filter((title): title is string => Boolean(title));
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

// Helper function to check if entire subtree should be filtered
function isEntireSubtreeCompleted(node: TaskTreeItem): boolean {
    const status = node.metadata?.task?.status?.kind;
    const completed = status === 'done' || status === 'canceled';
    if (!completed) {
        return false;
    }

    // Check if ALL descendants have statuses considered completed
    return (node.children ?? []).every(isEntireSubtreeCompleted);
}

// Helper function to recursively filter tree nodes based on task status with subtree logic
function filterTreeNodes(nodes: TaskTreeItem[], hideCompleted: boolean): TaskTreeItem[] {
    return nodes
        .map(node => {
            // Check if this is a tag group node (virtual parent)
            if (isTagGroupId(node.uuid)) {
                // For tag groups, filter children individually since they're virtual parents
                let filteredChildren = node.children;
                if (node.children && node.children.length > 0) {
                    filteredChildren = node.children.filter((child: TaskTreeItem) => {
                        const taskStatus = child.metadata?.task?.status?.kind;
                        const shouldFilterOut =
                            hideCompleted && (taskStatus === 'done' || taskStatus === 'canceled');
                        return !shouldFilterOut;
                    });
                }

                // Return the tag group with filtered children
                return { ...node, children: filteredChildren };
            }

            // For real task nodes
            const taskStatus = node.metadata?.task?.status?.kind;

            // Check if this node has children (is a real parent task forming a subtree)
            if (node.children && node.children.length > 0) {
                // This is a parent task - check if ALL descendants are completed
                const completed = isEntireSubtreeCompleted(node);

                if (hideCompleted && completed) {
                    return null; // Filter out entire subtree
                }

                return node;
            } else {
                // This is a leaf task without children - apply individual filtering
                // (This should only happen for tasks under tag groups, as per the logic)
                const shouldFilterOut =
                    hideCompleted && (taskStatus === 'done' || taskStatus === 'canceled');

                if (shouldFilterOut) {
                    return null; // Filter out this individual task
                }

                return node;
            }
        })
        .filter(node => node !== null); // Remove filtered out nodes
}

// Computed property for filtered forest with tags
const filteredForestWithTags = computed(() => {
    return filterTreeNodes(store.treeWithTagGroups, hideCompletedInTreeView.value);
});

// Helper function to filter task list based on status
function filterTasksByStatus(tasks: TaskNode[], hideCompleted: boolean): TaskNode[] {
    return tasks.filter(task => {
        const kind: StatusKind = task.metadata?.task?.status?.kind ?? 'backlog';
        if (hideCompleted && (kind === 'done' || kind === 'canceled')) return false;
        return true;
    });
}

// What the Descendants tab lists: the list root's descendants, a tag group's members, or every task.
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

// Among the tasks the Descendants tab lists, so the count follows the selection. A task in the
// backlog is not taken on yet and a done or canceled one is over, so neither is left, whatever the
// hide-completed switches say. Counted from the Status view's columns, as the popover is, so the
// two agree on where a task naming no status belongs.
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

const scheduled = computed<Record<string, TaskNode[]>>(() => {
    // Keep today, tomorrow, or other dates that have some undone tasks
    const today = dayjs().format('YYYY-MM-DD');
    const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
    const scheduled: Record<string, TaskNode[]> = {
        [today]: [],
        [tomorrow]: [],
    };

    for (const t of filteredSelectedNodeDescendants.value) {
        if (t.metadata?.task?.scheduled_dates) {
            for (const date of t.metadata.task.scheduled_dates) {
                scheduled[date] ??= [];
                scheduled[date].push(t);
            }
        }
    }
    
    // Sort tasks within each scheduled date by due date/deadline
    for (const date in scheduled) {
        scheduled[date] = sortTasksByDueDate(scheduled[date]);
    }
    
    return scheduled;
});

const knownTags = computed<[string, number][]>(() => {
    // Collect tags
    const tagCounts = new Map();
    for (const node of store.allTasks) {
        for (const tag of node.metadata?.tags ?? []) {
            tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
    }
    return Array.from(tagCounts)
        .sort(([_tag1, count1], [_tag2, count2]) => count2 - count1);
});

const knownContacts = computed<[string, number][]>(() => {
    // Collect contacts
    const contactCounts = new Map();
    for (const node of store.allTasks) {
        const status = node.metadata?.task?.status;
        const contact = status?.kind === 'waiting' ? status.contact : undefined;
        if (contact && contact.trim() !== '') {
            contactCounts.set(contact, (contactCounts.get(contact) ?? 0) + 1);
        }
    }
    return Array.from(contactCounts)
        .sort(([_contact1, count1], [_contact2, count2]) => count2 - count1);
});

// Eisenhower Matrix computed properties
const eisenhowerQuadrants = computed(() => {
    const quadrants = {
        doFirst: [] as TaskNode[],      // High importance, High urgency
        schedule: [] as TaskNode[],     // High importance, Low urgency
        delegate: [] as TaskNode[],     // Low importance, High urgency
        eliminate: [] as TaskNode[],    // Low importance, Low urgency
    };

    for (const task of filteredSelectedNodeDescendants.value) {
        const importance = task.metadata?.task?.importance ?? 3;
        const urgency = task.metadata?.task?.urgency ?? 3;
        const isHighImportance = importance >= 4;
        const isHighUrgency = urgency >= 4;

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

    // Sort tasks within each quadrant by due date/deadline
    return {
        doFirst: sortTasksByDueDate(quadrants.doFirst),
        schedule: sortTasksByDueDate(quadrants.schedule),
        delegate: sortTasksByDueDate(quadrants.delegate),
        eliminate: sortTasksByDueDate(quadrants.eliminate),
    };
});

const viewModeOptions = computed(() => [
    { text: 'Status', icon: mdiTrafficLightOutline, value: 'status' },
    { text: 'Schedule', icon: mdiCalendarMultiselectOutline, value: 'schedule' },
    { text: 'Eisenhower Matrix', icon: mdiGridLarge, value: 'eisenhower' },
]);

// URL management functions
// Apart from navigating, so a link can point where a click would go and still be opened in a new tab.
function routeToState(selectedNodeId?: string, tab?: string, viewMode?: string): RouteLocationRaw {
    return {
        name: 'TasksNextWithParams',
        params: {
            selectedNodeId: selectedNodeId || '_',
            tab: tab || 'descendants',
            viewMode: viewMode || 'status',
        },
    };
}

// Where choosing a task goes: its editor, keeping the view. A tag group is no task to edit, so it
// lists the tasks it holds instead.
function taskRoute(node: TaskNode): RouteLocationRaw {
    const tab = isTagGroupId(node.uuid) ? 'descendants' : 'selected';
    return routeToState(node.uuid, tab, descendantsViewMode.value);
}

function navigateToState(selectedNodeId?: string, tab?: string, viewMode?: string) {
    router.push(routeToState(selectedNodeId, tab, viewMode)).catch(err => {
        // Ignore navigation duplicated errors
        if (err.name !== 'NavigationDuplicated') {
            // eslint-disable-next-line no-console
            console.error('Router navigation error:', err);
        }
    });
}

// Watchers for opening tree nodes when selected node changes
watch(selectedNode, (node) => {
    if (node) {
        // Open tree up to the corresponding item
        const next = new Set(openNodes.value);
        let parent = store.parentOf(node.uuid);
        while (parent) {
            next.add(parent);
            parent = store.parentOf(parent);
        }
        openNodes.value = [...next];
    }
});

// Lifecycle hooks
onMounted(async () => {
    document.title = `Tasks | ${import.meta.env.VITE_APP_NAME}`;
    window.addEventListener('focus', onWindowFocus);
    await load(true);
});

onUnmounted(() => {
    window.removeEventListener('focus', onWindowFocus);
});

function onWindowFocus() {
    load();
}

// Event handlers for UI interactions
function onTabChange(newTab: string) {
    navigateToState(selectedNode.value?.uuid, newTab, descendantsViewMode.value);
}

function onViewModeChange(newViewMode: string) {
    navigateToState(selectedNode.value?.uuid, itemViewTab.value, newViewMode);
}

// Methods
function newTask() {
    // Navigate to selected tab first
    navigateToState(selectedNode.value?.uuid, 'selected', descendantsViewMode.value);
    // Then generate new UUID and set path for the task
    const taskUuid = crypto.randomUUID();
    newTaskPath.value = getNewTaskPath(taskUuid);
}

function onAddChildTask(parentUuid: UUID) {
    // Find the parent node
    const parentNode = store.node(parentUuid);
    if (!parentNode) return;
    
    // Navigate to the parent node first
    navigateToState(parentUuid, 'selected', descendantsViewMode.value);
    // Then generate new UUID and set path for the task under this parent
    const taskUuid = crypto.randomUUID();
    // A tag group is not a directory. Its task is a root task, and selecting the group is what
    // gives it the tag.
    newTaskPath.value = isTagGroupId(parentUuid)
        ? buildTaskPath([], taskUuid)
        : getNewTaskPathForParent(taskUuid, parentNode);
}

function getNewTaskPathForParent(taskUuid: string, parentNode: TaskNode): string {
    const idx = parentNode.path.lastIndexOf('/');
    const parentDir = parentNode.path.slice(0, idx) + '/' + parentNode.uuid;
    return parentDir + '/' + taskUuid + '.md';
}

function getNewTaskPath(taskUuid: string): string {
    let parentDir;
    if (selectedNode.value && !isTagGroupSelected.value) {
        // Create a task under the selected one (but not under tag groups)
        const selected = selectedNode.value;
        const idx = selected.path.lastIndexOf('/');
        parentDir = selected.path.slice(0, idx) + '/' + selected.uuid;
    }
    else {
        // Create a task under the root (for tag groups or no selection)
        parentDir = '.tasks';
    }
    return parentDir + '/' + taskUuid + '.md';
}

function updateNewTaskParent() {
    if (!newTaskPath.value) return;

    // Extract the UUID from the current newTaskPath
    const pathParts = newTaskPath.value.split('/');
    const filename = pathParts[pathParts.length - 1];
    const taskUuid = filename.replace('.md', '');

    // Update the path with the new parent but same UUID
    newTaskPath.value = getNewTaskPath(taskUuid);
}

// Watch for new task creation to update parent when selectedNode changes
watch(selectedNode, () => {
    if (newTaskPath.value) {
        updateNewTaskParent();
    }
});

async function onSelectedTaskSave(task: Task) {
    const isNew = newTaskPath.value !== null;
    const path = newTaskPath.value ?? selectedNode.value?.path;
    if (!path) {
        return;
    }
    // The forest is derived from the file listing, so there is nothing to update by hand: saving
    // waits until the write is visible in the listing, and the tree follows from that.
    await store.save(task, path);
    if (isNew) {
        newTaskPath.value = null;
        navigateToState(task.uuid, 'selected', descendantsViewMode.value);
    }
    // Refresh task editor manually because its task-path prop retains the same value
    // (the ref may be momentarily null while the window transition remounts the editor)
    taskEditorRef.value?.refresh();
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

async function onSelectedTaskDelete(path: string) {
    // Look up UUID by path
    const uuid = store.idByPath(path);
    if (!uuid) {
        return;
    }
    await store.remove(path);
    // Unselect by navigating to no selection
    if (activeNodeId.value === uuid) {
        navigateToState(undefined, 'descendants', descendantsViewMode.value);
    }
}

function onNewTaskCancel() {
    // Clear the new task path and return to descendants view
    newTaskPath.value = null;
    navigateToState(selectedNode.value?.uuid, 'descendants', descendantsViewMode.value);
}

async function onMoveTask(newParentUuid: UUID | null) {
    if (!selectedNode.value) {
        return;
    }

    try {
        await store.move(selectedNode.value.uuid, newParentUuid);
        
        // Navigate to the moved task to keep it selected
        navigateToState(selectedNode.value.uuid, 'selected', descendantsViewMode.value);
    } catch (e) {
        console.error('Failed to move task:', e);
        error.value = e instanceof Error ? e.message : 'Failed to move task';
    }
}

function showChangeParentDialog() {
    if (selectedNode.value && !isTagGroupSelected.value) {
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

.task-tree {
    width: 300px;
    overflow: hidden auto;
}

.task-tree-container {
    width: 300px;
}

/* Mobile responsive adjustments */
@media (max-width: 599px) { /* sm breakpoint in Vuetify 2 */
    .task-tree-container {
        width: 100%;
        max-height: 200px;
        min-height: 150px;
    }

    .task-tree {
        width: 100%;
    }
}

.item-view {
    flex: 1 1 0;
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

:deep(.item-view .v-window__container) {
    flex: 1 1 0;
}

:deep(.item-view .v-window-item) {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
}
</style>
