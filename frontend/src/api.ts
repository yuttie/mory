import { toRaw } from 'vue';
import { getAxios } from '@/axios';
import YAML from 'yaml';
import type { Status } from '@/task';

// Deep-clone a data tree while unwrapping Vue reactive proxies and preserving shared
// references (so YAML.stringify can still emit anchors/aliases for shared objects).
// structuredClone cannot be used directly because it throws on reactive proxies.
function deepCloneRaw<T>(value: T, seen = new Map<object, unknown>()): T {
    const raw = (typeof value === 'object' && value !== null ? toRaw(value) : value) as T;
    if (raw === null || typeof raw !== 'object') {
        return raw;
    }
    if (seen.has(raw)) {
        return seen.get(raw) as T;
    }
    if (Array.isArray(raw)) {
        const copy: unknown[] = [];
        seen.set(raw, copy);
        for (const item of raw) {
            copy.push(deepCloneRaw(item, seen));
        }
        return copy as T;
    }
    const copy: Record<string, unknown> = {};
    seen.set(raw, copy);
    for (const [key, item] of Object.entries(raw)) {
        copy[key] = deepCloneRaw(item, seen);
    }
    return copy as T;
}

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
//
// These mirror `metadata-schema.json`, which describes one `event` shape rather than the two
// mutually exclusive ones it used to: an event is a base occurrence, a list of occurrences, or a
// rule with adjustments to what the rule generates -- and may be more than one of those at once.

export type Weekday = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

export interface EventRepeat {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  // A weekday, optionally ordinal-prefixed: `3wed` is the third Wednesday, `-1fri` the last Friday.
  byday?: string[];
  bymonthday?: number[];
  bymonth?: number[];
  // RFC 5545 defaults this to Monday; Google emits `WKST=SU` on most weekly rules.
  wkst?: Weekday;
  // An IANA zone name, and the one place in the format that is not an offset: expanding a rule
  // needs a zone's DST function, which no fixed offset carries.
  tz?: string;
  until?: string;
  count?: number;
}

export interface EventIcal {
  calendar?: string;
  uid: string;
  // Present when the note claims a single occurrence rather than the whole series.
  recurrence_id?: string;
}

// What an event and one of its occurrences both carry.
export interface EventFields {
  end?: string;
  finished?: boolean;
  color?: string;
  note?: string;
  // Overrides the map key for this occurrence, which is how a renamed occurrence is recorded.
  name?: string;
  location?: string;
  url?: string;
}

export interface EventOccurrence extends EventFields {
  // The rule-generated occurrence this entry changes. Mutually exclusive with `start` in practice.
  at?: string;
  start?: string;
}

export interface MetadataEvent extends EventFields {
  start?: string;
  repeat?: EventRepeat;
  exclusions?: string[];
  overrides?: EventOccurrence[];
  instances?: EventOccurrence[];
  // The older spelling of `instances`. Still read, never written.
  times?: EventOccurrence[];
  ical?: EventIcal;
}

