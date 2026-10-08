<template>
    <!-- Closes like any dialog until something is typed; from then on only Cancel does, so a stray
         click or Escape cannot throw an outline away. -->
    <v-dialog
        v-model="isOpen"
        v-bind:fullscreen="$vuetify.display.smAndDown"
        v-bind:persistent="text.trim() !== ''"
        max-width="1200"
        v-on:after-enter="editorRef?.focus()"
    >
        <!-- The note editor lets Ctrl+Enter through for its panes' shortcuts; here it adds. -->
        <v-card
            class="quick-add"
            v-on:keydown.ctrl.enter.prevent="add"
        >
            <v-card-title class="d-flex align-center flex-wrap ga-2">
                <span>Quick add tasks</span>
                <v-spacer />
                <v-btn
                    class="parent-button"
                    variant="tonal"
                    size="small"
                    v-bind:prepend-icon="mdiFileTreeOutline"
                    v-bind:disabled="locked"
                    v-bind:title="parentTitle"
                    v-on:click="parentDialogIsVisible = true"
                >
                    <span class="text-truncate">Under: {{ parentTitle }}</span>
                </v-btn>
            </v-card-title>
            <v-card-text class="d-flex flex-column ga-3">
                <div class="panes">
                    <Editor
                        ref="editorRef"
                        class="outline-editor"
                        mode="markdown"
                        v-bind:value="text"
                        v-bind:readonly="locked"
                        v-on:change="text = $event"
                    />
                    <div class="preview">
                        <div
                            v-if="rows.length === 0"
                            class="text-medium-emphasis"
                        >
                            <p class="mb-2">
                                One task per line, nested by indentation, its fields in brackets at the end:
                            </p>
                            <pre class="example">{{ EXAMPLE }}</pre>
                            <v-table
                                density="compact"
                                class="mt-2 syntax"
                            >
                                <tbody>
                                    <tr
                                        v-for="[syntax, meaning] of SYNTAX"
                                        v-bind:key="syntax"
                                    >
                                        <td><code>{{ syntax }}</code></td>
                                        <td>{{ meaning }}</td>
                                    </tr>
                                </tbody>
                            </v-table>
                        </div>
                        <!-- A problem is told under its task rather than in an alert of its own, which
                             came and went with every half-typed field and moved the dialog with it. -->
                        <div
                            v-for="{ task, depth, key } of rows"
                            v-bind:key="key"
                            class="row"
                            v-bind:class="{ 'text-error': problemsByLine.has(task.line) }"
                            v-bind:style="{ paddingLeft: `${depth * 20}px` }"
                        >
                            <v-icon
                                size="small"
                                v-bind:color="statusColor(task.fields.status, taskSettings.resolvedStatusColors)"
                            >
                                {{ statusIcon(task.fields.status, task.children.length > 0) }}
                            </v-icon>
                            <span class="title">{{ task.title || 'Untitled' }}</span>
                            <v-chip
                                v-for="chip of chipsOf(task)"
                                v-bind:key="chip"
                                size="x-small"
                                label
                            >
                                {{ chip }}
                            </v-chip>
                            <v-icon
                                v-if="task.note !== ''"
                                size="small"
                                v-bind:title="task.note"
                            >
                                {{ mdiNoteTextOutline }}
                            </v-icon>
                            <div
                                v-for="(message, index) of problemsByLine.get(task.line)"
                                v-bind:key="index"
                                class="problem text-body-2"
                            >
                                Line {{ task.line }}: {{ message }}
                            </div>
                        </div>
                    </div>
                </div>
                <v-alert
                    v-if="errorText"
                    type="error"
                    density="compact"
                >
                    {{ errorText }}
                </v-alert>
            </v-card-text>
            <v-card-actions>
                <!-- Why Add is disabled, when the task saying so is scrolled out of sight. -->
                <span
                    v-if="pending === null && outline.problems.length > 0"
                    class="text-error text-body-2 ms-2"
                >
                    {{ outline.problems.length === 1 ? '1 problem' : `${outline.problems.length} problems` }} to fix
                </span>
                <v-spacer />
                <v-btn
                    v-bind:disabled="saving"
                    v-on:click="isOpen = false"
                >
                    {{ pending === null ? 'Cancel' : 'Skip the rest' }}
                </v-btn>
                <v-btn
                    color="primary"
                    variant="flat"
                    title="Ctrl+Enter"
                    v-bind:disabled="!canAdd"
                    v-bind:loading="saving"
                    v-on:click="add"
                >
                    {{ addLabel }}
                </v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
    <!-- Only while open: the tree it lists is the whole task forest. -->
    <ParentSelectionDialog
        v-if="isOpen"
        v-model="parentDialogIsVisible"
        mode="choose"
        v-bind:parent="placedUnder"
        v-bind:items="tasks.tree"
        v-on:choose="parent = $event"
    />
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
                v-on:click="openCreated"
            >
                Open
            </v-btn>
        </template>
    </v-snackbar>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { type RouteLocationRaw, useRoute, useRouter } from 'vue-router';
