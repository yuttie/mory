// The tags a file's frontmatter gives, as the views take them.

// The text items of a `tags:` list, and none from any other value, as moried's tools take them.
// Taking more would put a note under tags nothing else knows it by: a string read letter by letter,
// or a number turned into text. A number or a mapping as the whole value would throw where it is
// iterated and take that view down with it. The schema check reports every such value, for its
// author to write as a list of text.
export function tagsOf(metadata: unknown): string[] {
    if (typeof metadata !== 'object' || metadata === null) {
        return [];
    }
    const tags: unknown = (metadata as Record<string, unknown>).tags;
    return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : [];
}
