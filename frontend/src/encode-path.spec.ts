import { describe, expect, it } from 'vitest';

import { encodePath } from '@/encode-path';

describe('encodePath', () => {
    it('leaves the slashes between segments alone', () => {
        expect(encodePath('research/programming-learning/codewalker.md')).toBe('research/programming-learning/codewalker.md');
        expect(encodePath('.tasks/00000001-0000-4000-8000-000000000000.md')).toBe('.tasks/00000001-0000-4000-8000-000000000000.md');
    });

    it('keeps URL metacharacters as part of a name', () => {
        expect(encodePath('notes/name#draft?100%.md')).toBe('notes/name%23draft%3F100%25.md');
    });

    it('encodes spaces and non-ASCII text, which the backend decodes back', () => {
        expect(encodePath('日本 語/メモ 1.md')).toBe('%E6%97%A5%E6%9C%AC%20%E8%AA%9E/%E3%83%A1%E3%83%A2%201.md');
    });

    it('leaves an empty path and the empty segments of a stray slash as they are', () => {
        expect(encodePath('')).toBe('');
        expect(encodePath('/a.md')).toBe('/a.md');
        expect(encodePath('a//b.md')).toBe('a//b.md');
    });

    // A browser removes these from a URL whatever is written, so encoding cannot make them reach the
    // backend.
    it('keeps dot segments as they are', () => {
        expect(encodePath('a/../b.md')).toBe('a/../b.md');
    });

    it('keeps a backslash from becoming a separator', () => {
        expect(encodePath('a\\b.md')).toBe('a%5Cb.md');
    });

    it('does not decode a name that already looks encoded', () => {
        expect(encodePath('a%2Fb.md')).toBe('a%252Fb.md');
    });
});
