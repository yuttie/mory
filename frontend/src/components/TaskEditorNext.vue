<template>
    <v-card class="task-editor-next d-flex flex-column flex-grow-1">
        <v-form
            ref="formRef"
            v-model="uiValid"
            v-bind:disabled="loading"
            style="display: contents"
            v-on:submit.prevent="onSave"
        >
            <v-card-title class="editor-header">
                <div class="editor-heading">
                    <div class="editor-title">
                        <span>{{ isEdit ? 'Edit task' : getNewTaskTitle() }}</span>
                        <v-btn
                            v-if="isEdit"
                            v-bind:to="{ name: 'Note', params: { path: taskPath.split('/') } }"
                            target="_blank"
                            title="Open as note"
                            aria-label="Open as note"
                            variant="plain"
                            size="small"
                            icon
                        >
                            <v-icon>{{ mdiPencilBoxOutline }}</v-icon>
                        </v-btn>
                    </div>
                    <div class="editor-actions">
                        <v-btn
                            v-if="!isEdit"
                            variant="text"
                            aria-label="Cancel"
                            title="Cancel"
                            v-bind:icon="$vuetify.display.smAndDown"
                            v-on:click="onCancel"
                        >
                            <v-icon>{{ mdiClose }}</v-icon>
                            <span v-if="$vuetify.display.mdAndUp">Cancel</span>
                        </v-btn>
                        <v-btn
                            v-if="isEdit"
                            variant="text"
                            color="primary"
                            aria-label="Change Parent"
                            title="Change Parent"
                            v-bind:icon="$vuetify.display.smAndDown"
                            v-on:click="onChangeParent"
                        >
                            <v-icon v-bind:class="{ 'mr-1': $vuetify.display.mdAndUp }">
                                {{ mdiFileTreeOutline }}
                            </v-icon>
                            <span v-if="$vuetify.display.mdAndUp">Change Parent</span>
                        </v-btn>
                        <v-btn
                            v-if="isEdit"
                            color="error"
                            variant="text"
                            aria-label="Delete"
                            title="Delete"
                            v-bind:icon="$vuetify.display.smAndDown"
                            v-on:click="onDelete"
                        >
                            <v-icon>{{ mdiDelete }}</v-icon>
                            <span v-if="$vuetify.display.mdAndUp">Delete</span>
                        </v-btn>
                        <v-btn
                            v-bind:disabled="!!statusGateError || alarmsInvalid || !uiValid"
                            type="submit"
                            color="primary"
                            v-bind:aria-label="isEdit ? 'Save' : 'Create'"
                            v-bind:title="isEdit ? 'Save' : 'Create'"
                            v-bind:icon="$vuetify.display.smAndDown"
                        >
                            <v-icon>{{ mdiContentSave }}</v-icon>
                            <span v-if="$vuetify.display.mdAndUp">{{ isEdit ? 'Save' : 'Create' }}</span>
                        </v-btn>
                    </div>
                </div>
                <div class="editor-overview">
                    <v-chip
                        size="small"
                        class="overview-chip"
                    >
                        Urgency: {{ URGENCY_LABEL[derivedUrgency.level] }}
                    </v-chip>
                    <v-chip
                        v-if="!derivedUrgency.actionable"
                        size="small"
                        color="info"
                        class="overview-chip"
                    >
                        Not yet actionable
                    </v-chip>
                    <div
                        v-if="derivedProgress !== undefined"
                        class="header-progress"
                    >
                        <v-icon size="small">
                            {{ mdiPercent }}
                        </v-icon>
                        <div class="header-progress-value">
                            <span class="text-caption">{{ Math.round(derivedProgress) }}% of leaves done</span>
                            <v-progress-linear
                                v-bind:model-value="derivedProgress"
                                v-bind:aria-label="`${Math.round(derivedProgress)}% of leaves done`"
                                color="green"
                                height="4"
                                rounded
                            />
                        </div>
                    </div>
                </div>
            </v-card-title>
            <v-alert
                v-if="error"
                type="error"
                variant="outlined"
                class="mx-4"
            >
                {{ String(error) }}
            </v-alert>
            <v-card-text
                class="controls"
                style="flex: 1 1 0; min-height: 0;"
            >
                <div class="props-pane pr-3">
                    <!-- Title -->
                    <v-textarea
                        v-model="form.title"
                        v-bind:rules="[required('Title is required.')]"
                        label="Title"
                        autofocus
                        auto-grow
                        rows="1"
                        required
                        v-on:update:model-value="onTitleInput"
                    >
                        <template v-slot:prepend>
                            <v-icon>{{ mdiFormatHeader1 }}</v-icon>
                        </template>
                    </v-textarea>
                    <!-- Tags -->
                    <v-combobox
                        v-model="form.tags"
                        v-bind:items="tagItems"
                        v-bind:return-object="false"
                        label="Tags"
                        multiple
                        chips
                        clearable
                        hide-selected
                    >
                        <template v-slot:chip="{ item, props: chipProps }">
                            <v-chip
                                v-bind="chipProps"
                                label
                                closable
                                v-on:click:close="form.tags = form.tags.filter((t) => t !== item.value)"
                            >
                                <span>{{ item.value }}</span>
                            </v-chip>
                        </template>
                        <template v-slot:prepend>
                            <v-icon>{{ mdiTagMultipleOutline }}</v-icon>
                        </template>
                    </v-combobox>
                    <!-- Status -->
                    <div class="d-flex align-center">
                        <v-select
                            v-model="selectedKind"
                            v-bind:items="statusOptions"
                            v-bind:error-messages="statusGateError ? [statusGateError] : []"
                            label="Status"
                            item-title="label"
                            item-value="kind"
                        >
                            <template v-slot:prepend>
                                <v-icon>{{ mdiTrafficLightOutline }}</v-icon>
                            </template>
                        </v-select>
                        <v-icon-btn
                            v-bind:icon="statusOptionRestricted ? mdiLock : mdiLockOpenVariant"
                            variant="text"
                            v-on:click="statusOptionRestricted = !statusOptionRestricted"
                            title="Show all statuses"
                            color="primary"
                        ></v-icon-btn>
                    </div>
                    <!-- Status-specific fields -->
                    <TaskStatusFields
                        v-model="form.status"
                        v-bind:known-contacts="knownContacts"
                        class="ml-10"
                    />
                    <v-select
                        v-model="form.importance"
                        v-bind:items="['low', 'medium', 'high']"
                        clearable
                        label="Importance (unrated if empty)"
                    >
                        <template v-slot:prepend>
                            <v-icon>{{ mdiFlagOutline }}</v-icon>
                        </template>
                    </v-select>
                    <v-text-field
                        v-model="form.lead_time"
                        label="Lead time"
                        v-bind:placeholder="`${defaultLeadTime}d (resolved default)`"
                        persistent-placeholder
                        v-bind:rules="[leadTimeRule]"
                    >
                        <template v-slot:prepend>
                            <v-icon>{{ mdiTimerSand }}</v-icon>
                        </template>
                    </v-text-field>
                    <v-alert
                        v-if="derivedUrgency.short_window"
                        type="warning"
                        class="mb-3"
                    >
                        Window shorter than lead time
                    </v-alert>
                    <!-- Start date -->
                    <DateSelector
                        v-bind:model-value="form.available_from"
                        v-on:update:model-value="form.available_from = $event ?? ''"
                        v-bind:rules="[() => taskDateRule(form.available_from)]"
                        label="Available from"
                    >
                        <template v-slot:prepend>
                            <v-icon>{{ mdiCalendarOutline }}</v-icon>
                        </template>
                    </DateSelector>
                    <!-- Due date -->
                    <DateSelector
                        v-bind:model-value="form.due_by"
                        v-on:update:model-value="form.due_by = $event ?? ''"
                        v-bind:rules="[() => taskDateRule(form.due_by)]"
                        label="Due date (soft target)"
                    >
                        <template v-slot:prepend>
                            <v-icon>{{ mdiCalendarOutline }}</v-icon>
                        </template>
                    </DateSelector>
                    <InheritableAlarms
                        v-if="form.due_by !== ''"
                        v-model="form.due_by_alarms"
                        v-bind:fallback="calendars.effectiveAlarmDefaults.dueBy"
                    ></InheritableAlarms>
                    <!-- Deadline -->
                    <DateSelector
                        v-bind:model-value="form.deadline"
                        v-on:update:model-value="form.deadline = $event ?? ''"
                        v-bind:rules="[() => taskDateRule(form.deadline)]"
                        label="Deadline (hard cutoff)"
                    >
                        <template v-slot:prepend>
                            <v-icon>{{ mdiCalendarOutline }}</v-icon>
                        </template>
                    </DateSelector>
                    <InheritableAlarms
                        v-if="form.deadline !== ''"
                        v-model="form.deadline_alarms"
                        v-bind:fallback="calendars.effectiveAlarmDefaults.deadline"
                    ></InheritableAlarms>
                    <v-alert v-for="problem of Object.values(plans.errors)" v-bind:key="problem" type="warning">{{ problem }}</v-alert>
                    <v-list-subheader>Planned days</v-list-subheader>
                    <div v-if="plannedDays.length === 0">No planned days</div>
                    <ul><li v-for="date of plannedDays" v-bind:key="date">{{ date }}</li></ul>
                </div>
                <div class="note-pane flex-grow-1 pl-3">
                    <!-- Note -->
                    <div class="d-flex align-center mb-1">
                        <v-label>
                            <v-icon class="mr-1">
                                {{ mdiNoteTextOutline }}
                            </v-icon>
                            Note
                        </v-label>
                        <v-spacer />
                        <v-btn-toggle
                            v-model="notePanes"
                            mandatory
                            color="primary"
                        >
                            <v-btn
                                value="viewer"
                                icon
                                title="Viewer"
                            >
                                <v-icon>{{ mdiFileDocument }}</v-icon>
                            </v-btn>
                            <v-btn
                                value="both"
                                icon
                                title="Editor and viewer"
                            >
                                <v-icon>{{ mdiFileDocumentEdit }}</v-icon>
                            </v-btn>
                            <v-btn
                                value="editor"
                                icon
                                title="Editor"
                            >
                                <v-icon>{{ mdiPencil }}</v-icon>
                            </v-btn>
                        </v-btn-toggle>
                    </div>
                    <EditableViewer
                        v-model="form.note"
                        v-bind:editor-visible="notePanes !== 'viewer'"
                        v-bind:viewer-visible="notePanes !== 'editor'"
                        v-bind:lock-scroll="lockScroll"
                        class="border"
                    />
                </div>
                <div v-if="(taskAssessment || assessmentLoading) && form.title.length >= 3" class="assessment-pane pl-3">
                    <!-- Task Assessment -->
                    <v-card variant="outlined" class="pa-3">
                        <v-card-subtitle class="pa-0 pb-2">
                            <v-icon class="mr-1">{{ mdiLightbulbOnOutline }}</v-icon>
                            Task Assessment
                            <v-progress-circular
                                v-if="assessmentLoading"
                                indeterminate
                                size="16"
                                width="2"
                                class="ml-2"
                            ></v-progress-circular>
                        </v-card-subtitle>
                        <div v-if="!assessmentLoading">
                            <div class="d-flex align-center mb-2">
                                <span class="text-caption mr-2">Quality Score:</span>
                                <v-rating
                                    v-bind:model-value="taskAssessment.quality_score / 2"
                                    readonly
                                    length="5"
                                    half-increments
                                    color="amber"
                                ></v-rating>
                                <span class="text-caption ml-1">({{ taskAssessment.quality_score.toFixed(1) }}/10)</span>
                            </div>
                            <p class="text-caption mb-2" v-if="taskAssessment.feedback">
                                {{ taskAssessment.feedback }}
                            </p>
                            <div v-if="taskAssessment.suggestions.length > 0">
                                <p class="text-caption font-weight-bold mb-1">Suggestions:</p>
                                <ul class="text-caption">
                                    <li v-for="(suggestion, index) in taskAssessment.suggestions" v-bind:key="index">
                                        {{ suggestion }}
                                    </li>
                                </ul>
                            </div>
                            <div v-if="taskAssessment.note_suggestions && taskAssessment.note_suggestions.length > 0" class="mt-3">
                                <p class="text-caption font-weight-bold mb-1">
                                    Note Suggestions:
                                    <span class="font-weight-normal">(click + to add to note)</span>
                                </p>
                                <div class="note-suggestions">
                                    <div
                                        v-for="(suggestion, index) in taskAssessment.note_suggestions"
                                        v-bind:key="'note-' + index"
                                        class="note-suggestion-item"
                                    >
                                        <div class="d-flex align-center">
                                            <span class="text-caption flex-grow-1">{{ suggestion }}</span>
                                            <v-icon-btn
                                                v-bind:icon="mdiPlus"
                                                variant="text"
                                                class="ml-1"
                                                v-on:click="addNoteContent(suggestion)"
                                                title="Add to note"
                                                color="primary"
                                            ></v-icon-btn>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </v-card>
                </div>
            </v-card-text>
        </v-form>
    </v-card>
