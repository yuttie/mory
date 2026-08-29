<template>
    <v-treeview
        v-model:activated="noteTreeActive"
        v-model:opened="noteTreeOpen"
        v-bind:items="noteTreeRoot"
        v-bind:load-children="populateTagChildren"
        item-title="name"
        item-value="id"
        activatable
        open-on-click
        density="compact"
    >
        <template v-slot:prepend="{ item, isOpen }">
            <v-icon v-if="item.children" size="small">
                {{ isOpen ? mdiFolderOpen : mdiFolder }}
            </v-icon>
            <v-icon v-else size="small">
                {{ mdiFileDocumentOutline }}
            </v-icon>
        </template>
    </v-treeview>
</template>

<script lang="ts" setup>
// A tree of tags, lifted out of App.vue's navigation drawer unchanged.
//
// Despite the `noteTree*` names it inherits, it lists no notes: a node's `context` is a path of
// tags, expanding one lists every tag that co-occurs on entries carrying all of them (by
// descending frequency), and every node is created with `children: []`, so the leaf branch below
// never renders. Nothing reads the activated node, so a click navigates nowhere.
//
// Kept as it was found, quirks included -- populateTagChildren appends without clearing, nothing
// refreshes it after a save, and it has none of loadTemplates()'s 401 handling. Changing any of
// that is a separate decision from moving it.

import { computed, ref } from 'vue';

import { mdiFileDocumentOutline, mdiFolder, mdiFolderOpen } from '@mdi/js';

import { useFilesStore } from '@/stores/files';

interface TreeNode {
    name: string;
    id: string;
    context: string[];
    children: TreeNode[];
}

// Composables
const fileStore = useFilesStore();

// Reactive states
const noteTree = ref([] as TreeNode[]);
const noteTreeOpen = ref([]);
const noteTreeActive = ref([]);

// Computed properties
const noteTreeRoot = computed(() => {
    return [
        {
            name: 'Tags',
            id: '',
            context: [],
            children: noteTree.value,
        },
    ];
});

// Methods
async function populateTagChildren(item: TreeNode) {
    const entries = await fileStore.list();

    const tags: Map<string, number> = new Map();
    for (const entry of entries) {
        const entryTags = entry.metadata?.tags;
        if (!entryTags) {
            continue;
        }
        if (item.context.every((t) => entryTags.includes(t))) {
            for (const tag of entryTags) {
                tags.set(tag, (tags.get(tag) || 0) + 1);
            }
        }
    }
    for (const tag of item.context) {
        tags.delete(tag);
    }
    for (const tag of [...tags.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0])) {
        const context = item.context.concat([tag]);
        item.children.push({
            name: tag,
            id: context.join('/'),
            context: context,
            children: [],
        });
    }
}
</script>
