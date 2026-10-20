<template>
    <v-card
        ref="rootRef"
        class="task-editor-next d-flex flex-column flex-grow-1"
    >
        <v-form
            ref="formRef"
            v-model="uiValid"
            v-bind:disabled="loading"
            style="display: contents"
            v-on:submit.prevent="onSave"
        >
            <v-card-title
                ref="headerRef"
                class="editor-header"
            >
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
                        <!-- Every host draws the editor in a dialog, which a phone shows full
                             screen, with no scrim to click and no Escape to press. -->
                        <v-btn
                            variant="text"
                            aria-label="Cancel"
                            title="Cancel"
                            v-bind:icon="$vuetify.display.smAndDown"
                            v-on:click="onCancel"
                        >
                            <v-icon>{{ mdiClose }}</v-icon>
                            <span v-if="$vuetify.display.mdAndUp">Cancel</span>
                        </v-btn>
                        <!-- A new task has no file to move yet, so its parent is chosen rather than
                             changed: the host decides where the task will be written. Hidden until
                             the task has loaded, which is what tells the two apart. -->
                        <v-btn
                            v-if="!loading && !error"
                            variant="text"
                            color="primary"
                            v-bind:aria-label="parentActionLabel"
                            v-bind:title="parentActionLabel"
                            v-bind:disabled="writing"
                            v-bind:icon="$vuetify.display.smAndDown"
                            v-on:click="onChangeParent"
                        >
                            <v-icon v-bind:class="{ 'mr-1': $vuetify.display.mdAndUp }">
                                {{ mdiFileTreeOutline }}
                            </v-icon>
                            <span v-if="$vuetify.display.mdAndUp">{{ parentActionLabel }}</span>
                        </v-btn>
                        <!-- As from the task's row in the tree, and the view's Quick add: the host
                             starts the subtasks in a dialog of its own, and what is typed here
                             stays as it is. A phone has no room for both beside the rest, and
                             neither is used while writing, so there they wait in a menu. -->
                        <template v-if="isEdit && !$vuetify.display.xs">
                            <v-btn
                                variant="text"
                                color="primary"
                                aria-label="Add Subtask"
                                title="Add Subtask"
                                v-bind:icon="$vuetify.display.smAndDown"
                                v-on:click="onAddSubtask"
                            >
                                <v-icon v-bind:class="{ 'mr-1': $vuetify.display.mdAndUp }">
                                    {{ mdiPlus }}
                                </v-icon>
                                <span v-if="$vuetify.display.mdAndUp">Add Subtask</span>
                            </v-btn>
                            <v-btn
                                variant="text"
                                color="primary"
                                aria-label="Quick Add"
                                title="Quick Add"
                                v-bind:icon="$vuetify.display.smAndDown"
                                v-on:click="onQuickAdd"
                            >
                                <v-icon v-bind:class="{ 'mr-1': $vuetify.display.mdAndUp }">
                                    {{ mdiFormatListChecks }}
                                </v-icon>
                                <span v-if="$vuetify.display.mdAndUp">Quick Add</span>
                            </v-btn>
                        </template>
                        <v-menu
                            v-else-if="isEdit"
                            location="bottom end"
                        >
                            <template v-slot:activator="{ props: menuProps }">
                                <v-btn
                                    v-bind="menuProps"
                                    variant="text"
                                    color="primary"
                                    aria-label="More"
                                    title="More"
                                    icon
                                >
                                    <v-icon>{{ mdiDotsVertical }}</v-icon>
                                </v-btn>
                            </template>
                            <v-list>
                                <v-list-item
                                    title="Add Subtask"
                                    v-bind:prepend-icon="mdiPlus"
                                    v-on:click="onAddSubtask"
                                />
                                <v-list-item
                                    title="Quick Add"
                                    v-bind:prepend-icon="mdiFormatListChecks"
                                    v-on:click="onQuickAdd"
                                />
                            </v-list>
                        </v-menu>
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
                        <!-- With nothing changed there is nothing to save. A new task is unchanged
                             only while its title is empty, which the title's rule refuses already,
                             so this never holds back a Create. Nor while the task is read, as from
                             where a move put it: the form is counted against no task meanwhile, and
                             a save would write it as a new one, over whatever else the note holds. -->
                        <v-btn
                            v-bind:disabled="writing || loading || !isModified || !!statusGateError || alarmsInvalid || !uiValid"
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
                    <!-- The assessment is advice, read now and then rather than while writing, so it
                         waits behind its score instead of taking a pane beside the note. Its note
                         suggestions are added from inside it, so a click there leaves it open. It
                         keeps Tab to itself: drawn outside the editor's dialog, it would otherwise
                         lose Tab to the dialog's trap, which sent it back to the dialog's first
                         button before it reached a suggestion. -->
                    <v-menu
                        v-if="(taskAssessment || assessmentLoading) && form.title.length >= 3"
                        ref="assessmentMenu"
                        v-bind:close-on-content-click="false"
                        v-bind:max-height="assessmentMaxHeight"
                        v-bind:viewport-margin="MENU_MARGIN"
                        location="bottom"
                        retain-focus
                        v-on:update:model-value="fitAssessment"
                    >
                        <template v-slot:activator="{ props: activator }">
                            <!-- Named outright: the menu points the chip at its content with
                                 aria-owns, so a name drawn from the chip's content took in the
                                 whole assessment while it was open. Its arrow sets it apart from
                                 the chips beside it, which open nothing, where no pointer hovers. -->
                            <v-chip
                                v-bind="activator"
                                v-bind:aria-label="assessmentLabel"
                                v-bind:append-icon="mdiMenuDown"
                                size="small"
                                class="overview-chip"
                                role="button"
                            >
                                <!-- The chip keeps its size while the assessment reloads, which it
                                     does on every pause in typing the title: rewrapped, the row
                                     moved the field being typed in. So the last score stays, a
                                     spinning icon takes the lightbulb's place, and the first score
                                     is held a place of the same width. -->
                                <v-icon
                                    v-bind:icon="assessmentLoading ? mdiLoading : mdiLightbulbOnOutline"
                                    v-bind:class="{ 'assessment-loading': assessmentLoading }"
                                    start
                                />
                                <!-- Where the buttons above drop their labels, the lightbulb says
                                     what the score is, so on a phone the chip fits beside the
                                     progress bar rather than on a row of its own. -->
                                <span v-if="$vuetify.display.mdAndUp">Assessment:&nbsp;</span>
                                <span class="assessment-score">{{ assessmentScore }}</span>
                            </v-chip>
                        </template>
                        <v-card
                            max-width="360"
                            class="assessment pa-3"
                        >
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
                            <div v-if="taskAssessment">
                                <div class="d-flex align-center mb-2">
                                    <span class="text-caption mr-2">Quality Score:</span>
                                    <!-- Inert: read-only, its ten half-stars still took Tab and
                                         twenty "Rating x of 5" names, beside a score said in
                                         words already. -->
                                    <v-rating
                                        v-bind:model-value="taskAssessment.quality_score / 2"
                                        inert
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
                                                <!-- The note an added suggestion goes into lies
                                                     behind the menu, or off a phone's screen, so
                                                     the button says it was added, and is named by
                                                     its suggestion among the others alike. -->
                                                <v-icon-btn
                                                    v-bind:icon="inNote(suggestion) ? mdiCheck : mdiPlus"
                                                    v-bind:aria-label="`${inNote(suggestion) ? 'In the note' : 'Add to note'}: ${suggestion}`"
                                                    v-bind:aria-disabled="inNote(suggestion)"
                                                    v-bind:title="inNote(suggestion) ? 'In the note' : 'Add to note'"
                                                    variant="text"
                                                    class="ml-1"
                                                    color="primary"
                                                    v-on:click="addNoteContent(suggestion)"
                                                ></v-icon-btn>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </v-card>
                    </v-menu>
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
                    <!-- Status. The lock is in the field's append slot rather than beside the
                         input, where a row centring the two centred it on the field and the space
                         kept under it for a message together. The slot is as tall as the field
                         alone, and Vuetify centres what it holds. -->
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
                        <template v-slot:append>
                            <v-icon-btn
                                v-bind:icon="statusOptionRestricted ? mdiLock : mdiLockOpenVariant"
                                v-bind:title="statusOptionRestricted ? 'Show all statuses' : 'Show only the statuses this task can move to'"
                                v-bind:active="statusOptionRestricted ? undefined : true"
                                v-on:click="statusOptionRestricted = !statusOptionRestricted"
                                v-on:keydown="keepKeyFromStatusSelect"
                            ></v-icon-btn>
                        </template>
                    </v-select>
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
                        class="under-field"
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
                        class="under-field"
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
            </v-card-text>
        </v-form>
    </v-card>
