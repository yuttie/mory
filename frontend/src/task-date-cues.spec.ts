import { describe, expect, it } from 'vitest';
import { taskDateCues } from '@/task-date-cues';

const NOW = Date.parse('2026-10-04T12:00:00+09:00');
const ZONE = 'Asia/Tokyo';
describe('task date presentation', () => {
    it('uses the actual datetime and offset rather than the end of its date', () => {
        const cues = taskDateCues({ deadline: '2026-10-04 10:00:00+09:00' }, [], {}, NOW, ZONE);
        expect(cues[0]).toMatchObject({ field: 'deadline', text: '2 hours ago', color: 'error' });
        expect(taskDateCues({ deadline: '2026-10-04 01:00:00Z' }, [], {}, NOW, ZONE)[0].text).toBe('2 hours ago');
    });
    it('keeps date-only limits through the day and starts availability at midnight', () => {
        const cues = taskDateCues({ available_from: '2026-10-05', due_by: '2026-10-04' }, [], {}, NOW, ZONE);
        expect(cues).toMatchObject([
            { field: 'available_from', text: 'in 12 hours', color: 'info' },
            { field: 'due_by', text: 'in 12 hours', color: 'warning' },
        ]);
    });
    it('colors a limit according to lead time, including tag and global defaults', () => {
        const task = { deadline: '2026-10-24', lead_time: '30d' };
        expect(taskDateCues(task, [], {}, NOW, ZONE)[0].color).toBe('warning');
        expect(taskDateCues({ deadline: task.deadline }, ['travel'], { lead_time_by_tag: { travel: '30d' } }, NOW, ZONE)[0].color).toBe('warning');
        expect(taskDateCues({ deadline: task.deadline }, [], { default_lead_time: '30d' }, NOW, ZONE)[0].color).toBe('warning');
        expect(taskDateCues({ deadline: '2026-10-06', lead_time: '1d' }, [], {}, NOW, ZONE)[0].color).toBeUndefined();
    });
    it('keeps a missed target distinct from a future hard deadline', () => {
        const cues = taskDateCues({ due_by: '2026-10-03', deadline: '2026-11-01' }, [], {}, NOW, ZONE);
        expect(cues[0]).toMatchObject({ field: 'due_by', color: 'warning' });
        expect(cues[1]).toMatchObject({ field: 'deadline', color: undefined });
    });
    it('removes urgency colors for finished tasks', () => {
        for (const kind of ['done', 'canceled']) {
            expect(taskDateCues({ deadline: '2026-10-01', status: { kind } }, [], {}, NOW, ZONE)[0].color).toBeUndefined();
        }
    });
    it('reads legacy availability and tolerates invalid metadata', () => {
        expect(taskDateCues({ start_at: '2026-10-05' }, [], {}, NOW, ZONE)[0].field).toBe('available_from');
        expect(taskDateCues({ due_by: 123, deadline: '2026-02-30' }, [], {}, NOW, ZONE)).toMatchObject([{ field: 'deadline', text: 'Invalid date', color: undefined }]);
    });
    it('refreshes relative labels and colors with the task clock', () => {
        const task = { deadline: '2026-10-04 13:00:00+09:00' };
        expect(taskDateCues(task, [], {}, NOW, ZONE)[0]).toMatchObject({ text: 'in an hour', color: 'warning' });
        expect(taskDateCues(task, [], {}, NOW + 7_200_000, ZONE)[0]).toMatchObject({ text: 'an hour ago', color: 'error' });
    });
});