</template>

<script lang="ts" setup>
import { ref, reactive, computed, watch, toRef, onMounted, onUnmounted } from 'vue';

import {
    mdiCalendarOutline,
    mdiClose,
    mdiContentSave,
    mdiDelete,
    mdiFileDocument,
    mdiFileDocumentEdit,
    mdiFileTreeOutline,
    mdiFlagOutline,
    mdiFormatHeader1,
    mdiLightbulbOnOutline,
    mdiLock,
    mdiLockOpenVariant,
    mdiNoteTextOutline,
    mdiPencil,
    mdiPencilBoxOutline,
    mdiPercent,
    mdiPlus,
    mdiTagMultipleOutline,
    mdiTimerSand,
    mdiTrafficLightOutline,
} from '@mdi/js';

import { assessTask, type TaskAssessmentResponse } from '@/api';

import { alarmProblems, sameTaskAlarms, taskAlarmsToWrite } from '@/alarms';
import EditableViewer from '@/components/EditableViewer.vue';
import InheritableAlarms from '@/components/InheritableAlarms.vue';
import { extractFileUuid } from '@/api/task';
import type { UUID, Task, Status, StatusKind, WaitingStatus, BlockedStatus, OnHoldStatus, DoneStatus, CanceledStatus } from '@/task';
import { STATUS_LABEL, nextOptions, makeDefaultStatus, canTransition, withoutBlanks } from '@/task';
import { useFetchTask } from '@/composables/fetchTask';
import { useLocalStorage } from '@/composables/localStorage';
import { loadConfigValue } from '@/config';
import { required } from '@/rules';
import dayjs from 'dayjs';
import { useCalendarsStore } from '@/stores/calendars';

