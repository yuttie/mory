import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

import { editFrontmatter, hasKey, indentBlock, parsesTo, sameValue, stringifyWithFlowAlarms } from '@/frontmatter';

describe('editFrontmatter', () => {
    it('hands over the text between the fences and keeps the rest', () => {
        const note = '---\na: 1\n---\n\n# Title\n\n---\nnot frontmatter\n';
        expect(editFrontmatter(note, (yaml) => {
            expect(yaml).toBe('a: 1\n');
            return 'a: 2\n';
        })).toBe(note.replace('a: 1', 'a: 2'));
    });

    it('takes a closing fence with trailing space, and CRLF line endings', () => {
        expect(editFrontmatter('---\r\na: 1\r\n---  \r\nBody\r\n', () => 'b: 2\r\n'))
            .toBe('---\r\nb: 2\r\n---  \r\nBody\r\n');
    });

    it('refuses a note without frontmatter, or with frontmatter never closed', () => {
        expect(() => editFrontmatter('# Title\n', (yaml) => yaml)).toThrow('no frontmatter');
        expect(() => editFrontmatter('---\na: 1\n', (yaml) => yaml)).toThrow('never closed');
    });
});

describe('hasKey', () => {
    it('matches a mapping entry by its key', () => {
        const map = YAML.parseDocument('task: 1\n"status": 2\n').contents;
        if (!YAML.isMap(map)) {
            throw new Error('Not a mapping.');
        }
        expect(map.items.map((pair) => [hasKey(pair, 'task'), hasKey(pair, 'status')])).toEqual([[true, false], [false, true]]);
    });
});

describe('indentBlock', () => {
    it('indents each line but leaves blank ones blank, without the final line break', () => {
        expect(indentBlock('a:\n\n  b\n', 4, '\r\n')).toBe('    a:\r\n\r\n      b');
    });
});

describe('parsesTo and sameValue', () => {
    it('compares what YAML means, not how it is written', () => {
        expect(parsesTo('b: [1, 2]\na: {c: x}\n', { a: { c: 'x' }, b: [1, 2] })).toBe(true);
        expect(parsesTo('b: [2, 1]\n', { b: [1, 2] })).toBe(false);
        expect(parsesTo('a: [\n', { a: [] })).toBe(false);
        expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    });
});

describe('stringifyWithFlowAlarms', () => {
    it('writes a list under alarms on the line that names it, and nothing else that way', () => {
        expect(stringifyWithFlowAlarms({
            tags: ['a', 'b'],
            task: { alarms: { due_by: ['09:00'], deadline: [] }, scheduled_dates: ['2026-09-28'] },
            alarms: { timed: ['-10m', '0m'] },
            categories: { meeting: { alarms: ['-1h'] } },
        }, { indent: 4 })).toBe(`tags:
    - a
    - b
task:
    alarms:
        due_by: [09:00]
        deadline: []
    scheduled_dates:
        - 2026-09-28
alarms:
    timed: [-10m, 0m]
categories:
    meeting:
        alarms: [-1h]
`);
    });
});
