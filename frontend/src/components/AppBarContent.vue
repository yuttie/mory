<template>
    <!-- Deferred until the render that mounts this is done, so the target in App's app bar is
         found whichever of the two happens to mount first. -->
    <Teleport
        defer
        to="#app-bar-content"
    >
        <!-- Provide and inject follow the component tree, not the DOM, so what lands in the app bar
             misses the defaults a toolbar gives the buttons inside it unless they are given here. -->
        <v-defaults-provider v-bind:defaults="{ VBtn: { variant: 'text' } }">
            <slot />
        </v-defaults-provider>
    </Teleport>
</template>

<script lang="ts" setup>
import { onMounted, onUnmounted } from 'vue';

import { useAppStore } from '@/stores/app';

const appStore = useAppStore();

// Counted rather than flagged: navigating mounts the incoming view and unmounts the outgoing one in
// whichever order, and a flag could be cleared by the view that is leaving.
onMounted(() => {
    appStore.appBarClaims += 1;
});

onUnmounted(() => {
    appStore.appBarClaims -= 1;
});
</script>
