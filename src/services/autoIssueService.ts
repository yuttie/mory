import * as api from '@/api';
import { detectIssues, issueToTask, groupIssuesByFile } from './issueDetector';
import type { DetectedIssue } from './issueDetector';
import type { Task } from '@/task';
import { render } from '@/task';

export interface AutoIssueOptions {
    includeCompleted: boolean;
    maxIssuesPerFile: number;
    filePatterns: string[];
    skipTags: string[];
}

export interface AutoIssueResult {
    detectedIssues: DetectedIssue[];
    createdTasks: Task[];
    errors: string[];
}

export const DEFAULT_OPTIONS: AutoIssueOptions = {
    includeCompleted: false,
    maxIssuesPerFile: 10,
    filePatterns: ['*.md', '*.txt'],
    skipTags: ['auto-created'], // Don't create issues from already auto-created content
};

/**
 * Automatically scans notes and creates tasks from detected issues
 */
export class AutoIssueService {
    private options: AutoIssueOptions;

    constructor(options: Partial<AutoIssueOptions> = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    /**
     * Scans all notes for actionable items and creates tasks
     */
    async scanAndCreateIssues(): Promise<AutoIssueResult> {
        const result: AutoIssueResult = {
            detectedIssues: [],
            createdTasks: [],
            errors: [],
        };

        try {
            // Get list of all notes
            const notesResponse = await api.listNotes();
            const notes = notesResponse.data;

            // Filter notes based on patterns and options
            const filteredNotes = this.filterNotes(notes);

            // Scan each note for issues
            for (const note of filteredNotes) {
                try {
                    await this.scanNoteForIssues(note, result);
                } catch (error) {
                    result.errors.push(`Error scanning ${note.path}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }

            return result;
        } catch (error) {
            result.errors.push(`Error listing notes: ${error instanceof Error ? error.message : String(error)}`);
            return result;
        }
    }

    /**
     * Scans a specific note file for issues
     */
    async scanNoteForIssues(note: any, result: AutoIssueResult): Promise<void> {
        try {
            // Skip if note has auto-created tag and skipTags includes it
            if (note.metadata?.tags && this.options.skipTags.some(tag => note.metadata.tags.includes(tag))) {
                return;
            }

            // Get note content
            const noteResponse = await api.getNote(note.path);
            const content = noteResponse.data;

            // Detect issues in the content
            const detectedIssues = detectIssues(content, note.path);
            
            // Limit issues per file
            const limitedIssues = detectedIssues.slice(0, this.options.maxIssuesPerFile);
            result.detectedIssues.push(...limitedIssues);

            // Convert issues to tasks and create them
            for (const issue of limitedIssues) {
                try {
                    const task = issueToTask(issue);
                    await this.createTaskFromIssue(task);
                    result.createdTasks.push(task);
                } catch (error) {
                    result.errors.push(`Error creating task from issue "${issue.title}": ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        } catch (error) {
            throw new Error(`Failed to scan note ${note.path}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Creates a task file from a detected issue
     */
    private async createTaskFromIssue(task: Task): Promise<void> {
        const taskPath = `.tasks/${task.uuid}.md`;
        const markdown = render(task);
        await api.addNote(taskPath, markdown);
    }

    /**
     * Filters notes based on configured patterns and options
     */
    private filterNotes(notes: any[]): any[] {
        return notes.filter(note => {
            // Skip completed notes if not included
            if (!this.options.includeCompleted && note.metadata?.task?.status?.kind === 'done') {
                return false;
            }

            // Check file patterns
            if (this.options.filePatterns.length > 0) {
                const matches = this.options.filePatterns.some(pattern => {
                    const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
                    return regex.test(note.path);
                });
                if (!matches) {
                    return false;
                }
            }

            return true;
        });
    }

    /**
     * Preview what issues would be detected without creating tasks
     */
    async previewIssues(): Promise<DetectedIssue[]> {
        const issues: DetectedIssue[] = [];

        try {
            const notesResponse = await api.listNotes();
            const notes = notesResponse.data;
            const filteredNotes = this.filterNotes(notes);

            for (const note of filteredNotes) {
                try {
                    if (note.metadata?.tags && this.options.skipTags.some(tag => note.metadata.tags.includes(tag))) {
                        continue;
                    }

                    const noteResponse = await api.getNote(note.path);
                    const content = noteResponse.data;
                    const detectedIssues = detectIssues(content, note.path);
                    issues.push(...detectedIssues.slice(0, this.options.maxIssuesPerFile));
                } catch (error) {
                    console.warn(`Error previewing issues in ${note.path}:`, error);
                }
            }
        } catch (error) {
            console.error('Error previewing issues:', error);
        }

        return issues;
    }
}

// Export a default instance
export const autoIssueService = new AutoIssueService();