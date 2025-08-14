import { getAxios } from '@/axios';
import YAML from 'yaml';

export type JsonValue =
    | { [k: string]: JsonValue }
    | JsonValue[]
    | string
    | number
    | boolean
    | null;

export type UUID = string;

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

// Files
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

export function searchNotes(pattern: string) {
  return getAxios().post('/notes', { pattern: pattern });
}

export interface TaskData {
    tasks: { backlog: Task[], scheduled: { [key: string]: Task[] } };
    groups: { name: string, filter: string }[];
}

export async function getTaskData(eTag?: string): Promise<[string, TaskData | null]> {
    const headers = {};
    if (eTag) {
        headers['If-None-Match'] = eTag;
    }
    const res = await getAxios().get(`/v2/files/.mory/tasks.yaml`, {
        headers: headers,
        validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
    });
    if (res.status === 304) {
        return [res.headers.etag, null];
    }
    else {
        const data = YAML.parse(res.data) as TaskData;

        // Give a unique ID to each task if missing
        data.tasks.backlog.forEach((task) => task.id = task.id ?? crypto.randomUUID());
        for (const tasks of Object.values(data.tasks.scheduled)) {
            tasks.forEach((task) => task.id = task.id ?? crypto.randomUUID());
        }

        return [res.headers.etag, data];
    }
}

export async function putTaskData(data: TaskData) {
    // Clean up
    data = structuredClone(data);
    for (const task of data.tasks.backlog) {
        for (const [prop, value] of Object.entries(task)) {
            if (value === null) {
                delete task[prop];
            }
        }
    }
    for (const [date, dailyTasks] of Object.entries(data.tasks.scheduled)) {
        if ((dailyTasks as Task[]).length === 0) {
            delete data.tasks.scheduled[date];
        }
        for (const task of dailyTasks) {
            for (const [prop, value] of Object.entries(task)) {
                if (value === null) {
                    delete task[prop];
                }
            }
        }
    }

    // Serialize
    const datePattern = /\d{4}-\d{2}-\d{2}/;
    const taskPropertyOrder: { [key: string]: number } = {
        id: 0,
        name: 1,
        deadline: 2,
        schedule: 3,
        done: 4,
        tags: 5,
        note: 6,
    };
    const groupPropertyOrder: { [key: string]: number } = {
        name: 0,
        filter: 1,
    };
    const yaml = YAML.stringify(data, {
        sortMapEntries: (a, b) => {
            if (datePattern.test(a.key.value) && datePattern.test(b.key.value)) {
                if (a.key.value < b.key.value) {
                    return 1;
                }
                else if (a.key.value > b.key.value) {
                    return -1;
                }
                else {
                    return 0;
                }
            }
            else if (a.key.value in taskPropertyOrder && b.key.value in taskPropertyOrder) {
                if (taskPropertyOrder[a.key.value] < taskPropertyOrder[b.key.value]) {
                    return -1;
                }
                else if (taskPropertyOrder[a.key.value] > taskPropertyOrder[b.key.value]) {
                    return 1;
                }
                else {
                    return 0;
                }
            }
            else if (a.key.value in groupPropertyOrder && b.key.value in groupPropertyOrder) {
                if (groupPropertyOrder[a.key.value] < groupPropertyOrder[b.key.value]) {
                    return -1;
                }
                else if (groupPropertyOrder[a.key.value] > groupPropertyOrder[b.key.value]) {
                    return 1;
                }
                else {
                    return 0;
                }
            }
            else {
                if (a.key.value < b.key.value) {
                    return -1;
                }
                else if (a.key.value > b.key.value) {
                    return 1;
                }
                else {
                    return 0;
                }
            }
        },
    });

    // Send
    return await addNote('.mory/tasks.yaml', yaml);
}