import { leadTimeDays, resolvedLeadTime, taskInstant, urgencyOf, URGENCY_LABEL, type Importance } from '@/urgency';
import { useTasksStore } from '@/stores/tasks';
import { useTaskSettingsStore } from '@/stores/taskSettings';
import { usePlansStore } from '@/stores/plans';

type EditableTask = {
    title: string;
    tags: string[];
    status: Status;
    importance: Importance | null;
    lead_time: string;
    available_from: string;
    due_by: string;
    deadline: string;
    // When each date rings: `null` is the default from the settings, which the note does not
    // mention, and a list, even an empty one, is the task's own.
    due_by_alarms: string[] | null;
    deadline_alarms: string[] | null;
    note: string;
};

// Props
const props = defineProps<{
    taskPath: string;
    knownTags: [string, number][];
    knownContacts: [string, number][];
    parentTaskTitle?: string;
    ancestorTitlesForTaskAssessment?: string[];
    selectedTag?: string;
}>();
const pathRef = toRef(props, 'taskPath');

// Composables
const { task, loading, error, refresh } = useFetchTask(pathRef);
const calendars = useCalendarsStore();
const tasks = useTasksStore();
const settings = useTaskSettingsStore();
const derivedProgress = computed(() => tasks.progress(uuid.value));
const defaultLeadTime = computed(() => resolvedLeadTime({}, form.tags, settings.settings));
const derivedUrgency = computed(() => tasks.urgency(uuid.value, urgencyOf(form, form.tags, settings.settings, tasks.now), form.status.kind));
const plans = usePlansStore();
const plannedDays = computed(() => plans.plannedDays(uuid.value));
const leadTimeRule = (value: string) => !value?.trim() || leadTimeDays(value) !== undefined || 'Use whole days or weeks, such as 14d or 2w.';
const taskDateRule = (value: string) => !value || taskInstant(value, dayjs.tz.guess()) !== undefined || 'Use a valid YYYY-MM-DD date or a datetime with its UTC offset.';

