<template>
    <v-list-item
        v-bind:prepend-icon="mdiFileDocumentOutline"
        v-bind:title="path.replace(/\.template$/i, '')"
    >
        <template v-slot:append>
            <v-icon>{{ mdiChevronRight }}</v-icon>
        </template>
        <v-menu
            activator="parent"
            submenu
            open-on-hover
        >
            <v-list>
                <v-list-item
                    v-bind:to="{ name: 'Create', query: { from: path } }"
                    v-bind:prepend-icon="mdiFileOutline"
                    title="New note"
                ></v-list-item>
                <v-list-item
                    v-if="parent !== null"
                    v-bind:to="{ name: 'Create', query: { from: path, parent } }"
                    v-bind:prepend-icon="mdiSubdirectoryArrowRight"
                    title="New child note"
                ></v-list-item>
                <v-list-item
                    v-bind:to="{ name: 'Note', params: { path: path.split('/') } }"
                    v-bind:prepend-icon="mdiPencil"
                    title="Edit"
                ></v-list-item>
            </v-list>
        </v-menu>
    </v-list-item>
</template>

<script lang="ts" setup>
import {
    mdiChevronRight,
    mdiFileDocumentOutline,
    mdiFileOutline,
    mdiPencil,
    mdiSubdirectoryArrowRight,
} from '@mdi/js';

// Props
defineProps<{
    // The template's path.
    path: string;
    // The open note, which "New child note" nests the new note under; `null` when none is open.
    parent: string | null;
}>();
</script>
