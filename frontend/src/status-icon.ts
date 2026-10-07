// The icon of a task's status, drawn beside the task wherever it is listed, in its status colour.

import {
    mdiCancel,
    mdiCheckboxBlankOutline,
    mdiCheckboxMarkedOutline,
    mdiClockOutline,
    mdiCloseThick,
    mdiFolder,
    mdiFolderCancel,
    mdiFolderCheck,
    mdiFolderClock,
    mdiFolderLock,
    mdiFolderPlay,
    mdiFolderQuestion,
    mdiFolderRemove,
    mdiHelpBoxOutline,
    mdiLockOutline,
    mdiPlayCircleOutline,
} from '@mdi/js';

import type { StatusKind } from '@/task';

// Each status's own icon, and the folder carrying the same mark for a task with subtasks, so a
// glance tells both what state a task is in and whether it holds others. A mark is only chosen
// where the folder icons have one to match.
const STATUS_ICON: Record<StatusKind, { task: string; parent: string }> = {
    // Not yet committed to: an open question rather than an empty box to tick.
    backlog: { task: mdiHelpBoxOutline, parent: mdiFolderQuestion },
    todo: { task: mdiCheckboxBlankOutline, parent: mdiFolder },
    in_progress: { task: mdiPlayCircleOutline, parent: mdiFolderPlay },
    waiting: { task: mdiClockOutline, parent: mdiFolderClock },
    blocked: { task: mdiCancel, parent: mdiFolderCancel },
    on_hold: { task: mdiLockOutline, parent: mdiFolderLock },
    done: { task: mdiCheckboxMarkedOutline, parent: mdiFolderCheck },
    // A cross rather than a crossed-out box, which would read too like Blocked's barred circle.
    // No folder has a thick cross, so the folder's is the plain one.
    canceled: { task: mdiCloseThick, parent: mdiFolderRemove },
};

/// The icon of a status, as a folder for a task with subtasks. A task whose note gives no kind is in
/// the backlog, as the Status view files it and the editor opens it; one whose kind is no status is
/// drawn as To do, as one not yet finished.
export function statusIcon(kind: unknown, hasSubtasks: boolean): string {
    const status = kind ?? 'backlog';
    const icons = typeof status === 'string' && Object.hasOwn(STATUS_ICON, status)
        ? STATUS_ICON[status as StatusKind]
        : STATUS_ICON.todo;
    return hasSubtasks ? icons.parent : icons.task;
}
