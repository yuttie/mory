<template>
    <v-card class="task-editor-next d-flex flex-column flex-grow-1">
        <v-form
            ref="formRef"
            v-model="uiValid"
            v-bind:disabled="loading"
            lazy-validation
            style="display: contents"
            v-on:submit.prevent="onSave"
        >
            <v-card-title>
                {{ isEdit ? 'Edit Task' : 'New Task' }}
                <v-spacer />
                <v-btn
                    v-if="isEdit"
                    color="error"
                    text
                    class="mr-3"
                    v-on:click="onDelete"
                >
                    <v-icon>{{ mdiDelete }}</v-icon>
                    <span v-if="$vuetify.breakpoint.smAndUp">Delete</span>
                </v-btn>
                <v-btn
                    v-bind:disabled="!!statusGateError || !uiValid"
                    type="submit"
                    color="primary"
                >
                    <v-icon>{{ mdiContentSave }}</v-icon>
                    <span v-if="$vuetify.breakpoint.smAndUp">{{ isEdit ? 'Save' : 'Create' }}</span>
                </v-btn>
            </v-card-title>
            <v-alert
                v-if="error"
                type="error"
                dense
                outlined
                class="mx-4"
            >
                {{ String(error) }}
            </v-alert>
            <v-card-text
                class="d-flex flex-row"
                style="flex: 1 1 0; min-height: 0;"
            >
                <div class="props-pane pr-3">
                    <!-- Title -->
                    <v-textarea
                        v-model.trim="form.title"
                        v-bind:rules="[required('Title is required.')]"
                        label="Title"
                        autofocus
                        auto-grow
                        rows="1"
                        required
                    >
                        <template v-slot:prepend>
                            <v-icon>{{ mdiFormatHeader1 }}</v-icon>
                        </template>
                    </v-textarea>
                    <!-- Tags -->
                    <v-combobox
                        v-model.trim="form.tags"
                        v-bind:items="tagItems"
                        v-bind:return-object="false"
                        label="Tags"
                        multiple
                        chips
                        clearable
                        hide-selected
                    >
                        <template v-slot:selection="{ attrs, item, parent, selected }">
                            <v-chip
                                v-bind="attrs"
                                v-bind:input-value="selected"
                                label
                                small
                                close
                                v-on:click:close="parent.selectItem(item)"
                            >
                                <span>{{ item }}</span>
                            </v-chip>
                        </template>
                        <template v-slot:prepend>
                            <v-icon>{{ mdiTagMultipleOutline }}</v-icon>
                        </template>
                    </v-combobox>
                    <!-- Status -->
                    <v-select
                        v-model="selectedKind"
                        v-bind:items="statusOptions"
                        v-bind:error-messages="statusGateError ? [statusGateError] : []"
                        label="Status"
                        item-text="label"
                        item-value="kind"
                    >
                        <template v-slot:prepend>
                            <v-icon>{{ mdiTrafficLightOutline }}</v-icon>
                        </template>
                    </v-select>
                    <!-- Status-specific fields -->
                    <div v-if="form.status.kind === 'waiting'" class="ml-10">
                        <v-text-field
                            v-model.trim="form.status.waiting_for"
                            v-bind:rules="[required('Waiting on is required.')]"
                            label="Waiting on"
                            required
                        >
                            <template v-slot:prepend>
                                <v-icon>{{ mdiTarget }}</v-icon>
                            </template>
                        </v-text-field>
                        <DateSelector
                            v-model="form.status.expected_by"
                            v-bind:rules="[(v) => v === '' || isDateTime('Invalid format.')(v)]"
                            label="Expected by (optional)"
                        />
                        <v-text-field
                            v-model.trim="form.status.contact"
                            label="Contact (optional)"
                        >
                            <template v-slot:prepend>
                                <v-icon>{{ mdiAccountOutline }}</v-icon>
                            </template>
                        </v-text-field>
                        <DateSelector
                            v-model="form.status.follow_up_at"
                            v-bind:rules="[(v) => v === '' || isDateTime('Invalid format.')(v)]"
                            label="Follow up at (optional)"
                        />
                    </div>
                    <div v-if="form.status.kind === 'blocked'" class="ml-10">
                        <v-text-field
                            v-model.trim="form.status.blocked_by"
                            v-bind:rules="[required('Blocked by is required.')]"
                            label="Blocked by"
                            required
                        >
                            <template v-slot:prepend>
                                <v-icon>{{ mdiCancel }}</v-icon>
                            </template>
                        </v-text-field>
                    </div>
                    <div v-if="form.status.kind === 'on_hold'" class="ml-10">
                        <v-text-field
                            v-model.trim="form.status.hold_reason"
                            v-bind:rules="[required('Hold reason is required.')]"
                            label="Hold reason"
                            required
                        >
                            <template v-slot:prepend>
                                <v-icon>{{ mdiHelpCircleOutline }}</v-icon>
                            </template>
                        </v-text-field>
                        <DateSelector
                            v-model="form.status.review_at"
                            v-bind:rules="[(v) => v === '' || isDateTime('Invalid format.')(v)]"
                            label="Review on (optional)"
                        />
                    </div>
                    <div v-if="form.status.kind === 'done'" class="ml-10">
                        <DateSelector
                            v-model="form.status.completed_at"
                            v-bind:rules="[required('Completed at is required.'), isDateTime('Invalid format.')]"
                            label="Completed at"
                            required
                        />
                        <v-text-field
                            v-model.trim="form.status.completion_note"
                            label="Completion note (optional)"
                        >
                            <template v-slot:prepend>
                                <v-icon>{{ mdiNoteEditOutline }}</v-icon>
                            </template>
                        </v-text-field>
                    </div>
                    <div v-if="form.status.kind === 'canceled'" class="ml-10">
                        <DateSelector
                            v-model="form.status.canceled_at"
                            v-bind:rules="[required('Canceled at is required.'), isDateTime('Invalid format.')]"
                            label="Canceled at"
                            required
                        />
                        <v-text-field
                            v-model.trim="form.status.cancel_reason"
                            v-bind:rules="[required('Cancel reason is required.')]"
                            label="Cancel reason"
                            required
                        >
                            <template v-slot:prepend>
                                <v-icon>{{ mdiHelpCircleOutline }}</v-icon>
                            </template>
                        </v-text-field>
                    </div>
                    <!-- Progress -->
                    <v-label>
                        <v-icon>{{ mdiPercentOutline }}</v-icon>
                        Progress (%)
                    </v-label>
                    <v-progress-linear
                        v-model="progress"
                        v-bind:rules="[range(0, 100, 'Progress must be 0..100')]"
                        height="25"
                        striped
                    >
                        <template v-slot:default="{ value }">
                            <strong>{{ value }}%</strong>
                        </template>
                    </v-progress-linear>
                    <!-- Importance -->
                    <v-label>
                        <v-icon>{{ mdiPriorityHigh }}</v-icon>
                        Importance
                    </v-label>
                    <v-rating
                        v-model="form.importance"
                        v-bind:rules="[range(1, 5, 'Importance must be 1..5')]"
                    />
                    <!-- Urgency -->
                    <v-label>
                        <v-icon>{{ mdiTimerSand }}</v-icon>
                        Urgency
                    </v-label>
                    <v-rating
                        v-model="form.urgency"
                        v-bind:rules="[range(1, 5, 'Urgency must be 1..5')]"
                    />
                    <!-- Start date -->
                    <v-text-field
                        v-model="form.start_at"
                        v-bind:rules="[(v) => v === '' || isDateTime('Invalid format.')(v)]"
                        label="Start date"
                    >
                        <template v-slot:prepend>
                            <v-icon>{{ mdiCalendarOutline }}</v-icon>
                        </template>
                    </v-text-field>
                    <!-- Due date -->
                    <v-text-field
                        v-model="form.due_by"
                        v-bind:rules="[(v) => v === '' || isDateTime('Invalid format.')(v)]"
                        label="Due date (soft target)"
                    >
                        <template v-slot:prepend>
                            <v-icon>{{ mdiCalendarOutline }}</v-icon>
                        </template>
                    </v-text-field>
                    <!-- Deadline -->
                    <v-text-field
                        v-model="form.deadline"
                        v-bind:rules="[(v) => v === '' || isDateTime('Invalid format.')(v)]"
                        label="Deadline (hard cutoff)"
                    >
                        <template v-slot:prepend>
                            <v-icon>{{ mdiCalendarOutline }}</v-icon>
                        </template>
                    </v-text-field>
                    <!-- Scheduled dates -->
                    <v-label>
                        <v-icon>{{ mdiCalendarCursorOutline }}</v-icon>
                        Scheduled dates
                    </v-label>
                    <v-date-picker
                        v-model="form.scheduled_dates"
                        multiple
                        no-title
                        full-width
                    />
                </div>
                <div class="note-pane flex-grow-1 pl-3">
                    <!-- Note -->
                    <v-textarea
                        v-model="form.note"
                        label="Note"
                        outlined
                        no-resize
                        class="full-height-textarea"
                    />
                </div>
            </v-card-text>
        </v-form>
    </v-card>
