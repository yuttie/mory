import type { UUID } from '@/api';
import type { Task } from '@/task';
import { makeDefaultStatus } from '@/task';

export interface DetectedIssue {
    title: string;
    content: string;
    sourceFile: string;
    lineNumber: number;
    priority: 'low' | 'medium' | 'high';
    tags: string[];
    type: 'todo' | 'fixme' | 'bug' | 'action' | 'note';
}

export interface IssuePattern {
    regex: RegExp;
    type: DetectedIssue['type'];
    priority: DetectedIssue['priority'];
    extractTitle: (match: RegExpMatchArray) => string;
    extractContent: (match: RegExpMatchArray) => string;
}

// Define patterns for detecting different types of issues
export const ISSUE_PATTERNS: IssuePattern[] = [
    // TODO patterns
    {
        regex: /^[\s]*(?:[-*+]|\d+\.)\s*\[[ ]\]\s*(.*?)(?:\n((?:[\s]*[^\n]*\n?)*?))?$/gmi,
        type: 'todo',
        priority: 'medium',
        extractTitle: (match) => match[1]?.trim() || 'Untitled Task',
        extractContent: (match) => (match[2] || '').trim(),
    },
    // TODO: comments
    {
        regex: /(?:TODO|@todo):\s*(.*?)(?:\n((?:[\s]*[^\n]*\n?)*))?$/gmi,
        type: 'todo',
        priority: 'medium',
        extractTitle: (match) => match[1]?.trim() || 'TODO Item',
        extractContent: (match) => (match[2] || '').trim(),
    },
    // FIXME patterns
    {
        regex: /(?:FIXME|@fixme):\s*(.*?)(?:\n((?:[\s]*[^\n]*\n?)*))?$/gmi,
        type: 'fixme',
        priority: 'high',
        extractTitle: (match) => `Fix: ${match[1]?.trim() || 'Issue'}`,
        extractContent: (match) => (match[2] || '').trim(),
    },
    // BUG patterns
    {
        regex: /(?:BUG|@bug):\s*(.*?)(?:\n((?:[\s]*[^\n]*\n?)*))?$/gmi,
        type: 'bug',
        priority: 'high',
        extractTitle: (match) => `Bug: ${match[1]?.trim() || 'Issue'}`,
        extractContent: (match) => (match[2] || '').trim(),
    },
    // ACTION patterns
    {
        regex: /(?:ACTION|@action):\s*(.*?)(?:\n((?:[\s]*[^\n]*\n?)*))?$/gmi,
        type: 'action',
        priority: 'medium',
        extractTitle: (match) => `Action: ${match[1]?.trim() || 'Item'}`,
        extractContent: (match) => (match[2] || '').trim(),
    },
    // NOTE patterns for follow-up
    {
        regex: /(?:NOTE|@note):\s*(?:follow-?up|review|check)\s*(.*?)(?:\n((?:[\s]*[^\n]*\n?)*))?$/gmi,
        type: 'note',
        priority: 'low',
        extractTitle: (match) => `Follow-up: ${match[1]?.trim() || 'Item'}`,
        extractContent: (match) => (match[2] || '').trim(),
    },
];

/**
 * Scans markdown content for actionable items and issues
 */
export function detectIssues(content: string, sourceFile: string): DetectedIssue[] {
    const issues: DetectedIssue[] = [];
    const lines = content.split('\n');

    for (const pattern of ISSUE_PATTERNS) {
        let match;
        pattern.regex.lastIndex = 0; // Reset regex state
        
        while ((match = pattern.regex.exec(content)) !== null) {
            const matchText = match[0];
            const lineNumber = content.substring(0, match.index).split('\n').length;
            
            const title = pattern.extractTitle(match);
            const extractedContent = pattern.extractContent(match);
            
            // Skip empty or very short titles
            if (!title || title.length < 3) {
                continue;
            }

            // Auto-tag based on pattern type and content
            const tags = [pattern.type];
            if (extractedContent.toLowerCase().includes('urgent')) {
                tags.push('urgent');
            }
            if (extractedContent.toLowerCase().includes('important')) {
                tags.push('important');
            }

            issues.push({
                title,
                content: extractedContent,
                sourceFile,
                lineNumber,
                priority: pattern.priority,
                tags,
                type: pattern.type,
            });
        }
    }

    return issues;
}

/**
 * Converts a detected issue into a Task object
 */
export function issueToTask(issue: DetectedIssue): Task {
    const uuid = crypto.randomUUID();
    
    // Map priority to importance/urgency values
    let importance = 3;
    let urgency = 3;
    
    switch (issue.priority) {
        case 'high':
            importance = 5;
            urgency = 5;
            break;
        case 'medium':
            importance = 3;
            urgency = 3;
            break;
        case 'low':
            importance = 2;
            urgency = 2;
            break;
    }

    const note = issue.content ? 
        `${issue.content}\n\n---\n*Auto-created from ${issue.sourceFile}:${issue.lineNumber}*` :
        `*Auto-created from ${issue.sourceFile}:${issue.lineNumber}*`;

    return {
        uuid,
        title: issue.title,
        tags: [...issue.tags, 'auto-created'],
        status: makeDefaultStatus('todo'),
        progress: 0,
        importance,
        urgency,
        scheduled_dates: [],
        note,
    };
}

/**
 * Groups detected issues by their source file
 */
export function groupIssuesByFile(issues: DetectedIssue[]): Record<string, DetectedIssue[]> {
    return issues.reduce((groups, issue) => {
        if (!groups[issue.sourceFile]) {
            groups[issue.sourceFile] = [];
        }
        groups[issue.sourceFile].push(issue);
        return groups;
    }, {} as Record<string, DetectedIssue[]>);
}