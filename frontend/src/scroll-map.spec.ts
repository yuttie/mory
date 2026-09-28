import { describe, expect, it } from 'vitest';

import { buildScrollMap, lineAtOffset, offsetAtLine } from '@/scroll-map';

const anchor = (line: number, offset: number) => ({ line, offset });

describe('buildScrollMap', () => {
    it('orders the anchors by line', () => {
        expect(buildScrollMap([anchor(5, 100), anchor(1, 0), anchor(3, 40)]))
            .toEqual([anchor(1, 0), anchor(3, 40), anchor(5, 100)]);
    });

    it('drops an anchor that would make the offset go back up', () => {
        expect(buildScrollMap([anchor(1, 0), anchor(3, 40), anchor(5, 30), anchor(5, 35), anchor(7, 120)]))
            .toEqual([anchor(1, 0), anchor(5, 30), anchor(5, 35), anchor(7, 120)]);
    });

    it('drops a footnote drawn at the end rather than everything after its definition', () => {
        const footnote = anchor(3, 1000);
        expect(buildScrollMap([anchor(1, 0), footnote, anchor(5, 40), anchor(7, 80), anchor(9, 120)]))
            .toEqual([anchor(1, 0), anchor(5, 40), anchor(7, 80), anchor(9, 120)]);
    });

    it('keeps anchors on one line in the order they are drawn', () => {
        expect(buildScrollMap([anchor(3, 50), anchor(1, 0), anchor(3, 40)]))
            .toEqual([anchor(1, 0), anchor(3, 40), anchor(3, 50)]);
    });

    it('is empty without anchors', () => {
        expect(buildScrollMap([])).toEqual([]);
    });
});

describe('offsetAtLine and lineAtOffset', () => {
    const map = buildScrollMap([anchor(1, 0), anchor(3, 40), anchor(5, 100)]);

    it('interpolate between anchors, both ways', () => {
        expect(offsetAtLine(map, 2)).toBe(20);
        expect(offsetAtLine(map, 4.5)).toBe(85);
        expect(lineAtOffset(map, 20)).toBe(2);
        expect(lineAtOffset(map, 85)).toBe(4.5);
    });

    it('give nothing outside the anchors', () => {
        expect(offsetAtLine(map, 0.5)).toBeNull();
        expect(offsetAtLine(map, 5)).toBeNull();
        expect(lineAtOffset(map, 100)).toBeNull();
    });

    it('take the last of anchors sharing a line', () => {
        const shared = buildScrollMap([anchor(1, 0), anchor(3, 40), anchor(3, 50), anchor(5, 100)]);
        expect(offsetAtLine(shared, 3)).toBe(50);
        expect(lineAtOffset(shared, 45)).toBe(3);
    });
});