import { mdiFileTreeOutline, mdiNoteTextOutline } from '@mdi/js';

import Editor from '@/components/Editor.vue';
import ParentSelectionDialog from '@/components/ParentSelectionDialog.vue';
import { STATUS_LABEL, type UUID } from '@/task';
import { type OutlineTask, type TaskWrite, countTasks, parseOutline, writesOf } from '@/task-outline';
import { statusColor } from '@/status-color';
import { statusIcon } from '@/status-icon';
import { taskRoute, tasksRoute } from '@/task-route';
import { useTaskSettingsStore } from '@/stores/taskSettings';
import { useTasksStore } from '@/stores/tasks';

const EXAMPLE = [
    '- Task 1 [to do, high, 3w, <=2026-12-01, !<=2026-12-08]',
    '    - Subtask 1 [2d]',
    '    - Subtask 2 [#errands, "Some notes..."]',
    '- Task 2',
].join('\n');

const SYNTAX: [string, string][] = [
    ['backlog, to do, in progress, done', 'Status; Backlog if none'],
    ['low, medium, high', 'Importance'],
    ['3w, 2d', 'Lead time'],
    ['>=2026-11-01', 'Available from'],
    ['<=2026-12-01', 'Due by'],
    ['!<=2026-12-08 17:00', 'Deadline; any date may have a time'],
    ['#tag', 'A tag; as many as wanted'],
    ['"Some notes..."', 'The note'],
];

const props = defineProps<{
    // The task the outline goes under when the dialog opens, or `null` for the top.
    initialParent?: UUID | null;
    // The tag the tasks at the top start with, as Add gives a task the tag group selected in the
    // task view: without it they would land in another group than the one they were added from.
    tag?: string | null;
}>();

const isOpen = defineModel<boolean>({ required: true });

const route = useRoute();
const router = useRouter();
const tasks = useTasksStore();
const taskSettings = useTaskSettingsStore();

const text = ref('');
const parent = ref<UUID | null>(null);
const parentDialogIsVisible = ref(false);
const saving = ref(false);
const errorText = ref('');
// The writes of an attempt that failed part way, and how many of them landed. Kept, and the
// outline locked, so that trying again writes the rest under the same names rather than every
// task a second time.
const pending = ref<TaskWrite[] | null>(null);
const written = ref(0);
// Where the parent's file was when they were rendered: the rest go in its directory, so they are
// not written once it has moved or gone.
const pendingParentPath = ref<string | null>(null);
const successMessage = ref(false);
const successText = ref('');
// Where Open goes: the list of the task it all went under, or the first at the top in its editor.
const createdRoute = ref<RouteLocationRaw | null>(null);

const editorRef = ref<InstanceType<typeof Editor> | null>(null);

// The parent chosen, while the listing still holds it.
const placedUnder = computed<UUID | null>(() => {
    return parent.value !== null && tasks.node(parent.value) !== undefined ? parent.value : null;
});

// Only at the top: a task under another is in no tag group.
const topTag = computed<string | null>(() => placedUnder.value === null ? props.tag ?? null : null);

// The tag group stands where a parent would, as the task tree draws it.
const parentTitle = computed<string>(() => {
    if (placedUnder.value === null) {
        return topTag.value === null ? 'Top level' : `#${topTag.value}`;
    }
    return tasks.node(placedUnder.value)?.title || 'Untitled';
});

const outline = computed(() => {
    const read = parseOutline(text.value);
    const tag = topTag.value;
    if (tag !== null) {
        // First, since a task's group is its first tag.
        for (const task of read.tasks) {
            task.fields.tags = [tag, ...task.fields.tags.filter((other) => other !== tag)];
        }
    }
    return read;
});

const count = computed(() => countTasks(outline.value.tasks));

const problemsByLine = computed(() => {
    const byLine = new Map<number, string[]>();
    for (const { line, message } of outline.value.problems) {
        byLine.set(line, [...byLine.get(line) ?? [], message]);
    }
    return byLine;
});

const rows = computed(() => {
    const result: { task: OutlineTask; depth: number; key: number }[] = [];
    const visit = (task: OutlineTask, depth: number): void => {
        result.push({ task, depth, key: task.line });
        task.children.forEach((child) => visit(child, depth + 1));
    };
    outline.value.tasks.forEach((task) => visit(task, 0));
    return result;
});

