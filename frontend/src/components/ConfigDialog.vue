<template>
    <v-dialog
        v-model="isOpen"
        v-bind:fullscreen="$vuetify.display.smAndDown"
        max-width="1000"
        height="min(800px, calc(100dvh - 48px))"
        aria-labelledby="config-dialog-title"
    >
        <v-card class="config-dialog">
            <v-card-title class="d-flex align-center">
                <h1
                    id="config-dialog-title"
                    class="text-title-large"
                >
                    Config
                </h1>
                <v-spacer />
                <v-icon-btn
                    v-bind:icon="mdiClose"
                    variant="text"
                    title="Close Config"
                    v-on:click="isOpen = false"
                />
            </v-card-title>
            <v-divider />
            <ConfigSettings class="flex-grow-1" />
        </v-card>
    </v-dialog>
</template>

<script lang="ts" setup>
import { mdiClose } from '@mdi/js';

import ConfigSettings from '@/components/ConfigSettings.vue';

const isOpen = defineModel<boolean>({ required: true });
</script>

<style scoped lang="scss">
.config-dialog {
    height: 100%;
}
</style>
