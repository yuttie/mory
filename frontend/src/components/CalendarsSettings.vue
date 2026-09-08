<template>
    <v-card class="mt-6">
        <v-card-text>
            <v-card-title>Calendars</v-card-title>
            <v-alert
                class="mb-4"
                type="info"
                variant="tonal"
            >
                Subscribed calendars are stored in the repository
                as <code>{{ CALENDARS_PATH }}</code> and are shared across browsers.
                Their events are read-only until converted to a note.
            </v-alert>

            <v-list
                v-if="calendars.subscriptions.length > 0"
            >
                <v-list-item
                    v-for="(subscription, index) of calendars.subscriptions"
                    v-bind:key="subscription.id"
                    v-bind:subtitle="subscription.url"
                    v-bind:title="subscription.name || subscription.id"
                >
                    <template v-slot:prepend>
                        <v-avatar
                            v-bind:color="subscription.color || DEFAULT_IMPORTED_COLOR"
                            size="16"
                        ></v-avatar>
                    </template>
                    <template v-slot:append>
                        <v-switch
                            v-bind:model-value="subscription.enabled"
                            class="mr-2"
                            hide-details
                            v-on:update:model-value="setEnabled(index, $event)"
                        ></v-switch>
                        <v-btn
                            icon
                            size="small"
                            variant="text"
                            v-on:click="openEditDialog(index)"
                        >
                            <v-icon>{{ mdiPencil }}</v-icon>
                        </v-btn>
                        <v-btn
                            icon
                            size="small"
                            variant="text"
                            v-on:click="remove(index)"
                        >
                            <v-icon>{{ mdiDelete }}</v-icon>
                        </v-btn>
                    </template>
                </v-list-item>
            </v-list>
            <p
                v-else
                class="text-medium-emphasis"
            >
                No calendars subscribed yet.
            </p>

            <v-btn
                v-bind:prepend-icon="mdiPlus"
                class="mt-4"
                v-on:click="openEditDialog(null)"
            >
                Add calendar
            </v-btn>

            <v-divider class="mt-6 mb-4"></v-divider>

            <v-card-subtitle class="px-0">Task dates</v-card-subtitle>
            <p class="text-medium-emphasis mb-4">
                The colours a task's due date and deadline are drawn in, on the calendar and on the
                home page. Stored in the same file, so they follow the notes rather than the
                browser. Leave one empty for its default.
            </p>
            <div class="task-date-colors">
                <v-text-field
                    v-for="field of TASK_DATE_FIELDS"
                    v-bind:key="field.name"
                    v-model="taskDateDraft[field.name]"
                    v-bind:label="field.label"
                    v-bind:placeholder="field.fallback"
                    persistent-placeholder
                >
                    <template v-slot:prepend-inner>
                        <v-avatar
                            v-bind:color="taskDateDraft[field.name].trim() || field.fallback"
                            size="16"
                        ></v-avatar>
                    </template>
                </v-text-field>
            </div>
            <v-btn
                v-bind:disabled="!taskDateColorsChanged"
                v-bind:loading="isSavingColors"
                variant="tonal"
                v-on:click="saveTaskDateColors"
            >
                Save colours
            </v-btn>
            <v-alert
                v-if="colorError"
                class="mt-4"
                type="error"
                variant="tonal"
            >{{ colorError }}</v-alert>

            <v-alert
                v-if="error"
                class="mt-4"
                type="error"
                variant="tonal"
            >{{ error }}</v-alert>
        </v-card-text>

        <v-dialog
            v-model="dialogOpen"
            max-width="40em"
        >
            <v-card>
                <v-card-title>{{ editingIndex === null ? 'Add calendar' : 'Edit calendar' }}</v-card-title>
                <v-card-text>
                    <v-text-field
                        v-model="draft.name"
                        label="Name"
                    ></v-text-field>
                    <v-text-field
                        v-model="draft.url"
                        hint="The calendar's iCal address. In Google Calendar, its settings page calls this the secret address in iCal format."
                        label="iCal URL"
                        persistent-hint
                    ></v-text-field>
                    <v-text-field
                        v-model="draft.id"
                        hint="Used to identify this calendar in converted notes. Changing it unlinks notes already converted from it."
                        label="Identifier"
                        persistent-hint
                    ></v-text-field>
                    <v-text-field
                        v-model="draft.color"
                        class="mt-4"
                        label="Colour"
                        placeholder="#3f51b5"
                    ></v-text-field>
                    <v-alert
                        v-if="draftError"
                        type="error"
                        variant="tonal"
                    >{{ draftError }}</v-alert>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn v-on:click="dialogOpen = false">Cancel</v-btn>
                    <v-btn
                        v-bind:loading="isSaving"
                        variant="tonal"
                        v-on:click="save"
                    >Save</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </v-card>
</template>

<script lang="ts" setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';

import Color from 'color';
import { mdiDelete, mdiPencil, mdiPlus } from '@mdi/js';

import { DEFAULT_DEADLINE_COLOR, DEFAULT_DUE_COLOR, DEFAULT_IMPORTED_COLOR } from '@/events';
import type { TaskDateColors } from '@/events';
import { CALENDARS_PATH, useCalendarsStore } from '@/stores/calendars';
import type { CalendarSubscription } from '@/stores/calendars';

