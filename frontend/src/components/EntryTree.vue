<template>
    <v-treeview
        v-bind:items="items"
        v-on:update:opened="$emit('update:open', $event)"
        v-on:update:activated="$emit('update:active', $event[0])"
        v-bind:opened="open"
        v-bind:activated="(active ?? '') !== '' ? [active] : []"
        v-bind:item-value="itemValue"
        v-bind:open-on-click="openOnClick"
        item-title="title"
        activatable
        density="compact"
        class="entry-tree"
    >
        <template v-slot:prepend="{ item }">
            <slot name="prepend" v-bind:item="item" />
        </template>
        <template v-slot:title="{ item }">
            <slot name="title" v-bind:item="item">
                <span v-bind:title="item.title ?? undefined">{{ item.title }}</span>
            </slot>
        </template>
        <template v-slot:append="{ item }">
            <slot name="append" v-bind:item="item" />
        </template>
    </v-treeview>
</template>

<script lang="ts" setup generic="Item extends { title?: string | null }">
// The tree plumbing shared by every tree the app draws over the file listing: which items are
// open, which is active, and how the three events reach the parent. What a row *looks* like is
// left to the slots, because that is the only part that differs between a task tree and a tree of
// ordinary notes.

// Props
defineProps<{
    items: Item[];
    open: string[];
    active?: string;
    // The item property identifying a row: the UUID for tasks, the path for notes.
    itemValue: string;
    // Whether clicking anywhere on a branch row toggles it, rather than only its chevron.
    openOnClick?: boolean;
}>();

// Emits
defineEmits<{
    (e: 'update:open', value: string[]): void;
    (e: 'update:active', value: string | undefined): void;
}>();
</script>

<style scoped lang="scss">
.entry-tree {
    :deep(.v-treeview-item) {
        // Row actions stay out of the way until the row is pointed at.
        &:not(:hover) .v-list-item__append {
            display: none;
        }
    }
}
</style>
