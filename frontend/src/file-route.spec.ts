import { describe, expect, it } from 'vitest';

import { routeForMime } from '@/file-route';

describe('routeForMime', () => {
    it('sends media to the media view', () => {
        expect(routeForMime('scan.png', 'image/png')).toBe('/media/scan.png');
        expect(routeForMime('clip.mp4', 'video/mp4')).toBe('/media/clip.mp4');
        expect(routeForMime('paper.pdf', 'application/pdf')).toBe('/media/paper.pdf');
    });

    it('sends Markdown and other text to the note view', () => {
        expect(routeForMime('.tasks/todo.md', 'text/markdown')).toBe('/note/.tasks/todo.md');
        expect(routeForMime('readme.txt', 'text/plain')).toBe('/note/readme.txt');
    });
});
