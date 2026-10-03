import { describe, expect, it } from 'vitest';
import { collectUndone, putPlanEntry, readPlan, type MonthPlan } from '@/plans';
const A = '4955857d-3267-4b94-83f2-538a428970d7';
const B = '2a997a71-0d2b-4938-b8ff-5178c28a5ad9';
const C = '53b2a26e-a2c8-4e3c-a11b-a0d532237fe1';

describe('day plans', () => {
    it('keeps order, deduplicates daily tasks, records interruptions and permits unknown UUIDs', () => {
        const plan: MonthPlan = {};
        putPlanEntry(plan, '2026-10-05', A, 'planned');
        putPlanEntry(plan, '2026-10-05', B, 'interruption');
        putPlanEntry(plan, '2026-10-05', A, 'interruption');
        expect(plan['2026-10-05']).toEqual([{ task: A, origin: 'planned' }, { task: B, origin: 'interruption', result: 'worked' }]);
        expect(readPlan(`2026-10-05:\n    - task: ${C}\n      origin: planned\n`, '2026-10')['2026-10-05'][0].task).toBe(C);
    });
    it('refuses malformed data before any rewrite can drop it', () => {
        for (const text of [
            '2026-02-30: []', '2026-11-01: []', '2026-10-05: nope', '- task: bad',
            `2026-10-05:\n    - task: ${A}\n      origin: planned\n      result: null`,
            `2026-10-05:\n    - task: ${A}\n      origin: planned\n      extra: data`,
            `2026-10-05:\n    - task: ${A}\n      origin: planned\n    - task: ${A}\n      origin: planned`,
        ]) {
            expect(() => readPlan(text, '2026-10'), text).toThrow();
        }
    });
    it('collects only unrecorded open tasks and leaves past records as history', () => {
        const plans: Record<string, MonthPlan> = {
            '2026-09': { '2026-09-30': [{ task: A, origin: 'planned' }, { task: B, origin: 'planned' }, { task: C, origin: 'planned' }] },
            '2026-10': { '2026-10-01': [{ task: A, origin: 'planned' }], '2026-10-04': [{ task: A, origin: 'interruption', result: 'worked' }] },
        };
        const status = (uuid: string) => uuid === A ? 'todo' : uuid === B ? 'done' : undefined;
        const changed = collectUndone(plans, '2026-10-04', status);
        expect([...changed].sort()).toEqual(['2026-09', '2026-10']);
        expect(plans['2026-09']['2026-09-30']).toEqual([{ task: A, origin: 'planned', result: 'missed' }, { task: B, origin: 'planned' }, { task: C, origin: 'planned' }]);
        expect(plans['2026-10']['2026-10-04']).toEqual([{ task: A, origin: 'interruption', result: 'worked' }]);
        expect(collectUndone(plans, '2026-10-04', status).size).toBe(0);
    });
});
