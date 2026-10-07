import { describe, expect, it } from 'vitest';
import {
    mdiCheckboxBlankOffOutline,
    mdiCheckboxBlankOutline,
    mdiCheckboxMarkedOutline,
    mdiFolder,
    mdiFolderCheck,
    mdiFolderOff,
} from '@mdi/js';

import { statusIcon } from '@/status-icon';

describe('statusIcon', () => {
    it('draws a task without subtasks as a checkbox', () => {
        expect(statusIcon('todo', false)).toBe(mdiCheckboxBlankOutline);
        expect(statusIcon('done', false)).toBe(mdiCheckboxMarkedOutline);
        expect(statusIcon('canceled', false)).toBe(mdiCheckboxBlankOffOutline);
    });

    it('draws a task with subtasks as a folder', () => {
        expect(statusIcon('in_progress', true)).toBe(mdiFolder);
        expect(statusIcon('done', true)).toBe(mdiFolderCheck);
        expect(statusIcon('canceled', true)).toBe(mdiFolderOff);
    });

    it('draws a task whose status is not one as not yet finished', () => {
        expect(statusIcon(undefined, false)).toBe(mdiCheckboxBlankOutline);
        expect(statusIcon('started', true)).toBe(mdiFolder);
    });
});
