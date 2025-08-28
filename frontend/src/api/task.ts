import YAML from 'yaml';

import { getAxios } from '@/axios';
import type { JsonValue, UUID } from '@/api';
import type { Task } from '@/task';
import { extractFrontmatterH1AndRest } from '@/markdown';

export { JsonValue, UUID, Task };

export interface ApiTreeNode {
    uuid: UUID;
    name?: string | null;
    path: string;
    size: number;
    mime_type: string;
    metadata?: JsonValue | null;
    title?: string | null;
    mtime: string;  // RFC3339/ISO string
    children?: ApiTreeNode[];
}

export async function getTaskForest(eTag?: string): Promise<[string, ApiTreeNode[] | null]> {
    const headers = {};
    if (eTag) {
        headers['If-None-Match'] = eTag;
    }
    const res = await getAxios().get(`/v2/tasks?format=tree`, {
        headers: headers,
        validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
    });
    if (res.status === 304) {
        return [res.headers.etag, null];
    }
    else {
        return [res.headers.etag, res.data];
    }
}

export async function getTask(taskPath: string, eTag?: string): Promise<[string, Task | null]> {
    const headers = {};
    if (eTag) {
        headers['If-None-Match'] = eTag;
    }
    const res = await getAxios().get(`/v2/files/${taskPath}`, {
        headers: headers,
        validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
    });
    if (res.status === 304) {
        return [res.headers.etag, null];
    }
    else {
        const md = res.data as string;
        const { frontmatter, heading: title, rest } = extractFrontmatterH1AndRest(md);
        const metadata = YAML.parse(frontmatter);
        const uuid = extractFileUuid(taskPath);
        const task = {
            uuid: uuid,
            title: title,
            tags: metadata.tags,
            status: metadata.task.status,
            progress: metadata.task.progress,
            importance: metadata.task.importance,
            urgency: metadata.task.urgency,
            ...(metadata.task.start_at ? { start_at: metadata.task.start_at } : {}),
            ...(metadata.task.due_by ? { due_by: metadata.task.due_by } : {}),
            ...(metadata.task.deadline ? { deadline: metadata.task.deadline } : {}),
            scheduled_dates: metadata.task.scheduled_dates,
            note: rest,
        };

        return [res.headers.etag, task];
    }
}

export function extractFileUuid(path: string): UUID {
    const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const EXT_RE = /\.[^.]*$/;
    const lastSlashIdx = path.lastIndexOf('/');
    const filename = path.slice(lastSlashIdx + 1);  // NOTE: Works even if '/' was not found
    const stem = filename.replace(EXT_RE, '');
    const uuid = stem.slice(-36);
    if (!UUID_V4_RE.test(uuid)) {
        throw new Error(`Filename stem must end with a UUIDv4: ${path}`);
    }
    return uuid;
}

export function buildTaskPath(taskUuid: UUID, parentUuid: UUID | null): string {
    if (parentUuid === null) {
        return `.tasks/${taskUuid}.md`;
    } else {
        return `.tasks/${parentUuid}/${taskUuid}.md`;
    }
}

export async function moveTask(taskUuid: UUID, oldParentUuid: UUID | null, newParentUuid: UUID | null): Promise<void> {
    const oldPath = buildTaskPath(taskUuid, oldParentUuid);
    const newPath = buildTaskPath(taskUuid, newParentUuid);
    
    if (oldPath === newPath) {
        return; // No move needed
    }

    const { renameNote } = await import('@/api');
    await renameNote(oldPath, newPath);
}

export async function moveTaskSubtree(taskUuid: UUID, oldParentUuid: UUID | null, newParentUuid: UUID | null, taskForestStore: any): Promise<void> {
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
    // Children's paths change because their parent directory changed
    const children = taskForestStore.childrenOf(taskUuid);
    for (const child of children) {
        const childOldPath = buildTaskPath(child.uuid, taskUuid);
        const childNewPath = buildTaskPath(child.uuid, taskUuid);
        
        // For direct children, we need to update their parent directory path
        // The child files are stored under the task's directory, so when the task moves,
        // all child files need to be moved too
        const oldTaskDir = oldPath.replace('.md', '');
        const newTaskDir = newPath.replace('.md', '');
        
        // Build actual old and new paths for the child
        const actualChildOldPath = `${oldTaskDir}/${child.uuid}.md`;
        const actualChildNewPath = `${newTaskDir}/${child.uuid}.md`;
        
        try {
            await renameNote(actualChildOldPath, actualChildNewPath);
            
            // Recursively move the child's children
            await moveTaskSubtree(child.uuid, taskUuid, taskUuid, taskForestStore);
        } catch (error) {
            console.warn(`Failed to move child ${child.uuid}:`, error);
            // Continue with other children even if one fails
        }
    }
}