/// The explicitly listed occurrences of an event, under either spelling.
///
/// Replaces an `Array.isArray(ev.times)` test that decided between two shapes. That test could not
/// see `instances`, and the branch it fell through to read `ev.start` -- which for a list-only
/// event is `undefined`, and `dayjs(undefined)` is *now*, so the miss rendered a phantom event at
/// the current time rather than failing.
export function occurrencesOf(event: MetadataEvent): EventOccurrence[] {
  const listed = event.instances ?? event.times;
  return Array.isArray(listed) ? listed : [];
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
  metadata: { tags: string[], events?: { [key: string]: MetadataEvent } } | null;
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

// The listing, or just what changed since a commit the client already holds.
//
// One tagged shape so the caller handles either uniformly. `commit` is the commit the returned
// rows actually describe, which may lag HEAD while the backend is still syncing; storing rows
// under that commit rather than under HEAD is what keeps the cache honest.
// `commit` is what the returned rows describe; `head` is where the repository actually is. They
// differ only while the backend is still syncing, and reporting both means the client can tell
// without spending a second request on `/v2/commits/head`.
export type EntriesResponse =
  | { kind: 'full'; commit: string; head: string; entries: ListEntry2[] }
  | {
      kind: 'delta';
      commit: string;
      head: string;
      base: string;
      changed: ListEntry2[];
      deleted: string[];
    };

// Pass `since` to receive only what changed since that commit. The backend falls back to a full
// listing whenever a delta cannot be computed or would not pay, so a caller never has to handle
// a rejection -- only the two shapes above.
export async function getEntries(since?: string): Promise<EntriesResponse> {
  const params = since === undefined ? undefined : { since };
  const res = await getAxios().get('/v2/entries', { params });
  return res.data as EntriesResponse;
}

// The ID of the repository's HEAD commit. Notes are files in a Git repository, so this
// identifies the exact state every other file API call observes, and is what the
// frontend's cache is validated against.
export async function getHeadCommitId(): Promise<string> {
  const res = await getAxios().get('/v2/commits/head');
  return res.data;
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

// Whether a path exists, without transferring its content. Used for the rename dialog's
// conflict check, which runs on every keystroke.
export async function noteExists(path: string): Promise<boolean> {
  const res = await getAxios().head(`/v2/files/${path}`, {
    validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
  });
  return res.status !== 404;
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

export const TASK_DATA_PATH = '.mory/tasks.yaml';

// Serializes task data to the YAML stored at `TASK_DATA_PATH`. Writing it is a file
// mutation, so it goes through the files store rather than straight to the API — that is
// what keeps the cached listing from surviving the commit this write produces.
export function serializeTaskData(data: TaskData): string {
    // Clean up
    data = deepCloneRaw(data);
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

    return yaml;
}

export interface TaskAssessmentResponse {
    quality_score: number;
    suggestions: string[];
    feedback: string;
    note_suggestions: string[];
}

// Calendar import
//
// These mirror the backend's `/v2/imported-events`. An imported occurrence is read-only until it
// is converted, so it is deliberately not a `MetadataEvent`: it has no note behind it, and the
// identity it carries -- `uid` plus `recurrence_id` -- is what a converted note records to shadow
// it.

export interface ImportedOccurrence {
  calendar: string;
  uid: string;
  /// Present on every occurrence, not only the ones a feed marks as modified.
  recurrence_id: string;
  name: string;
  start: string;
  end?: string;
  note?: string;
  location?: string;
  url?: string;
}

/// What converting a whole series to a note needs, keyed by uid.
export interface ImportedSeries {
  name: string;
  start: string;
  end?: string;
  /// Absent when the feed's rule cannot be said in mory's dialect, which is what makes conversion
  /// fall back to listing the occurrences.
  repeat?: EventRepeat;
  exclusions?: string[];
  overrides?: EventOccurrence[];
  /// Occurrences the rule does not generate -- iCal's `RDATE`.
  instances?: EventOccurrence[];
  note?: string;
  location?: string;
  url?: string;
  /// iCal properties mory has no key for, written into the converted note's body.
  unmapped?: Record<string, string>;
}

export interface ImportedCalendarReport {
  id: string;
  name: string;
  color: string | null;
  /// `null` when the feed was read. One dead feed is reported here rather than failing the request.
  error: string | null;
}

export interface ImportedEventsResponse {
  calendars: ImportedCalendarReport[];
  events: ImportedOccurrence[];
  series: Record<string, ImportedSeries>;
  truncated: boolean;
}

export async function getImportedEvents(
  start: string,
  end: string,
): Promise<ImportedEventsResponse> {
  const axios = await getAxios();
  const response = await axios.get('/v2/imported-events', { params: { start, end } });
  return response.data;
}

export async function runAiAction(prompt: string): Promise<string> {
    const axios = await getAxios();
    const response = await axios.post('/v2/ai-action', { prompt: prompt });
    return response.data.text;
}

export async function assessTask(task: { 
    title: string; 
    tags?: string[];
    status?: Status;
    progress?: number;
    importance?: number;
    urgency?: number;
    start_at?: string;
    due_by?: string;
    deadline?: string;
    note?: string;
}, ancestorTitles: string[] = []): Promise<TaskAssessmentResponse> {
    const axios = await getAxios();
    const response = await axios.post('/v2/assess-task', {
        ancestor_titles: ancestorTitles,
        title: task.title,
        tags: task.tags,
        status: task.status,
        progress: task.progress,
        importance: task.importance,
        urgency: task.urgency,
        start_at: task.start_at,
        due_by: task.due_by,
        deadline: task.deadline,
        note: task.note,
    });
    return response.data;
}
