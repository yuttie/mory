# Auto-Issue Creation Feature

## Overview

The auto-issue creation feature automatically scans markdown notes for actionable items and converts them into proper tasks. This feature addresses the common problem of having scattered TODO items, FIXME notes, and action items throughout documentation that never get properly tracked.

## Supported Patterns

The feature recognizes the following patterns in markdown content:

### 1. Checkbox TODO Items
```markdown
- [ ] Implement user authentication
- [ ] Add data validation to API endpoints
  Additional details can be included on subsequent lines
```

### 2. TODO Comments
```markdown
TODO: Refactor the database connection logic
The current implementation has too much coupling.
```

### 3. FIXME Items
```markdown
FIXME: Memory leak in image processing
The image processor doesn't release memory properly.
```

### 4. Bug Reports
```markdown
BUG: Login form fails with special characters
Users can't login with passwords containing @#$ characters.
```

### 5. Action Items
```markdown
ACTION: Update API documentation
The new endpoints need to be documented.
```

### 6. Follow-up Notes
```markdown
NOTE: follow-up on security audit
Schedule a meeting to discuss findings.
```

## Priority Mapping

Items are automatically assigned priority levels:

- **High Priority (5/5)**: FIXME, BUG items
- **Medium Priority (3/5)**: TODO, ACTION items  
- **Low Priority (2/5)**: NOTE items

## Usage

1. Navigate to the **Tasks (New)** view
2. Click the **"Auto Issues"** button in the toolbar
3. Review the preview of detected issues
4. Click **"Create X Tasks"** to generate task files

## Features

- **Preview Mode**: See what issues would be created before committing
- **Progress Indicators**: Visual feedback during scanning and creation
- **Error Handling**: Graceful handling of API errors and edge cases
- **Duplicate Prevention**: Auto-created tasks are tagged to prevent re-processing
- **Source Tracking**: Each task includes reference to source file and line number

## Technical Implementation

### Files Added

- `src/services/issueDetector.ts` - Core pattern matching and issue detection
- `src/services/autoIssueService.ts` - Service orchestrating the scanning and creation process
- Enhanced `src/views/TasksNext.vue` - UI integration with dialog and controls

### Integration Points

- Uses existing `api.addNote()` for task creation
- Integrates with `useTaskForestStore()` for state management
- Follows existing task creation patterns and metadata structure
- Maintains compatibility with current task workflow

### Error Handling

- Graceful handling of network errors during note scanning
- Validation of detected patterns to prevent invalid tasks
- User feedback for creation errors and warnings
- Configurable limits to prevent overwhelming the system

## Configuration

The service supports configuration options:

```typescript
{
    includeCompleted: false,     // Skip completed tasks
    maxIssuesPerFile: 10,        // Limit issues per file
    filePatterns: ['*.md'],      // File patterns to scan
    skipTags: ['auto-created']   // Avoid re-processing
}
```

## Example Output

For the pattern:
```markdown
TODO: Implement user authentication
This needs to be done before the v2 release.
```

Creates a task file at `.tasks/[UUID].md`:
```markdown
---
task:
    status:
        kind: todo
    progress: 0
    importance: 3
    urgency: 3
    scheduled_dates: []
tags:
    - todo
    - auto-created
---

# Implement user authentication

This needs to be done before the v2 release.

---
*Auto-created from project-notes.md:15*
```

## Benefits

1. **Reduces Manual Work**: Automatically converts scattered notes into trackable tasks
2. **Improves Organization**: Centralizes action items in the task management system
3. **Maintains Context**: Preserves source location and additional details
4. **Flexible Patterns**: Supports multiple common note-taking conventions
5. **Safe Operation**: Preview mode prevents unwanted task creation

This feature seamlessly integrates with mory's existing task management workflow while providing a powerful way to automatically capture actionable items from your notes.