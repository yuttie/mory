import YAML from 'yaml';

export type PlanOrigin = 'planned' | 'interruption';
export type PlanResult = 'worked' | 'missed';
export interface PlanEntry {
    task: string;
    origin: PlanOrigin;
    result?: PlanResult;
}
export type MonthPlan = Record<string, PlanEntry[]>;
export const PLAN_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPlanDate(value: string): boolean {
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) {
        return false;
    }
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function readPlan(text: string, month: string): MonthPlan {
    const value: unknown = YAML.parse(text) ?? {};
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('A plan file must map dates to ordered entries.');
    }
    const result: MonthPlan = {};
    for (const [date, entries] of Object.entries(value)) {
        if (!isPlanDate(date) || !date.startsWith(`${month}-`) || !Array.isArray(entries)) {
            throw new Error(`Invalid plan day ${date} in ${month}.`);
        }
        const seen = new Set<string>();
        result[date] = entries.map((entry: unknown) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                throw new Error(`Invalid plan entry on ${date}.`);
            }
            const item = entry as Record<string, unknown>;
            if (Object.keys(item).some((key) => !['task', 'origin', 'result'].includes(key)) || typeof item.task !== 'string' || !PLAN_UUID.test(item.task) || typeof item.origin !== 'string' || !['planned', 'interruption'].includes(item.origin) || (item.result !== undefined && (typeof item.result !== 'string' || !['worked', 'missed'].includes(item.result)))) {
                throw new Error(`Invalid plan entry on ${date}. Use task UUID, origin planned/interruption and optional result worked/missed.`);
            }
            const task = item.task.toLowerCase();
            if (seen.has(task)) {
                throw new Error(`Duplicate task ${task} on ${date}.`);
            }
            seen.add(task);
            return { task, origin: item.origin as PlanOrigin, ...(item.result !== undefined ? { result: item.result as PlanResult } : {}) };
        });
    }
    return result;
}

export function putPlanEntry(plan: MonthPlan, date: string, task: string, origin: PlanOrigin): void {
    const entries = plan[date] ??= [];
    if (!entries.some((entry) => entry.task === task)) {
        entries.push({ task, origin, ...(origin === 'interruption' ? { result: 'worked' as const } : {}) });
    }
}

// Today's additions are computed before past records are marked, so a retry remains idempotent.
export function collectUndone(plans: Record<string, MonthPlan>, today: string, statusOf: (uuid: string) => string | undefined): Set<string> {
    const changed = new Set<string>();
    const currentMonth = today.slice(0, 7);
    const current = plans[currentMonth] ??= {};
    for (const [month, plan] of Object.entries(plans).sort(([a], [b]) => a.localeCompare(b))) {
        for (const [date, entries] of Object.entries(plan).sort(([a], [b]) => a.localeCompare(b))) {
            if (date >= today) {
                continue;
            }
            for (const entry of entries) {
                const status = statusOf(entry.task);
                if (entry.result !== undefined || status === undefined || status === 'done' || status === 'canceled') {
                    continue;
                }
                entry.result = 'missed';
                changed.add(month);
                const before = current[today]?.length ?? 0;
                putPlanEntry(current, today, entry.task, 'planned');
                if ((current[today]?.length ?? 0) !== before) {
                    changed.add(currentMonth);
                }
            }
        }
    }
    return changed;
}
