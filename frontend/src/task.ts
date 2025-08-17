import YAML from 'yaml';

import type { UUID } from '@/api';

export { UUID };

export interface TodoStatus {
    kind: 'todo';
}

export interface InProgressStatus {
    kind: 'in_progress';
}

export interface WaitingStatus {
    kind: 'waiting';
    waiting_for: string;
    expected_by?: string;
    contact?: string;
    follow_up_at?: string;
}

export interface BlockedStatus {
    kind: 'blocked';
    blocked_by: string;
}

export interface OnHoldStatus {
    kind: 'on_hold';
    hold_reason: string;
    review_at?: string;
}

export interface DoneStatus {
    kind: 'done';
    completed_at: string; // ISO datetime
    completion_note?: string;
}

export interface CanceledStatus {
    kind: 'canceled';
    canceled_at: string; // ISO datetime
    cancel_reason: string;
}

export type Status =
    | TodoStatus
    | InProgressStatus
    | WaitingStatus
    | BlockedStatus
    | OnHoldStatus
    | DoneStatus
    | CanceledStatus;

export type StatusKind = Status['kind'];

export const STATUS_LABEL: Record<StatusKind, string> = {
    todo: 'To do',
    in_progress: 'In progress',
    waiting: 'Waiting',
    blocked: 'Blocked',
    on_hold: 'On hold',
    done: 'Done',
    canceled: 'Canceled',
};

export const STATUS_FLOW = {
    todo: ['in_progress', 'waiting', 'blocked', 'canceled'],
    in_progress: ['waiting', 'blocked', 'on_hold', 'done', 'canceled'],
    waiting: ['in_progress', 'done', 'canceled'],
    blocked: ['in_progress', 'waiting', 'canceled'],
    on_hold: ['in_progress', 'canceled'],
    done: [],
    canceled: [],
} as const satisfies Record<StatusKind, readonly StatusKind[]>;

export interface Task {
    uuid: UUID;
    title: string;
    tags: string[];
    status: Status;
    progress: number;
    importance: number;
    urgency: number;
    start_at?: string;
    due_by?: string;
    deadline?: string;
    scheduled_dates: string[];
    note: string;
}

export function nextOptions(from: Status): readonly StatusKind[] {
    return STATUS_FLOW[from.kind] ?? [];
}

export function makeDefaultStatus(kind: StatusKind): Status {
    switch (kind) {
        case 'todo': return { kind: 'todo' };
        case 'in_progress': return { kind: 'in_progress' };
        case 'waiting': return { kind: 'waiting', waiting_for: '' };
        case 'blocked': return { kind: 'blocked', blocked_by: '' };
        case 'on_hold': return { kind: 'on_hold', hold_reason: '' };
        case 'done': return { kind: 'done', completed_at: '' };
        case 'canceled': return { kind: 'canceled', canceled_at: '', cancel_reason: '' };
    }
}

export function canTransition(from: Status, to: StatusKind): boolean {
    if (to === from.kind) { return true; }  // Allow no-op (same status)
    return nextOptions(from).includes(to);
}

export function render(task: Task): string {
    const metadata = {
        task: {
            status: task.status,
            progress: task.progress,
            importance: task.importance,
            urgency: task.urgency,
            ...(task.start_at ? { start_at: task.start_at } : {}),
            ...(task.due_by ? { due_by: task.due_by } : {}),
            ...(task.deadline ? { deadline: task.deadline } : {}),
            scheduled_dates: task.scheduled_dates,
        },
        tags: task.tags,
    };
    return '---\n' + YAML.stringify(metadata, { indent: 4 }) + '---\n' + (task.title ? `\n# ${task.title}\n` : '') + (`\n${task.note}`);
}
