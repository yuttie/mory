import { describe, expect, it } from 'vitest';

import { fileKindOf, isOfKind } from '@/file-kinds';
import type { FileKind } from '@/file-kinds';

const TASK = '.tasks/0b5bd9c4-6a3e-4a8f-9d0e-2f4c7a1b3e5d.md';
const SUBTASK = '.tasks/0b5bd9c4-6a3e-4a8f-9d0e-2f4c7a1b3e5d/report-7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f.md';

function kindsOf(path: string, mime_type: string): FileKind[] {
    return (['notes', 'tasks', 'media'] as const).filter((kind) => isOfKind({ path, mime_type }, kind));
}

describe('fileKindOf', () => {
    it('reads the kinds the router accepts', () => {
        expect(fileKindOf('notes')).toBe('notes');
        expect(fileKindOf('tasks')).toBe('tasks');
        expect(fileKindOf('media')).toBe('media');
    });

    it('reads anything else as every file', () => {
        expect(fileKindOf(undefined)).toBeNull();
        expect(fileKindOf('')).toBeNull();
        expect(fileKindOf(['notes'])).toBeNull();
        expect(fileKindOf('Notes')).toBeNull();
    });
});

describe('isOfKind', () => {
    it('lists the notes the note tree holds', () => {
        expect(kindsOf('ideas.md', 'text/markdown')).toEqual(['notes']);
        expect(kindsOf('ideas/draft.org', 'application/vnd.lotus-organizer')).toEqual(['notes']);
        expect(kindsOf('readme.txt', 'text/plain')).toEqual(['notes']);
    });

    it('lists the tasks the task tree holds, subtasks included', () => {
        expect(kindsOf(TASK, 'text/markdown')).toEqual(['tasks']);
        expect(kindsOf(SUBTASK, 'text/markdown')).toEqual(['tasks']);
    });

    it('leaves a file under .tasks/ that is not named as a task to every file', () => {
        expect(kindsOf('.tasks/notes.md', 'text/markdown')).toEqual([]);
    });

    it('leaves the application\'s settings and event notes to every file', () => {
        expect(kindsOf('.mory/calendars.yaml', 'application/yaml')).toEqual([]);
        expect(kindsOf('.mory/plans/2026-10.yaml', 'application/yaml')).toEqual([]);
        expect(kindsOf('.events/meeting.md', 'text/markdown')).toEqual([]);
    });

    it('lists whatever the media view opens, wherever it is', () => {
        expect(kindsOf('photo.jpg', 'image/jpeg')).toEqual(['media']);
        expect(kindsOf('ideas/sketch.png', 'image/png')).toEqual(['media']);
        expect(kindsOf('clip.mp4', 'video/mp4')).toEqual(['media']);
        expect(kindsOf('paper.pdf', 'application/pdf')).toEqual(['media']);
        expect(kindsOf('.tasks/0b5bd9c4-6a3e-4a8f-9d0e-2f4c7a1b3e5d/receipt.png', 'image/png')).toEqual(['media']);
    });
});