</template>

<script lang="ts" setup>
import { ref, reactive, computed, watch, toRef } from 'vue';

import {
    mdiAccountOutline,
    mdiCalendarCursorOutline,
    mdiCalendarOutline,
    mdiCancel,
    mdiContentSave,
    mdiDelete,
    mdiFormatHeader1,
    mdiHelpCircleOutline,
    mdiNoteEditOutline,
    mdiPercentOutline,
    mdiPriorityHigh,
    mdiTagMultipleOutline,
    mdiTarget,
    mdiTimerSand,
    mdiTrafficLightOutline,
} from '@mdi/js';

import DateSelector from '@/components/DateSelector.vue';
import { extractFileUuid } from '@/api/task';
import type { UUID, Task, Status, StatusKind } from '@/task';
import { STATUS_LABEL, nextOptions, makeDefaultStatus, canTransition } from '@/task';
import { useFetchTask } from '@/composables/fetchTask';

import dayjs from 'dayjs';

type EditableTask = {
    title: string;
    tags: string[];
    status: Status;
    progress: number;
    importance: number;
    urgency: number;
    start_at: string;
    due_by: string;
    deadline: string;
    scheduled_dates: string[];
    note: string;
};

// Props
const props = defineProps<{
    taskPath: string;
    knownTags: [string, number][];
    busy?: boolean;
}>();
const pathRef = toRef(props, 'taskPath');

