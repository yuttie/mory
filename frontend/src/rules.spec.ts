import { describe, expect, it } from 'vitest';

import { isDateTime, optionalDateTime, range, required } from '@/rules';

describe('required', () => {
    it('refuses nothing and blanks, with the message given', () => {
        for (const blank of [null, undefined, '', '   ']) {
            expect(required('Needed.')(blank)).toBe('Needed.');
        }
        expect(required('Needed.')('x')).toBe(true);
        expect(required('Needed.')(0)).toBe(true);
    });
});

describe('isDateTime and optionalDateTime', () => {
    it('accepts what can be read as a date, and an optional one left empty', () => {
        expect(isDateTime('Bad.')('2026-09-27 10:00:00+09:00')).toBe(true);
        expect(isDateTime('Bad.')('not a date')).toBe('Bad.');
        expect(optionalDateTime('')).toBe(true);
        expect(optionalDateTime('2026-09-27')).toBe(true);
        expect(optionalDateTime('not a date')).toBe('Invalid format.');
    });
});

describe('range', () => {
    it('accepts a number within the bounds, inclusive', () => {
        expect(range(1, 5, 'Out.')(1)).toBe(true);
        expect(range(1, 5, 'Out.')(5)).toBe(true);
        expect(range(1, 5, 'Out.')(6)).toBe('Out.');
        expect(range(1, 5, 'Out.')('3')).toBe('Out.');
    });
});
