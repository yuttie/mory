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
                <ColorField
                    v-for="field of TASK_DATE_FIELDS"
                    v-bind:key="field.name"
                    v-model="taskDateDraft[field.name]"
                    v-bind:fallback="field.fallback"
                    v-bind:label="field.label"
                ></ColorField>
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

            <v-divider class="mt-6 mb-4"></v-divider>

            <v-card-subtitle class="px-0">Event categories</v-card-subtitle>
            <p class="text-medium-emphasis mb-4">
                An event joins one by naming it, as in <code>category: meeting</code>, and is drawn
                in its colour and with its name template unless it sets its own colour. Stored in the
                same file.
            </p>
            <v-list
                v-if="categoryList.length > 0"
            >
                <v-list-item
                    v-for="(category, index) of categoryList"
                    v-bind:key="category.id"
                    v-bind:subtitle="previewOf(category.id)"
                    v-bind:title="category.id"
                >
                    <template v-slot:prepend>
                        <v-avatar
                            v-bind:color="resolvedOf(category.id).color || DEFAULT_EVENT_COLOR"
                            size="16"
                        ></v-avatar>
                    </template>
                    <template v-slot:append>
                        <v-btn
                            icon
                            size="small"
                            variant="text"
                            v-on:click="openCategoryDialog(index)"
                        >
                            <v-icon>{{ mdiPencil }}</v-icon>
                        </v-btn>
                        <v-btn
                            icon
                            size="small"
                            variant="text"
                            v-on:click="removeCategory(index)"
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
                No categories yet.
            </p>
            <v-btn
                v-bind:prepend-icon="mdiPlus"
                class="mt-4"
                v-on:click="openCategoryDialog(null)"
            >
                Add category
            </v-btn>
            <v-alert
                v-if="categoryError"
                class="mt-4"
                type="error"
                variant="tonal"
            >{{ categoryError }}</v-alert>

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
                    <ColorField
                        v-model="draft.color"
                        v-bind:fallback="DEFAULT_IMPORTED_COLOR"
                        class="mt-4"
                        label="Colour"
                    ></ColorField>
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

        <v-dialog
            v-model="categoryDialogOpen"
            max-width="40em"
        >
            <v-card>
                <v-card-title>{{ editingCategoryIndex === null ? 'Add category' : 'Edit category' }}</v-card-title>
                <v-card-text>
                    <v-text-field
                        v-model="categoryDraft.id"
                        hint="What an event writes after category:. A slash nests it: meeting/1on1 takes whatever it leaves empty from meeting. Notes naming an identifier that no longer exists are reported on the calendar."
                        label="Identifier"
                        persistent-hint
                    ></v-text-field>
                    <v-text-field
                        v-model="categoryDraft.name"
                        v-bind:placeholder="inheritedDraft.name"
                        class="mt-4"
                        hint="{{name}} stands for the event's own name, as in [MTG] {{name}}. Leave it empty to inherit, or to keep names as they are."
                        label="Name template"
                        persistent-hint
                        persistent-placeholder
                    ></v-text-field>
                    <ColorField
                        v-model="categoryDraft.color"
                        v-bind:fallback="inheritedDraft.color ?? DEFAULT_EVENT_COLOR"
                        class="mt-4"
                        label="Colour"
                    ></ColorField>
                    <v-alert
                        v-if="categoryDraftError"
                        type="error"
                        variant="tonal"
                    >{{ categoryDraftError }}</v-alert>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn v-on:click="categoryDialogOpen = false">Cancel</v-btn>
                    <v-btn
                        v-bind:loading="isSavingCategories"
                        variant="tonal"
                        v-on:click="saveCategory"
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

import ColorField from '@/components/ColorField.vue';
import {
    DEFAULT_DEADLINE_COLOR,
    DEFAULT_DUE_COLOR,
    DEFAULT_EVENT_COLOR,
    DEFAULT_IMPORTED_COLOR,
    applyNameTemplate,
    resolveCategory,
} from '@/events';
import type { EventCategory, TaskDateColors } from '@/events';
import { CALENDARS_PATH, useCalendarsStore } from '@/stores/calendars';
import type { CalendarSubscription, ConfiguredCategory } from '@/stores/calendars';

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

