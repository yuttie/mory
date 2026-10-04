import { describe, expect, it } from 'vitest';
import { nowLocal, withCreatedAt } from '@/time';

const timestamp = '2026-10-04 14:05:12+09:00';

describe('creation timestamps', () => {
    it('gives a plain note frontmatter', () => {
        expect(withCreatedAt('# Note\n', timestamp)).toBe(`---\ncreated_at: "${timestamp}"\n---\n\n# Note\n`);
    });
    it('preserves comments, quoting, line endings and an existing timestamp', () => {
        const original = "---\r\n# Keep\r\ntags: ['work']\r\n---\r\nText\r\n";
        const stamped = withCreatedAt(original, timestamp);
        expect(stamped).toContain(original.slice(5));
        expect(withCreatedAt(stamped, 'later')).toBe(stamped);
    });
    it('does not silently repair invalid frontmatter', () => {
        expect(() => withCreatedAt('---\ntags: [\n---\nText')).toThrow();
    });
    it('formats local wall clock with seconds and an offset', () => {
        expect(nowLocal()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    });
});
