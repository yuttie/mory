import { describe, expect, it } from 'vitest';

import { STATUS_KINDS } from '@/task';
import { statusColor, statusGround } from '@/status-color';

describe('statusColor', () => {
    it('gives the palette colours the task tree has always drawn', () => {
        expect(STATUS_KINDS.map(statusColor)).toEqual([
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

    it('gives nothing for what is not a status', () => {
        for (const kind of [undefined, null, 3, '', 'started', 'toString', '__proto__']) {
            expect(statusColor(kind)).toBeUndefined();
        }
    });
});

describe('statusGround', () => {
    it('mixes the status colour faintly into the theme surface', () => {
        expect(statusGround('done')).toBe('color-mix(in srgb, #4caf50 12%, rgb(var(--v-theme-surface)))');
    });

    it('gives no ground for what is not a status', () => {
        expect(statusGround('toString')).toBeUndefined();
    });
});
