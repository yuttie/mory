import { getAxios } from '@/axios';
import type { JsonValue, UUID } from '@/api';

export { JsonValue, UUID };

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

export async function getTasks(eTag?: string): Promise<[string, ApiTreeNode | null]> {
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