</template>

<script lang="ts" setup>
import { ref, reactive, computed, watch, toRef, onMounted, onUnmounted, type ComponentPublicInstance } from 'vue';
import type { VMenu } from 'vuetify/components';

import {
    mdiCalendarOutline,
    mdiCheck,
    mdiClose,
    mdiContentSave,
    mdiDelete,
    mdiDotsVertical,
    mdiFileDocument,
    mdiFileDocumentEdit,
    mdiFileTreeOutline,
    mdiFlagOutline,
    mdiFormatHeader1,
    mdiFormatListChecks,
    mdiLightbulbOnOutline,
    mdiLoading,
    mdiMenuDown,
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
import type { TaskNode } from '@/task-forest';
import { useFetchTask } from '@/composables/fetchTask';
import { useLocalStorage } from '@/composables/localStorage';
import { useConfigValue } from '@/config';
import { required } from '@/rules';
import { useShortcuts } from '@/keyboard';
import dayjs from 'dayjs';
import { useCalendarsStore } from '@/stores/calendars';

import { leadTimeDays, resolvedLeadTime, taskInstant, urgencyOf, URGENCY_LABEL, type Importance } from '@/urgency';
import { useTasksStore } from '@/stores/tasks';
import { useTaskSettingsStore } from '@/stores/taskSettings';
import { useTaskAssessmentStore } from '@/stores/taskAssessment';
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
    // The tag group a new task is started from: its tag, `null` for the Untagged group, which has
    // none to give, and absent when the draft is not from a group or sits under a task.
    selectedTag?: string | null;
    // Set while the host writes the task: a save the editor emitted, or a move. It refuses a save,
    // and another move, until then, which the buttons show rather than take a press and drop it.
    writing?: boolean;
}>();
const pathRef = toRef(props, 'taskPath');

