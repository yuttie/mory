import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { taskInstant, urgencyOf, type TaskSettings, type UrgencyLevel, type UrgencyTask } from '@/urgency';

dayjs.extend(relativeTime, {
    thresholds: [
        { l: 's', r: 1 },
        { l: 'm', r: 1 },
        { l: 'mm', r: 59, d: 'minute' },
        { l: 'h', r: 1 },
        { l: 'hh', r: 23, d: 'hour' },
        { l: 'd', r: 1 },
        { l: 'dd', d: 'day' },
        { l: 'M' },
        { l: 'MM', d: 'month' },
        { l: 'y' },
        { l: 'yy', d: 'year' },
    ],
});

export type TaskDateField = 'available_from' | 'due_by' | 'deadline';
export interface TaskDateCue {
    field: TaskDateField;
    label: string;
    value: string;
    text: string;
    color?: string;
}
const LABELS: Record<TaskDateField, string> = { available_from: 'Available', due_by: 'Due', deadline: 'Deadline' };
const COLORS: Partial<Record<UrgencyLevel, string>> = { notice: 'info', urgent: 'warning', target_missed: 'warning', overdue: 'error' };

export function taskDateCues(task: UrgencyTask, tags: readonly string[], settings: TaskSettings, now: number, zone = dayjs.tz.guess()): TaskDateCue[] {
    const cues: TaskDateCue[] = [];
    for (const field of ['available_from', 'due_by', 'deadline'] as const) {
        const value = field === 'available_from' ? task.available_from ?? task.start_at : task[field];
        if (typeof value !== 'string' || !value.trim()) {
            continue;
        }
        const instant = taskInstant(value, zone, field !== 'available_from');
        // Each limit describes its own urgency: a missed target must not color a later deadline.
        const level = urgencyOf({ ...task, due_by: undefined, deadline: undefined, [field]: value }, tags, settings, now, zone).level;
        cues.push({
            field,
            label: LABELS[field],
            value,
            text: instant === undefined ? 'Invalid date' : dayjs(instant).from(dayjs(now)),
            color: field === 'available_from' ? (instant !== undefined && instant > now ? 'info' : undefined) : COLORS[level],
        });
    }
    return cues;
}
