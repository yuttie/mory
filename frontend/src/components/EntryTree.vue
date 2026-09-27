<template>
    <v-treeview
        v-bind:items="items"
        v-bind:item-props="routeFor !== undefined ? linkProps : undefined"
        v-on:update:opened="$emit('update:open', $event)"
        v-on:update:activated="onActivated($event[0])"
        v-on:click:activate="onClickActivate"
        v-bind:opened="open"
        v-bind:activated="(active ?? '') !== '' ? [active] : []"
        v-bind:item-value="itemValue"
        v-bind:open-on-click="openOnClick"
        item-title="title"
        activatable
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

<script lang="ts" setup generic="Item extends { title?: string | null; children?: Item[] }">
// The tree plumbing shared by every tree the app draws over the file listing: which items are
// open, which is active, how the three events reach the parent, and how a row becomes a link. What
// a row *looks* like is left to the slots, because that is the only part that differs between a
// task tree and a tree of ordinary notes.

import { type RouteLocationRaw, useRouter } from 'vue-router';

// Props
const props = defineProps<{
    items: Item[];
    open: string[];
    active?: string;
    // The item property identifying a row: the UUID for tasks, the path for notes.
    itemValue: string;
    // Whether clicking anywhere on a branch row toggles it, rather than only its chevron.
    openOnClick?: boolean;
    // Where each row goes, or null for one with nowhere to go. Given, the tree goes there itself
    // rather than reporting activation, so the parent reads what is active from the route.
    routeFor?: (item: Item) => RouteLocationRaw | null;
}>();

// Emits
const emit = defineEmits<{
    (e: 'update:open', value: string[]): void;
    (e: 'update:active', value: string | undefined): void;
}>();

// Composables
const router = useRouter();

// Methods
// v-treeview spreads these onto the row, and `to` is what makes that row an `<a href>` rather than
// a div listening for a click -- so a middle click, a Ctrl-click, "Open link in new tab" and the
// status bar all behave as they do on any other link.
function linkProps(item: object): { to: RouteLocationRaw } | undefined {
    const to = props.routeFor?.(item as Item) ?? null;
    return to === null ? undefined : { to };
}

function onActivated(id: string | undefined) {
    if (props.routeFor === undefined) {
        emit('update:active', id);
    }
}

// A click is the anchor's own business: vue-router follows a plain left click, and deliberately
// leaves a Ctrl-, Shift- or middle-click to the browser, which opens a new tab or window and must
// not move this one. The keyboard is the caller the tree still navigates for, because v-treeview
// handles Enter itself and the keypress never reaches the anchor. Told apart by the event the
// activation carries, which `update:activated` leaves out.
function onClickActivate({ id, event }: { id: unknown; event?: { type: string } }) {
    if (props.routeFor === undefined || event?.type !== 'keydown') {
        return;
    }
    const item = findItem(props.items, id);
    const target = item === undefined ? null : props.routeFor(item);
    // Even on the row already shown, since a click on it goes there again too.
    if (target !== null) {
        router.push(target);
    }
}

function findItem(items: Item[], id: unknown): Item | undefined {
    for (const item of items) {
        if ((item as Record<string, unknown>)[props.itemValue] === id) {
            return item;
        }
        const found = findItem(item.children ?? [], id);
        if (found !== undefined) {
            return found;
        }
    }
    return undefined;
}
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
