import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type { JsonValue, UUID, ApiTreeNode } from '@/api/task';

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

    // ETag
    const lastETag = ref<string | null>(null);

    // Selection
    const selectedNodeId = ref<UUID | null>(null);

    // ===== Getters =====

    const hasData = computed<boolean>(() => Object.keys(nodesById.value).length > 0);

    // --- Forest ---

    const forest = computed<ApiTreeNode[]>(() => {
        return rootIds.value.map((rid) => toApiTreeNode(rid));
    });

    // --- Single node ---

    const selectedNode = computed<TreeNodeRecord>(() =>
        nodesById.value[selectedNodeId.value] ?? null
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

    function flattenSubtree(rootId: UUID): TreeNodeRecord[] {
        const ids = [rootId, ...collectDescendants(rootId, childrenById.value)];
        return ids
            .map((id) => nodesById.value[id])
            .filter((n): n is TreeNodeRecord => Boolean(n));
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

    return {
        // === State properties ===
        nodesById,
        childrenById,
        parentById,
        pathToId,
        rootIds,
        lastETag,
        selectedNodeId,

        // === Getters ===
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
        flattenSubtree,
        // -- Ingestion --
        replaceFromServer,
        mergeFromServer,
        // -- Selection --
        selectNode,
        selectByPath,
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