// Composables
const { task, loading, error, reread } = useFetchTask(pathRef);
const calendars = useCalendarsStore();
const tasks = useTasksStore();
const settings = useTaskSettingsStore();
const assessmentPrompt = useTaskAssessmentStore();
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
    (e: 'add-subtask'): void;
    (e: 'quick-add'): void;
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
// The path of the task the form was last filled from, which tells a move of that task from a
// switch to another.
let filledFrom: string | null = null;
const statusOptionRestricted = ref(true);
// What the editor last gave its host to save, and whether the status was unlocked for it, for
// `saved` to tell its own save from one an earlier editor gave.
let emitted: { task: Task; unlocked: boolean } | null = null;
// The ETag of the note the form counts from, which a save is checked against. Kept apart from the
// task read, which after a save can be a change that landed since rather than the save itself.
let formEtag: string | undefined;
// Kept across tasks and visits, as one way of working with notes rather than a property of a task.
const notePanes = useLocalStorage<'viewer' | 'both' | 'editor'>('task-editor-note-panes', 'both');
const lockScroll = useConfigValue('lock-scroll', false);

// Task assessment data
const taskAssessment = ref<TaskAssessmentResponse | null>(null);
const assessmentLoading = ref(false);
let assessmentTimeout: number | null = null;
const assessmentMaxHeight = ref<number>();
// The room Vuetify keeps clear of each edge of the window, given to the assessment's menu here
// because its cap counts it too.
const MENU_MARGIN = 12;
const headerObserver = new ResizeObserver(() => fitAssessment());

// Template refs
const rootRef = ref<ComponentPublicInstance | null>(null);
const formRef = ref<any>(null);
const headerRef = ref<ComponentPublicInstance | null>(null);
const assessmentMenu = ref<InstanceType<typeof VMenu> | null>(null);

// Computed properties
const uuid = computed<UUID>(() => extractFileUuid(props.taskPath));

const isEdit = computed<boolean>(() => !!task.value);

const parentActionLabel = computed<string>(() => isEdit.value ? 'Change Parent' : 'Choose Parent');

const assessmentScore = computed<string>(() => taskAssessment.value
    ? `${taskAssessment.value.quality_score.toFixed(1)}/10`
    : '–/10');

const assessmentLabel = computed<string>(() => {
    if (!taskAssessment.value) {
        return 'Task assessment: loading';
    }
    const score = `Task assessment: ${taskAssessment.value.quality_score.toFixed(1)} out of 10`;
    return assessmentLoading.value ? `${score}, updating` : score;
});

// The task this one sits under, for a new task's heading, worked out from the path so that a new
// task has one before the listing holds it.
const parentTask = computed<TaskNode | undefined>(() => tasks.parentAt(props.taskPath));

// The titles above this task, root first, for its assessment. Untitled ones are left out: the
// backend takes the titles as strings and refuses the whole request over a null.
const ancestorTitles = computed<string[]>(() => {
    const parent = parentTask.value;
    if (parent === undefined) {
        return [];
    }
    return [...tasks.ancestorsOf(parent.uuid), parent]
        .map((node) => node.title)
        .filter((title): title is string => Boolean(title));
});

// The form as the task `t` fills it, or as a new task starts it.
function formOf(t: Task | null | undefined): EditableTask {
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
}

