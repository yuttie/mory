<template>
    <v-list-item
        link
        v-bind:prepend-icon="mdiFileDocumentOutline"
        v-bind:title="path.replace(/\.template$/i, '')"
        v-on:click.stop="submenuIsVisible = true"
    >
        <template v-slot:append>
            <v-icon>{{ mdiChevronRight }}</v-icon>
        </template>
        <v-menu
            v-model="submenuIsVisible"
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
import { ref } from 'vue';

import {
    mdiChevronRight,
    mdiFileDocumentOutline,
    mdiFileOutline,
    mdiPencil,
    mdiSubdirectoryArrowRight,
} from '@mdi/js';

// Reactive states
//
// The row is `link` so that it is focusable, which a row with no destination is not, and the
// keyboard can reach it. Its click is stopped and the submenu opened by hand: left to bubble, the
// click reaches the Add menu around this one, which closes on a click in its content, and
// `open-on-hover` turns off opening on click, so a tap would only close both menus.
const submenuIsVisible = ref(false);

// Props
defineProps<{
    // The template's path.
    path: string;
    // The open note, which "New child note" nests the new note under; `null` when none is open.
    parent: string | null;
}>();
</script>
