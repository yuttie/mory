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

export async function getTaskForest(eTag?: string): Promise<[string, ApiTreeNode | null]> {
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
