// The icon of a task's status, drawn beside the task wherever it is listed, in its status colour.

import {
    mdiCheckboxBlankOffOutline,
    mdiCheckboxBlankOutline,
    mdiCheckboxMarkedOutline,
    mdiFolder,
    mdiFolderCheck,
    mdiFolderOff,
} from '@mdi/js';

/// A folder for a task with subtasks and a checkbox for one without: checked when it is done,
/// crossed out when it is canceled, and empty otherwise, the colour telling the rest apart.
export function statusIcon(kind: unknown, hasSubtasks: boolean): string {
    if (hasSubtasks) {
        return kind === 'done' ? mdiFolderCheck : kind === 'canceled' ? mdiFolderOff : mdiFolder;
    }
    return kind === 'done' ? mdiCheckboxMarkedOutline : kind === 'canceled' ? mdiCheckboxBlankOffOutline : mdiCheckboxBlankOutline;
}