// Composables
const { task, loading, error } = useFetchTask(pathRef);

// Emits
const emit = defineEmits<{
    (e: 'save', value: Task): void;
    (e: 'delete', path: string): void;
}>();

// Reactive states
const form = reactive<EditableTask>({
    title: '',
    tags: [],
    status: { kind: 'todo' },
    progress: 0,
    importance: 3,
    urgency: 3,
    start_at: '',
    due_by: '',
    deadline: '',
    scheduled_dates: [],
    note: '',
});
const uiValid = ref(true);

// Template refs
const formRef = ref<any>(null);

// Computed properties
const uuid = computed<UUID>(() => extractFileUuid(props.taskPath));

const isEdit = computed<boolean>(() => !!task.value);

const progress = computed<number>({
    get: () => form.progress,
    set: (p) => {
        form.progress = Math.round(p);
    },
});

const prevStatus = computed<Status>(() => task.value?.status ?? { kind: 'todo' });

const statusOptions = computed<{ kind: StatusKind, label: string }[]>(() => {
    const allowed = nextOptions(prevStatus.value);
    const opts = [prevStatus.value.kind, ...allowed] as StatusKind[];
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
    const from = prevStatus.value;
    const to = form.status.kind;
    if (canTransition(from, to)) {
        return undefined;
    }
    else {
        return `Cannot move from ${STATUS_LABEL[from.kind]} to ${STATUS_LABEL[to]}.`;
    }
});

const tagItems = computed<{ text: string; value: string; }[]>(() =>
    props.knownTags.map(([tag, count]) => {
        return {
            text: `${tag} (${count})`,
            value: tag,
        };
    })
);

// Watchers
watch(
    task,
    (t) => {
        resetFromTask(t);
    },
    { immediate: true },
);

// Methods
function resetFromTask(t?: Task | undefined | null): void {
    if (!t) {
        form.title = '';
        form.tags = [];
        form.status = { kind: 'todo' };
        form.progress = 0;
        form.importance = 3;
        form.urgency = 3;
        form.start_at = '';
        form.due_by = '';
        form.deadline = '';
        form.scheduled_dates = [];
        form.note = '';
    }
    else {
        form.title = t.title ?? '';
        form.tags = Array.isArray(t.tags) ? [...t.tags] : [];
        form.status = (t.status === undefined || t.status === null) ? { kind :'todo' } : { ...t.status };
        form.progress = t.progress ?? 0;
        form.importance  = t.importance ?? 3;
        form.urgency = t.urgency ?? 3;
        form.start_at = t.start_at ?? '';
        form.due_by = t.due_by ?? '';
        form.deadline = t.deadline ?? '';
        form.scheduled_dates = Array.isArray(t.scheduled_dates) ? [...t.scheduled_dates] : [];
        form.note = t.note ?? '';
    }
}

// Validation
const required = (msg: string) => (v: any) => (v != null && String(v).trim().length > 0) || msg;
const isDateTime = (msg: string) => (v: any) => dayjs(v).isValid() || msg;
const range = (min: number, max: number, msg: string) => (v: any) =>
    (typeof v === 'number' && v >= min && v <= max) || msg;

// Save/Delete
function onSave(): void {
    // Check validation results
    const ok = formRef.value?.validate?.();  // Runs Vuetify rules
    if (!ok || statusGateError.value) {
        return;
    }
    // Create a Task value
    const task = {
        uuid: uuid.value,
        title: form.title,
        tags: [...form.tags],
        status: { ...form.status },
        progress: form.progress,
        importance: form.importance,
        urgency: form.urgency,
        ...(form.start_at !== '' ? { start_at: form.start_at } : {}),
        ...(form.due_by !== '' ? { due_by: form.due_by } : {}),
        ...(form.deadline !== '' ? { deadline: form.deadline } : {}),
        scheduled_dates: [...form.scheduled_dates],
        note: form.note,
    };
    emit('save', task);
}

function onDelete(): void {
    if (!isEdit.value) {
        return;
    }
    emit('delete', props.taskPath);
}
</script>

<style scoped lang="scss">
.task-editor-next {
    flex: 1 1 0;
    height: 100%;
}

.props-pane {
    width: 350px;
    box-sizing: content-box;
    overflow-y: auto;
}

.full-height-textarea {
    height: 100%;
}

:deep(.full-height-textarea .v-input__control) {
    height: 100%;
}

:deep(.full-height-textarea .v-input__slot) {
    height: 100%;
}
</style>
