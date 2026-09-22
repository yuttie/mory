<template>
    <v-menu
        v-bind:close-on-content-click="false"
        v-bind:location="location"
    >
        <template #activator="{ props: activator }">
            <v-list-item
                v-bind="activator"
                variant="text"
                title="Indexing stopped"
                base-color="error"
            >
                <template #prepend>
                    <v-icon>
                        {{ mdiAlertCircleOutline }}
                    </v-icon>
                </template>
            </v-list-item>
        </template>
        <v-card max-width="420">
            <v-card-title>Indexing stopped</v-card-title>
            <v-card-text>
                <p
                    v-for="stop in stops"
                    v-bind:key="stop.work"
                    class="mb-2"
                >
                    <strong>{{ WORK_LABELS[stop.work] ?? stop.work }}</strong>: {{ stop.message }}
                </p>
                <p>Fix the cause, then restart moried to resume indexing.</p>
            </v-card-text>
        </v-card>
    </v-menu>
</template>

<script lang="ts" setup>
// Tells the user that search indexing has stopped on a failure only they can fix, such as a
// rejected OpenAI API key, and why. Nothing retries it before moried restarts, so without this
// the only trace would be one line in the server log.

import { mdiAlertCircleOutline } from '@mdi/js';

import type { IndexingStop } from '@/api';

withDefaults(defineProps<{
    stops: IndexingStop[];
    location?: 'right' | 'bottom';
}>(), {
    location: 'right',
});

const WORK_LABELS: Record<IndexingStop['work'], string> = {
    embeddings: 'Semantic search',
    image_descriptions: 'Image descriptions',
};
</script>
