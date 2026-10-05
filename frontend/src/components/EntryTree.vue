<template>
    <v-treeview
        v-bind:items="items"
        v-bind:item-props="routeFor !== undefined ? linkProps : undefined"
        items-registration="props"
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
// open and which is active, how the parent hears of either, and how a row becomes a link. What a
// row *looks* like is left to the slots, because that is the only part that differs between a task
// tree and a tree of ordinary notes.
//
// `items-registration="props"` has Vuetify learn the hierarchy from `items` rather than from rows
// registering as they mount. Its default mounts every row of every closed branch, hidden, just so
// the row can register; and a change to what is open re-renders every mounted row, because
// VTreeview reads the open set in its own render and its children all take slots. With the 490
// tasks of the real notes, the task tree re-rendered 536 rows per click to open or close one
// parent, where 76 were showing.

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
    // Where each row goes, or null for one with nowhere to go. Given, each such row is a link and
    // the tree reports no activation: the parent reads what is active from the route instead.
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
// activation carries, which `update:activated` leaves out. `click:activate` is VList's own event:
// VTreeview does not declare it, and the listener reaches the VList it renders only as a passed-on
// attribute. Should an upgrade declare it without passing it on, the keyboard would stop without a
// word; the keyboard test in task-links.spec.ts is what notices.
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
@media (hover: hover) {
    .entry-tree {
        :deep(.v-treeview-item) {
            // Keep summary text visible and reserve action space so rows do not shift on hover.
            &:not(:hover):not(:focus-within) .v-list-item__append button {
                visibility: hidden;
                // VIconBtn transitions `all` for 0.2s, and an animated `visibility` stays visible
                // until the end, so the buttons would linger after the pointer leaves. A
                // transition is taken from the state being entered: this hides them at once and
                // leaves the hover state's own transition alone.
                transition: none;
            }
        }
    }
}
</style>
