import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';

import { FILE_TABS, fileQueryMatcher, parseFileQuery, tabShowsTags } from '@/composables/fileRows';
import type { FileRow } from '@/composables/fileRows';

// A note as the All tab lists it, by its title, unless the test says otherwise.
function row(fields: Partial<FileRow> = {}): FileRow {
    return {
        key: 'ideas/draft.md',
        path: 'ideas/draft.md',
        size: 0,
        mimeType: 'text/markdown',
        tags: [],
        title: 'Draft chapter',
        time: dayjs('2026-10-21T09:00:00+00:00'),
        icon: '',
        iconColor: null,
        to: '/note/ideas/draft.md',
        ...fields,
    };
}

function matches(text: string, file: FileRow, searchesTags = true): boolean {
    return fileQueryMatcher(parseFileQuery(text), searchesTags)(file);
}

describe('parseFileQuery', () => {
    it('reads a word by the mark it starts with: a tag, a path, or any word shown', () => {
        expect(parseFileQuery('#thesis /ideas draft')).toEqual({
            tags: new Set(['thesis']),
            paths: new Set(['ideas']),
            any: new Set(['draft']),
        });
    });

    it('keeps the words in quotes together, marks and all', () => {
        expect(parseFileQuery('"draft chapter" "#reading list" "/my notes"')).toEqual({
            tags: new Set(['reading list']),
            paths: new Set(['my notes']),
            any: new Set(['draft chapter']),
        });
    });

    it('splits at any run of white space, and asks for each word once', () => {
        expect(parseFileQuery('  draft\tdraft\n#a #a  ')).toEqual({
            tags: new Set(['a']),
            paths: new Set(),
            any: new Set(['draft']),
        });
    });

    it('asks for nothing when given no word', () => {
        expect(parseFileQuery('')).toEqual({ tags: new Set(), paths: new Set(), any: new Set() });
        expect(parseFileQuery('   ')).toEqual({ tags: new Set(), paths: new Set(), any: new Set() });
    });
});

describe('fileQueryMatcher', () => {
    it('lists every file for no word', () => {
        expect(matches('', row())).toBe(true);
    });

    it('finds a word within what the row shows, case aside', () => {
        expect(matches('draft', row())).toBe(true);
        expect(matches('APT', row())).toBe(true);
        expect(matches('Monday', row())).toBe(false);
        expect(matches('draft', row({ title: 'DRAFT CHAPTER' }))).toBe(true);
    });

    it('finds the words beside the title too: the project, folder, note, purpose and repetition', () => {
        expect(matches('thesis', row({ caption: 'Thesis › Chapters' }))).toBe(true);
        expect(matches('ideas', row({ folder: 'ideas' }))).toBe(true);
        expect(matches('lecture', row({ note: 'Lecture notes' }))).toBe(true);
        expect(matches('plans', row({ purpose: 'Day plans for October 2026' }))).toBe(true);
        expect(matches('weekly', row({ repeats: 'Weekly on Mon' }))).toBe(true);
    });

    it('lists only the files that show every word', () => {
        expect(matches('draft chapter', row())).toBe(true);
        expect(matches('draft monday', row())).toBe(false);
        expect(matches('"draft chapter"', row())).toBe(true);
        expect(matches('"chapter draft"', row())).toBe(false);
    });

    // A path the row does not show would list a note for words that are nowhere on it.
    it('finds a plain word in the path only where the row shows the path for its title', () => {
        expect(matches('ideas', row())).toBe(false);
        expect(matches('ideas', row({ title: null }))).toBe(true);
    });

    it('finds a path asked for by name whether or not the row shows it, case aside', () => {
        expect(matches('/ideas/', row())).toBe(true);
        expect(matches('/IDEAS/DRAFT', row({ title: null }))).toBe(true);
        expect(matches('/journal', row())).toBe(false);
    });

    it('finds a tag by any part of it, case aside', () => {
        const tagged = row({ tags: ['Thesis', 'reading list'] });
        expect(matches('#thesis', tagged)).toBe(true);
        expect(matches('#THE', tagged)).toBe(true);
        expect(matches('#sis', tagged)).toBe(true);
        expect(matches('"#reading list"', tagged)).toBe(true);
        expect(matches('#journal', tagged)).toBe(false);
        expect(matches('#thesis', row())).toBe(false);
    });

    it('finds a plain word among the tags too', () => {
        expect(matches('thesis', row({ tags: ['thesis'] }))).toBe(true);
    });

    // An event's tags are its note's, and a tab that shows none finds no file by them.
    it('finds nothing by the tags on a tab that does not show them', () => {
        const tagged = row({ tags: ['thesis'] });
        expect(matches('#thesis', tagged, false)).toBe(false);
        expect(matches('thesis', tagged, false)).toBe(false);
        expect(matches('draft', tagged, false)).toBe(true);
    });
});

describe('tabShowsTags', () => {
    it('shows tags on the tabs of notes and tasks, and on the one of every file', () => {
        const showing = FILE_TABS.filter((each) => tabShowsTags(each.kind)).map((each) => each.value);
        expect(showing).toEqual(['all', 'notes', 'tasks']);
    });
});