const categoryDialogOpen = ref(false);
const editingCategoryIndex = ref<number | null>(null);
const isSavingCategories = ref(false);
const categoryError = ref('');
const categoryDraftError = ref('');
// Text, for the same reason as the task date colours: empty means "inherit".
const categoryDraft = reactive({ id: '', name: '', color: '' });

// Computed properties
const taskDateColorsChanged = computed(() => TASK_DATE_FIELDS.some(
    (field) => taskDateDraft[field.name].trim() !== (calendars.taskDateColors[field.name] ?? ''),
));

// `null` while the file is unread or unreadable; there is nothing to list either way.
const categoryList = computed(() => calendars.categories ?? []);

const categoryMap = computed(() => calendars.categoryMap ?? new Map<string, EventCategory>());

// What the category being edited would inherit from its ancestors, shown where its own fields are
// empty. Resolved as the calendar resolves it, with the draft standing in as a category of its own
// that sets nothing.
const inheritedDraft = computed((): EventCategory => {
    const id = categoryDraft.id.trim();
    if (id === '') {
        return {};
    }
    return resolveCategory(id, new Map([...categoryMap.value, [id, {}]])) ?? {};
});

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

function resolvedOf(id: string): EventCategory {
    return resolveCategory(id, categoryMap.value) ?? {};
}

// How an event's name reads under the category, with a stand-in for the name.
function previewOf(id: string): string {
    const template = resolvedOf(id).name;
    return template === undefined ? 'Names unchanged' : applyNameTemplate(template, 'Weekly sync');
}

function openCategoryDialog(index: number | null) {
    editingCategoryIndex.value = index;
    categoryDraftError.value = '';
    const existing = index === null ? null : categoryList.value[index];
    Object.assign(categoryDraft, {
        id: existing?.id ?? '',
        name: existing?.name ?? '',
        color: existing?.color ?? '',
    });
    categoryDialogOpen.value = true;
}

async function saveCategory() {
    const id = categoryDraft.id.trim();
    if (id === '') {
        categoryDraftError.value = 'A category needs an identifier.';
        return;
    }
    // An empty part would nest under a category no one could name.
    if (id.split('/').some((part) => part.trim() === '')) {
        categoryDraftError.value = 'An identifier cannot start or end with a slash, or have two in a row.';
        return;
    }
    const clash = categoryList.value
        .some((category, index) => category.id === id && index !== editingCategoryIndex.value);
    if (clash) {
        categoryDraftError.value = `Another category already uses the identifier "${id}".`;
        return;
    }
    const color = categoryDraft.color.trim();
    if (color !== '') {
        // The same check the task date colours get: the views fall back to the default on a
        // colour they cannot parse, so a typo would save and then appear to be ignored.
        try {
            Color(color);
        }
        catch {
            categoryDraftError.value = `"${color}" is not a colour this can draw.`;
            return;
        }
    }

    const name = categoryDraft.name.trim();
    const entry: ConfiguredCategory = {
        id,
        ...(color === '' ? {} : { color }),
        ...(name === '' ? {} : { name }),
    };
    const next = [...categoryList.value];
    if (editingCategoryIndex.value === null) {
        next.push(entry);
    }
    else {
        next[editingCategoryIndex.value] = entry;
    }
    await persistCategories(next, () => { categoryDialogOpen.value = false; });
}

async function removeCategory(index: number) {
    await persistCategories(categoryList.value.filter((_, at) => at !== index));
}

async function persistCategories(next: ConfiguredCategory[], onSaved?: () => void) {
    isSavingCategories.value = true;
    categoryError.value = '';
    try {
        await calendars.saveCategories(next);
        onSaved?.();
    }
    catch (err) {
        categoryError.value = `Could not save ${CALENDARS_PATH}: ${err}`;
    }
    finally {
        isSavingCategories.value = false;
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