// Emits
const emit = defineEmits<{
    (e: 'save', value: Task): void;
    (e: 'delete', path: string): void;
    (e: 'cancel'): void;
    (e: 'change-parent'): void;
}>();

// Reactive states
const form = reactive<EditableTask>({
    title: '',
    // Seeded here because nothing resets the form for a new task: the watcher on `task` skips a
    // task that stays absent, and the one on `selectedTag` fires only when it changes.
    tags: props.selectedTag ? [props.selectedTag] : [],
    // A new task starts in the backlog: To do is a commitment the author makes by moving it there.
    status: { kind: 'backlog' },
    importance: null,
    lead_time: '',
    available_from: '',
    due_by: '',
    deadline: '',
    due_by_alarms: null,
    deadline_alarms: null,
    note: '',
});
const uiValid = ref(true);
const statusOptionRestricted = ref(true);
// Kept across tasks and visits, as one way of working with notes rather than a property of a task.
const notePanes = useLocalStorage<'viewer' | 'both' | 'editor'>('task-editor-note-panes', 'both');
const lockScroll = loadConfigValue('lock-scroll', false);

// Task assessment data
const taskAssessment = ref<TaskAssessmentResponse | null>(null);
const assessmentLoading = ref(false);
let assessmentTimeout: number | null = null;

