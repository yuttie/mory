import { computed, ref, watch } from 'vue';
import { useTaskForestStore, type TreeNodeRecord } from '@/stores/taskForest';
import type { ApiTreeNode, UUID } from '@/api/task';

/**
 * Composable that wraps the basic forestStore and adds tag grouping functionality.
 * This provides a clean separation between core forest operations and tag enhancements.
 */
export function useTaggedForest() {
    const store = useTaskForestStore();

    // Tag-specific state
    const tagGroups = ref<Map<string, UUID[]>>(new Map());
    const parentNodes = ref<UUID[]>([]);

    // Preprocess tag groups whenever the forest changes
    const preprocessTagGroups = () => {
        const newTagGroups = new Map<string, UUID[]>();
        const newParentNodes: UUID[] = [];

        // Find all tasks that have no parent and no children (leaf tasks at root level)
        for (const [id, parent] of Object.entries(store.parentById)) {
            if (parent === null) {
                const children = store.childrenById[id];
                if (children && children.length > 0) {
                    // This is a parent node (top-level task with children)
                    newParentNodes.push(id);
                } else {
                    // This is a leaf task at root level - group by first tag
                    const node = store.nodesById[id];
                    if (!node) continue;

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
        }

        tagGroups.value = newTagGroups;
        parentNodes.value = newParentNodes;
    };

    // Watch for changes in the forest to reprocess tag groups
    watch(
        () => [store.nodesById, store.parentById, store.childrenById, store.rootIds],
        () => preprocessTagGroups(),
        { deep: true, immediate: true }
    );

    // Enhanced forest with tag grouping
    const forestWithTags = computed<ApiTreeNode[]>(() => {
        const result: ApiTreeNode[] = [];

        // First, add parent nodes (tasks with children)
        for (const parentId of parentNodes.value) {
            result.push(store.toApiTreeNode(parentId));
        }

        // Then, add tag group nodes sorted alphabetically (with "Untagged" at the end)
        const sortedTags = Array.from(tagGroups.value.keys()).sort((a, b) => {
            if (a === 'Untagged') return 1;
            if (b === 'Untagged') return -1;
            return a.localeCompare(b);
        });

        for (const tag of sortedTags) {
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
                children: taskIds.map((taskId) => store.toApiTreeNode(taskId))
            };
            result.push(tagGroupNode);
        }

        return result;
    });

    // Enhanced node accessor that handles tag groups
    const node = (id: UUID): TreeNodeRecord | undefined => {
        // Handle virtual tag group nodes
        if (id.startsWith('tag-group-')) {
            const tag = id.replace('tag-group-', '');
            return {
                uuid: id,
                name: null,
                path: `.tags/${tag}`,
                size: 0,
                mime_type: 'application/x-tag-group',
                metadata: { tag_group: tag },
                title: tag,
                mtime: new Date().toISOString()
            };
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
        // Enhanced tree with tags
        forestWithTags,
        
        // Enhanced accessors
        node,
        childrenOf,
        parentOf,
        
        // Tag-specific state (read-only)
        tagGroups: computed(() => tagGroups.value),
        parentNodes: computed(() => parentNodes.value),
        
        // Re-export all basic store functionality
        ...store
    };
}