// What the preview says of a task besides its title, as it will be written.
function chipsOf(task: OutlineTask): string[] {
    const { status, importance, lead_time, available_from, due_by, deadline, tags } = task.fields;
    return [
        STATUS_LABEL[status],
        ...(importance ? [`${importance} importance`] : []),
        ...(lead_time ? [`lead ${lead_time}`] : []),
        ...(available_from ? [`from ${available_from}`] : []),
        ...(due_by ? [`due ${due_by}`] : []),
        ...(deadline ? [`deadline ${deadline}`] : []),
        ...tags.map((tag) => `#${tag}`),
    ];
}

const locked = computed(() => saving.value || pending.value !== null);

const canAdd = computed(() => {
    return !saving.value && (pending.value !== null || (count.value > 0 && outline.value.problems.length === 0));
});

const addLabel = computed(() => {
    if (pending.value !== null) {
        return `Add the remaining ${pending.value.length - written.value}`;
    }
    if (count.value === 0) {
        return 'Add tasks';
    }
    return count.value === 1 ? 'Add 1 task' : `Add ${count.value} tasks`;
});

// Every opening is another outline, under the task it was opened from.
watch(isOpen, (open) => {
    if (open) {
        text.value = '';
        parent.value = props.initialParent ?? null;
        errorText.value = '';
        pending.value = null;
        written.value = 0;
        pendingParentPath.value = null;
    }
});

async function add(): Promise<void> {
    if (!canAdd.value) {
        return;
    }
    const parentPath = placedUnder.value === null ? null : tasks.node(placedUnder.value)?.path ?? null;
    if (pending.value !== null && parentPath !== pendingParentPath.value) {
        errorText.value = `"${parentTitle.value}" has moved or gone since, so the rest cannot go under it.`;
        return;
    }
    const writes = pending.value ?? writesOf(outline.value.tasks, (id) => tasks.pathUnder(placedUnder.value, id));
    pending.value = writes;
    pendingParentPath.value = parentPath;
    saving.value = true;
    errorText.value = '';
    let failure: unknown = null;
    try {
        await tasks.saveAll(writes.slice(written.value), () => { written.value += 1; });
    }
    catch (e) {
        failure = e;
    }
    finally {
        saving.value = false;
    }
    if (written.value < writes.length) {
        const reason = failure instanceof Error ? failure.message : String(failure);
        errorText.value = `Added ${written.value} of ${writes.length} tasks; "${writes[written.value].title}" failed: ${reason}`;
        // The ones that landed belong in the tree meanwhile, rather than waiting for whatever
        // syncs next; if this fails too, that is all it costs.
        tasks.refresh().catch(() => undefined);
        return;
    }
    // Every task landed. A sync that failed after them only leaves the tree behind until the next.
    const viewMode = route.name === 'TasksNextWithParams' ? String(route.params.viewMode) : undefined;
    createdRoute.value = placedUnder.value === null
        ? taskRoute(writes[0].uuid)
        : tasksRoute(placedUnder.value, 'descendants', viewMode);
    successText.value = writes.length === 1 ? `Added "${writes[0].title}".` : `Added ${writes.length} tasks.`;
    successMessage.value = true;
    pending.value = null;
    isOpen.value = false;
}

function openCreated(): void {
    if (createdRoute.value !== null) {
        router.push(createdRoute.value);
    }
    successMessage.value = false;
}
</script>

<style scoped lang="scss">
// It may shrink below its content and scroll, rather than push the buttons off a dialog that
// fills the screen.
.v-card-text {
    min-height: 0;
    overflow-y: auto;
}

.panes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    height: 50vh;

    // Below `md` the dialog fills the screen, and the panes take what the title, an error and the
    // buttons leave.
    @media (max-width: 959px) {
        grid-template-columns: 1fr;
        grid-template-rows: 1fr 1fr;
        height: auto;
        flex: 1 1 0;
        min-height: 320px;
    }
}

// A button does not wrap its label, so a long title is cut short rather than run off a phone.
.parent-button {
    max-width: 100%;

    :deep(.v-btn__content) {
        min-width: 0;
    }
}

// A `v-alert` grows by default, and would take half of what the panes are to fill.
.v-alert {
    flex: 0 0 auto;
}

.outline-editor {
    min-height: 0;
    border: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
    border-radius: 4px;
}

.preview {
    min-height: 0;
    overflow: auto;
}

.row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding-top: 2px;
    padding-bottom: 2px;

    .title {
        margin-right: 4px;
    }
}

.problem {
    flex-basis: 100%;
}

.example {
    font-size: 0.85em;
    white-space: pre-wrap;
}

.syntax td {
    font-size: 0.85em;
}
</style>
