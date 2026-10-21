import { describe, expect, it } from 'vitest';

import { FILE_KINDS, fileKindOf, isOfKind, templateNameOf } from '@/file-kinds';
import type { FileKind } from '@/file-kinds';

const TASK = '.tasks/0b5bd9c4-6a3e-4a8f-9d0e-2f4c7a1b3e5d.md';
const SUBTASK = '.tasks/0b5bd9c4-6a3e-4a8f-9d0e-2f4c7a1b3e5d/report-7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f.md';

function kindsOf(path: string, mime_type: string): FileKind[] {
    return FILE_KINDS.filter((kind) => isOfKind({ path, mime_type }, kind));
}

describe('fileKindOf', () => {
    it('reads the kinds the router accepts', () => {
        expect(fileKindOf('notes')).toBe('notes');
        expect(fileKindOf('tasks')).toBe('tasks');
        expect(fileKindOf('media')).toBe('media');
        expect(fileKindOf('templates')).toBe('templates');
        expect(fileKindOf('events')).toBe('events');
        expect(fileKindOf('system')).toBe('system');
        expect(fileKindOf('others')).toBe('others');
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

    it('lists the application\'s settings and event notes apart from the notes', () => {
        expect(kindsOf('.mory/calendars.yaml', 'application/yaml')).toEqual(['system']);
        expect(kindsOf('.mory/plans/2026-10.yaml', 'application/yaml')).toEqual(['system']);
        expect(kindsOf('.events/meeting.md', 'text/markdown')).toEqual(['events']);
    });

    it('lists the templates the Add menu offers, wherever they are', () => {
        expect(kindsOf('lecture.template', 'application/octet-stream')).toEqual(['templates']);
        expect(kindsOf('research/Meeting.TEMPLATE', 'application/octet-stream')).toEqual(['templates']);
        expect(kindsOf('.mory/report.template', 'application/octet-stream')).toEqual(['templates', 'system']);
    });

    it('lists what no other tab does as the others', () => {
        expect(kindsOf('.tasks/notes.md', 'text/markdown')).toEqual(['others']);
        expect(kindsOf('.redirects.gollum', 'application/octet-stream')).toEqual(['others']);
        expect(kindsOf('ideas/.gitkeep', 'application/octet-stream')).toEqual(['others']);
    });

    it('lists whatever the media view opens, wherever it is', () => {
        expect(kindsOf('photo.jpg', 'image/jpeg')).toEqual(['media']);
        expect(kindsOf('ideas/sketch.png', 'image/png')).toEqual(['media']);
        expect(kindsOf('clip.mp4', 'video/mp4')).toEqual(['media']);
        expect(kindsOf('paper.pdf', 'application/pdf')).toEqual(['media']);
        expect(kindsOf('.tasks/0b5bd9c4-6a3e-4a8f-9d0e-2f4c7a1b3e5d/receipt.png', 'image/png')).toEqual(['media']);
        expect(kindsOf('.mory/background.jpg', 'image/jpeg')).toEqual(['media', 'system']);
    });
});

describe('templateNameOf', () => {
    it('names a template as the Add menu lists it', () => {
        expect(templateNameOf('lecture.template')).toBe('lecture');
        expect(templateNameOf('research/Meeting.TEMPLATE')).toBe('research/Meeting');
    });
});
