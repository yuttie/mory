# Quick Start Guide

This guide will help you get started with mory quickly. If you haven't installed mory yet, see the [Installation Guide](getting-started.md) first.

## First Steps

### 1. Access mory

Open your web browser and navigate to your mory instance (e.g., `http://127.0.0.1:8080`).

### 2. Familiarize with the Interface

mory's interface consists of several main sections:

- **Home** - Overview of recent notes and activity
- **Calendar** - Event management and scheduling
- **Tasks** - Task and project management
- **Files** - File browser and management
- **Search** - Find content across all your data
- **Config** - Application settings and preferences

## Creating Your First Note

### 1. Navigate to Notes

Click on the **Home** tab or use the create button to start a new note.

### 2. Create a New Note

- Click the **"+"** or **"Create"** button
- Choose a template (optional) or start with a blank note
- Give your note a meaningful filename (e.g., `my-first-note.md`)

### 3. Write Content

mory uses Markdown for formatting. Here's a simple example:

```markdown
# My First Note

Welcome to **mory**! This is my first note.

## Things I want to remember

- mory uses Markdown for formatting
- All notes are stored as plain text files
- Everything is version controlled with Git

## Next Steps

- [ ] Explore the calendar feature
- [ ] Set up some tasks
- [ ] Import my existing notes
```

### 4. Save and Preview

- The note saves automatically as you type
- Use the preview pane to see formatted output
- Toggle between edit and preview modes as needed

## Adding Your First Event

### 1. Open Calendar

Click on the **Calendar** tab to access event management.

### 2. Create an Event

Events in mory are created using note metadata. Add this to the top of any note:

```yaml
---
events:
  meeting:
    start: "2024-01-15 14:00"
    end: "2024-01-15 15:00"
    note: "Team planning session"
---

# Meeting Notes

[Your meeting content here]
```

### 3. View in Calendar

The event will automatically appear in your calendar view.

## Setting Up Tasks

### 1. Access Tasks

Click on the **Tasks** tab to open task management.

### 2. Create Tasks

Tasks can be created in multiple ways:

**Method 1: Direct Task Creation**
- Use the task interface to create new tasks
- Set priorities, due dates, and descriptions

**Method 2: In Notes with Markdown**
```markdown
# Project Tasks

- [ ] Research options
- [x] Write proposal (completed)
- [ ] Schedule meeting
- [ ] Review feedback
```

**Method 3: Using Metadata**
```yaml
---
tags: ["project", "urgent"]
---

# Project Planning

Task content goes here...
```

## Organizing Files

### 1. File Management

Use the **Files** tab to:
- Upload attachments
- Organize images and documents
- Link files to notes

### 2. Linking Files in Notes

Reference files in your notes:

```markdown
![Screenshot](files/screenshot.png)

[Download PDF](files/document.pdf)
```

## Using Search

### 1. Quick Search

Use the **Search** tab to find:
- Text within notes
- File names and content
- Task descriptions
- Event details

### 2. Search Tips

- Use keywords for broad searches
- Search for specific file types: `filetype:pdf`
- Use quotes for exact phrases: `"important meeting"`
- Combine terms: `project AND deadline`

## Customizing mory

### 1. Access Configuration

Click on **Config** to customize:
- Editor theme and appearance
- Syntax highlighting style
- Default templates
- File organization preferences

### 2. Common Customizations

- **Dark/Light Mode** - Choose your preferred theme
- **Editor Settings** - Adjust font size, line numbers, word wrap
- **Syntax Highlighting** - Pick from many code themes
- **Custom CSS** - Add your own styling

## Keyboard Shortcuts

### General Navigation
- `Ctrl/Cmd + K` - Quick search
- `Ctrl/Cmd + N` - New note
- `Ctrl/Cmd + S` - Save (auto-save is enabled)

### Editor Shortcuts
- `Ctrl/Cmd + B` - Bold text
- `Ctrl/Cmd + I` - Italic text
- `Ctrl/Cmd + L` - Insert link
- `Tab` - Indent list items
- `Shift + Tab` - Unindent list items

## Tips for Success

### 1. Develop a Naming Convention

Use consistent file naming:
- `2024-01-15-meeting-notes.md`
- `project-planning.md`
- `daily-2024-01-15.md`

### 2. Use Tags and Metadata

Organize with frontmatter:
```yaml
---
tags: ["work", "project", "urgent"]
created: "2024-01-15"
---
```

### 3. Leverage Templates

Create note templates for:
- Meeting notes
- Daily journals
- Project planning
- Task lists

### 4. Regular Backups

Since mory uses Git:
- Your changes are automatically tracked
- Push to remote repositories for backup
- Use branching for experimental changes

## Next Steps

Now that you know the basics:

1. **Explore Features** - Dive deeper into specific areas:
   - [Notes](notes.md) - Advanced note-taking features
   - [Calendar](calendar.md) - Event management
   - [Tasks](tasks.md) - Project tracking
   - [Markdown](markdown.md) - Rich formatting options

2. **Customize** - Set up mory to match your workflow:
   - [Configuration](configuration.md) - Detailed customization options

3. **Import Data** - Move your existing notes and files into mory

4. **Develop Workflows** - Create processes that work for you:
   - Daily note templates
   - Project organization systems
   - Review and planning routines

## Getting Help

If you need assistance:
- Check specific feature documentation
- Review the [configuration guide](configuration.md)
- Report issues on [GitHub](https://github.com/yuttie/mory/issues)