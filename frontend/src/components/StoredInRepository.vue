<template>
    <!-- On a phone the panel is too narrow to give the icon its column. A note, not the alert
         v-alert makes it by default: an alert is read out over whatever the screen reader was
         saying, each time a panel opens. -->
    <v-alert
        v-bind:icon="$vuetify.display.xs ? false : mdiSourceRepository"
        class="mb-4"
        type="info"
        variant="tonal"
        role="note"
    >
        Stored in the repository as <code>{{ path }}</code> and shared by every browser.
        Each save is a commit.
    </v-alert>
</template>

<script lang="ts" setup>
import { mdiSourceRepository } from '@mdi/js';

defineProps<{
    path: string;
}>();
</script>
