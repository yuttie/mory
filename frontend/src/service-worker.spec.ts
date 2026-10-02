// The words the worker puts under an alarm's title. They are said in the reader's locale and zone,
// so what is expected here is what `Intl` says of the same moment, as `e2e/event-alarms.spec.ts`
// does in a browser; this holds the edges of it that a browser test would take a week to reach.

import { afterAll, describe, expect, it, vi } from 'vitest';

import source from '../public/service-worker.js?raw';

interface Alarm {
    title?: string;
    body?: unknown;
    start?: unknown;
    all_day?: boolean;
}

const worker = (() => {
    // A classic script, which declares its functions at the top level for the e2e tests to call:
    // run it as a function of the `self` it expects, and take them out.
    const self = {
        location: { href: 'https://app.invalid/service-worker.js?api=https://api.invalid/api/' },
        addEventListener: () => undefined,
    };
    return new Function('self', `${source}\nreturn { whenIs, bodyOf };`)(self) as {
        whenIs: (alarm: Alarm, now: Date) => string | undefined;
        bodyOf: (alarm: Alarm, now: Date) => string;
    };
})();

// West of Greenwich, where a day read as UTC midnight is the day before: the zone a mistake about
// whole days shows in. Not the one anybody here works in, so that it is the test's doing. Set before
// the tests are collected, since they build their dates as they are declared.
vi.stubEnv('TZ', 'America/Los_Angeles');
afterAll(() => {
    vi.unstubAllEnvs();
});

it('runs in the zone it asks for', () => {
    expect(new Date(2026, 9, 14, 12).getTimezoneOffset()).toBe(7 * 60);
});

const say = (date: Date, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(undefined, options).format(date);
const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
const DATE: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };

// Local times, so that what is a different day is the same in whatever zone this runs in.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);
const starting = (start: Date): Alarm => ({ title: 'x', start: start.toISOString() });

describe('whenIs', () => {
    const now = at(14, 12);

    it('says nothing for a payload with no start, or one that is not a time', () => {
        expect(worker.whenIs({ title: 'x' }, now)).toBeUndefined();
        expect(worker.whenIs({ title: 'x', start: 5 }, now)).toBeUndefined();
        expect(worker.whenIs({ title: 'x', start: 'soon' }, now)).toBeUndefined();
        expect(worker.whenIs({ title: 'x', start: 'not-a-day', all_day: true }, now)).toBeUndefined();
    });

    it('says the time alone for an event today', () => {
        expect(worker.whenIs(starting(at(14, 15, 30)), now)).toBe(say(at(14, 15, 30), TIME));
        expect(worker.whenIs(starting(at(14, 9)), now)).toBe(say(at(14, 9), TIME));
    });

    it('means today as the calendar day, not as the next twenty-four hours', () => {
        // Two minutes ahead, but tomorrow: a weekday says which day it is.
        const late = at(14, 23, 59);
        expect(worker.whenIs(starting(at(15, 0, 1)), late))
            .toBe(say(at(15, 0, 1), { weekday: 'short', ...TIME }));
        // Twenty-three hours ahead, but today.
        const early = at(14, 0, 1);
        expect(worker.whenIs(starting(at(14, 23, 59)), early)).toBe(say(at(14, 23, 59), TIME));
    });

    it('says a weekday and the time within the week, and the date as well beyond it', () => {
        expect(worker.whenIs(starting(at(17, 9)), now)).toBe(say(at(17, 9), { weekday: 'short', ...TIME }));
        expect(worker.whenIs(starting(at(30, 9)), now)).toBe(say(at(30, 9), { ...DATE, ...TIME }));
    });

    it('stops saying only a weekday at six days, where it would name two days at once', () => {
        const start = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
        const before = new Date(start.getTime() - 1);
        expect(worker.whenIs(starting(before), now)).toBe(say(before, { weekday: 'short', ...TIME }));
        expect(worker.whenIs(starting(start), now)).toBe(say(start, { ...DATE, ...TIME }));
        // And an event just as far behind it, as one that was missed and is still being told of.
        const behind = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
        expect(worker.whenIs(starting(behind), now)).toBe(say(behind, { ...DATE, ...TIME }));
    });

    it('says the date alone for a whole day, as it is written, whatever the zone', () => {
        expect(worker.whenIs({ title: 'x', start: '2026-10-20', all_day: true }, now))
            .toBe(say(new Date(2026, 9, 20), DATE));
        // The day it names, and not the one before, which parsing it as UTC midnight would give west
        // of Greenwich.
        expect(worker.whenIs({ title: 'x', start: '2026-01-01', all_day: true }, now))
            .toBe(say(new Date(2026, 0, 1), DATE));
    });
});

describe('bodyOf', () => {
    const now = at(14, 12);

    it('puts when the event is before what moried added, separated by a dot', () => {
        expect(worker.bodyOf({ ...starting(at(14, 15)), body: 'Room 2' }, now))
            .toBe(`${say(at(14, 15), TIME)} · Room 2`);
    });

    it('says whichever there is, and nothing when there is neither', () => {
        expect(worker.bodyOf({ title: 'x', body: 'Room 2' }, now)).toBe('Room 2');
        expect(worker.bodyOf(starting(at(14, 15)), now)).toBe(say(at(14, 15), TIME));
        expect(worker.bodyOf({ title: 'x' }, now)).toBe('');
    });

    it('leaves out an empty part and anything that is not text', () => {
        expect(worker.bodyOf({ title: 'x', body: '' }, now)).toBe('');
        for (const body of [null, 5, true, {}, ['a']]) {
            expect(worker.bodyOf({ title: 'x', body }, now), JSON.stringify(body)).toBe('');
        }
    });
});
