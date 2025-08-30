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
        return nodesById.value[id];
    }

    function childrenOf(id: UUID): TreeNodeRecord[] {
        return (childrenById.value[id] || [])
            .map((cid) => nodesById.value[cid])
            .filter((n): n is TreeNodeRecord => Boolean(n));
    }

    function parentOf(id: UUID): UUID | null {
        return parentById.value[id] ?? null;
    }

    function idByPath(path: string): UUID | undefined {
        return pathToId.value[path];
    }

    // --- Tree ---

    function subtree(rootId: UUID): ApiTreeNode {
        return toApiTreeNode(rootId);
    }

    function toApiTreeNode(id: UUID): ApiTreeNode {
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
    }

    function moveNodeLocal(nodeId: UUID, newParent: UUID | null, index?: number): void {
        const rec = node(nodeId);
        if (!rec) {
            throw new Error(`moveNodeLocal: node ${nodeId} not found.`);
        }

        // Prevent moving a node to its own descendant (circular reference)
        if (newParent !== null) {
            const descendants = collectDescendants(nodeId, childrenById.value);
            if (descendants.includes(newParent)) {
                throw new Error(`moveNodeLocal: cannot move node ${nodeId} to its own descendant ${newParent}.`);
            }
        }

        // Get the current parent
        const currentParent = parentOf(nodeId);

        // Don't do anything if moving to the same parent
        if (currentParent === newParent) {
            return;
        }

        // Remove from current parent
        if (currentParent === null) {
            rootIds.value = rootIds.value.filter((rid) => rid !== nodeId);
        } else {
            const currentSiblings = (childrenById.value[currentParent] || []).filter((cid) => cid !== nodeId);
            setChildrenOf(currentParent, currentSiblings);
        }

        // Add to new parent
        if (newParent === null) {
            const roots = [...rootIds.value];
            const pos = clampIndex(index ?? roots.length, roots.length);
            roots.splice(pos, 0, nodeId);
            rootIds.value = roots;
            setParentOf(nodeId, null);
        } else {
            ensureChildBucket(newParent);
            const newSiblings = [...(childrenById.value[newParent] || [])];
            const pos = clampIndex(index ?? newSiblings.length, newSiblings.length);
            newSiblings.splice(pos, 0, nodeId);
            setChildrenOf(newParent, newSiblings);
            setParentOf(nodeId, newParent);
        }

        // Update paths for the moved node and all its descendants
        updatePathsAfterMove(nodeId, newParent);
    }

    function updatePathsAfterMove(nodeId: UUID, newParent: UUID | null): void {
        const rec = node(nodeId);
        if (!rec) return;

        // Calculate new path
        const newPath = newParent === null 
            ? `.tasks/${nodeId}.md`
            : `.tasks/${newParent}/${nodeId}.md`;

        // Update the node's path
        const oldPath = rec.path;
        const updatedNode = { ...rec, path: newPath };
        upsertNodeRecord(updatedNode);

        // Update path index
        unindexPath(oldPath);
        indexPath(newPath, nodeId);

        // Recursively update descendants
        const children = childrenById.value[nodeId] || [];
        for (const childId of children) {
            updatePathsAfterMove(childId, nodeId);
        }
    }

    function buildTaskPath(taskUuid: UUID, parentUuid: UUID | null): string {
        if (parentUuid === null) {
            return `.tasks/${taskUuid}.md`;
        } else {
            // Build the full hierarchical path by walking up the parent chain
            const pathComponents: UUID[] = [];
            let currentParent = parentUuid;
            
            // Walk up the parent chain to build the complete directory path
            while (currentParent !== null) {
                pathComponents.unshift(currentParent);
                const nextParent = parentOf(currentParent);
                currentParent = nextParent;
            }
            
            // Construct the full path: .tasks/grandparent/parent/child.md
            const directoryPath = pathComponents.join('/');
            return `.tasks/${directoryPath}/${taskUuid}.md`;
        }
    }


    async function moveTaskSubtreeOnServer(taskUuid: UUID, oldParentUuid: UUID | null, newParentUuid: UUID | null): Promise<void> {
        // Prevent moving a node to its own descendant (circular reference)
        if (newParentUuid !== null) {
            const descendants = collectDescendants(taskUuid, childrenById.value);
            if (descendants.includes(newParentUuid)) {
                throw new Error(`moveTaskSubtreeOnServer: cannot move task ${taskUuid} to its own descendant ${newParentUuid}.`);
            }
        }

        // Get the old and new base paths for the task
        const oldPath = buildTaskPath(taskUuid, oldParentUuid);
        const newPath = buildTaskPath(taskUuid, newParentUuid);
        
        if (oldPath === newPath) {
            return; // No move needed
        }

        const { renameNote } = await import('@/api');
        
        // Move the task itself first
        await renameNote(oldPath, newPath);
        
        // Now recursively move all children
        const children = childrenOf(taskUuid);
        for (const child of children) {
            try {
                // Calculate the old and new parent directory paths for children
                const oldTaskDir = oldPath.replace('.md', '');
                const newTaskDir = newPath.replace('.md', '');
                
                // Build child paths
                const childOldPath = `${oldTaskDir}/${child.uuid}.md`;
                const childNewPath = `${newTaskDir}/${child.uuid}.md`;
                
                // Move the child file
                await renameNote(childOldPath, childNewPath);
                
                // Recursively move the child's subtree
                await moveTaskSubtreeOnServer(child.uuid, oldParentUuid, newParentUuid);
            } catch (error) {
                console.warn(`Failed to move child ${child.uuid}:`, error);
                // Continue with other children even if one fails
            }
        }
    }

    async function moveNode(nodeId: UUID, newParent: UUID | null, index?: number): Promise<void> {
        const rec = node(nodeId);
        if (!rec) {
            throw new Error(`moveNode: node ${nodeId} not found.`);
        }

        const currentParent = parentOf(nodeId);
        
        // Don't do anything if moving to the same parent
        if (currentParent === newParent) {
            return;
        }

        // Move on server first (this will move the entire subtree)
        await moveTaskSubtreeOnServer(nodeId, currentParent, newParent);

        // Update local state
        moveNodeLocal(nodeId, newParent, index);

        // Refresh the store to sync with server
        await refresh();
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
        selectedNodeId,
        lastETag,
        isLoading,

        // === Getters ===
        isLoaded,
        hasData,
        // -- Forest --
        forest,
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
        moveNodeLocal,
        moveNode,
        // -- Helper functions --
        buildTaskPath,
        moveTaskSubtreeOnServer,
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
