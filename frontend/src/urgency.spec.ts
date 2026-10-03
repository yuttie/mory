import { describe, expect, it } from 'vitest';
import fixtures from '../../fixtures/urgency/cases.json';
import { leadTimeDays, readTaskSettings, urgencyOf, readImportance, mostUrgent } from '@/urgency';

describe('shared urgency fixtures', () => {
    for (const test of fixtures.cases) {
        it(test.name, () => {
            const { settings } = readTaskSettings(test.settings);
            const result = urgencyOf(test.task, test.tags, settings, Date.parse(test.now), test.zone);
            expect({ ...result, slack_ratio: null }).toEqual({ ...test.expected, slack_ratio: null });
            if (test.expected.slack_ratio === null) {
                expect(JSON.parse(JSON.stringify(result)).slack_ratio).toBeNull();
            }
            else {
                expect(result.slack_ratio).toBeCloseTo(test.expected.slack_ratio, 9);
            }
        });
    }
    for (const test of fixtures.grammar) {
        it(`lead time ${JSON.stringify(test.value)}`, () => {
            expect(leadTimeDays(test.value) ?? null).toBe(test.days);
        });
    }
    for (const test of fixtures.importance) {
        it(`importance ${JSON.stringify(test.value)}`, () => {
            expect(readImportance(test.value) ?? null).toBe(test.expected);
        });
    }
    it('ignores legacy settings and reports malformed values', () => {
        expect(readTaskSettings({ tasks: { backlog: [] } }).problems).toHaveLength(1);
        expect(readTaskSettings({ default_lead_time: '-7d' }).settings).toEqual({});
    });
    it('accepts named importance and reads the transition mapping', () => {
        expect([1, 2, 3, 4, 5, 'low', 'medium', 'high', null].map(readImportance)).toEqual(['low', 'low', undefined, 'medium', 'high', 'low', 'medium', 'high', undefined]);
    });
    it('takes the most urgent descendant and smallest ratio', () => {
        const a = urgencyOf({ deadline: '2026-10-15' }, [], {}, Date.parse('2026-10-04T00:00:00Z'), 'Asia/Tokyo');
        const b = urgencyOf({ due_by: '2026-10-01' }, [], {}, Date.parse('2026-10-04T00:00:00Z'), 'Asia/Tokyo');
        expect(mostUrgent([a, b])).toEqual(b);
    });
    it('keeps the sign of infinite slack internally when sorting zero-day leads', () => {
        const now = Date.parse('2026-10-04T00:00:00Z');
        const zero = urgencyOf({ deadline: '2026-10-01', lead_time: '0d' }, [], {}, now, 'Asia/Tokyo');
        const finite = urgencyOf({ deadline: '2026-10-01', lead_time: '7d' }, [], {}, now, 'Asia/Tokyo');
        expect(zero.slack_ratio).toBe(-Infinity);
        expect(mostUrgent([finite, zero])).toEqual(zero);
    });
});
