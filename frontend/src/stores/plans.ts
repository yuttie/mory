import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import axios from 'axios';
import YAML from 'yaml';
import { useFilesStore } from '@/stores/files';
import { collectUndone, isPlanDate, PLAN_UUID, putPlanEntry, readPlan, type MonthPlan, type PlanOrigin, type PlanResult } from '@/plans';

const planPath = (month: string) => `.mory/plans/${month}.yaml`;
export const usePlansStore = defineStore('plans', () => {
    const files = useFilesStore();
    const months = ref<Record<string, MonthPlan>>({});
    const errors = ref<Record<string, string>>({});
    const etags = new Map<string, string>();
    let queue: Promise<unknown> = Promise.resolve();
    function serialize<T>(operation: () => Promise<T>): Promise<T> {
        const result = queue.then(operation);
        queue = result.catch(() => undefined);
        return result;
    }
    async function readMonth(month: string): Promise<void> {
        if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) {
            throw new Error('Use a month in YYYY-MM format.');
        }
        try {
            const version = await files.readVersion(planPath(month), etags.get(month));
            if (version.content !== null) {
                const parsed = readPlan(version.content, month);
                months.value[month] = parsed;
                etags.set(month, version.etag);
            }
            delete errors.value[month];
        }
        catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                months.value[month] = {};
                etags.set(month, 'absent');
                delete errors.value[month];
            }
            else {
                errors.value[month] = String(error);
                throw error;
            }
        }
    }
    function loadMonths(visible: readonly string[]): Promise<void> {
        return serialize(async () => {
            for (const month of [...new Set(visible)].sort()) {
                await readMonth(month);
            }
        });
    }
    async function loadAll(): Promise<void> {
        await files.refresh();
        const listed = files.entries.map((entry) => /^\.mory\/plans\/([0-9]{4}-[0-9]{2})\.yaml$/.exec(entry.path)?.[1]).filter((month): month is string => month !== undefined);
        for (const month of new Set([...Object.keys(months.value), ...listed])) {
            await readMonth(month);
        }
    }
    async function saveMonth(month: string, plan: MonthPlan): Promise<void> {
        if (errors.value[month]) {
            throw new Error(`Fix the invalid ${month} plan before writing it: ${errors.value[month]}`);
        }
        const content = YAML.stringify(plan, { indent: 4 });
        readPlan(content, month);
        try {
            await files.writeChecked(planPath(month), content, etags.get(month) ?? 'absent');
        }
        catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 412) {
                await readMonth(month);
                throw new Error('This plan changed elsewhere. It has been reloaded; retry your change.');
            }
            throw error;
        }
        // Do not refetch the tag after saving: another writer may already own that version.
        etags.delete(month);
        months.value[month] = plan;
        await readMonth(month);
    }
    function change(date: string, edit: (plan: MonthPlan) => void): Promise<void> {
        if (!isPlanDate(date)) {
            return Promise.reject(new Error('Use a valid date in YYYY-MM-DD format.'));
        }
        return serialize(async () => {
            const month = date.slice(0, 7);
            await readMonth(month);
            const next = JSON.parse(JSON.stringify(months.value[month])) as MonthPlan;
            edit(next);
            await saveMonth(month, next);
        });
    }
    function planTask(date: string, uuid: string, origin: PlanOrigin = 'planned'): Promise<void> {
        if (!PLAN_UUID.test(uuid)) {
            return Promise.reject(new Error('A task reference must be a UUIDv4.'));
        }
        return change(date, (plan) => putPlanEntry(plan, date, uuid.toLowerCase(), origin));
    }
    function recordResult(date: string, uuid: string, result?: PlanResult): Promise<void> {
        return change(date, (plan) => {
            const entry = plan[date]?.find((entry) => entry.task === uuid.toLowerCase());
            if (!entry) {
                throw new Error('This task is not planned on that day.');
            }
            if (result === undefined) {
                delete entry.result;
            }
            else {
                entry.result = result;
            }
        });
    }
    function unplanTask(date: string, uuid: string): Promise<void> {
        return change(date, (plan) => { plan[date] = (plan[date] ?? []).filter((entry) => entry.task !== uuid.toLowerCase()); });
    }
    function reorder(date: string, uuids: readonly string[]): Promise<void> {
        return change(date, (plan) => {
            const entries = plan[date] ?? [];
            if (uuids.length !== entries.length || new Set(uuids).size !== entries.length || uuids.some((uuid) => !entries.some((entry) => entry.task === uuid))) {
                throw new Error('The plan changed during reordering. Reload and retry.');
            }
            plan[date] = uuids.map((uuid) => entries.find((entry) => entry.task === uuid)!);
        });
    }
    function collect(today: string, statusOf: (uuid: string) => string | undefined): Promise<void> {
        if (!isPlanDate(today)) {
            return Promise.reject(new Error('Use a valid date in YYYY-MM-DD format.'));
        }
        return serialize(async () => {
            await loadAll();
            const currentMonth = today.slice(0, 7);
            if (!months.value[currentMonth]) {
                await readMonth(currentMonth);
            }
            const next = JSON.parse(JSON.stringify(months.value)) as Record<string, MonthPlan>;
            const changed = collectUndone(next, today, statusOf);
            // Save today's additions first. If a later month fails, collecting again deduplicates today.
            const order = [...changed].sort((a, b) => a === currentMonth ? -1 : b === currentMonth ? 1 : a.localeCompare(b));
            for (const month of order) {
                await saveMonth(month, next[month]);
            }
        });
    }
    const days = computed(() => Object.assign({}, ...Object.values(months.value)) as MonthPlan);
    function plannedDays(uuid: string): string[] {
        return Object.entries(days.value).filter(([, entries]) => entries.some((entry) => entry.task === uuid.toLowerCase())).map(([date]) => date).sort();
    }
    function missedCount(uuid: string): number {
        return Object.values(days.value).flat().filter((entry) => entry.task === uuid.toLowerCase() && entry.result === 'missed').length;
    }
    // Repository commits include external MCP edits and deleted plan files.
    watch(() => files.commitId, (commit) => {
        if (commit && Object.keys(months.value).length > 0) {
            const listed = files.entries.map((entry) => /^\.mory\/plans\/([0-9]{4}-[0-9]{2})\.yaml$/.exec(entry.path)?.[1]).filter((month): month is string => month !== undefined);
            void loadMonths([...Object.keys(months.value), ...listed]).catch(() => undefined);
        }
    });
    return { months, days, errors, loadMonths, loadAll: () => serialize(loadAll), planTask, recordResult, unplanTask, reorder, collect, plannedDays, missedCount };
});
