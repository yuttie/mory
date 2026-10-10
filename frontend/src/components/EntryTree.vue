<template>
    <v-treeview
        v-bind="$attrs"
        v-bind:items="items"
        v-bind:item-props="rowProps"
        items-registration="props"
        v-on:update:opened="$emit('update:open', $event)"
        v-on:update:activated="onActivated($event[0])"
        v-on:click:activate="onClickActivate"
        v-on:pointerdown="onPointerDown"
        v-bind:opened="open"
        v-bind:activated="activated"
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
    <!-- Into the app rather than the body, for the theme's colours and type. -->
    <Teleport to="#app">
        <div
            v-if="draggedItem !== undefined"
            class="entry-tree-drag-copy"
            v-bind:style="{ transform: `translate(${pointer.x}px, ${pointer.y}px)` }"
        >
            <slot
                name="prepend"
                v-bind:item="draggedItem"
            />
            <slot
                name="title"
                v-bind:item="draggedItem"
            >
                <span>{{ draggedItem.title }}</span>
            </slot>
        </div>
    </Teleport>
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

import { computed } from 'vue';
import { type RouteLocationRaw, useRouter } from 'vue-router';

import { useTreeDrag } from '@/composables/treeDrag';

// The attributes the tree is given go to the tree itself, not to the copy drawn while a row is
// dragged beside it.
defineOptions({ inheritAttrs: false });

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
    // Which rows can be dragged onto which, by their ids. Without `canDrag` no row can be.
    canDrag?: (id: string) => boolean;
    canDrop?: (id: string, target: string) => boolean;
}>();

// Emits
const emit = defineEmits<{
    (e: 'update:open', value: string[]): void;
    (e: 'update:active', value: string | undefined): void;
    // The row `id` was dropped on the row `target`, which `canDrop` allowed.
    (e: 'drop', id: string, target: string): void;
}>();

// Composables
const router = useRouter();
const { dragged, pointer, onPointerDown } = useTreeDrag({
    canDrag: (id) => props.canDrag?.(id) ?? false,
    canDrop: (id, target) => props.canDrop?.(id, target) ?? false,
    drop: (id, target) => emit('drop', id, target),
});

// Computed properties
// Made once rather than in the template, where every render of this component would hand the tree
// a new array and re-render every row. The copy dragged beside the tree re-renders this component
// each time the pointer moves.
const activated = computed<string[]>(() => (props.active ?? '') !== '' ? [props.active!] : []);

const draggedItem = computed<Item | undefined>(() => dragged.value === null ? undefined : findItem(props.items, dragged.value));

// Methods
// v-treeview spreads these onto the row. `to` is what makes that row an `<a href>` rather than a div
// listening for a click -- so a middle click, a Ctrl-click, "Open link in new tab" and the status
// bar all behave as they do on any other link. A tree whose rows can be dragged also says which row
// each is, for a drag to find the one under the pointer.
function rowProps(item: object): Record<string, unknown> | undefined {
    const to = props.routeFor?.(item as Item) ?? null;
    const link = to === null ? undefined : { to };
    if (props.canDrag === undefined) {
        return link;
    }
    const id = String((item as Record<string, unknown>)[props.itemValue]);
    return {
        ...link,
        'data-tree-id': id,
        // A row that can be picked up is a link made undraggable, or the browser would start a
        // drag of its own to carry off the address, and end this one at the first move.
        ...(props.canDrag(id) ? { draggable: 'false' } : {}),
    };
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

        // A row's buttons act on that row, and a row passed over by a drag is not being pointed at.
        &.tree-dragging :deep(.v-treeview-item .v-list-item__append button) {
            visibility: hidden;
            transition: none;
        }
    }
}

/* The drag styles, set by `useTreeDrag` on the tree and its rows. */

/* The rows a dragged one passes over are not being pointed at, so they must not answer the pointer
   as if they were: no hover shade, no pointing hand, no tooltip with a row's title.
   Only what is inside a row stops taking the pointer. The row itself still takes it: the drag finds
   the row under the pointer by asking which element is there. */
.entry-tree.tree-dragging :deep(.v-treeview-item) {
    --v-hover-opacity: 0;
    cursor: inherit;

    & * {
        pointer-events: none;
    }
}

/* Each row that cannot take the dragged one, the dragged one included. */
.entry-tree :deep(.tree-drop-refused) {
    opacity: 0.4;
}

/* Inside the row, since the rows touch and the tree clips what overflows it. */
.entry-tree :deep(.tree-drop-target) {
    outline: 2px solid rgb(var(--v-theme-primary));
    outline-offset: -2px;
}

/* Beside the pointer rather than under it, so the row it is over shows. */
.entry-tree-drag-copy {
    position: fixed;
    top: 12px;
    left: 12px;
    z-index: 3000;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 300px;
    padding: 6px 12px;
    border-radius: 4px;
    background: rgb(var(--v-theme-surface));
    color: rgb(var(--v-theme-on-surface));
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    pointer-events: none;
    white-space: nowrap;

    & > :last-child {
        overflow: hidden;
        text-overflow: ellipsis;
    }
}
</style>
