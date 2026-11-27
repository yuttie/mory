// The tasks a day can be planned from, as the Schedule and Plan views list them: which of a list's
// tasks are candidates, the order they are ranked in, and the search that narrows them.
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { TaskNode } from '@/task-forest';
import { readImportance, isUrgent, compareUrgency, IMPORTANCE_ORDER, URGENCY_ORDER, type Importance, type Urgency } from '@/urgency';
import type { TaskDateField } from '@/task-date-cues';
import { useTasksStore } from '@/stores/tasks';
import { searchTerms, titlesMatcher } from '@/task-tree-filter';

interface Rank {
    importance: Importance | undefined;
    urgency: Urgency;
}
function quadrant({ importance, urgency }: Rank): number {
    if (!importance) {
        return 4;
    }
    const important = importance === 'medium' || importance === 'high';
    return important ? (isUrgent(urgency) ? 0 : 1) : (isUrgent(urgency) ? 2 : 3);
}
// By quadrant, then by urgency within it, as the Eisenhower view orders a quadrant. Urgency is
// compared whole, level first: its slack alone would put a step behind one less urgent once a
// project whose target is missed but whose deadline is far off lends it its own.
function compareRanks(a: Rank, b: Rank): number {
    return quadrant(a) - quadrant(b) || compareUrgency(a.urgency, b.urgency);
}
// A subtask stands in for the tasks above it, which the column hides while it can be planned, so a
// step of a project due tomorrow is ranked as urgent as the project and as important: `ranked` is the
// most of each among them. Its `own` rank still orders two steps the same project ranks alike.
// The tasks the list is under are left out, as the row's path leaves them out: every candidate
// shares them, so they would only flatten the ranking. A done or canceled task lends nothing.
interface Standing {
    own: Rank;
    ranked: Rank;
    // The task above whose dates raise the level of urgency the candidate is ranked at, for the row
    // to name. One that only shortens its slack is not named: slack is counted in each task's own
    // lead time, so a project could be named for a deadline later than the step's own.
    lender: TaskNode | undefined;
}
// A lender's own start is not the candidate's, so only the dates that rank it are shown.
export const LENT_FIELDS: readonly TaskDateField[] = ['due_by', 'deadline'];

export interface PlanCandidates {
    /// What the candidates are searched for, as typed.
    searched: Ref<string>;
    terms: ComputedRef<string[]>;
    /// The candidates in ranked order, narrowed by the search.
    shown: ComputedRef<TaskNode[]>;
    /// For each candidate, the task above it whose dates raise its rank, if one does.
    lenders: ComputedRef<Map<string, TaskNode | undefined>>;
}

/// `candidates` are the tasks of the list and `listRoot` the task they are under, if any.
export function usePlanCandidates(candidates: () => readonly TaskNode[], listRoot: () => string | undefined): PlanCandidates {
    const tasks = useTasksStore();
    function standingOf(task: TaskNode): Standing {
        // Nearest first, so that of two as urgent the closer is named.
        const above = tasks.ancestorsOf(task.uuid, listRoot()).reverse()
            .filter((ancestor) => !['done', 'canceled'].includes(ancestor.metadata?.task?.status?.kind ?? ''));
        const own: Rank = { importance: readImportance(task.metadata?.task?.importance), urgency: tasks.urgency(task.uuid) };
        let { importance, urgency } = own;
        let lender: TaskNode | undefined;
        for (const ancestor of above) {
            const lent = tasks.ownUrgency(ancestor.uuid);
            if (compareUrgency(lent, urgency) < 0) {
                urgency = lent;
                lender = ancestor;
            }
            const value = readImportance(ancestor.metadata?.task?.importance);
            if (value !== undefined && (importance === undefined || IMPORTANCE_ORDER[value] > IMPORTANCE_ORDER[importance])) {
                importance = value;
            }
        }
        const raised = URGENCY_ORDER[urgency.level] > URGENCY_ORDER[own.urgency.level];
        return { own, ranked: { importance, urgency }, lender: raised ? lender : undefined };
    }
    // A task in the backlog is not taken on yet and a done or canceled one is over, so neither is
    // planned for a day, and nor is one whose `available_from` has not come. A task that names no
    // status is read as Backlog, as the Status view reads it.
    const isPlannable = (task: TaskNode) => tasks.ownUrgency(task.uuid).actionable
        && !['backlog', 'done', 'canceled'].includes(task.metadata?.task?.status?.kind ?? 'backlog');
    // A task with a plannable subtask, at any depth, is worked on through that subtask, which is what a
    // day plans. One that is not plannable leaves the task above it to be planned. Testing the subtasks
    // for what makes a candidate keeps any two candidates from being ancestor and descendant.
    // Each standing is worked out once, rather than at every comparison of the sort.
    const ranked = computed(() => candidates()
        .filter((task) => isPlannable(task) && !tasks.flattenDescendants(task.uuid).some(isPlannable))
        .map((task) => ({ task, standing: standingOf(task) }))
        .sort((a, b) => compareRanks(a.standing.ranked, b.standing.ranked)
            || compareRanks(a.standing.own, b.standing.own)
            || a.task.uuid.localeCompare(b.task.uuid)));
    const candidateTasks = computed(() => ranked.value.map(({ task }) => task));
    // What the candidates are searched for, once typing pauses, as the task tree is. A search draws
    // anew every row it keeps, to mark it: with 240 candidates, all kept, each key took Firefox 68 to
    // 90 ms and Chrome 40 to 54 ms on a production build, which on every key would stall the typing.
    const searched = ref('');
    const terms = computed(() => searchTerms(searched.value));
    // A candidate is found by the titles its row draws, its own and those of the tasks above it, so
    // that a project's name finds the steps standing in for it.
    const shownCandidates = computed(() => {
        if (terms.value.length === 0) {
            return candidateTasks.value;
        }
        const matches = titlesMatcher(terms.value);
        return candidateTasks.value.filter((task) => {
            const { own, ancestors } = tasks.rowTitles(task, listRoot());
            return matches([own, ...ancestors]);
        });
    });
    const lenders = computed(() => new Map(ranked.value.map(({ task, standing }) => [task.uuid, standing.lender])));
    return { searched, terms, shown: shownCandidates, lenders };
}
