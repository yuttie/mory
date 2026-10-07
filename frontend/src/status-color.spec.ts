import { describe, expect, it } from 'vitest';

import { STATUS_KINDS } from '@/task';
import { readStatusColors, resolveStatusColors, statusColor, statusGround, writeStatusColors } from '@/status-color';

describe('statusColor', () => {
    it('gives each status its default colour from the palette', () => {
        expect(STATUS_KINDS.map((kind) => statusColor(kind))).toEqual([
            '#cfd8dc', // blue-grey-lighten-4
            '#607d8b', // blue-grey
            '#2196f3', // blue
            '#ffc107', // amber
            '#e91e63', // pink
            '#3f51b5', // indigo
            '#4caf50', // green
            '#000000', // black
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

describe('writeStatusColors', () => {
    it('adds the block at the end, leaving the rest of the file as it was', () => {
        const source = '# Lead times\ndefault_lead_time: 7d   # a week\nlead_time_by_tag:\n  work: 2w\n';
        expect(writeStatusColors(source, { todo: 'blue', done: '#00ff00' }))
            .toBe(source + "status_colors:\n  todo: blue\n  done: \"#00ff00\"\n");
    });

    it('writes the statuses in the order they are listed', () => {
        expect(writeStatusColors('', { canceled: 'grey', backlog: 'blue' })).toBe('status_colors:\n    backlog: blue\n    canceled: grey\n');
    });

    it('replaces the block where it was, in whatever style it was written', () => {
        const block = 'default_lead_time: 7d\nstatus_colors:\n    done: green # mine\n    todo: blue\n# Tags\nlead_time_by_tag:\n    work: 2w\n';
        expect(writeStatusColors(block, { done: 'red' }))
            .toBe('default_lead_time: 7d\nstatus_colors:\n    done: red\n# Tags\nlead_time_by_tag:\n    work: 2w\n');
        expect(writeStatusColors('status_colors: {done: green}\ndefault_lead_time: 7d\n', { done: 'red' }))
            .toBe('status_colors:\n    done: red\ndefault_lead_time: 7d\n');
        expect(writeStatusColors('status_colors:\ndefault_lead_time: 7d\n', { done: 'red' }))
            .toBe('status_colors:\n    done: red\ndefault_lead_time: 7d\n');
    });

    it('removes the block when every status takes its default', () => {
        expect(writeStatusColors('a: 1\nstatus_colors:\n  done: green\nb: 2\n', {})).toBe('a: 1\nb: 2\n');
        expect(writeStatusColors('a: 1\nstatus_colors: {done: green}\n', {})).toBe('a: 1\n');
        expect(writeStatusColors('a: 1\n', {})).toBe('a: 1\n');
    });

    it('leaves a file of nothing but the block empty when every status takes its default', () => {
        expect(writeStatusColors('status_colors:\n    done: red\n', {})).toBe('');
        expect(writeStatusColors('# Colours\nstatus_colors:\n    done: red\n', {})).toBe('# Colours\n');
    });

    it('keeps the line endings the file has', () => {
        expect(writeStatusColors('a: 1\r\n', { done: 'red' })).toBe('a: 1\r\nstatus_colors:\r\n    done: red\r\n');
    });

    it('refuses a file it cannot edit, writing nothing', () => {
        expect(() => writeStatusColors('a: [1\n', { done: 'red' })).toThrow('not valid YAML');
        expect(() => writeStatusColors('- a\n', { done: 'red' })).toThrow('block mapping');
        expect(() => writeStatusColors('{a: 1}\n', { done: 'red' })).toThrow('block mapping');
        expect(() => writeStatusColors('tasks:\n  backlog: []\n', { done: 'red' })).toThrow('legacy task data');
    });
});