const initialForm = computed<EditableTask>(() => formOf(task.value));

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

// The lock sits inside the Status select, which listens for keys on the whole of it: Enter or Space
// on the lock would open the menu rather than press the lock, an arrow would open it too, and a
// letter would pick the status it starts. Escape, Tab and keys held with Ctrl or Meta go on, since
// the dialog closes on Escape and the editor saves on Ctrl+S, both listening on the window.
function keepKeyFromStatusSelect(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Tab' || e.ctrlKey || e.metaKey) {
        return;
    }
    e.stopPropagation();
}

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

const isModified = computed<boolean>(() => differs(form, initialForm.value));

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
        // The same note read again after a save, which `saved` settles.
        if (newTask && oldTask && filledFrom === props.taskPath) {
            return;
        }
        // A task moved under another parent is read again from its new path, but it is the same
        // note, so the form keeps what has been typed into it. Change Parent and a drop in the tree
        // both move the task being edited, or one above it.
        if (filledFrom !== null && filledFrom !== props.taskPath && extractFileUuid(filledFrom) === uuid.value) {
            if (newTask) {
                filledFrom = props.taskPath;
            }
            return;
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
        // Put under a task, the draft keeps the group's tag: a tag is not taken away unasked.
        if (task.value || newTag === oldTag || newTag === undefined) {
            return;
        }
        // Back at the top, the group's tag heads the draft again. A draft is started from one
        // group and stays with it, so there is no other group's tag to take away.
        const rest = form.tags.filter((tag) => tag !== newTag);
        form.tags = newTag ? [newTag, ...rest] : rest;
    }
);

// Lifecycle hooks
onMounted(() => {
    window.addEventListener('beforeunload', onBeforeunload);
    window.addEventListener('resize', fitAssessment);
    headerObserver.observe(headerRef.value!.$el);
    // The default alarms are shown beside a date's own, and live in the calendar configuration.
    // Without it they read as the built-in ones, which is only wrong until it has loaded.
    void plans.loadAll().catch(() => undefined);
    void settings.load();
    calendars.ensureLoaded().catch(() => undefined);
});

onUnmounted(() => {
    window.removeEventListener('beforeunload', onBeforeunload);
    window.removeEventListener('resize', fitAssessment);
    headerObserver.disconnect();
    if (assessmentTimeout) {
        clearTimeout(assessmentTimeout);
    }
});

useShortcuts(onKeydown, () => rootRef.value?.$el);