// Template refs
const formRef = ref<any>(null);

// Computed properties
const uuid = computed<UUID>(() => extractFileUuid(props.taskPath));

const isEdit = computed<boolean>(() => !!task.value);

const initialForm = computed<EditableTask>(() => {
    const t = task.value;
    if (!t) {
        const defaultTags = props.selectedTag ? [props.selectedTag] : [];
        return {
            title: '',
            tags: defaultTags,
            status: { kind: 'backlog' },
            importance: null,
            lead_time: '',
            available_from: '',
            due_by: '',
            deadline: '',
            due_by_alarms: null,
            deadline_alarms: null,
            note: '',
        };
    }
    return {
        title: t.title ?? '',
        tags: Array.isArray(t.tags) ? [...t.tags] : [],
        status: (t.status === undefined || t.status === null) ? { kind: 'backlog' } : { ...t.status },
        importance: t.importance ?? null,
        lead_time: t.lead_time ?? '',
        available_from: t.available_from ?? '',
        due_by: t.due_by ?? '',
        deadline: t.deadline ?? '',
        due_by_alarms: t.alarms?.due_by ? [...t.alarms.due_by] : null,
        deadline_alarms: t.alarms?.deadline ? [...t.alarms.deadline] : null,
        note: t.note ?? '',
    };
});

const statusOptions = computed<{ kind: StatusKind, label: string }[]>(() => {
    const allowed = statusOptionRestricted.value ? nextOptions(initialForm.value.status.kind) : [...Object.keys(STATUS_LABEL)];
    const opts = [initialForm.value.status.kind, ...allowed] as StatusKind[];
    const items = Array.from(new Set(opts))
        .map((k) => { return { kind: k, label: STATUS_LABEL[k] }; });
    return items;
});

const selectedKind = computed<StatusKind>({
    get: () => form.status.kind,
    set: (k) => {
        if (k === form.status.kind) {
            return;
        }
        form.status = makeDefaultStatus(k);
    },
});

const statusGateError = computed<string | undefined>(() => {
    const from = initialForm.value.status;
    const to = form.status.kind;
    // Unlocking offers every status, so it has to lift the gate too: otherwise a status it offers,
    // such as In progress back to To do, is one the form can never save.
    if (!statusOptionRestricted.value || canTransition(from.kind, to)) {
        return undefined;
    }
    else {
        return `Cannot move from ${STATUS_LABEL[from.kind]} to ${STATUS_LABEL[to]}.`;
    }
});

