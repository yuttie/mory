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
    it('adds a block after the other settings, leaving them as they were', () => {
        const source = '# Lead times\ndefault_lead_time: 7d   # a week\nlead_time_by_tag:\n  work: 2w\n';
        expect(writeStatusColors(source, { done: '#00ff00', todo: 'blue' }))
            .toBe(source + 'status_colors:\n  todo: blue\n  done: "#00ff00"\n');
        expect(writeStatusColors('', { canceled: 'grey', backlog: 'blue' })).toBe('status_colors:\n    backlog: blue\n    canceled: grey\n');
    });

    it('adds the block before what follows the settings, rather than after it', () => {
        expect(writeStatusColors('a: 1\n\n# The end\n', { done: 'red' })).toBe('a: 1\nstatus_colors:\n    done: red\n\n# The end\n');
        expect(writeStatusColors('a: 1\n...\n', { done: 'red' })).toBe('a: 1\nstatus_colors:\n    done: red\n...\n');
        expect(writeStatusColors('a: 1', { done: 'red' })).toBe('a: 1\nstatus_colors:\n    done: red\n');
        expect(writeStatusColors('# Only this\n', { done: 'red' })).toBe('# Only this\nstatus_colors:\n    done: red\n');
        expect(writeStatusColors('  a: 1\n', { done: 'red' })).toBe('  a: 1\n  status_colors:\n      done: red\n');
    });

    it('changes only the entries edited, keeping every comment in the block', () => {
        const source = 'a: 1\nstatus_colors: # mine\n    # Brand colours\n    todo: blue   # do not change\n    done: green # for now\n    # More later\nb: 2\n';
        expect(writeStatusColors(source, { done: '#ff0000' }))
            .toBe('a: 1\nstatus_colors: # mine\n    # Brand colours\n    todo: blue   # do not change\n    done: "#ff0000" # for now\n    # More later\nb: 2\n');
        expect(writeStatusColors(source, { waiting: 'amber', backlog: 'grey' }))
            .toBe('a: 1\nstatus_colors: # mine\n    # Brand colours\n    todo: blue   # do not change\n    done: green # for now\n    backlog: grey\n    waiting: amber\n    # More later\nb: 2\n');
        expect(writeStatusColors(source, { todo: null }))
            .toBe('a: 1\nstatus_colors: # mine\n    # Brand colours\n    done: green # for now\n    # More later\nb: 2\n');
    });

    it('leaves the entries not edited as the file has them, even ones it cannot use', () => {
        expect(writeStatusColors('status_colors:\n    started: red\n    blocked: nope\n', { done: 'green' }))
            .toBe('status_colors:\n    started: red\n    blocked: nope\n    done: green\n');
        expect(writeStatusColors('status_colors:\n    done:\n    todo: blue\n', { done: 'red' })).toBe('status_colors:\n    done: red\n    todo: blue\n');
    });

    it('writes a block it cannot edit entry by entry afresh', () => {
        expect(writeStatusColors('status_colors: {done: green, todo: blue}\nb: 1\n', { done: 'red' }))
            .toBe('status_colors:\n    done: red\n    todo: blue\nb: 1\n');
        expect(writeStatusColors('status_colors:\nb: 1\n', { done: 'red' })).toBe('status_colors:\n    done: red\nb: 1\n');
    });

    it('removes the block, its comments with it, when every status takes its default', () => {
        expect(writeStatusColors('a: 1\nstatus_colors: # mine\n    done: green\n    # More later\nb: 2\n', { done: null })).toBe('a: 1\nb: 2\n');
        expect(writeStatusColors('a: 1\nstatus_colors: {done: green}\n', { done: null })).toBe('a: 1\n');
        expect(writeStatusColors('status_colors:\n    done: red\n', { done: null })).toBe('');
        expect(writeStatusColors('# Colours\nstatus_colors:\n    done: red\n', { done: null })).toBe('# Colours\n');
    });

    it('returns the file as it is when nothing changes', () => {
        const source = 'a: 1   \n\n\nstatus_colors:\n    done: red\n\n';
        expect(writeStatusColors(source, {})).toBe(source);
        expect(writeStatusColors(source, { done: 'red', todo: null })).toBe(source);
    });

    it('keeps the line endings and the byte-order mark the file has', () => {
        expect(writeStatusColors('a: 1\r\n', { done: 'red' })).toBe('a: 1\r\nstatus_colors:\r\n    done: red\r\n');
        expect(writeStatusColors('﻿status_colors:\n    done: red\nb: 2\n', { done: null })).toBe('﻿b: 2\n');
        expect(writeStatusColors('﻿a:\n    b: 1\n', { done: 'red' })).toBe('﻿a:\n    b: 1\nstatus_colors:\n    done: red\n');
    });

    it('refuses a file it cannot edit, writing nothing', () => {
        expect(() => writeStatusColors('a: [1\n', { done: 'red' })).toThrow('not valid YAML');
        expect(() => writeStatusColors('- a\n', { done: 'red' })).toThrow('block mapping');
        expect(() => writeStatusColors('{a: 1}\n', { done: 'red' })).toThrow('block mapping');
        expect(() => writeStatusColors('tasks:\n  backlog: []\n', { done: 'red' })).toThrow('legacy task data');
        expect(() => writeStatusColors('status_colors: &mine {done: green}\nother: *mine\n', { done: 'red' })).toThrow('by hand');
    });
});
