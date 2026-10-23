<template>
    <!-- Near the top of the screen, as a command palette is, rather than in its middle: centred,
         the search field would move with every key that changes how many files are listed. The
         palette is mounted only while the dialog is open, so a closed one costs nothing on a
         sync, and mounted anew for each opening, so each starts a new search with the focus in
         its field: Vuetify keeps the last one until it has finished scaling out, and an opening
         meanwhile would find it with its search and without the focus, which stayed where the
         closing gave it back, in a note being written, say. -->
    <v-dialog
        v-model="isOpen"
        max-width="720"
        aria-label="Search files"
        class="file-search-dialog"
    >
        <FileSearchPalette
            v-bind:key="openings"
            v-on:choose="choose"
            v-on:close="isOpen = false"
        />
    </v-dialog>
</template>

<script lang="ts" setup>
import { nextTick, ref, watch } from 'vue';

import { useRoute, useRouter } from 'vue-router';
import type { RouteLocationRaw } from 'vue-router';

import FileSearchPalette from '@/components/FileSearchPalette.vue';
import { isSearchKey, useShortcuts } from '@/keyboard';

const route = useRoute();
const router = useRouter();

const isOpen = ref(false);
const openings = ref(0);

// Where the focus was when the dialog opened, to give back if it closes with nothing opened: the
// note being written, say, rather than the page.
let returnFocusTo: HTMLElement | null = null;

// From any view, and from a text field too, as the browser's own Ctrl+K would be taken. Not from
// under another dialog, which has every key, nor from an editor that has taken the key for itself:
// its Emacs bindings kill a line with it. Once for each press: the key held down would repeat,
// closing the dialog and opening it again until let go.
useShortcuts((event) => {
    if (isSearchKey(event) && !event.defaultPrevented) {
        event.preventDefault();
        if (event.repeat) {
            return;
        }
        returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        openings.value += 1;
        isOpen.value = true;
    }
});

// The page already shown is no navigation, so choosing it closes the dialog as Escape does, giving
// the focus back: to the note being written, say, when that is the one chosen. Where on the page
// the address points, its hash, does not make it another.
function choose(to: RouteLocationRaw): void {
    if (pageOf(router.resolve(to).fullPath) !== pageOf(route.fullPath)) {
        returnFocusTo = null;
        void router.push(to);
    }
    isOpen.value = false;
}

// A `#` within the path or the query is escaped, so the first is the hash's.
function pageOf(fullPath: string): string {
    return fullPath.split('#', 1)[0];
}

// Once the dialog has let the focus go, as Vuetify gives it back to an activator.
watch(isOpen, async (open) => {
    if (open) {
        return;
    }
    await nextTick();
    if (returnFocusTo?.isConnected) {
        returnFocusTo.focus({ preventScroll: true });
    }
    returnFocusTo = null;
});
</script>

<style scoped lang="scss">
.file-search-dialog {
    align-items: flex-start;

    :deep(> .v-overlay__content) {
        $top: min(10vh, 96px);
        margin-top: $top;
        max-height: calc(100% - #{$top} - 24px);
    }
}
</style>
