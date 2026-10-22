import { describe, expect, it } from 'vitest';

import { isMediaType, routeForMime } from '@/file-route';

describe('routeForMime', () => {
    it('sends media to the media view', () => {
        expect(routeForMime('scan.png', 'image/png')).toEqual({ name: 'Media', params: { path: ['scan.png'] } });
        expect(routeForMime('clip.mp4', 'video/mp4')).toEqual({ name: 'Media', params: { path: ['clip.mp4'] } });
        expect(routeForMime('paper.pdf', 'application/pdf')).toEqual({ name: 'Media', params: { path: ['paper.pdf'] } });
    });

    it('sends Markdown and other text to the note view', () => {
        expect(routeForMime('.tasks/todo.md', 'text/markdown')).toEqual({
            name: 'Note',
            params: { path: ['.tasks', 'todo.md'] },
        });
        expect(routeForMime('readme.txt', 'text/plain')).toEqual({ name: 'Note', params: { path: ['readme.txt'] } });
    });

    it('keeps URL metacharacters as literal path data', () => {
        expect(routeForMime('notes/name#draft?100%.md', 'text/markdown')).toEqual({
            name: 'Note',
            params: { path: ['notes', 'name#draft?100%.md'] },
        });
    });
});

describe('isMediaType', () => {
    it('takes images, videos and PDFs', () => {
        expect(isMediaType('image/webp')).toBe(true);
        expect(isMediaType('video/webm')).toBe(true);
        expect(isMediaType('application/pdf')).toBe(true);
    });

    it('leaves text and other documents to the note view', () => {
        expect(isMediaType('text/markdown')).toBe(false);
        expect(isMediaType('application/json')).toBe(false);
        expect(isMediaType('application/octet-stream')).toBe(false);
    });
});
