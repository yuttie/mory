import { describe, expect, it } from 'vitest';

import type { ListEntry2 } from '@/api';
import { declaredEvents, FILE_KINDS, fileKindOf, isOfKind, templateNameOf } from '@/file-kinds';
import type { FileKind } from '@/file-kinds';

const TASK = '.tasks/0b5bd9c4-6a3e-4a8f-9d0e-2f4c7a1b3e5d.md';
const SUBTASK = '.tasks/0b5bd9c4-6a3e-4a8f-9d0e-2f4c7a1b3e5d/report-7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f.md';

function kindsOf(path: string, mime_type: string, metadata: ListEntry2['metadata'] = null): FileKind[] {
    return FILE_KINDS.filter((kind) => isOfKind({ path, mime_type, metadata }, kind));
}

function withEvents(events: unknown): ListEntry2['metadata'] {
    return { tags: [], events: events as Record<string, never> };
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

    it('lists the application\'s settings, and the files that declare events, apart from the notes', () => {
        expect(kindsOf('.mory/calendars.yaml', 'application/yaml')).toEqual(['system']);
        expect(kindsOf('.mory/plans/2026-10.yaml', 'application/yaml')).toEqual(['system']);
        expect(kindsOf('.events/meeting.md', 'text/markdown', withEvents({ Meeting: { start: '2026-10-21' } })))
            .toEqual(['events']);
    });

    it('lists every file that declares events under Events too', () => {
        const lecture = withEvents({ Lecture: { start: '2026-04-10 10:00', repeat: { freq: 'weekly' } } });
        expect(kindsOf('teaching/lecture.md', 'text/markdown', lecture)).toEqual(['notes', 'events']);
        expect(kindsOf(TASK, 'text/markdown', lecture)).toEqual(['tasks', 'events']);
        expect(kindsOf('.tasks/notes.md', 'text/markdown', lecture)).toEqual(['events']);
    });

    it('lists no file for an empty or unreadable `events:`', () => {
        expect(kindsOf('ideas.md', 'text/markdown', withEvents({}))).toEqual(['notes']);
        expect(kindsOf('ideas.md', 'text/markdown', withEvents(null))).toEqual(['notes']);
        expect(kindsOf('ideas.md', 'text/markdown', withEvents({ Broken: null, Number: 3 }))).toEqual(['notes']);
        expect(kindsOf('ideas.md', 'text/markdown', { tags: [] })).toEqual(['notes']);
        // Under `.events/` too, where no other tab takes it.
        expect(kindsOf('.events/draft.md', 'text/markdown', withEvents({}))).toEqual(['others']);
    });

    it('lists the templates the Add menu offers, wherever they are', () => {
        expect(kindsOf('lecture.template', 'application/octet-stream')).toEqual(['templates']);
        expect(kindsOf('research/Meeting.TEMPLATE', 'application/octet-stream')).toEqual(['templates']);
        expect(kindsOf('.mory/report.template', 'application/octet-stream')).toEqual(['templates', 'system']);
    });

    it('lists what no other tab does as Uncategorized', () => {
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

describe('declaredEvents', () => {
    it('reads the events a file declares by name, and nothing else', () => {
        const lecture = { start: '2026-04-10 10:00' };
        expect(declaredEvents(withEvents({ Lecture: lecture, Broken: null, Number: 3 }))).toEqual([['Lecture', lecture]]);
        expect(declaredEvents(withEvents('Lecture'))).toEqual([]);
        expect(declaredEvents(null)).toEqual([]);
    });
});

describe('templateNameOf', () => {
    it('names a template as the Add menu lists it', () => {
        expect(templateNameOf('lecture.template')).toBe('lecture');
        expect(templateNameOf('research/Meeting.TEMPLATE')).toBe('research/Meeting');
    });
});
