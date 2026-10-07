// The icon of a task's status, drawn beside the task wherever it is listed, in its status colour.

import {
    mdiCancel,
    mdiCheckboxBlankOutline,
    mdiCheckboxMarkedOutline,
    mdiClockOutline,
    mdiCloseThick,
    mdiCogOutline,
    mdiFolder,
    mdiFolderCancel,
    mdiFolderCheck,
    mdiFolderClock,
    mdiFolderCog,
    mdiFolderLock,
    mdiFolderQuestion,
    mdiFolderRemove,
    mdiHelpBoxOutline,
    mdiLockOutline,
} from '@mdi/js';

import type { StatusKind } from '@/task';

// Each status's own icon, and the folder carrying the same mark for a task with subtasks, so a
// glance tells both what state a task is in and whether it holds others. A mark is only chosen
// where the folder icons have one to match.
const STATUS_ICON: Record<StatusKind, { task: string; parent: string }> = {
    // Not yet committed to: an open question rather than an empty box to tick.
    backlog: { task: mdiHelpBoxOutline, parent: mdiFolderQuestion },
    todo: { task: mdiCheckboxBlankOutline, parent: mdiFolder },
    in_progress: { task: mdiCogOutline, parent: mdiFolderCog },
    waiting: { task: mdiClockOutline, parent: mdiFolderClock },
    blocked: { task: mdiCancel, parent: mdiFolderCancel },
    on_hold: { task: mdiLockOutline, parent: mdiFolderLock },
    done: { task: mdiCheckboxMarkedOutline, parent: mdiFolderCheck },
    // A cross rather than a crossed-out box, which would read too like Blocked's barred circle.
    // No folder has a thick cross, so the folder's is the plain one.
    canceled: { task: mdiCloseThick, parent: mdiFolderRemove },
};

/// The icon of a status, as a folder for a task with subtasks. A task whose status is not one is
/// drawn as To do, as one not yet finished.
export function statusIcon(kind: unknown, hasSubtasks: boolean): string {
    const icons = typeof kind === 'string' && Object.hasOwn(STATUS_ICON, kind)
        ? STATUS_ICON[kind as StatusKind]
        : STATUS_ICON.todo;
    return hasSubtasks ? icons.parent : icons.task;
}
