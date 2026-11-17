import { describe, expect, it } from 'vitest';

import { tagsOf } from '@/tags';

describe('tagsOf', () => {
    it('takes the text items of a list', () => {
        expect(tagsOf({ tags: ['work', 'home'] })).toEqual(['work', 'home']);
        expect(tagsOf({ tags: [2024, 'work', null, ['nested'], { a: 1 }, true] })).toEqual(['work']);
    });

    // The schema check reports each of these, and no view may throw or split one into letters.
    it.each([
        ['a string', 'work'],
        ['a number', 5],
        ['a mapping', { a: 1 }],
        ['an empty value', null],
        ['nothing', undefined],
    ])('takes no tags from %s', (_name, tags) => {
        expect(tagsOf({ tags })).toEqual([]);
    });

    it('takes no tags from frontmatter that is not a mapping, or from none', () => {
        expect(tagsOf(null)).toEqual([]);
        expect(tagsOf(undefined)).toEqual([]);
        expect(tagsOf('tags')).toEqual([]);
    });
});
