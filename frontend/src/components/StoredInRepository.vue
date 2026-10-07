<template>
    <!-- On a phone the panel is too narrow to give the icon its column. -->
    <v-alert
        v-bind:icon="$vuetify.display.xs ? false : mdiSourceRepository"
        class="mb-4"
        type="info"
        variant="tonal"
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
