import { describe, expect, it } from 'vitest';
import fixtures from '../../fixtures/urgency/estimates.json';
import { estimateMinutes, formatEstimate, readPlanningSettings, readWorkHours, resolvedEstimate } from '@/estimate';

describe('estimateMinutes', () => {
    it.each(fixtures)('reads $value as moried does', ({ value, minutes }) => {
        expect(estimateMinutes(value) ?? null).toBe(minutes);
    });
});

describe('formatEstimate', () => {
    it.each([[0, '0m'], [45, '45m'], [60, '1h'], [90, '1h 30m'], [600, '10h']])('writes %i minutes as %s', (minutes, text) => {
        expect(formatEstimate(minutes)).toBe(text);
        expect(estimateMinutes(text)).toBe(minutes);
    });
});

describe('readWorkHours', () => {
    it('reads a span of the day', () => {
        expect(readWorkHours('09:00-18:00')).toEqual({ start: 540, end: 1080 });
        expect(readWorkHours(' 8:30 - 24:00 ')).toEqual({ start: 510, end: 1440 });
    });
    it.each(['18:00-09:00', '09:00-09:00', '09:60-18:00', '09:00-24:01', '09:00', 9, null])('refuses %s', (value) => {
        expect(readWorkHours(value)).toBeUndefined();
    });
});

describe('readPlanningSettings', () => {
    it('reads what is set and reports what is not an estimate or a span', () => {
        expect(readPlanningSettings({
            default_estimate: '30m',
            estimate_by_tag: { deep: '2h', odd: 'long' },
            work_hours: '10:00-19:00',
        })).toEqual({
            settings: { default_estimate: '30m', estimate_by_tag: { deep: '2h' }, work_hours: { start: 600, end: 1140 } },
            problems: ['Invalid estimate for tag odd.'],
        });
        expect(readPlanningSettings({ default_estimate: 60, estimate_by_tag: [], work_hours: '9-18' }).problems).toHaveLength(3);
    });
    it('leaves a file that is no settings to the task settings to report', () => {
        expect(readPlanningSettings(null)).toEqual({ settings: {}, problems: [] });
        expect(readPlanningSettings({ tasks: [], default_estimate: 'x' })).toEqual({ settings: {}, problems: [] });
    });
});

describe('resolvedEstimate', () => {
    const settings = { default_estimate: '30m', estimate_by_tag: { deep: '2h', quick: '15m' } };
    it('takes the task\'s own first', () => {
        expect(resolvedEstimate('3h', ['deep'], settings)).toEqual({ minutes: 180, assumed: false });
    });
    it('then the longest of its tags, the default, and an hour', () => {
        expect(resolvedEstimate(undefined, ['quick', 'deep'], settings)).toEqual({ minutes: 120, assumed: true });
        expect(resolvedEstimate('soon', ['other'], settings)).toEqual({ minutes: 30, assumed: true });
        expect(resolvedEstimate(undefined, [])).toEqual({ minutes: 60, assumed: true });
    });
});
