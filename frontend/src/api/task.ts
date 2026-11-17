import YAML from 'yaml';

import { readTaskAlarms } from '@/alarms';
import { getAxios } from '@/axios';
import { encodePath } from '@/encode-path';
import { type UUID, versionOf } from '@/api';
import { type Task, readStatus } from '@/task';
import type { TaskMetadata } from '@/task-forest';
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
        return [versionOf(res.headers.etag), null];
    }
    else {
        const { extractFrontmatterH1AndRest } = await import('@/markdown-utils');
        const md = res.data as string;
        const { frontmatter, heading: title, before, rest } = extractFrontmatterH1AndRest(md);
        // Frontmatter is whatever the file said. A note in the task tree without a status is still
        // a task, opened with none for the editor to fill in; one whose frontmatter, `task:` or
        // status is written in a shape no reader takes is refused here, since saving the form over
        // it would replace what it holds.
        let metadata: unknown;
        try {
            metadata = frontmatter.trim() === '' ? null : YAML.parse(frontmatter);
        }
        catch (e) {
            throw new Error(`${taskPath} cannot be edited as a task: its frontmatter is not YAML (${(e as Error).message}). Open it as a note to fix it.`, { cause: e });
        }
        const reading = readStatus(metadata);
        if ('unread' in reading) {
            throw new Error(`${taskPath} cannot be edited as a task: ${reading.unread} Open it as a note to fix it.`);
        }
        const meta = (metadata ?? {}) as TaskMetadata;
        const block = meta.task ?? {};
        const uuid = extractFileUuid(taskPath);
        const alarms = readTaskAlarms(block.alarms);
        const task = {
            created_at: meta.created_at,
            uuid: uuid,
            title: title,
            tags: Array.isArray(meta.tags) ? meta.tags : [],
            ...('status' in reading ? { status: reading.status } : {}),
            source: md,
            etag: versionOf(res.headers.etag),
            importance: readImportance(block.importance),
            available_from: block.available_from ?? block.start_at,
            lead_time: typeof block.lead_time === 'string' ? block.lead_time : undefined,
            ...(block.due_by ? { due_by: block.due_by } : {}),
            ...(block.deadline ? { deadline: block.deadline } : {}),
            ...(alarms === undefined ? {} : { alarms }),
            ...(before ? { beforeTitle: before } : {}),
            note: rest,
        };

        return [versionOf(res.headers.etag), task];
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
