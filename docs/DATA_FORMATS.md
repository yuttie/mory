# Data Format Specifications

This document describes the data formats used in mory, including YAML frontmatter structure, task metadata, event definitions, and date/time formats.

## Table of Contents

- [YAML Frontmatter Structure](#yaml-frontmatter-structure)
- [Task Metadata Schema](#task-metadata-schema)
- [Event Metadata Schema](#event-metadata-schema)
- [Date and Time Formats](#date-and-time-formats)
- [File Naming Conventions](#file-naming-conventions)
- [Tags System](#tags-system)

## YAML Frontmatter Structure

All Markdown files in mory can contain YAML frontmatter for metadata. The frontmatter must be placed at the beginning of the file, enclosed in triple dashes.

### Basic Structure

```yaml
---
tags:
  - example
  - work
task:
  status:
    kind: todo
  progress: 0
  importance: 3
  urgency: 2
  scheduled_dates: []
events:
  meeting:
    start: "2023-12-01T14:00:00+00:00"
    end: "2023-12-01T15:00:00+00:00"
    color: "#ff5722"
---

# Your Markdown Content Here

Content of your note goes here...
```

### Root Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `tags` | `string[]` or `null` | No | Array of tag strings |
| `task` | `object` or `null` | No | Task metadata object |
| `events` | `object` or `null` | No | Event definitions object |

## Task Metadata Schema

Tasks are defined using a comprehensive metadata structure that supports various status types and workflow management.

### Task Object Structure

```yaml
task:
  status:
    kind: todo  # Required: task status
  progress: 0   # Required: 0-100
  importance: 3 # Required: 1-5 scale
  urgency: 2    # Required: 1-5 scale
  start_at: "2023-12-01T09:00:00+00:00"  # Optional
  due_by: "2023-12-01T17:00:00+00:00"    # Optional
  deadline: "2023-12-01T23:59:59+00:00"  # Optional
  scheduled_dates:  # Required: array of date strings
    - "2023-12-01"
    - "2023-12-02"
```

### Task Status Types

#### 1. Todo Status
```yaml
status:
  kind: todo
```

#### 2. In Progress Status
```yaml
status:
  kind: in_progress
```

#### 3. Waiting Status
```yaml
status:
  kind: waiting
  waiting_for: "Client feedback"  # Required
  expected_by: "2023-12-05"       # Optional
  contact: "john@example.com"     # Optional
  follow_up_at: "2023-12-03"      # Optional
```

#### 4. Blocked Status
```yaml
status:
  kind: blocked
  blocked_by: "Missing dependencies"  # Required
```

#### 5. On Hold Status
```yaml
status:
  kind: on_hold
  hold_reason: "Waiting for budget approval"  # Required
  review_at: "2023-12-15"                     # Optional
```

#### 6. Done Status
```yaml
status:
  kind: done
  completed_at: "2023-12-01T15:30:00+00:00"  # Required
  completion_note: "Finished ahead of schedule"  # Optional
```

#### 7. Canceled Status
```yaml
status:
  kind: canceled
  canceled_at: "2023-12-01T12:00:00+00:00"  # Required
  cancel_reason: "Requirements changed"       # Required
```

### Task Property Details

| Property | Type | Range/Format | Description |
|----------|------|--------------|-------------|
| `progress` | `number` | 0-100 | Completion percentage |
| `importance` | `number` | 1-5 | Priority level (1=lowest, 5=highest) |
| `urgency` | `number` | 1-5 | Urgency level (1=lowest, 5=highest) |
| `start_at` | `string` | ISO 8601 | When task should start |
| `due_by` | `string` | ISO 8601 | Preferred completion time |
| `deadline` | `string` | ISO 8601 | Hard deadline |
| `scheduled_dates` | `string[]` | YYYY-MM-DD | Dates task is scheduled |

### Status Workflow

Tasks follow a defined workflow for status transitions:

- `todo` → `in_progress`, `waiting`, `blocked`, `canceled`
- `in_progress` → `waiting`, `blocked`, `on_hold`, `done`, `canceled`
- `waiting` → `in_progress`, `done`, `canceled`
- `blocked` → `in_progress`, `waiting`, `canceled`
- `on_hold` → `in_progress`, `canceled`
- `done` → (no transitions)
- `canceled` → (no transitions)

## Event Metadata Schema

Events represent calendar entries and can be either single occurrences or recurring events.

### Single Event

```yaml
events:
  meeting:
    start: "2023-12-01T14:00:00+00:00"  # Required
    end: "2023-12-01T15:00:00+00:00"    # Optional
    finished: true                       # Optional
    color: "#ff5722"                     # Optional
    note: "Weekly team sync"             # Optional
```

### Multiple/Recurring Event

```yaml
events:
  weekly_standup:
    end: "2023-12-31T23:59:59+00:00"    # Optional: series end date
    color: "#2196f3"                     # Optional
    note: "Daily standup meeting"        # Optional
    times:  # Required: array of time slots
      - start: "2023-12-01T09:00:00+00:00"
        end: "2023-12-01T09:30:00+00:00"
      - start: "2023-12-02T09:00:00+00:00"
        end: "2023-12-02T09:30:00+00:00"
```

### Event Property Details

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `start` | `string` | Yes (single events) | Event start time in ISO 8601 |
| `end` | `string` | No | Event end time in ISO 8601 |
| `finished` | `boolean` | No | Whether event is completed |
| `color` | `string` | No | Hex color code for display |
| `note` | `string` | No | Additional notes about the event |
| `times` | `array` | Yes (multiple events) | Array of time slots |

## Date and Time Formats

### ISO 8601 / RFC 3339 Format

All date and time values must use ISO 8601 format with timezone information:

```
YYYY-MM-DDTHH:MM:SS+TZ:TZ
```

#### Examples:
- `2023-12-01T14:30:00+00:00` (UTC)
- `2023-12-01T14:30:00+09:00` (JST)
- `2023-12-01T14:30:00-05:00` (EST)

### Date-Only Format

For date-only fields (like `scheduled_dates`), use:

```
YYYY-MM-DD
```

#### Examples:
- `2023-12-01`
- `2023-12-25`

### Supported Timezones

The system supports all standard timezone offsets:

- UTC offsets: `+00:00` to `+14:00`
- Negative offsets: `-01:00` to `-12:00`
- Half-hour offsets: `+05:30`, `+09:30`, etc.
- Quarter-hour offsets: `+05:45`, `+12:45`

#### Common Timezone Examples:
```yaml
# UTC
"2023-12-01T12:00:00+00:00"

# Eastern Time (EST)
"2023-12-01T07:00:00-05:00"

# Pacific Time (PST)
"2023-12-01T04:00:00-08:00"

# Japan Standard Time
"2023-12-01T21:00:00+09:00"

# India Standard Time
"2023-12-01T17:30:00+05:30"
```

## File Naming Conventions

### UUID-Based Naming

mory uses UUID v4 for file identification to ensure uniqueness and avoid conflicts.

#### Basic Format:
```
{optional-name-}{uuid}.{extension}
```

#### Examples:
- `550e8400-e29b-41d4-a716-446655440000.md`
- `meeting-notes-550e8400-e29b-41d4-a716-446655440000.md`
- `project-plan-550e8400-e29b-41d4-a716-446655440000.md`

### Directory Structure

#### Tasks:
- Path: `.tasks/{uuid}.md` or `.tasks/{name-}{uuid}.md`
- Example: `.tasks/complete-docs-550e8400-e29b-41d4-a716-446655440000.md`

#### Events:
- Path: `.events/{uuid}.md` or `.events/{name-}{uuid}.md`
- Example: `.events/team-meeting-550e8400-e29b-41d4-a716-446655440000.md`

#### Hierarchical Tasks:
- Path: `.tasks/{parent-uuid}/{uuid}.md`
- Example: `.tasks/550e8400-e29b-41d4-a716-446655440000/550e8400-e29b-41d4-a716-446655440001.md`

### File Name Parsing Rules

1. **UUID Extraction**: The last 36 characters before the extension must be a valid UUID v4
2. **Name Extraction**: Everything before the UUID (minus trailing dash) is treated as the optional name
3. **Directory Names**: Must be valid UUID v4 for hierarchical organization

## Tags System

### Tag Format

Tags are simple strings stored in an array:

```yaml
tags:
  - work
  - project
  - urgent
  - meeting
```

### Tag Naming Rules

- **Case Sensitive**: `Work` and `work` are different tags
- **No Spaces**: Use hyphens or underscores: `project-alpha`, `project_alpha`
- **Alphanumeric**: Letters, numbers, hyphens, and underscores recommended
- **No Special Characters**: Avoid quotes, slashes, and other special characters

### Common Tag Patterns

#### By Type:
```yaml
tags: [note, task, event, draft, archive]
```

#### By Project:
```yaml
tags: [project-alpha, project-beta, client-work]
```

#### By Priority:
```yaml
tags: [urgent, high-priority, low-priority]
```

#### By Context:
```yaml
tags: [work, personal, home, travel]
```

### Tag Sorting

Tags are sorted alphabetically (case-insensitive) in the UI for consistent display.

## Validation and Error Handling

### Common Validation Errors

1. **Invalid Date Format**: Non-ISO 8601 dates will cause parsing errors
2. **Missing Required Fields**: Status-specific required fields must be present
3. **Invalid UUID**: File names must contain valid UUID v4
4. **Invalid Status Transitions**: Status changes must follow the defined workflow
5. **Out of Range Values**: Progress (0-100), importance/urgency (1-5)

### Error Response Example

```json
{
  "error": "Invalid task metadata",
  "details": "progress must be between 0 and 100"
}
```