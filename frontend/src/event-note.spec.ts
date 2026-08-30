import { describe, expect, it, vi } from 'vitest';
import Ajv from 'ajv';
import YAML from 'yaml';

import metadataSchema from '@/metadata-schema.json';

import type { ImportedOccurrence, ImportedSeries, MetadataEvent } from '@/api';
import {
    buildOccurrenceNote,
    buildSeriesNote,
    canConvertSeries,
} from '@/event-note';

vi.stubGlobal('crypto', {
    randomUUID: () => '01234567-89ab-4cde-8f01-23456789abcd',
});

const occurrence: ImportedOccurrence = {
    calendar: 'rust',
    uid: 'poms@google.com',
    recurrence_id: '2015-08-06 10:00:00-07:00',
    name: 'Rust release: 1.2 stable',
    start: '2015-08-06 10:00:00-07:00',
    end: '2015-08-06 11:00:00-07:00',
};

const series: ImportedSeries = {
    name: 'Rust release',
    start: '2015-06-25 10:00:00-07:00',
    end: '2015-06-25 11:00:00-07:00',
    repeat: {
        freq: 'weekly',
        interval: 6,
        byday: ['thu'],
        wkst: 'sun',
        tz: 'America/Los_Angeles',
    },
    exclusions: ['2020-01-30 10:00:00-08:00'],
    overrides: [{ at: '2015-08-06 10:00:00-07:00', name: 'Rust release: 1.2 stable' }],
    unmapped: { organizer: 'mailto:someone@example.com', transp: 'OPAQUE' },
};

interface Frontmatter {
    tags: string[];
    events: Record<string, MetadataEvent>;
}

function frontmatterOf(content: string): Frontmatter {
    const match = /^---\n([\s\S]*?)\n?---\n/.exec(content);
    expect(match).not.toBeNull();
    return YAML.parse(match![1]) as Frontmatter;
}

describe('buildSeriesNote', () => {
    it('writes the note under .events/ with a bare uuid, as .tasks/ does', () => {
        const note = buildSeriesNote(occurrence, series);
        expect(note.path).toBe('.events/01234567-89ab-4cde-8f01-23456789abcd.md');
    });

    it('copies the rule and its adjustments rather than referring to the feed', () => {
        const metadata = frontmatterOf(buildSeriesNote(occurrence, series).content);
        const event = metadata.events['Rust release'];

        expect(event.start).toBe('2015-06-25 10:00:00-07:00');
        expect(event.repeat).toEqual({
            freq: 'weekly',
            interval: 6,
            byday: ['thu'],
            wkst: 'sun',
            tz: 'America/Los_Angeles',
        });
        expect(event.exclusions).toEqual(['2020-01-30 10:00:00-08:00']);
        expect(event.overrides).toHaveLength(1);
    });

    // Without the uid the imported original would keep showing beside the note that replaced it.
    it('records the uid and no recurrence_id, so it claims the whole series', () => {
        const metadata = frontmatterOf(buildSeriesNote(occurrence, series).content);
        const event = metadata.events['Rust release'];

        expect(event.ical).toEqual({ calendar: 'rust', uid: 'poms@google.com' });
        expect(event.ical?.recurrence_id).toBeUndefined();
    });

    it('marks the note with the ical tag and titles it after the event', () => {
        const note = buildSeriesNote(occurrence, series);
        expect(frontmatterOf(note.content).tags).toEqual(['ical']);
        expect(note.content).toContain('\n# Rust release\n');
    });

    it('spills the properties mory has no key for into the body', () => {
        const content = buildSeriesNote(occurrence, series).content;
        expect(content).toContain('## Imported details');
        expect(content).toContain('- organizer: mailto:someone@example.com');
        expect(content).toContain('- transp: OPAQUE');
    });
});

describe('buildOccurrenceNote', () => {
    it('claims one occurrence, by uid and recurrence_id together', () => {
        const metadata = frontmatterOf(buildOccurrenceNote(occurrence, series).content);
        const event = metadata.events['Rust release: 1.2 stable'];

        expect(event.start).toBe('2015-08-06 10:00:00-07:00');
        expect(event.repeat).toBeUndefined();
        expect(event.ical).toEqual({
            calendar: 'rust',
            uid: 'poms@google.com',
            recurrence_id: '2015-08-06 10:00:00-07:00',
        });
    });

    it('says so in the note when the series could not be converted whole', () => {
        const unconvertible: ImportedSeries = { ...series, repeat: undefined };
        const content = buildOccurrenceNote(occurrence, unconvertible).content;

        expect(content).toContain('cannot express');
        expect(content).toContain('still read-only');
    });

    it('stays quiet when the series was convertible and the user chose one occurrence', () => {
        const content = buildOccurrenceNote(occurrence, series).content;
        expect(content).not.toContain('cannot express');
    });
});

describe('canConvertSeries', () => {
    it('is false when the feed rule has no equivalent in the dialect', () => {
        expect(canConvertSeries(series)).toBe(true);
        expect(canConvertSeries({ ...series, repeat: undefined })).toBe(false);
        expect(canConvertSeries(undefined)).toBe(false);
    });
});

describe('the emitted note', () => {
    // The note editor validates every note against this schema. A conversion that wrote something
    // it rejects would hand the user a file the app complains about the moment they open it.
    const validate = new Ajv().compile(metadataSchema);

    it('satisfies the metadata schema, for a series and for one occurrence', () => {
        for (const note of [
            buildSeriesNote(occurrence, series),
            buildOccurrenceNote(occurrence, series),
            buildOccurrenceNote(occurrence, { ...series, repeat: undefined }),
            buildSeriesNote(occurrence, { name: 'Bare', start: '2024-05-01 09:00:00+09:00' }),
        ]) {
            const metadata = frontmatterOf(note.content);
            expect(validate(metadata), JSON.stringify(validate.errors)).toBe(true);
        }
    });

    // Every datetime in it comes from the backend, which writes offsets like tasks do.
    it('keeps the offsets the backend supplied', () => {
        const content = buildSeriesNote(occurrence, series).content;
        expect(content).toContain('2015-06-25 10:00:00-07:00');
        expect(content).toContain('2020-01-30 10:00:00-08:00');
    });

    it('parses back as the metadata schema describes', () => {
        const metadata = frontmatterOf(buildSeriesNote(occurrence, series).content);
        expect(Object.keys(metadata)).toEqual(['tags', 'events']);
        expect(Object.keys(metadata.events)).toEqual(['Rust release']);
    });
});