// An alarm that is not one would be dropped by moried, so the task is not saved with it: the box
// names it. Only the lists that would be written are checked.
const alarmsInvalid = computed<boolean>(() => Object.values(taskAlarmsToWrite(form))
    .some((list) => alarmProblems(list).length > 0));

const tagItems = computed<{ title: string; value: string; }[]>(() =>
    props.knownTags.map(([tag, count]) => {
        return {
            title: `${tag} (${count})`,
            value: tag,
        };
    })
);

const isModified = computed<boolean>(() => {
    return (
        form.title !== initialForm.value.title ||
        !arraysEqual(form.tags, initialForm.value.tags) ||
        !statusEqual(form.status, initialForm.value.status) ||
        form.importance !== initialForm.value.importance ||
        form.lead_time !== initialForm.value.lead_time ||
        form.available_from !== initialForm.value.available_from ||
        form.due_by !== initialForm.value.due_by ||
        form.deadline !== initialForm.value.deadline ||
        !sameTaskAlarms(taskAlarmsToWrite(form), taskAlarmsToWrite(initialForm.value)) ||
        form.note !== initialForm.value.note
    );
});

// Watchers
watch(
    task,
    (newTask, oldTask) => {
        // If both old and new task values are undefined/null,
        // we're switching parents during new task creation - preserve form
        if ((newTask === null || newTask === undefined) &&
            (oldTask === null || oldTask === undefined)) {
            return; // Don't reset the form
        }

        resetFromTask(newTask);
    },
    { immediate: true },
);

// A new task moved under another parent keeps its UUID, and the watcher above keeps what has been
// typed. A new UUID is another new task, from Add pressed while one was open, and starts afresh.
watch(uuid, () => {
    if (!task.value) {
        resetFromTask(task.value);
    }
});

// Watch for changes in selectedTag during new task creation
watch(
    () => props.selectedTag,
    (newTag, oldTag) => {
        // Only update tags if we're creating a new task (no existing task)
        if (!task.value && newTag !== oldTag) {
            // The old group's tag goes even when there is a new one to put first: moving the task
            // from one group to another would otherwise leave it filed under both.
            const rest = form.tags.filter((tag) => tag !== oldTag && tag !== newTag);
            form.tags = newTag ? [newTag, ...rest] : rest;
        }
    }
);

// Lifecycle hooks
onMounted(() => {
    window.addEventListener('beforeunload', onBeforeunload);
    // The default alarms are shown beside a date's own, and live in the calendar configuration.
    // Without it they read as the built-in ones, which is only wrong until it has loaded.
    void plans.loadAll().catch(() => undefined);
    void settings.load();
    calendars.ensureLoaded().catch(() => undefined);
});

onUnmounted(() => {
    window.removeEventListener('beforeunload', onBeforeunload);
    if (assessmentTimeout) {
        clearTimeout(assessmentTimeout);
    }
});

// Methods
function getNewTaskTitle(): string {
    if (props.selectedTag) {
        return `New task with tag "${props.selectedTag}"`;
    } else if (props.parentTaskTitle) {
        return `New subtask of "${props.parentTaskTitle}"`;
    } else {
        return 'New task';
    }
}

