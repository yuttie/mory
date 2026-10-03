import dayjs from 'dayjs';
import YAML from 'yaml';
import { editFrontmatter, lineEnding, parsesTo } from '@/frontmatter';

export function nowLocal(): string {
    return dayjs().format('YYYY-MM-DD HH:mm:ssZ');
}

// Inserting one key preserves template comments and the author's formatting.
export function withCreatedAt(markdown: string, timestamp = nowLocal()): string {
    const eol = lineEnding(markdown);
    const line = `created_at: ${JSON.stringify(timestamp)}${eol}`;
    if (!/^---\r?\n/.test(markdown)) {
        return `---${eol}${line}---${eol}${eol}${markdown}`;
    }
    return editFrontmatter(markdown, (source) => {
        const before = YAML.parse(source) ?? {};
        if (typeof before !== 'object' || Array.isArray(before)) {
            throw new Error('The frontmatter must be a mapping.');
        }
        if (Object.hasOwn(before, 'created_at')) {
            return source;
        }
        const edited = line + source;
        if (!parsesTo(edited, { created_at: timestamp, ...before })) {
            throw new Error('Adding created_at would change other frontmatter.');
        }
        return edited;
    });
}
