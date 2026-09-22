import { describe, expect, it } from 'vitest';

import { parseEventColor } from '@/event-color';

const hex = (value: unknown) => parseEventColor(value)?.hex() ?? null;

describe('parseEventColor', () => {
    // `Color` alone throws on these, and the settings used to refuse them for it.
    it('reads a hyphenated palette name as its base colour', () => {
        expect(hex('light-green')).toBe('#8BC34A');
        expect(hex('deep-purple')).toBe('#673AB7');
        expect(hex('blue-grey')).toBe('#607D8B');
    });

    it('prefers the palette to CSS for a name both know', () => {
        expect(hex('blue')).toBe('#2196F3');
    });

    it('reads anything else Color can', () => {
        expect(hex('#1565c0')).toBe('#1565C0');
        expect(hex('lightgreen')).toBe('#90EE90');
        expect(hex('rgb(255, 0, 0)')).toBe('#FF0000');
    });

    it('names no colour for text it cannot read, or for no text at all', () => {
        expect(parseEventColor('light-greeen')).toBeNull();
        expect(parseEventColor('light-green-lighten-2')).toBeNull();
        // A palette entry with no base of its own.
        expect(parseEventColor('shades')).toBeNull();
        expect(parseEventColor(12)).toBeNull();
        expect(parseEventColor(undefined)).toBeNull();
    });
});