// Methods
function getNewTaskTitle(): string {
    if (props.selectedTag) {
        return `New task with tag "${props.selectedTag}"`;
    } else if (parentTask.value?.title) {
        return `New subtask of "${parentTask.value.title}"`;
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
    // Unlocking is an exception for one edit, which the next task the editor is reused for may not
    // inherit. A saved edit is locked again by `saved`.
    statusOptionRestricted.value = true;
    filledFrom = t ? props.taskPath : null;
    emitted = null;
    formEtag = t?.etag;
    Object.assign(form, formOf(t));

    // Automatically assess the task for existing tasks
    if (t && form.title && form.title.length >= 3) {
        performTaskAssessment(form.title);
    }
}

// The host has saved `written` and the editor stays open on it: the note is read again, for the
// next change to count from. The form takes the note as read, with the title trimmed as the save
// trimmed it, unless something was typed while the save ran, which it keeps. The assessment stays:
// it was of what the form holds. A `written` this editor did not give came from one closed while
// it saved; this one opened since, on the note as it was before the save landed, and its form
// takes the saved note too, unless something has been typed into it.
//
// The form counts from the note its own save wrote, by the ETag the save gave, whatever the read
// then finds: a change landing between the two is refused by the next save rather than put back,
// and a read that fails leaves the next save to go ahead. A form left on another editor's save
// keeps counting from the note before it.
async function saved(written: Task, writtenEtag?: string): Promise<void> {
    const own = emitted?.task === written ? emitted : null;
    emitted = null;
    const base = initialForm.value;
    if (own && writtenEtag !== undefined) {
        formEtag = writtenEtag;
    }
    if (!(await reread())) {
        return;
    }
    if (own && writtenEtag === undefined) {
        formEtag = task.value?.etag;
    }
    // As the save would read the form: a blank it trims away is no change.
    if (own ? differs(formOf(taskOf(written)), formOf(written)) : differs(form, base)) {
        return;
    }
    // Locked again only for the edit it was unlocked for, not by an unlock while the save ran.
    if (own?.unlocked) {
        statusOptionRestricted.value = true;
    }
    Object.assign(form, formOf(task.value));
    formEtag = task.value?.etag;
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

// Ctrl+S saves, as it saves a note. A shortcut of the dialog the editor is drawn in rather than a key
// listened for on the editor: a click between the fields leaves the focus on the dialog around the
// editor, and a date picker or the assessment is drawn outside it. Taken from the browser even with
// nothing to save, whose Save would only save the page.
function onKeydown(e: KeyboardEvent): void {
    if (!e.ctrlKey || e.key !== 's') {
        return;
    }
    e.preventDefault();
    void onSave();
}

// Save/Delete
async function onSave(): Promise<void> {
    // Check validation results (async and returns { valid } in Vuetify 3)
    const result = await formRef.value?.validate?.();  // Runs Vuetify rules
    if (props.writing || loading.value || !isModified.value || !result?.valid || statusGateError.value || alarmsInvalid.value) {
        return;
    }
    emitted = { task: taskOf(task.value), unlocked: !statusOptionRestricted.value };
    emit('save', emitted.task);
}

// The task the form holds, written over the note `base` was read from.
function taskOf(base: Task | null | undefined): Task {
    const alarms = taskAlarmsToWrite(form);
    return {
        source: base?.source,
        etag: formEtag,
        created_at: base?.created_at,
        uuid: uuid.value,
        // One line: the title is written as the note's `# ` heading, and a line after that would
        // be read back as the start of the note.
        title: form.title.replace(/\s*\n\s*/g, ' ').trim(),
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

function onAddSubtask(): void {
    emit('add-subtask');
}

function onQuickAdd(): void {
    emit('quick-add');
}

// Helper functions for comparison
function differs(a: EditableTask, b: EditableTask): boolean {
    return (
        a.title !== b.title ||
        !arraysEqual(a.tags, b.tags) ||
        !statusEqual(a.status, b.status) ||
        a.importance !== b.importance ||
        a.lead_time !== b.lead_time ||
        a.available_from !== b.available_from ||
        a.due_by !== b.due_by ||
        a.deadline !== b.deadline ||
        !sameTaskAlarms(taskAlarmsToWrite(a), taskAlarmsToWrite(b)) ||
        a.note !== b.note
    );
}

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
        const instructions = await assessmentPrompt.current();
        const response = await assessTask(taskForAssessment, ancestorTitles.value, instructions);
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

// Vuetify shifts a menu taller than the room below its activator up over the activator rather than
// shortening it, so a long assessment would cover the chip that opened it. Capped at the larger room
// above or below the chip, it scrolls there instead, flipping above where there is more room. An open
// menu is placed again as the window or the chip resizes, with the cap it was given, so the cap is
// measured whenever the menu opens or closes, the window resizes, or the header does: the chip moves
// without resizing when the row above it rewraps.
function fitAssessment(): void {
    // Read from the menu: the activator props already carry Vuetify's ref to the chip, which a
    // template ref would replace.
    const chip = assessmentMenu.value?.activatorEl;
    if (!chip) {
        return;
    }
    const { top, bottom } = chip.getBoundingClientRect();
    assessmentMaxHeight.value = Math.max(top, document.documentElement.clientHeight - bottom) - MENU_MARGIN;
}

// A suggestion goes into the note as it is, so finding it there is how its button knows it was
// added, and knows again once it has been edited away.
function inNote(suggestion: string): boolean {
    return form.note.includes(suggestion);
}

function addNoteContent(suggestion: string) {
    // The menu stays open after an addition, so a second press is likely, and would add it twice.
    if (inNote(suggestion)) {
        return;
    }
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
// For a host that may close the editor: a draft with something typed in it is worth keeping open.
// And for one that keeps it open on a task it has saved.
defineExpose({
    isModified,
    saved,
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
.props-pane {
    box-sizing: content-box;

    > * {
        box-sizing: border-box;
    }
}

.props-pane {
    max-width: 350px;
    overflow-y: auto;
}

// What belongs to the field above it, such as a date's alarms, starts where that field's box does,
// past its icon, so the column of icons marks where each field begins and the rest reads as part of
// the field before it.
.under-field {
    margin-inline-start: var(--mory-field-prepend-width);
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

// As wide as any score but a perfect one, so the first score takes the room its placeholder held.
.assessment-score {
    display: inline-block;
    min-width: 3em;
    font-variant-numeric: tabular-nums;
}

.assessment-loading {
    animation: assessment-loading 1s linear infinite;
}

@keyframes assessment-loading {
    to {
        transform: rotate(360deg);
    }
}

.assessment {
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
            // The theme's, as the menu floats over the page in a dark theme too, where a fixed
            // light grey drew bright rules.
            border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));

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
