<template>
    <v-list-item
        to="/health"
        title="Health"
        v-bind:prepend-icon="mdiHeartPulse"
        v-bind:aria-label="health.notice ? `Health: ${health.notice.text}` : 'Health'"
    >
        <template
            v-if="counts.length > 0"
            #append
        >
            <div
                class="counts"
                aria-hidden="true"
            >
                <span
                    v-for="count in counts"
                    v-bind:key="count.severity"
                    v-bind:class="['count', `text-${count.severity}`]"
                >
                    <v-icon
                        v-bind:icon="count.icon"
                        size="14"
                    />
                    {{ count.value.toLocaleString() }}
                </span>
            </div>
        </template>
    </v-list-item>
</template>

<script lang="ts" setup>
// The Health page's entry in the account menu, saying when a check fails. The notice once stood
// in the sidebar, in view on every page, but some problems are never fixed -- an image that
// semantic search cannot read is no reason to change the note it belongs to -- and it stayed
// there for good. In the menu it is found by anyone opening it, and in nobody's way otherwise.
//
// The counts sit at the end of the row, so the item keeps the one line its neighbours have, and
// each carries its severity's icon as well as its colour, so the two tell apart without either.

import { mdiAlertCircleOutline, mdiAlertOutline, mdiHeartPulse } from '@mdi/js';
import { computed } from 'vue';

import { useHealthStore } from '@/stores/health';

const health = useHealthStore();

const counts = computed(() => {
    if (health.notice === null) {
        return [];
    }
    const { error, warning } = health.failingChecks;
    return [
        { severity: 'error', icon: mdiAlertCircleOutline, value: error },
        { severity: 'warning', icon: mdiAlertOutline, value: warning },
    ].filter(({ value }) => value > 0);
});
</script>

<style scoped>
.counts {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
}

.count {
    display: inline-flex;
    align-items: center;
    gap: 2px;
}
</style>
