<template>
    <v-progress-linear
        v-bind:active="files.isLoading"
        indeterminate
        color="primary"
        height="2"
    />
</template>

<script lang="ts" setup>
// Whether the files are syncing, in a component of its own so that a sync starting and ending draws
// this bar alone again. Bound in the search palette, which syncs as it opens, it was read as the
// card around it drew its contents, and the card drew every row the palette lists again, twice at
// each opening.

import { useFilesStore } from '@/stores/files';

const files = useFilesStore();
</script>
