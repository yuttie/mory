// The kinds of file the Files view has a tab for, and which files each tab lists.
//
// Each lists what one of the other views is for, so a file is found under the kind it is opened
// as: the notes the note tree holds, the tasks the task tree holds, and whatever the media view
// opens. The tab with no kind lists every file, the application's settings and the event notes
// under `.events/` among them, which no other tab does.

import type { ListEntry2 } from '@/api';
import { isMediaType } from '@/file-route';
import { isHiddenPath } from '@/note-forest';
import { taskUuidOf } from '@/task-forest';

export type FileKind = 'notes' | 'tasks' | 'media';

export const FILE_KINDS: readonly FileKind[] = ['notes', 'tasks', 'media'];

// The kind a route parameter names, or `null` for every file. The router accepts only these, but a
// parameter may be absent, empty or an array, depending on how the address was reached.
export function fileKindOf(param: unknown): FileKind | null {
    return FILE_KINDS.find((kind) => kind === param) ?? null;
}

export function isOfKind(entry: Pick<ListEntry2, 'path' | 'mime_type'>, kind: FileKind): boolean {
    switch (kind) {
        // As the note tree has them: the application's own directories hold its storage, not
        // notes. An image beside a note is not one either, though the tree shows it, because the
        // note view cannot open it.
        case 'notes':
            return !isHiddenPath(entry.path) && !isMediaType(entry.mime_type);
        // As the task tree has them, which leaves out a file under `.tasks/` named otherwise.
        case 'tasks':
            return taskUuidOf(entry.path) !== null;
        // Wherever it is, so an image attached to a task is listed too.
        case 'media':
            return isMediaType(entry.mime_type);
    }
}
