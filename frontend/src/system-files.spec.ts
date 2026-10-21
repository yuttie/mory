import { describe, expect, it } from 'vitest';

import { systemFilePurpose } from '@/system-files';

describe('systemFilePurpose', () => {
    it('says what each file the application reads is for', () => {
        expect(systemFilePurpose('.mory/calendars.yaml')).toBe('Subscribed calendars, event categories and alarms');
        expect(systemFilePurpose('.mory/tasks.yaml')).toBe('Lead times and status colours of the tasks');
        expect(systemFilePurpose('.mory/custom-note.less')).toBe('Styles for the notes, unless there is a custom-note.css');
    });

    it('names the month a day plan is for', () => {
        expect(systemFilePurpose('.mory/plans/2026-10.yaml')).toBe('Day plans for October 2026');
    });

    it('says nothing of a file the application does not read', () => {
        expect(systemFilePurpose('.mory/events.md')).toBeUndefined();
        expect(systemFilePurpose('.mory/plans/2026-13.yaml')).toBeUndefined();
        expect(systemFilePurpose('.mory/plans/notes.md')).toBeUndefined();
        expect(systemFilePurpose('calendars.yaml')).toBeUndefined();
    });
});
