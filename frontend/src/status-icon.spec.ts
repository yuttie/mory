import { describe, expect, it } from 'vitest';
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

import { STATUS_KINDS } from '@/task';
import { statusIcon } from '@/status-icon';

describe('statusIcon', () => {
    it('gives each status an icon of its own', () => {
        const icons = STATUS_KINDS.map((kind) => statusIcon(kind, false));
        expect(icons).toEqual([
            mdiHelpBoxOutline,
            mdiCheckboxBlankOutline,
            mdiCogOutline,
            mdiClockOutline,
            mdiCancel,
            mdiLockOutline,
            mdiCheckboxMarkedOutline,
            mdiCloseThick,
        ]);
        expect(new Set(icons).size).toBe(STATUS_KINDS.length);
    });

    it('draws a task with subtasks as a folder with the same mark', () => {
        const icons = STATUS_KINDS.map((kind) => statusIcon(kind, true));
        expect(icons).toEqual([
            mdiFolderQuestion,
            mdiFolder,
            mdiFolderCog,
            mdiFolderClock,
            mdiFolderCancel,
            mdiFolderLock,
            mdiFolderCheck,
            mdiFolderRemove,
        ]);
        expect(new Set(icons).size).toBe(STATUS_KINDS.length);
    });

    it('draws a task whose note gives no status as Backlog, where the Status view files it', () => {
        expect(statusIcon(undefined, false)).toBe(mdiHelpBoxOutline);
        expect(statusIcon(null, true)).toBe(mdiFolderQuestion);
    });

    it('draws a task whose status is not one as To do', () => {
        expect(statusIcon('started', true)).toBe(mdiFolder);
        expect(statusIcon('toString', false)).toBe(mdiCheckboxBlankOutline);
        expect(statusIcon(3, false)).toBe(mdiCheckboxBlankOutline);
    });
});
