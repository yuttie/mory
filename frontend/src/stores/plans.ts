import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import axios from 'axios';
import { useFilesStore } from '@/stores/files';
import { collectUndone, isPlanDate, PLAN_UUID, planMonthOf, putPlanEntry, readPlan, writePlan, type MonthPlan, type PlanOrigin, type PlanResult } from '@/plans';

const planPath = (month: string) => `.mory/plans/${month}.yaml`;
// Only a file named for a month holds a plan. One named otherwise, such as `2026-13.yaml`, is never
// read as one, and the health check reports it.
function listedMonths(entries: readonly { path: string }[]): string[] {
    return entries.map((entry) => planMonthOf(entry.path)).filter((month): month is string => month !== null);
}
export const usePlansStore = defineStore('plans', () => {
    const files = useFilesStore();
    const months = ref<Record<string, MonthPlan>>({});
    const errors = ref<Record<string, string>>({});
    const etags = new Map<string, string>();
    // The commit each month's last read began at, or `null` where it reached no file to read,
    // failing for moried or the network rather than for what the file holds: what needs the plans
    // as of a commit, as the health checks do, tells by it whether a month's error is its file's.
    const readCommits = new Map<string, string | null>();
    let queue: Promise<unknown> = Promise.resolve();
    let historyRequested = false;
    function serialize<T>(operation: () => Promise<T>): Promise<T> {
        const result = queue.then(operation);
        queue = result.catch(() => undefined);
        return result;
    }
    async function readMonth(month: string): Promise<void> {
        if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) {
            throw new Error('Use a month in YYYY-MM format.');
        }
        const commit = files.commitId;
        try {
            const version = await files.readVersion(planPath(month), etags.get(month));
            if (version.content !== null) {
                try {
                    months.value[month] = readPlan(version.content, month);
                }
                catch (error) {
                    // What an earlier read held of the month is not what its file says now, so
                    // none of it is shown or collected. A month that only failed to be fetched,
                    // as while moried restarts, keeps it: its file may well be unchanged.
                    delete months.value[month];
                    etags.delete(month);
                    throw error;
                }
                etags.set(month, version.etag);
            }
            delete errors.value[month];
            readCommits.set(month, commit);
        }
        catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                // A month with no file is read again at each commit and nearly always still has
                // none. The empty plan held for it is kept then, as a month whose file is unchanged
                // keeps its plan, or `days` and all drawn from it would be worked out anew.
                if (etags.get(month) !== 'absent' || !(month in months.value)) {
                    months.value[month] = {};
                }
                etags.set(month, 'absent');
                delete errors.value[month];
                readCommits.set(month, commit);
            }
            else {
                errors.value[month] = String(error);
                readCommits.set(month, axios.isAxiosError(error) ? null : commit);
                throw error;
            }
        }
    }
    // Every month, each on its own: a month that does not read is refused whole, but it must not
    // keep the months after it from being read, or the planned days they hold would go unseen.
    // What failed is named once all are read, and kept in `errors` for the views that show it.
    async function readMonths(wanted: Iterable<string>): Promise<void> {
        const failures: string[] = [];
        for (const month of [...new Set(wanted)].sort()) {
            try {
                await readMonth(month);
            }
            catch (error) {
                failures.push(`${month}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (failures.length > 0) {
            throw new Error(`These day plans could not be read: ${failures.join('; ')}`);
        }
    }
    function loadMonths(visible: readonly string[]): Promise<void> {
        return serialize(() => readMonths(visible));
    }
    // The months held and listed, and those known only by their error: a refused month is not
    // held, and must still be read again, so that it stops failing once its file is fixed or gone.
    function knownMonths(): string[] {
        return [...Object.keys(months.value), ...Object.keys(errors.value), ...listedMonths(files.entries)];
    }
    async function loadAll(): Promise<void> {
        historyRequested = true;
        await files.refresh();
        await readMonths(knownMonths());
    }
    async function saveMonth(month: string, plan: MonthPlan): Promise<void> {
        if (errors.value[month]) {
            throw new Error(`Fix the invalid ${month} plan before writing it: ${errors.value[month]}`);
        }
        const content = writePlan(plan);
        readPlan(content, month);
        try {
            await files.writeChecked(planPath(month), content, etags.get(month) ?? 'absent');
        }
        catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 412) {
                await readMonth(month);
                throw new Error('This plan changed elsewhere. It has been reloaded; retry your change.', { cause: error });
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
    function planTask(date: string, uuid: string, origin: PlanOrigin = 'planned', position?: number): Promise<void> {
        if (!PLAN_UUID.test(uuid)) {
            return Promise.reject(new Error('A task reference must be a UUIDv4.'));
        }
        return change(date, (plan) => {
            const id = uuid.toLowerCase();
            const exists = plan[date]?.some((entry) => entry.task === id);
            putPlanEntry(plan, date, id, origin);
            if (!exists && position !== undefined) {
                const entries = plan[date];
                const entry = entries.pop()!;
                entries.splice(position, 0, entry);
            }
        });
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
    function moveTask(from: string, to: string, uuid: string, position: number): Promise<void> {
        if (!isPlanDate(from) || !isPlanDate(to) || !PLAN_UUID.test(uuid)) {
            return Promise.reject(new Error('Use valid dates and a task UUIDv4.'));
        }
        return serialize(async () => {
            const sourceMonth = from.slice(0, 7);
            const targetMonth = to.slice(0, 7);
            await readMonth(sourceMonth);
            if (sourceMonth !== targetMonth) {
                await readMonth(targetMonth);
            }
            const source = JSON.parse(JSON.stringify(months.value[sourceMonth])) as MonthPlan;
            const target = sourceMonth === targetMonth ? source : JSON.parse(JSON.stringify(months.value[targetMonth])) as MonthPlan;
            const entries = source[from] ?? [];
            const index = entries.findIndex((entry) => entry.task === uuid.toLowerCase());
            if (index === -1) {
                throw new Error('This task is no longer planned on the source day.');
            }
            if (from !== to && target[to]?.some((entry) => entry.task === uuid.toLowerCase())) {
                throw new Error('This task is already planned on the destination day.');
            }
            const [entry] = entries.splice(index, 1);
            (target[to] ??= []).splice(position, 0, entry);
            if (sourceMonth === targetMonth) {
                await saveMonth(sourceMonth, source);
            }
            else {
                // Across month files, retain the source until the destination is safely written.
                await saveMonth(targetMonth, target);
                try {
                    await saveMonth(sourceMonth, source);
                }
                catch (error) {
                    throw new Error('The destination was saved, but moving the source failed. Reload the plans before retrying.', { cause: error });
                }
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
            const currentMonth = today.slice(0, 7);
            // A month that does not read is in `errors` once the rest are read, and is dealt with
            // below. A listing that cannot be refreshed still stops the collection: without it, which
            // months there are to collect from is not known.
            historyRequested = true;
            await files.refresh();
            await readMonths(knownMonths()).catch(() => undefined);
            if (!months.value[currentMonth] && !errors.value[currentMonth]) {
                await readMonth(currentMonth);
            }
            if (errors.value[currentMonth]) {
                throw new Error(`Collected nothing: the ${currentMonth} plan, which today's tasks go into, could not be read: ${errors.value[currentMonth]}`);
            }
            // A past month that does not read is left out rather than refusing the whole collection,
            // which one old mistake would then block for good. So is what the store still holds of
            // one that could not be fetched: it may be out of date, and what it added to today would
            // be saved before its own write was refused.
            const unreadable = Object.keys(errors.value).filter((month) => month < currentMonth).sort();
            const readable = Object.fromEntries(Object.entries(months.value).filter(([month]) => !errors.value[month]));
            const next = JSON.parse(JSON.stringify(readable)) as Record<string, MonthPlan>;
            const changed = collectUndone(next, today, statusOf);
            // Save today's additions first. If a later month fails, collecting again deduplicates today.
            const order = [...changed].sort((a, b) => a === currentMonth ? -1 : b === currentMonth ? 1 : a.localeCompare(b));
            for (const month of order) {
                await saveMonth(month, next[month]);
            }
            // Thrown after saving, as a partial move is, so the error alert says what was not done.
            if (unreadable.length > 0) {
                throw new Error(`Left out ${unreadable.join(', ')}, which could not be read, and collected undone tasks from the other months. Collect again once ${unreadable.length === 1 ? 'it reads' : 'they read'}.`);
            }
        });
    }
    /// The commit the last read of `month` began at, or `null` if it reached no file or none has
    /// been made.
    function readAt(month: string): string | null {
        return readCommits.get(month) ?? null;
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
        if (commit && (historyRequested || Object.keys(months.value).length > 0 || Object.keys(errors.value).length > 0)) {
            void loadMonths(knownMonths()).catch(() => undefined);
        }
    });
    return { months, days, errors, readAt, loadMonths, loadAll: () => serialize(loadAll), planTask, moveTask, recordResult, unplanTask, reorder, collect, plannedDays, missedCount };
});
