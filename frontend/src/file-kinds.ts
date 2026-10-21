// The kinds of file the Files view has a tab for, and which files each tab lists.
//
// Most list what one of the other views is for, so a file is found under the kind it is opened as:
// the notes the note tree holds, the tasks the task tree holds, and whatever the media view opens.
// The rest list what the application keeps in files of its own: the templates the Add menu offers,
// the events the calendar draws, by the files that declare them, and the settings under `.mory/`.
// "Uncategorized" lists every file none of those does, and the tab with no kind every file of all.

import type { ListEntry2 } from '@/api';
import { isMediaType } from '@/file-route';
import { isHiddenPath } from '@/note-forest';
import { taskUuidOf } from '@/task-forest';

export type FileKind = 'notes' | 'tasks' | 'media' | 'templates' | 'events' | 'system' | 'others';

export const FILE_KINDS: readonly FileKind[] = ['notes', 'tasks', 'media', 'templates', 'events', 'system', 'others'];

export const SYSTEM_DIR = '.mory/';

// The kind a route parameter names, or `null` for every file. The router accepts only these, but a
// parameter may be absent, empty or an array, depending on how the address was reached.
export function fileKindOf(param: unknown): FileKind | null {
    return FILE_KINDS.find((kind) => kind === param) ?? null;
}

// What the Add menu offers to start a note from, wherever it is.
export function isTemplatePath(path: string): boolean {
    return /\.template$/i.test(path);
}

// A template as the Add menu lists it.
export function templateNameOf(path: string): string {
    return path.replace(/\.template$/i, '');
}

export function isOfKind(entry: Pick<ListEntry2, 'path' | 'mime_type' | 'metadata'>, kind: FileKind): boolean {
    switch (kind) {
        // As the note tree has them: the application's own directories hold its storage, not
        // notes. An image beside a note is not one either, though the tree shows it, because the
        // note view cannot open it, and a template is what a note is started from.
        case 'notes':
            return !isHiddenPath(entry.path) && !isMediaType(entry.mime_type) && !isTemplatePath(entry.path);
        // As the task tree has them, which leaves out a file under `.tasks/` named otherwise.
        case 'tasks':
            return taskUuidOf(entry.path) !== null;
        // Wherever it is, so an image attached to a task is listed too.
        case 'media':
            return isMediaType(entry.mime_type);
        case 'templates':
            return isTemplatePath(entry.path);
        // Wherever they are, as the calendar draws them. A file under `.events/` that declares none
        // has nothing to list there.
        case 'events':
            return declaredEvents(entry.metadata).length > 0;
        case 'system':
            return entry.path.startsWith(SYSTEM_DIR);
        case 'others':
            return FILE_KINDS.every((other) => other === 'others' || !isOfKind(entry, other));
    }
}

// The events a file declares, by name, as `eventsFromEntries` reads them. Most notes that have the
// `events:` key leave it empty.
export function declaredEvents(metadata: ListEntry2['metadata']): [string, object][] {
    const declared = metadata?.events;
    if (typeof declared !== 'object' || declared === null) {
        return [];
    }
    return Object.entries(declared).filter((pair): pair is [string, object] => typeof pair[1] === 'object' && pair[1] !== null);
}
