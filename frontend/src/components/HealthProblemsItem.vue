<template>
    <v-list-item
        v-if="health.notice !== null"
        to="/health"
        variant="text"
        v-bind:title="health.notice.text"
        v-bind:base-color="health.notice.severity"
        v-bind:prepend-icon="health.notice.icon"
    />
</template>

<script lang="ts" setup>
// Tells the user that a health check fails. The page is reached from the account menu, which
// nobody opens to learn that a note they are not looking at has gone wrong, so without this a
// problem would wait for someone to think of checking.

import { useHealthStore } from '@/stores/health';

const health = useHealthStore();
</script>
