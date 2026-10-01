// The schema is compiled at runtime by `views/Note.vue` with a bare `new Ajv()`, which is
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

    it('accepts a category by its id, and only as text', () => {
        const at = (category: unknown) => ({ events: { A: { start: '2024-05-01 09:00', category } } });
        expect(ok(at('meeting'))).toBe(true);
        expect(ok(at('meeting/1on1'))).toBe(true);
        expect(ok(at(['meeting']))).toBe(false);
    });
});

describe('metadata schema, alarms', () => {
    const at = (alarms: unknown) => ({ events: { A: { start: '2024-05-01 09:00', alarms } } });

    // What `alarms.rs` and `alarms.ts` read, as far as a pattern can say it: the schema is only the
    // editor's first look, and the parser is what reports the rest.
    const valid = [
        '-10m', '+1h', '-2 days', '-1w', '0m', '0d', '-1.5h', '-90 minutes', '-30s', '+0.5s',
        '09:00', '23:59', '00:00', '-1d 18:00', '+1 day 08:30', '-2 weeks 00:00', '0d 09:00',
    ];
    const invalid = [
        '', 'soon', '0', '10m', '1d 09:00', '- 10m', '--10m', '-10', '-10x', '-10M', '-10 Minutes', '-1.5d',
        '-1.0d', '-0.5w', '9:00', '09:0', '24:00', '09:60', '09:00:00', '-1d09:00', '-1h 09:00',
        '-1d 25:00', '1.5d 09:00',
    ];

    it('accepts offsets and times of day, one alone or in a list', () => {
        for (const alarm of valid) {
            expect(ok(at(alarm)), alarm).toBe(true);
            expect(ok(at([alarm, '-5m'])), alarm).toBe(true);
        }
    });

    it('accepts a list that is empty, and a value left empty', () => {
        expect(ok(at([]))).toBe(true);
        expect(ok(at(null))).toBe(true);
    });

    it('rejects an alarm that is not one, and anything that is not text', () => {
        for (const alarm of invalid) {
            expect(ok(at(alarm)), JSON.stringify(alarm)).toBe(false);
            expect(ok(at(['-5m', alarm])), JSON.stringify(alarm)).toBe(false);
        }
        for (const alarms of [5, true, {}, [5], [null], [['-5m']], { at: '-5m' }]) {
            expect(ok(at(alarms)), JSON.stringify(alarms)).toBe(false);
        }
    });

    it('accepts alarms on an override and an instance as on the event', () => {
        expect(ok({
            events: {
                A: {
                    start: '2024-05-01 09:00',
                    repeat: { freq: 'weekly' },
                    alarms: ['-10m'],
                    overrides: [{ at: '2024-05-08 09:00', alarms: [] }],
                    instances: [{ start: '2024-05-09 09:00', alarms: '-1h' }],
                },
            },
        })).toBe(true);
        expect(ok({
            events: { A: { instances: [{ start: '2024-05-09 09:00', alarms: ['soon'] }] } },
        })).toBe(false);
    });
});

describe('metadata schema, tasks', () => {
    const task = (status: unknown) => ({
        task: { status, progress: 0, importance: 3, urgency: 3, scheduled_dates: [] },
    });

    it('accepts a backlog status carrying only its kind', () => {
        expect(ok(task({ kind: 'backlog' }))).toBe(true);
        // Like To do, it has nothing to say, so a key left over from another status is an error.
        expect(ok(task({ kind: 'backlog', hold_reason: 'later' }))).toBe(false);
    });

    it('rejects a status kind it does not know', () => {
        expect(ok(task({ kind: 'someday' }))).toBe(false);
    });
});

describe('metadata schema, task alarms', () => {
    const task = (alarms: unknown) => ({
        task: {
            status: { kind: 'todo' },
            progress: 0,
            importance: 3,
            urgency: 3,
            scheduled_dates: [],
            due_by: '2024-05-10',
            alarms,
        },
    });

    it('accepts alarms for each of the two dates', () => {
        expect(ok(task({ due_by: ['09:00'], deadline: ['-1d 18:00', '-2h'] }))).toBe(true);
        expect(ok(task({ deadline: '-1h' }))).toBe(true);
        expect(ok(task({ due_by: [], deadline: null }))).toBe(true);
        expect(ok(task({}))).toBe(true);
        expect(ok(task(null))).toBe(true);
    });

    it('rejects an alarm that is not one, a date a task does not have, and a list for both', () => {
        expect(ok(task({ due_by: ['10m'] }))).toBe(false);
        expect(ok(task({ start_at: ['-1h'] }))).toBe(false);
        expect(ok(task(['-1h']))).toBe(false);
        expect(ok(task('-1h'))).toBe(false);
    });
});
