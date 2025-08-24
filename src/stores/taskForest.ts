import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type { JsonValue, UUID, ApiTreeNode } from '@/api/task';
import * as api from '@/api/task';

export interface TreeNodeRecord {
    uuid: UUID;
    name: string | null;
    path: string;
    size: number;
    mime_type: string;
    metadata: JsonValue | null;
    title: string | null;
    mtime: string;
}

type IdsById = Record<UUID, UUID[]>;
type ParentById = Record<UUID, UUID | null>;
type NodeById = Record<UUID, TreeNodeRecord>;
type PathToId = Record<string, UUID>;

export const useTaskForestStore = defineStore('taskForest', () => {
    // ===== State properties =====

    // Normalized forest
    const nodesById = ref<NodeById>({});
    const childrenById = ref<IdsById>({});
    const parentById = ref<ParentById>({});
    const pathToId = ref<PathToId>({});
    const rootIds = ref<UUID[]>([]);

    // Preprocessed tag groups
    const tagGroups = ref<Map<string, UUID[]>>(new Map());
    const parentNodes = ref<UUID[]>([]);

    // Selection
    const selectedNodeId = ref<UUID | null>(null);

    // Fetch
    const lastETag = ref<string | null>(null);
    const isLoading = ref(false);

    // ===== Getters =====

    const isLoaded = computed<boolean>(() => lastETag.value !== null);
    const hasData = computed<boolean>(() => Object.keys(nodesById.value).length > 0);

    // --- Forest ---

    const forest = computed<ApiTreeNode[]>(() => {
        return rootIds.value.map((rid) => toApiTreeNode(rid));
    });

    const forestWithTags = computed<ApiTreeNode[]>(() => {
        const result: ApiTreeNode[] = [];

        // First, add parent nodes (tasks with children)
        for (const parentId of parentNodes.value) {
            result.push(toApiTreeNode(parentId));
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
                children: taskIds.map((taskId) => toApiTreeNode(taskId))
            };
            result.push(tagGroupNode);
        }

        return result;
    });

    // --- Single node ---

    const selectedNode = computed<TreeNodeRecord | null>(() =>
        selectedNodeId.value ? nodesById.value[selectedNodeId.value] ?? null : null
    );

    // --- Flattened node list  ---

    const allTaskIds = computed<UUID[]>(() => {
        const out: UUID[] = [];
        for (const rid of rootIds.value) {
            out.push(rid, ...collectDescendants(rid, childrenById.value));
        }
        return out;
    });

    const selectedDescendantIds = computed<UUID[]>(() => {
        const root = selectedNodeId.value;
        if (!root) { return []; }
        return collectDescendants(root, childrenById.value);
    });

    const selectedSubtreeNodeIds = computed<UUID[]>(() => {
        const root = selectedNodeId.value;
        if (!root) { return []; }
        return [root, ...collectDescendants(root, childrenById.value)];
    });

    const allTasks = computed<TreeNodeRecord[]>(() =>
        allTaskIds.value
            .map((id) => nodesById.value[id])
            .filter((n): n is TreeNodeRecord => Boolean(n))
    );

    const selectedDescendants = computed<TreeNodeRecord[]>(() =>
        selectedDescendantIds.value
            .map((id) => nodesById.value[id])
            .filter((n): n is TreeNodeRecord => Boolean(n))
    );

    const selectedSubtreeNodes = computed<TreeNodeRecord[]>(() =>
        selectedSubtreeNodeIds.value
            .map((id) => nodesById.value[id])
            .filter((n): n is TreeNodeRecord => Boolean(n))
    );

    // ===== Actions =====

    // --- Accessors ---

    function node(id: UUID): TreeNodeRecord | undefined {
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

        return nodesById.value[id];
    }

    function childrenOf(id: UUID): TreeNodeRecord[] {
        // Handle virtual tag group nodes
        if (id.startsWith('tag-group-')) {
            const tag = id.replace('tag-group-', '');
            const taskIds = tagGroups.value.get(tag) || [];
            return taskIds
                .map((taskId) => nodesById.value[taskId])
                .filter((n): n is TreeNodeRecord => Boolean(n));
        }

        return (childrenById.value[id] || [])
            .map((cid) => nodesById.value[cid])
            .filter((n): n is TreeNodeRecord => Boolean(n));
    }

    function parentOf(id: UUID): UUID | null {
        // If this is a tag group node, it has no parent (it's a root)
        if (id.startsWith('tag-group-')) {
            return null;
        }

        // Check if this is a top-level task
        const currentParent = parentById.value[id];
        if (currentParent === null) {
            // Check if this task has no children - only then should it be under a tag group
            const children = childrenById.value[id];
            if (!children || children.length === 0) {
                // This is a top-level task with no children, so its parent should be the tag group
                const node = nodesById.value[id];
                if (node) {
                    const firstTag = (node.metadata && typeof node.metadata === 'object' && 'tags' in node.metadata && Array.isArray(node.metadata.tags)) 
                        ? String(node.metadata.tags[0] || 'Untagged')
                        : 'Untagged';
                    return `tag-group-${firstTag}`;
                }
            }
            // If it has children, it stays at the root (return null)
            return null;
        }

        return currentParent ?? null;
    }

    function idByPath(path: string): UUID | undefined {
        return pathToId.value[path];
    }

    // --- Tree ---

    function subtree(rootId: UUID): ApiTreeNode {
        return toApiTreeNode(rootId);
    }

    function toApiTreeNode(id: UUID): ApiTreeNode {
        // Handle virtual tag group nodes
        if (id.startsWith('tag-group-')) {
            const tag = id.replace('tag-group-', '');
            const taskIds = tagGroups.value.get(tag) || [];
            const children: ApiTreeNode[] = taskIds.map((taskId) => toApiTreeNode(taskId));

            return {
                uuid: id,
                name: null,
                path: `.tags/${tag}`,
                size: 0,
                mime_type: 'application/x-tag-group',
                metadata: { tag_group: tag },
                title: tag,
                mtime: new Date().toISOString(),
                children: children
            };
        }

        const rec = nodesById.value[id];
        if (!rec) {
            throw new Error(`Node not found: ${id}`);
        }
        const kids = childrenById.value[id] || [];
        const node: ApiTreeNode = {
            uuid: rec.uuid,
            ...(rec.name != null ? { name: rec.name } : {}),
            path: rec.path,
            size: rec.size,
            mime_type: rec.mime_type,
            ...(rec.metadata != null ? { metadata: rec.metadata } : {}),
            ...(rec.title != null ? { title: rec.title } : {}),
            mtime: rec.mtime,
            ...(kids.length ? { children: kids.map((cid) => toApiTreeNode(cid)) } : {}),
        };
        return node;
    }

    // --- Flattened node list  ---

    function flattenDescendants(rootId: UUID): TreeNodeRecord[] {
        const ids = collectDescendants(rootId, childrenById.value);
        return ids
            .map((id) => nodesById.value[id])
            .filter((n): n is TreeNodeRecord => Boolean(n));
    }

    function flattenSubtree(rootId: UUID): TreeNodeRecord[] {
        const ids = [rootId, ...collectDescendants(rootId, childrenById.value)];
        return ids
            .map((id) => nodesById.value[id])
            .filter((n): n is TreeNodeRecord => Boolean(n));
    }

    // --- Fetch ---

    async function refresh(): Promise<'not-modified' | 'ok'> {
        if (isLoading.value) {
            return 'not-modified';
        }
        isLoading.value = true;
        try {
            const [newETag, data] = await (lastETag.value === null ? api.getTaskForest() : api.getTaskForest(lastETag.value));

            if (data !== null) {
                // Updated
                replaceFromServer(data, newETag);
                return 'ok';
            }
            else {
                // Not updated
                return 'not-modified';
            }
        }
        finally {
            isLoading.value = false;
        }
    }

    // --- Ingestion ---

    function preprocessTagGroups(): void {
        const newTagGroups = new Map<string, UUID[]>();
        const newParentNodes: UUID[] = [];

        // Find all tasks that have no parent and no children (leaf tasks at root level)
        for (const [id, parent] of Object.entries(parentById.value)) {
            if (parent === null) {
                const children = childrenById.value[id];
                if (children && children.length > 0) {
                    // This is a parent node (top-level task with children)
                    newParentNodes.push(id);
                } else {
                    // This is a leaf task at root level - group by first tag
                    const node = nodesById.value[id];
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
    }

    function replaceFromServer(forest: ApiTreeNode[], etag?: string | null): void {
        const nextNodes: NodeById = {};
        const nextChildren: IdsById = {};
        const nextParents: ParentById = {};
        const nextPaths: PathToId = {};
        const roots: UUID[] = [];

        for (const root of forest) {
            roots.push(root.uuid);
            ingest(root, null, nextNodes, nextChildren, nextParents, nextPaths);
        }

        setNodes(nextNodes);
        setChildren(nextChildren);
        setParents(nextParents);
        setPathIndex(nextPaths);
        rootIds.value = roots;

        // Preprocess tag groups after data is set
        preprocessTagGroups();

        if (etag !== undefined) {
            lastETag.value = etag;
        }

        // Clear selection if it no longer exists
        if (selectedNodeId.value && !(selectedNodeId.value in nextNodes)) {
            selectedNodeId.value = null;
        }
    }

    function mergeFromServer(forest: ApiTreeNode[], etag?: string | null): void {
        const nextNodes: NodeById = { ...nodesById.value };
        const nextChildren: IdsById = { ...childrenById.value };
        const nextParents: ParentById = { ...parentById.value };
        const nextPaths: PathToId = { ...pathToId.value };
        const roots = new Set<UUID>(rootIds.value);

        for (const root of forest) {
            roots.add(root.uuid);
            ingest(root, null, nextNodes, nextChildren, nextParents, nextPaths);
        }

        setNodes(nextNodes);
        setChildren(nextChildren);
        setParents(nextParents);
        setPathIndex(nextPaths);
        rootIds.value = Array.from(roots);

        // Preprocess tag groups after data is merged
        preprocessTagGroups();

        if (etag !== undefined) {
            lastETag.value = etag;
        }
    }

    // --- Selection ---

    function selectNode(id: UUID | null): void {
        selectedNodeId.value = id;
    }
    function selectByPath(path: string): void {
        selectedNodeId.value = idByPath(path) ?? null;
    }

    // --- Local CRUD operations ---

    function addNodeLocal(parent: UUID | null, node: TreeNodeRecord, index?: number): void {
        upsertNodeRecord(node);
        indexPath(node.path, node.uuid);
        ensureChildBucket(node.uuid);

        if (parent === null) {
            const roots = [...rootIds.value];
            const pos = clampIndex(index ?? roots.length, roots.length);
            roots.splice(pos, 0, node.uuid);
            rootIds.value = roots;
            setParentOf(node.uuid, null);
        }
        else {
            const sibs = [...(childrenById.value[parent] || [])];
            const pos = clampIndex(index ?? sibs.length, sibs.length);
            sibs.splice(pos, 0, node.uuid);
            setChildrenOf(parent, sibs);
            setParentOf(node.uuid, parent);
        }

        // Preprocess tag groups after local changes
        preprocessTagGroups();
    }

    function replaceNodeLocal(next: TreeNodeRecord): void {
        const id = next.uuid;
        const prev = node(id);
        if (!prev) {
            throw new Error(`replaceNodeLocal: node ${id} not found.`);
        }
        if (prev.path !== next.path) {
            throw new Error(`replaceNodeLocal: new path ${next.path} does not match old one ${prev.path}.`);
        }
        upsertNodeRecord(next);

        // Preprocess tag groups after local changes (in case tags changed)
        preprocessTagGroups();
    }

    function deleteLeafLocal(id: UUID): void {
        const rec = node(id);
        if (!rec) {
            throw new Error(`deleteLeafLocal: node ${id} not found.`);
        }

        const kids = childrenById.value[id] || [];
        if (kids.length > 0) {
            throw new Error(`deleteLeafLocal: node ${id} has children and cannot be deleted.`);
        }

        // Detach from parent or roots
        const p = parentOf(id);
        if (p === null) {
            rootIds.value = rootIds.value.filter((rid) => rid !== id);
        } else {
            const remaining = (childrenById.value[p] || []).filter((cid) => cid !== id);
            setChildrenOf(p, remaining);
        }

        // Drop path index
        unindexPath(rec.path);

        // Remove from maps
        const nextNodes = { ...nodesById.value };
        delete nextNodes[id];
        setNodes(nextNodes);

        const nextParents = { ...parentById.value };
        delete nextParents[id];
        setParents(nextParents);

        const nextChildren = { ...childrenById.value };
        delete nextChildren[id];
        setChildren(nextChildren);

        // Clear selection if it targeted this node
        if (selectedNodeId.value === id) {
            selectedNodeId.value = null;
        }

        // Preprocess tag groups after deletion
        preprocessTagGroups();
    }

    // ===== Helper functions =====

    // --- Ingestion ---

    function setNodes(next: NodeById): void {
        nodesById.value = next;
    }
    function setChildren(next: IdsById): void {
        childrenById.value = next;
    }
    function setParents(next: ParentById): void {
        parentById.value = next;
    }
    function setPathIndex(next: PathToId): void {
        pathToId.value = next;
    }

    // --- Local CRUD operations ---

    function upsertNodeRecord(rec: TreeNodeRecord): void {
        setNodes({ ...nodesById.value, [rec.uuid]: rec });
    }
    function ensureChildBucket(id: UUID): void {
        if (!childrenById.value[id]) {
            setChildren({ ...childrenById.value, [id]: [] });
        }
    }
    function setChildrenOf(id: UUID, childIds: UUID[]): void {
        setChildren({ ...childrenById.value, [id]: [...childIds] });
    }
    function setParentOf(id: UUID, parent: UUID | null): void {
        setParents({ ...parentById.value, [id]: parent });
    }
    function indexPath(path: string, id: UUID): void {
        setPathIndex({ ...pathToId.value, [path]: id });
    }
    function unindexPath(path: string): void {
        const { [path]: _omit, ...rest } = pathToId.value;
        setPathIndex(rest);
    }

    return {
        // === State properties ===
        nodesById,
        childrenById,
        parentById,
        pathToId,
        rootIds,
        tagGroups,
        parentNodes,
        selectedNodeId,
        lastETag,
        isLoading,

        // === Getters ===
        isLoaded,
        hasData,
        // -- Forest --
        forest,
        forestWithTags,
        // -- Single node --
        selectedNode,
        // -- Flattened node list --
        allTaskIds,
        selectedDescendantIds,
        selectedSubtreeNodeIds,
        allTasks,
        selectedDescendants,
        selectedSubtreeNodes,

        // === Actions ===
        // -- Accessors --
        node,
        childrenOf,
        parentOf,
        idByPath,
        // -- Tree --
        subtree,
        toApiTreeNode,
        // -- Flattened node list --
        flattenDescendants,
        flattenSubtree,
        // -- Fetch --
        refresh,
        // -- Ingestion --
        replaceFromServer,
        mergeFromServer,
        // -- Selection --
        selectNode,
        selectByPath,
        // -- Local CRUD operations --
        addNodeLocal,
        replaceNodeLocal,
        deleteLeafLocal,
    };
});

// ===== Utilities =====
function collectDescendants(root: UUID, childrenById: IdsById): UUID[] {
    const out: UUID[] = [];
    const stack = [...(childrenById[root] || [])];
    while (stack.length > 0) {
        const id = stack.pop() as UUID;
        out.push(id);
        const kids = childrenById[id];
        if (kids) {
            for (const k of kids) {
                stack.push(k);
            }
        }
    }
    return out;
}

function ingest(
    node: ApiTreeNode,
    parent: UUID | null,
    nextNodes: NodeById,
    nextChildren: IdsById,
    nextParents: ParentById,
    nextPaths: PathToId
): void {
    const { uuid, children = [], ...rest } = node;

    const rec: TreeNodeRecord = {
        uuid,
        name: rest.name ?? null,
        path: rest.path,
        size: rest.size,
        mime_type: rest.mime_type,
        metadata: rest.metadata ?? null,
        title: rest.title ?? null,
        mtime: rest.mtime,
    };
    nextNodes[uuid] = rec;
    nextParents[uuid] = parent ?? null;
    nextPaths[rec.path] = uuid;

    const kids: UUID[] = [];
    for (const child of children) {
        kids.push(child.uuid);
        ingest(child, uuid, nextNodes, nextChildren, nextParents, nextPaths);
    }
    nextChildren[uuid] = kids;
}

function clampIndex(index: number, length: number): number {
    return Math.max(0, Math.min(index, length));
}