// The two fields, with what each falls back to when it is left empty.
const TASK_DATE_FIELDS = [
    { name: 'due_by', label: 'Due date colour', fallback: DEFAULT_DUE_COLOR },
    { name: 'deadline', label: 'Deadline colour', fallback: DEFAULT_DEADLINE_COLOR },
] as const;

// Composables
const calendars = useCalendarsStore();

// Reactive states
const dialogOpen = ref(false);
const editingIndex = ref<number | null>(null);
const isSaving = ref(false);
const error = ref('');
const draftError = ref('');
const draft = reactive<CalendarSubscription>({
    id: '',
    name: '',
    url: '',
    color: '',
    enabled: true,
});

const isSavingColors = ref(false);
const colorError = ref('');
// Edited as text, so an empty field can mean "the default" rather than an unset key.
const taskDateDraft = reactive<Record<'due_by' | 'deadline', string>>({ due_by: '', deadline: '' });

// Computed properties
const taskDateColorsChanged = computed(() => TASK_DATE_FIELDS.some(
    (field) => taskDateDraft[field.name].trim() !== (calendars.taskDateColors[field.name] ?? ''),
));

// Lifecycle hooks
onMounted(() => {
    calendars.loadSubscriptions().catch((err) => {
        error.value = `Could not read ${CALENDARS_PATH}: ${err}`;
    });
});

// Watchers
// The file is read after this component mounts, so the draft is filled in when it arrives rather
// than at setup, where there is nothing to fill it from yet.
watch(() => calendars.taskDateColors, (colors) => {
    for (const field of TASK_DATE_FIELDS) {
        taskDateDraft[field.name] = colors[field.name] ?? '';
    }
}, { immediate: true });

// Methods
function openEditDialog(index: number | null) {
    editingIndex.value = index;
    draftError.value = '';
    const existing = index === null ? null : calendars.subscriptions[index];
    Object.assign(draft, existing === null
        ? { id: '', name: '', url: '', color: '', enabled: true }
        : { ...existing, color: existing.color ?? '' });
    dialogOpen.value = true;
}

// A slug rather than the name, because this is what converted notes record: it has to stay stable
// when the name is edited, and readable in a note's frontmatter.
function slugify(name: string): string {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return slug === '' ? `calendar-${Date.now()}` : slug;
}

async function save() {
    if (draft.url.trim() === '') {
        draftError.value = 'A calendar needs a URL.';
        return;
    }
    if (!draft.url.trim().startsWith('https://')) {
        // The backend refuses anything else, so say so here rather than after a failed fetch.
        draftError.value = 'The URL must start with https://.';
        return;
    }

    const id = draft.id.trim() === '' ? slugify(draft.name.trim() || draft.url) : draft.id.trim();
    const clash = calendars.subscriptions
        .some((subscription, index) => subscription.id === id && index !== editingIndex.value);
    if (clash) {
        draftError.value = `Another calendar already uses the identifier "${id}".`;
        return;
    }

    const entry: CalendarSubscription = {
        id,
        name: draft.name.trim() || id,
        url: draft.url.trim(),
        ...(draft.color?.trim() ? { color: draft.color.trim() } : {}),
        enabled: draft.enabled,
    };
    const next = [...calendars.subscriptions];
    if (editingIndex.value === null) {
        next.push(entry);
    }
    else {
        next[editingIndex.value] = entry;
    }
    await persist(next, () => { dialogOpen.value = false; });
}

async function setEnabled(index: number, enabled: boolean | null) {
    const next = [...calendars.subscriptions];
    next[index] = { ...next[index], enabled: enabled === true };
    await persist(next);
}

async function remove(index: number) {
    const next = calendars.subscriptions.filter((_, at) => at !== index);
    await persist(next);
}

async function saveTaskDateColors() {
    const next: TaskDateColors = {};
    for (const field of TASK_DATE_FIELDS) {
        const value = taskDateDraft[field.name].trim();
        if (value === '') {
            continue;
        }
        // `Color` throws on anything it cannot parse, and the views fall back to the default when
        // it does -- so a typo would silently save and then appear to have been ignored.
        try {
            Color(value);
        }
        catch {
            colorError.value = `"${value}" is not a colour this can draw.`;
            return;
        }
        next[field.name] = value;
    }

    isSavingColors.value = true;
    colorError.value = '';
    try {
        await calendars.saveTaskDateColors(next);
    }
    catch (err) {
        colorError.value = `Could not save ${CALENDARS_PATH}: ${err}`;
    }
    finally {
        isSavingColors.value = false;
    }
}

async function persist(next: CalendarSubscription[], onSaved?: () => void) {
    isSaving.value = true;
    error.value = '';
    try {
        await calendars.saveSubscriptions(next);
        onSaved?.();
    }
    catch (err) {
        error.value = `Could not save ${CALENDARS_PATH}: ${err}`;
    }
    finally {
        isSaving.value = false;
    }
}
</script>

<style scoped lang="scss">
// Side by side where there is room, so the two colours are compared rather than read in turn.
.task-date-colors {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14em, 1fr));
    gap: 0 1rem;
}
</style>
