import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useTaskForestStore, type TreeNodeRecord } from './taskForest';
import type { ApiTreeNode, UUID } from '@/api/task';

// Re-export types from taskForest
export type { TreeNodeRecord } from './taskForest';

/**
 * Pinia store that extends the basic forestStore with tag grouping functionality.
 * This provides a clean separation between core forest operations and tag enhancements.
 */
export const useTaggedTaskForestStore = defineStore('taggedTaskForest', () => {
    const store = useTaskForestStore();

    // Tag-specific state
    const tagGroups = ref<Map<string, UUID[]>>(new Map());
    const sortedTags = ref<string[]>([]);
    const parentNodeIds = ref<UUID[]>([]);
    const tagGroupNodeCache = ref<Map<string, TreeNodeRecord>>(new Map());

    // Preprocess tag groups whenever the forest changes
    const preprocessTagGroups = () => {
        // Only process if store has data
        if (!store.hasData) {
            tagGroups.value = new Map();
            sortedTags.value = [];
            parentNodeIds.value = [];
            tagGroupNodeCache.value = new Map();
            return;
        }

        const newTagGroups = new Map<string, UUID[]>();
        const newParentNodeIds: UUID[] = [];
        const newTagGroupNodeCache = new Map<string, TreeNodeRecord>();

        // Find all parent tasks and leaf tasks at root level
        // - Parent tasks: ones that have no parent and some children
        // - Leaf tasks: ones that have no parent and no children
        for (const [id, parent] of Object.entries(store.parentById)) {
            if (parent !== null) { continue; }
            const children = store.childrenById[id];
            if (children && children.length > 0) {
                // This is a parent node (top-level task with children)
                newParentNodeIds.push(id);
            } else {
                // This is a leaf task at root level - group by first tag
                const node = store.nodesById[id];
                if (!node) { continue; }

                // Get the first tag, or use "Untagged" as default
                const firstTag = (node.metadata && typeof node.metadata === 'object' && 'tags' in node.metadata && Array.isArray(node.metadata.tags))
                    ? String(node.metadata.tags[0] || 'Untagged')
                    : 'Untagged';

                if (!newTagGroups.has(firstTag)) {
                    newTagGroups.set(firstTag, []);
                }
                newTagGroups.get(firstTag)!.push(id);
            }
        }

        // Sort tag keys alphabetically with "Untagged" at the end
        const newSortedTags = Array.from(newTagGroups.keys()).sort((a, b) => {
            if (a === 'Untagged') return 1;
            if (b === 'Untagged') return -1;
            return a.localeCompare(b);
        });

        // Create cached virtual tag group nodes for stable object identity
        for (const tag of newSortedTags) {
            const tagGroupId = `tag-group-${tag}`;
            newTagGroupNodeCache.set(tagGroupId, {
                uuid: tagGroupId,
                name: null,
                path: `.tags/${tag}`,
                size: 0,
                mime_type: 'application/x-tag-group',
                metadata: { tag_group: tag },
                title: tag,
                mtime: new Date().toISOString(),
            });
        }

        tagGroups.value = newTagGroups;
        sortedTags.value = newSortedTags;
        parentNodeIds.value = newParentNodeIds;
        tagGroupNodeCache.value = newTagGroupNodeCache;
    };

    // Watch for changes in the forest to reprocess tag groups
    watch(
        () => [store.nodesById, store.parentById, store.childrenById, store.rootIds],
        () => preprocessTagGroups(),
        { immediate: true },
    );

    // Enhanced forest with tag grouping
    const forestWithTags = computed<ApiTreeNode[]>(() => {
        try {
            if (!store.hasData) {
                return [];
            }

            const result: ApiTreeNode[] = [];

            // First, add parent nodes (tasks with children)
            for (const parentId of parentNodeIds.value) {
                if (store.nodesById[parentId]) {
                    result.push(store.toApiTreeNode(parentId));
                }
            }

            // Then, add tag group nodes using pre-sorted tags
            for (const tag of sortedTags.value) {
                const taskIds = tagGroups.value.get(tag)!;
                // Create a virtual tag group node
                const tagGroupNode: ApiTreeNode = {
                    uuid: `tag-group-${tag}`,
                    name: null,
                    path: `.tags/${tag}`,
                    size: 0,
                    mime_type: 'application/x-tag-group',
                    metadata: { tag_group: tag },
                    title: tag,
                    mtime: new Date().toISOString(),
                    children: taskIds
                        .filter((taskId) => store.nodesById[taskId])
                        .map((taskId) => store.toApiTreeNode(taskId)),
                };
                result.push(tagGroupNode);
            }

            return result;
        } catch (error) {
            console.error('Error in forestWithTags:', error);
            return [];
        }
    });

    // Enhanced node accessor that handles tag groups
    const node = (id: UUID): TreeNodeRecord | undefined => {
        // Handle virtual tag group nodes using cached objects
        if (id.startsWith('tag-group-')) {
            return tagGroupNodeCache.value.get(id);
        }

        return store.node(id);
    };

    // Enhanced children accessor that handles tag groups
    const childrenOf = (id: UUID): TreeNodeRecord[] => {
        // Handle virtual tag group nodes
        if (id.startsWith('tag-group-')) {
            const tag = id.replace('tag-group-', '');
            const taskIds = tagGroups.value.get(tag) || [];
            return taskIds
                .map((taskId) => store.nodesById[taskId])
                .filter((n): n is TreeNodeRecord => Boolean(n));
        }

        return store.childrenOf(id);
    };

    // Enhanced parent accessor that handles tag groups
    const parentOf = (id: UUID): UUID | null => {
        // If this is a tag group node, it has no parent (it's a root)
        if (id.startsWith('tag-group-')) {
            return null;
        }

        // Check if this is a top-level task
        const currentParent = store.parentById[id];
        if (currentParent === null) {
            // Check if this task has no children - only then should it be under a tag group
            const children = store.childrenById[id];
            if (!children || children.length === 0) {
                // This is a top-level task with no children, so its parent should be the tag group
                const nodeData = store.nodesById[id];
                if (nodeData) {
                    const firstTag = (nodeData.metadata && typeof nodeData.metadata === 'object' && 'tags' in nodeData.metadata && Array.isArray(nodeData.metadata.tags))
                        ? String(nodeData.metadata.tags[0] || 'Untagged')
                        : 'Untagged';
                    return `tag-group-${firstTag}`;
                }
            }
            // If it has children, it stays at the root (return null)
            return null;
        }

        return currentParent ?? null;
    };

    return {
        // === Re-export basic store state and computed properties ===
        nodesById: computed(() => store.nodesById),
        childrenById: computed(() => store.childrenById),
        parentById: computed(() => store.parentById),
        pathToId: computed(() => store.pathToId),
        rootIds: computed(() => store.rootIds),
        selectedNodeId: computed(() => store.selectedNodeId),
        lastETag: computed(() => store.lastETag),
        isLoading: computed(() => store.isLoading),
        isLoaded: computed(() => store.isLoaded),
        hasData: computed(() => store.hasData),
        forest: computed(() => store.forest),
        selectedNode: computed(() => store.selectedNode),
        allTaskIds: computed(() => store.allTaskIds),
        selectedDescendantIds: computed(() => store.selectedDescendantIds),
        selectedSubtreeNodeIds: computed(() => store.selectedSubtreeNodeIds),
        allTasks: computed(() => store.allTasks),
        selectedDescendants: computed(() => store.selectedDescendants),
        selectedSubtreeNodes: computed(() => store.selectedSubtreeNodes),

        // === Enhanced properties with tag functionality ===
        forestWithTags,

        // === Enhanced accessors (override store methods) ===
        node,
        childrenOf,
        parentOf,

        // === Re-export store actions ===
        idByPath: store.idByPath,
        subtree: store.subtree,
        toApiTreeNode: store.toApiTreeNode,
        flattenDescendants: store.flattenDescendants,
        flattenSubtree: store.flattenSubtree,
        moveNode: store.moveNode,
        refresh: store.refresh,
        replaceFromServer: store.replaceFromServer,
        mergeFromServer: store.mergeFromServer,
        selectNode: store.selectNode,
        selectByPath: store.selectByPath,
        addNodeLocal: store.addNodeLocal,
        replaceNodeLocal: store.replaceNodeLocal,
        deleteLeafLocal: store.deleteLeafLocal,
        moveNodeLocal: store.moveNodeLocal,
        buildTaskPath: store.buildTaskPath,
        moveTaskSubtreeOnServer: store.moveTaskSubtreeOnServer,

        // === Tag-specific state (read-only) ===
        tagGroups: computed(() => tagGroups.value),
        parentNodeIds: computed(() => parentNodeIds.value)
    };
});
