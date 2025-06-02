import { getAxios } from '@/axios';
import YAML from 'yaml';

// App
export interface Claim {
    sub: string;
    exp: number;
    email: string;
}

export interface UploadEntry {
    uuid: string;
    filename: string;
    status: string;
    statusMessage: string;
}

// Home and Calendar
export interface MetadataEventSingle {
  start: string;
  end?: string;
  finished?: boolean;
  color?: string;
  note?: string;
}

export interface MetadataEventMultiple {
  end?: string;
  color?: string;
  note?: string;
  times: MetadataEventSingle[];
}

export type MetadataEvent = MetadataEventSingle | MetadataEventMultiple;

export function isMetadataEventMultiple(ev: MetadataEvent): ev is MetadataEventMultiple {
  return Array.isArray((ev as MetadataEventMultiple).times);
}

export interface Metadata {
  tags?: string[];
  events?: { [key: string]: MetadataEvent };
}

export interface ListEntry {
  path: string;
  metadata: Metadata;
}

export function validateEvent(event: any): boolean {
  if (typeof event.name !== "string") {
    console.error("%s: Event's name is not a string: %o", event.notePath, event);
    return false;
  }
  if (typeof event.start !== "string") {
    console.error("%s: Event's start is not a string: %o", event.notePath, event);
    return false;
  }
  if (typeof event.end !== "string" && typeof event.end !== "undefined") {
    console.error("%s: Event's end is neither a string nor the undefined: %o", event.notePath, event);
    return false;
  }
  if (typeof event.color !== "string") {
    console.error("%s: Event's color is not a string: %o", event.notePath, event);
    return false;
  }
  return true;
}

// Tasks
export interface Task {
  id: string;
  name: string;
  deadline: null | string;
  schedule: null | string;
  done: boolean;
  tags: string[];
  note: string;
}

export function isTask(task: any): task is Task {
  return 'id' in task
    && 'name' in task
    && 'deadline' in task
    && 'schedule' in task
    && 'done' in task
    && 'tags' in task
    && 'note' in task;
}

// Find
export interface Query {
  paths: Set<any>;
  tags: Set<any>;
  any: Set<any>;
}

export interface ListEntry2 {
  path: string;
  size: number;
  mime_type: string;
  metadata: { tags: string[] } | null;
  title: string | null;
  time: string;
}

export function compareTags(a: string, b: string): number {
  const A = a.toUpperCase();
  const B = b.toUpperCase();
  if (A < B) {
    return -1;
  }
  if (A > B) {
    return 1;
  }
  return 0;
}

// APIs
export function login(user: string, password: string) {
  return getAxios().post(`/login`, {
    user: user,
    password: password,
  });
}

export function listNotes() {
  return getAxios().get('/notes');
}

export function addNote(path: string, content: string) {
  return getAxios().put(`/notes/${path}`, {
    Save: {
      content: content,
      message: `Update ${path}`,
    },
  });
}

export function renameNote(oldPath: string, newPath: string) {
  return getAxios().put(`/notes/${newPath}`, {
    Rename: {
      from: oldPath,
    },
  });
}

export function getNote(path: string) {
  return getAxios().get(`/notes/${path}`);
}

export function deleteNote(path: string) {
  return getAxios().delete(`/notes/${path}`);
}

export function uploadFiles(fd: FormData) {
  return getAxios().post(`/files`, fd);
}

export async function getTaskData() {
    const res = await getNote(".mory/tasks.yaml");
    const data = YAML.parse(res.data);

    // Give a unique ID to each task
    data.tasks.backlog.forEach((task) => task.id = crypto.randomUUID());
    for (const tasks of Object.values(data.tasks.scheduled)) {
        tasks.forEach((task) => task.id = crypto.randomUUID());
    }

    return data;
}