function resetFromTask(t?: Task | undefined | null): void {
    // Clear task assessment when switching tasks
    taskAssessment.value = null;
    assessmentLoading.value = false;
    if (assessmentTimeout) {
        clearTimeout(assessmentTimeout);
        assessmentTimeout = null;
    }
    // Unlocking is an exception for one edit. The editor is reused for the next task and reloads
    // the saved one, both through here, so neither may inherit it.
    statusOptionRestricted.value = true;

    if (!t) {
        const defaultTags = props.selectedTag ? [props.selectedTag] : [];
        form.title = '';
        form.tags = defaultTags;
        form.status = { kind: 'backlog' };
        form.importance = null;
        form.lead_time = '';
        form.available_from = '';
        form.due_by = '';
        form.deadline = '';
        form.due_by_alarms = null;
        form.deadline_alarms = null;
        form.note = '';
    }
    else {
        form.title = t.title ?? '';
        form.tags = Array.isArray(t.tags) ? [...t.tags] : [];
        form.status = (t.status === undefined || t.status === null) ? { kind: 'backlog' } : { ...t.status };
        form.importance = t.importance ?? null;
        form.lead_time = t.lead_time ?? '';
        form.available_from = t.available_from ?? '';
        form.due_by = t.due_by ?? '';
        form.deadline = t.deadline ?? '';
        form.due_by_alarms = t.alarms?.due_by ? [...t.alarms.due_by] : null;
        form.deadline_alarms = t.alarms?.deadline ? [...t.alarms.deadline] : null;
        form.note = t.note ?? '';

        // Automatically assess the task for existing tasks
        if (form.title && form.title.length >= 3) {
            performTaskAssessment(form.title);
        }
    }
}

function onBeforeunload(e: any) {
    if (isModified.value) {
        // Cancel the event
        e.preventDefault();
        e.returnValue = '';  // Chrome requires returnValue to be set
    }
    else {
        delete e['returnValue'];  // This guarantees the browser unload happens
    }
}

// Save/Delete
async function onSave(): Promise<void> {
    // Check validation results (async and returns { valid } in Vuetify 3)
    const result = await formRef.value?.validate?.();  // Runs Vuetify rules
    if (!result?.valid || statusGateError.value || alarmsInvalid.value) {
        return;
    }
    const alarms = taskAlarmsToWrite(form);
    // Create a Task value
    const savedTask: Task = {
        source: task.value?.source,
        created_at: task.value?.created_at,
        uuid: uuid.value,
        title: form.title.trim(),
        tags: [...form.tags],
        status: withoutBlanks(form.status),
        importance: form.importance ?? undefined,
        ...(form.lead_time.trim() ? { lead_time: form.lead_time.trim() } : {}),
        ...(form.available_from !== '' ? { available_from: form.available_from } : {}),
        ...(form.due_by !== '' ? { due_by: form.due_by } : {}),
        ...(form.deadline !== '' ? { deadline: form.deadline } : {}),
        ...(Object.keys(alarms).length > 0 ? { alarms } : {}),
        note: form.note,
    };
    emit('save', savedTask);
}

function onDelete(): void {
    if (!isEdit.value) {
        return;
    }
    emit('delete', props.taskPath);
}

function onCancel(): void {
    emit('cancel');
}

function onChangeParent(): void {
    emit('change-parent');
}

// Helper functions for comparison
function arraysEqual<T>(a: T[], b: T[]): boolean {
    if (a.length !== b.length) { return false; }
    return a.every((val, index) => val === b[index]);
}

function statusEqual(a: Status, b: Status): boolean {
    if (a.kind !== b.kind) { return false; }

    switch (a.kind) {
        case 'backlog':
        case 'todo':
        case 'in_progress':
            return true; // These only have 'kind' property
        case 'waiting':
            return a.waiting_for === (b as WaitingStatus).waiting_for &&
                   a.expected_by === (b as WaitingStatus).expected_by &&
                   a.contact === (b as WaitingStatus).contact &&
                   a.follow_up_at === (b as WaitingStatus).follow_up_at;
        case 'blocked':
            return a.blocked_by === (b as BlockedStatus).blocked_by;
        case 'on_hold':
            return a.hold_reason === (b as OnHoldStatus).hold_reason &&
                   a.review_at === (b as OnHoldStatus).review_at;
        case 'done':
            return a.completed_at === (b as DoneStatus).completed_at &&
                   a.completion_note === (b as DoneStatus).completion_note;
        case 'canceled':
            return a.canceled_at === (b as CanceledStatus).canceled_at &&
                   a.cancel_reason === (b as CanceledStatus).cancel_reason;
        default:
            return false;
    }
}

