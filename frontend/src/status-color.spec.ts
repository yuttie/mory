import { describe, expect, it } from 'vitest';

import { STATUS_KINDS } from '@/task';
import { readStatusColors, resolveStatusColors, statusColor, statusGround } from '@/status-color';

describe('statusColor', () => {
    it('gives the palette colours the task tree has always drawn', () => {
        expect(STATUS_KINDS.map((kind) => statusColor(kind))).toEqual([
            '#90a4ae', // blue-grey-lighten-2
            '#607d8b', // blue-grey
            '#2196f3', // blue
            '#ff9800', // orange
            '#f44336', // red
            '#9c27b0', // purple
            '#4caf50', // green
            '#9e9e9e', // grey
        ]);
    });

    it('gives a configured colour over the default, and the default for the rest', () => {
        expect(statusColor('done', { done: 'rgb(1, 2, 3)' })).toBe('rgb(1, 2, 3)');
        expect(statusColor('todo', { done: 'rgb(1, 2, 3)' })).toBe('#607d8b');
    });

    it('gives nothing for what is not a status', () => {
        for (const kind of [undefined, null, 3, '', 'started', 'toString', '__proto__']) {
            expect(statusColor(kind, { done: 'rgb(1, 2, 3)' })).toBeUndefined();
        }
    });
});

describe('statusGround', () => {
    it('mixes the status colour faintly into the theme surface', () => {
        expect(statusGround('done')).toBe('color-mix(in srgb, #4caf50 12%, rgb(var(--v-theme-surface)))');
        expect(statusGround('done', { done: 'rgb(1, 2, 3)' })).toBe('color-mix(in srgb, rgb(1, 2, 3) 12%, rgb(var(--v-theme-surface)))');
    });

    it('gives no ground for what is not a status', () => {
        expect(statusGround('toString')).toBeUndefined();
    });
});

describe('readStatusColors', () => {
    it('reads colours as written, palette names and CSS alike', () => {
        expect(readStatusColors({ default_lead_time: '7d', status_colors: { done: ' light-green ', blocked: '#ff0000' } }))
            .toEqual({ colors: { done: 'light-green', blocked: '#ff0000' }, problems: [] });
    });

    it('takes an empty colour for the default, as the calendar settings do', () => {
        expect(readStatusColors({ status_colors: { done: '', todo: null } })).toEqual({ colors: {}, problems: [] });
    });

    it('drops what it cannot use and says why', () => {
        expect(readStatusColors({ status_colors: { started: 'red', done: 'not a colour', todo: 3, toString: 'red' } })).toEqual({
            colors: {},
            problems: [
                'Unknown status started in status_colors.',
                'Invalid colour for status done.',
                'Invalid colour for status todo.',
                'Unknown status toString in status_colors.',
            ],
        });
        expect(readStatusColors({ status_colors: ['red'] })).toEqual({ colors: {}, problems: ['status_colors must be a mapping.'] });
    });

    it('leaves a file it cannot read to readTaskSettings to report', () => {
        for (const value of [null, undefined, 'text', ['list'], { tasks: {}, status_colors: { done: 'red' } }, {}]) {
            expect(readStatusColors(value)).toEqual({ colors: {}, problems: [] });
        }
    });
});

describe('resolveStatusColors', () => {
    it('resolves palette names to the palette, not to CSS', () => {
        expect(resolveStatusColors({ done: 'green', todo: '#123456' })).toEqual({ done: 'rgb(76, 175, 80)', todo: 'rgb(18, 52, 86)' });
    });
});

