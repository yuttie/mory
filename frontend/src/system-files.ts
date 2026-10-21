// What each file the application keeps under `.mory/` is for, as the Files view's System tab says.
//
// A name alone does not say which of them the application reads, nor which settings screen writes
// it, so a file edited by hand, or deleted, can surprise. A file it does not read is someone's own,
// and has nothing said of it.

import dayjs from 'dayjs';

import { AI_ACTIONS_PATH } from '@/ai-actions';
import { TASK_DATA_PATH } from '@/api';
import { DEFAULT_CONFIG_PATH } from '@/config';
import { planMonthOf } from '@/health';
import { CALENDARS_PATH } from '@/stores/calendars';
import { TASK_SETTINGS_PATH } from '@/stores/taskSettings';
import { TASK_ASSESSMENT_PROMPT_PATH } from '@/task-assessment';

// The style sheets are read where they are loaded, by a literal path. Each Less file is read only
// where its CSS twin is absent.
const PURPOSES: ReadonlyMap<string, string> = new Map([
    [CALENDARS_PATH, 'Subscribed calendars, event categories and alarms'],
    [TASK_SETTINGS_PATH, 'Lead times and status colours of the tasks'],
    [TASK_DATA_PATH, 'The tasks of the old task model, kept as they were'],
    [TASK_ASSESSMENT_PROMPT_PATH, 'What the task assessment asks for'],
    [AI_ACTIONS_PATH, 'The AI actions the editor offers'],
    [DEFAULT_CONFIG_PATH, 'Settings a new browser can start from'],
    ['.mory/custom.css', 'Styles for the app'],
    ['.mory/custom.less', 'Styles for the app, unless there is a custom.css'],
    ['.mory/custom-note.css', 'Styles for the notes'],
    ['.mory/custom-note.less', 'Styles for the notes, unless there is a custom-note.css'],
]);

export function systemFilePurpose(path: string): string | undefined {
    const month = planMonthOf(path);
    if (month !== null) {
        return `Day plans for ${dayjs(`${month}-01`).format('MMMM YYYY')}`;
    }
    return PURPOSES.get(path);
}
