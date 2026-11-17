import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

import {
    calendarConfigurationText,
    calendarSubscriptionOf,
    heldAfterSave,
    parseCalendarConfiguration,
    readCalendarConfiguration,
    writeCalendarConfiguration,
} from '@/calendar-configuration';

describe('readCalendarConfiguration', () => {
    it('refuses a file that is not a mapping, and reads an empty one as nothing', () => {
        expect(() => readCalendarConfiguration(['calendars'])).toThrow('not a mapping');
        expect(() => readCalendarConfiguration('calendars')).toThrow('not a mapping');
        expect(readCalendarConfiguration(null).unread).toEqual([]);
    });

    it('keeps only a subscription as written, and drops the rest it does not read', () => {
        const read = readCalendarConfiguration(YAML.parse(`calendars:
    - id: paused
      url: https://example.invalid/paused.ics
      enabled: off
    - id: work
      url: https://example.invalid/work.ics
      description: 5
`));
        expect(read.unread.map(({ at, kept }) => [at, kept])).toEqual([
            ['calendars[0]', true],
            ['calendars[1].description', false],
        ]);
    });
});

describe('calendarSubscriptionOf', () => {
    it('takes only true and false for enabled', () => {
        const entry = (enabled: unknown) => ({ id: 'work', url: 'https://example.invalid/work.ics', enabled });
        expect(calendarSubscriptionOf(entry(false))).toMatchObject({ enabled: false });
        expect(calendarSubscriptionOf(entry(true))).toMatchObject({ enabled: true });
        expect(calendarSubscriptionOf({ id: 'work', url: 'https://example.invalid/work.ics' }))
            .toMatchObject({ enabled: true });
        for (const value of ['off', 'yes', 1, null]) {
            expect(calendarSubscriptionOf(entry(value))).toBe('work: has an enabled that is not true or false');
        }
    });
});

describe('writeCalendarConfiguration', () => {
    const subscription = (id: string) => ({ id, name: id, url: `https://example.invalid/${id}.ics`, enabled: true });
    const base = { taskDateColors: {}, alarmDefaults: {}, categories: [] };

    it('puts each subscription it kept back after those that stood before it', () => {
        const document = writeCalendarConfiguration({
            ...base,
            subscriptions: [subscription('a'), subscription('b')],
            held: [{ after: 0, entry: 'first' }, { after: 0, entry: 'second' }, { after: 1, entry: 'middle' }],
        });
        expect((document.calendars as unknown[]).map((entry) => (typeof entry === 'string' ? entry : (entry as { id: string }).id)))
            .toEqual(['first', 'second', 'a', 'middle', 'b']);
    });

    it('puts them at the end once fewer subscriptions are left', () => {
        const document = writeCalendarConfiguration({ ...base, subscriptions: [], held: [{ after: 2, entry: 'late' }] });
        expect(document.calendars).toEqual(['late']);
    });
});

// moried's YAML reader takes these otherwise than YAML 1.2's core schema does, and a subscription has
// to be one to both components or to neither.
describe('parseCalendarConfiguration', () => {
    it('reads a plain scalar as moried does', () => {
        expect(parseCalendarConfiguration('a: 017\nb: 0b101\nc: -0x1F\nd: +0o7\ne: 1e400\nf: 0x1F\ng: "0b101"\n'))
            .toEqual({ a: '017', b: 5, c: -31, d: 7, e: '1e400', f: 31, g: '0b101' });
    });
});

describe('calendarConfigurationText', () => {
    it('quotes the text moried would read as a number, and only that', () => {
        const document = {
            calendars: [{ id: '017', name: '0b101', url: 'https://example.invalid/a.ics', enabled: true }],
        };
        const text = calendarConfigurationText(document);
        expect(text).toContain('    - id: 017\n');
        expect(text).toContain('      name: "0b101"\n');
        expect(parseCalendarConfiguration(text)).toEqual(document);
    });
});

describe('heldAfterSave', () => {
    const [a, b] = [{ id: 'a' }, { id: 'b' }];
    const held = [{ after: 1, entry: 'held' }];

    it('moves an entry up past a subscription removed before it, and only that', () => {
        expect(heldAfterSave(held, [a, b], [b])).toEqual([{ after: 0, entry: 'held' }]);
        expect(heldAfterSave(held, [a, b], [a])).toEqual(held);
    });

    it('leaves each where it stood when one is changed or added', () => {
        expect(heldAfterSave(held, [a, b], [{ ...a, name: 'A' }, b])).toEqual(held);
        expect(heldAfterSave(held, [a, b], [a, b, { id: 'c' }])).toEqual(held);
    });
});
