// The schema is compiled at runtime by `EditableViewer.vue` with a bare `new Ajv()`, which is
// draft-07 with strict mode on. Strict mode *throws at compile time* on an unknown keyword, so a
// keyword from a later draft would break the note editor's validation wholesale rather than just
// misjudging one note. Compiling it here is the guard against that.

import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';

import metadataSchema from '@/metadata-schema.json';

const ajv = new Ajv();
const validate = ajv.compile(metadataSchema);

const ok = (metadata: unknown) => validate(metadata) === true;

describe('metadata schema, events', () => {
    it('compiles under the same Ajv configuration the editor uses', () => {
        expect(typeof validate).toBe('function');
    });

    it('accepts the shapes that existed before recurrence', () => {
        expect(ok({ events: { A: { start: '2024-05-01 09:00' } } })).toBe(true);
        expect(ok({ events: { A: { start: '2024-05-01 09:00', end: '+1h' } } })).toBe(true);
        expect(ok({ events: { A: { times: [{ start: '2024-05-01 09:00' }] } } })).toBe(true);
        expect(ok({ events: null })).toBe(true);
        expect(ok({})).toBe(true);
    });

    it('accepts a rule with its adjustments', () => {
        expect(ok({
            events: {
                'Rust release': {
                    start: '2015-06-25 10:00:00-07:00',
                    end: '+1h',
                    repeat: {
                        freq: 'weekly',
                        interval: 6,
                        byday: ['thu'],
                        wkst: 'sun',
                        tz: 'America/Los_Angeles',
                        until: '2021-01-01',
                    },
                    exclusions: ['2020-01-30 10:00:00-08:00'],
                    overrides: [{ at: '2015-08-06 10:00:00-07:00', name: 'Rust release: 1.2' }],
                    instances: [{ start: '2016-01-14 09:00:00-08:00', end: '+2h' }],
                    ical: { calendar: 'rust', uid: 'poms@google.com' },
                },
            },
        })).toBe(true);
    });

    it('accepts both readings of "every 3rd Wednesday"', () => {
        const base = { start: '2024-05-01 09:00' };
        expect(ok({ events: { A: { ...base, repeat: { freq: 'monthly', byday: ['3wed'] } } } }))
            .toBe(true);
        expect(ok({
            events: { A: { ...base, repeat: { freq: 'weekly', interval: 3, byday: ['wed'] } } },
        })).toBe(true);
        expect(ok({ events: { A: { ...base, repeat: { freq: 'monthly', byday: ['-1fri'] } } } }))
            .toBe(true);
    });

    // The old `oneOf` could not say this: an instances-only event matched neither branch.
    it('accepts an event that is only a list of occurrences', () => {
        expect(ok({ events: { A: { instances: [{ start: '2024-05-01 09:00' }] } } })).toBe(true);
    });

    // ...and teaching the multiple branch about `instances` made this match *both* branches.
    it('accepts a start and a list of occurrences together', () => {
        expect(ok({
            events: {
                A: {
                    start: '2024-05-01 09:00',
                    repeat: { freq: 'weekly' },
                    instances: [{ start: '2024-06-01 09:00' }],
                },
            },
        })).toBe(true);
    });

    it('rejects an event that names no occurrence at all', () => {
        expect(ok({ events: { A: { color: 'red' } } })).toBe(false);
    });

    it('requires a rule to have a start to count from', () => {
        expect(ok({ events: { A: { instances: [{ start: '2024-05-01 09:00' }],
                                   repeat: { freq: 'weekly' } } } })).toBe(false);
    });

    it('requires adjustments to have a rule to adjust', () => {
        const base = { start: '2024-05-01 09:00' };
        expect(ok({ events: { A: { ...base, exclusions: ['2024-05-08 09:00'] } } })).toBe(false);
        expect(ok({ events: { A: { ...base, overrides: [{ at: '2024-05-08 09:00' }] } } }))
            .toBe(false);
    });

    it('rejects until and count together', () => {
        expect(ok({
            events: { A: { start: '2024-05-01 09:00',
                           repeat: { freq: 'weekly', until: '2025-01-01', count: 5 } } },
        })).toBe(false);
    });

    it('rejects a misspelled rule key, a bad frequency and a bad weekday', () => {
        const at = (repeat: unknown) => ({ events: { A: { start: '2024-05-01 09:00', repeat } } });
        expect(ok(at({ freq: 'weekly', frequency: 'weekly' }))).toBe(false);
        expect(ok(at({ freq: 'fortnightly' }))).toBe(false);
        expect(ok(at({ freq: 'weekly', byday: ['we'] }))).toBe(false);
        expect(ok(at({ freq: 'weekly', interval: 0 }))).toBe(false);
    });

    it('requires an override to say which occurrence it changes', () => {
        expect(ok({
            events: { A: { start: '2024-05-01 09:00', repeat: { freq: 'weekly' },
                           overrides: [{ name: 'no at' }] } },
        })).toBe(false);
    });

    it('requires an imported event to carry the uid it is shadowed by', () => {
        expect(ok({
            events: { A: { start: '2024-05-01 09:00', ical: { calendar: 'work' } } },
        })).toBe(false);
    });
});
