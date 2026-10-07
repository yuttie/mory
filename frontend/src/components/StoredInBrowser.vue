<template>
    <div class="mb-4">
        <!-- On a phone the panel is too narrow to give the icon its column. A note, not the alert
             v-alert makes it by default: an alert is read out over whatever the screen reader was
             saying, each time a panel opens. -->
        <v-alert
            v-bind:icon="$vuetify.display.xs ? false : mdiMonitor"
            class="mb-4"
            type="info"
            variant="tonal"
            role="note"
        >
            Saved in this browser as you change them; no other browser sees them.
            <strong>Save to repository</strong> copies every tab under This browser into
            <code>{{ DEFAULT_CONFIG_PATH }}</code>; <strong>Load from repository</strong> copies
            it back here, replacing them.
        </v-alert>
        <!-- Outside the alert: inside, its padding leaves a 320px phone too little width for
             the longer label. -->
        <div class="d-flex flex-wrap ga-2">
            <v-btn
                v-bind:loading="busy === 'load'"
                v-bind:disabled="busy === 'save'"
                v-on:click="emit('load')"
            >
                Load from repository
            </v-btn>
            <v-btn
                v-bind:loading="busy === 'save'"
                v-bind:disabled="busy === 'load'"
                v-on:click="emit('save')"
            >
                Save to repository
            </v-btn>
        </div>
        <v-alert
            v-if="error"
            class="mt-4"
            type="error"
            variant="tonal"
        >
            {{ error }}
        </v-alert>
    </div>
</template>

<script lang="ts" setup>
import { mdiMonitor } from '@mdi/js';

import { DEFAULT_CONFIG_PATH } from '@/config';

defineProps<{
    busy: 'load' | 'save' | null;
    error: string;
}>();

const emit = defineEmits<{
    load: [];
    save: [];
}>();
</script>