// Task assessment functions
async function performTaskAssessment(title: string) {
    if (!title || title.length < 3) {
        taskAssessment.value = null;
        return;
    }

    assessmentLoading.value = true;

    try {
        const ancestorTitles = props.ancestorTitlesForTaskAssessment || [];
        const taskForAssessment = {
            title: title,
            tags: (form.tags || []).filter((t) => t !== 'quick-create'),
            status: form.status,
            importance: form.importance ?? undefined,
            available_from: form.available_from,
            due_by: form.due_by,
            deadline: form.deadline,
            note: form.note,
        };
        const response = await assessTask(taskForAssessment, ancestorTitles);
        taskAssessment.value = response;
    } catch (error) {
        console.warn('Failed to assess task:', error);
        taskAssessment.value = null;
    } finally {
        assessmentLoading.value = false;
    }
}

function onTitleInput() {
    // Clear existing timeout
    if (assessmentTimeout) {
        clearTimeout(assessmentTimeout);
    }

    // Set a new timeout to assess after user stops typing
    assessmentTimeout = setTimeout(() => {
        performTaskAssessment(form.title);
    }, 1000);
}

function addNoteContent(suggestion: string) {
    let currentNote = form.note;
    if (currentNote.trim() === '') {
        form.note = suggestion;
    } else {
        // Add suggestion as a new paragraph
        while (!currentNote.endsWith('\n\n')) {
            currentNote += '\n';
        }
        form.note = currentNote + suggestion;
    }
}

// Expose
defineExpose({
  refresh,
});
</script>

<style scoped lang="scss">
.task-editor-next {
    flex: 1 1 0;
    height: 100%;
}

.controls {
    display: flex;
    flex-direction: row;
}

.editor-header {
    flex-shrink: 0;
    white-space: normal;
}

.editor-heading,
.editor-title,
.editor-actions,
.editor-overview {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
}

.editor-title {
    min-width: 0;
    overflow-wrap: anywhere;
}

.editor-actions {
    margin-left: auto;
}

.editor-overview {
    margin-top: 8px;
    column-gap: 20px;
    font-size: 14px;
    line-height: 1.4;
}

.overview-chip {
    font-size: 12px;
}

.header-progress {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1 1 160px;
    max-width: 220px;
    min-width: 0;

    > .v-icon {
        opacity: var(--v-medium-emphasis-opacity);
    }

    .header-progress-value {
        flex: 1 1 0;
        min-width: 0;
    }
}

// The widths are of the content, with the pane's padding added outside them. Vuetify's reset has
// every element inherit its box-sizing, though, so each field inside would take content-box too and
// grow its padding outside its 40px minimum: a compact field came out 56px tall. Restore it on the
// children, which is where the inheritance starts again.
.props-pane,
.assessment-pane {
    box-sizing: content-box;

    > * {
        box-sizing: border-box;
    }
}

.props-pane {
    max-width: 350px;
    overflow-y: auto;
}

// Sized from zero rather than from its content: the editor's lines and the rendered note are wider
// than the textarea was, and would squeeze the fields beside them.
.note-pane {
    display: flex;
    flex-direction: column;
    flex-basis: 0;
    min-width: 0;
}

@media (max-width: 1263px) { /* lg breakpoint in Vuetify 2 */
    .controls {
        display: block;
        overflow-y: auto;
    }

    .props-pane,
    .note-pane {
        max-width: unset;
        overflow: hidden;
        flex: 1 0 0;
    }

    // Stacked below the fields, the pane has no height to fill, and the editor and viewer each
    // scroll within the one they are given.
    .note-pane {
        height: 80dvh;
    }
}

.date-list {
    column-width: 6em;
    column-gap: 1em;
}

.date-list > li {
    break-inside: avoid;
    -webkit-column-break-inside: avoid;
    padding-inline-start: 0.1em;
}

.assessment-pane {
    max-width: 300px;
    overflow-y: auto;

    .v-card {
        border-left: 3px solid #1976d2;
    }

    .text-caption {
        line-height: 1.4;
    }

    ul {
        margin-left: 16px;
        margin-bottom: 0;
    }

    .note-suggestions {
        .note-suggestion-item {
            padding: 4px 0;
            border-bottom: 1px solid #e0e0e0;

            &:last-child {
                border-bottom: none;
            }

            .text-caption {
                line-height: 1.3;
            }
        }
    }
}
</style>
