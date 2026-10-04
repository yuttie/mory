import YAML from 'yaml';

import { readTaskAlarms } from '@/alarms';
import { getAxios } from '@/axios';
import { encodePath } from '@/encode-path';
import type { UUID } from '@/api';
import type { Task } from '@/task';
import { readImportance } from '@/urgency';

export { UUID, Task };

export async function getTask(taskPath: string, eTag?: string): Promise<[string, Task | null]> {
    const headers: Record<string, string> = {};
    if (eTag) {
        headers['If-None-Match'] = eTag;
    }
    const res = await getAxios().get(`/v2/files/${encodePath(taskPath)}`, {
        headers: headers,
        validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
    });
    if (res.status === 304) {
        return [res.headers.etag, null];
    }
    else {
        const { extractFrontmatterH1AndRest } = await import('@/markdown-utils');
        const md = res.data as string;
        const { frontmatter, heading: title, rest } = extractFrontmatterH1AndRest(md);
        const metadata = YAML.parse(frontmatter);
        const uuid = extractFileUuid(taskPath);
        const alarms = readTaskAlarms(metadata.task.alarms);
        const task = {
            created_at: metadata.created_at,
            uuid: uuid,
            title: title,
            tags: metadata.tags,
            status: metadata.task.status,
            source: md,
            importance: readImportance(metadata.task.importance),
            available_from: metadata.task.available_from ?? metadata.task.start_at,
            lead_time: typeof metadata.task.lead_time === 'string' ? metadata.task.lead_time : undefined,
            ...(metadata.task.due_by ? { due_by: metadata.task.due_by } : {}),
            ...(metadata.task.deadline ? { deadline: metadata.task.deadline } : {}),
            ...(alarms === undefined ? {} : { alarms }),
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
