# Tasks Guide

mory provides flexible task management that integrates seamlessly with your notes and projects. Track todos, manage projects, and organize your workflow all within your note-taking system.

## Task Overview

### Key Features

- **Multiple Task Views** - Classic list view and modern task interface
- **Note Integration** - Tasks can live within any note
- **Hierarchical Organization** - Nested tasks and subtasks
- **Drag & Drop** - Reorder tasks with drag and drop
- **Project Tracking** - Group tasks by projects or categories
- **Due Dates & Priorities** - Schedule and prioritize your work

### Access Tasks

Click the **Tasks** tab to open task management. You may see both "Tasks" and "Tasks Next" - these represent different interface styles.

## Creating Tasks

### Method 1: Task Interface

**Using the Task Panel**
1. Navigate to the **Tasks** tab
2. Click **"Add Task"** or **"+"** button
3. Fill in task details:
   - Task description
   - Due date (optional)
   - Priority level
   - Project/category tags

### Method 2: Markdown in Notes

**Checkbox Syntax**
```markdown
# Project Tasks

## Current Sprint
- [ ] Design user interface mockups
- [ ] Implement authentication system
- [x] Set up database schema (completed)
- [ ] Write API documentation

## Future Tasks
- [ ] Performance optimization
- [ ] User testing
- [ ] Deploy to production
```

**Advanced Task Markdown**
```markdown
# Development Tasks

- [ ] **High Priority**: Fix critical bug in login system
- [ ] Review pull request #123
- [ ] Update dependencies to latest versions
- [ ] 📅 2024-01-30: Complete quarterly review
- [ ] @alice: Get feedback on new feature
```

### Method 3: Note Metadata

**YAML Frontmatter**
```yaml
---
tags: ["project", "urgent"]
status: "in-progress"
assignee: "me"
deadline: "2024-01-30"
---

# Project Planning

Task details in note content...
```

## Task Properties

### Core Properties

**Description** - What needs to be done
```markdown
- [ ] Complete user research interviews
- [ ] Write quarterly report
- [ ] Review team performance metrics
```

**Status** - Current state
- `[ ]` - Pending/Todo
- `[x]` - Completed
- `[-]` - Cancelled/Won't do
- `[>]` - Deferred/Scheduled
- `[?]` - Question/Need info

**Priority Indicators**
```markdown
- [ ] 🔴 Critical: Fix security vulnerability
- [ ] 🟡 Medium: Update user documentation  
- [ ] 🟢 Low: Organize code comments
- [ ] ⭐ Important: Client presentation
```

### Extended Properties

**Due Dates**
```markdown
- [ ] 📅 2024-01-15: Submit project proposal
- [ ] 🗓️ Jan 30: Complete code review
- [ ] ⏰ Tomorrow: Send follow-up email
```

**Assignments**
```markdown
- [ ] @alice: Review design mockups
- [ ] @bob: Test new feature
- [ ] @team: Weekly planning meeting
```

**Estimates & Time Tracking**
```markdown
- [ ] 🕐 2h: Write user documentation
- [ ] ⏱️ 30m: Update project status
- [ ] 📊 4-6h: Implement new feature
```

## Task Organization

### Hierarchical Tasks

**Nested Structure**
```markdown
# Project: Website Redesign

- [ ] Planning Phase
  - [x] Gather requirements
  - [x] Create wireframes
  - [ ] Design approval
    - [ ] Present to stakeholders
    - [ ] Incorporate feedback
    - [ ] Final approval sign-off

- [ ] Development Phase
  - [ ] Frontend development
    - [ ] HTML structure
    - [ ] CSS styling
    - [ ] JavaScript functionality
  - [ ] Backend integration
  - [ ] Testing
```

**Project Grouping**
```markdown
## 🚀 Current Projects

### Website Redesign
- [ ] Complete wireframes
- [ ] Client review meeting
- [ ] Implement feedback

### Mobile App
- [ ] User testing session
- [ ] Bug fixes from testing
- [ ] App store submission

### Documentation
- [ ] Update user guide
- [ ] Create video tutorials
- [ ] Review existing content
```

### Tags and Categories

**Using Tags**
```yaml
---
tags: ["work", "urgent", "client-work"]
project: "website-redesign"
category: "development"
---
```

**Category-Based Organization**
```markdown
# Personal Tasks

## 🏠 Home
- [ ] Schedule dentist appointment
- [ ] Fix leaky faucet
- [ ] Organize garage

## 💼 Work
- [ ] Prepare presentation
- [ ] Team 1:1 meetings
- [ ] Review quarterly goals

## 📚 Learning
- [ ] Complete online course
- [ ] Read industry articles
- [ ] Practice new programming language
```

## Task Management Features

### Drag & Drop Reordering

**In Task Interface**
- Drag tasks to reorder priorities
- Move tasks between projects
- Reorganize hierarchical structure
- Drop tasks into different categories

### Filtering and Sorting

**Filter Options**
- By status (pending, completed, all)
- By priority level
- By due date (overdue, today, this week)
- By project or tag
- By assignee

**Sort Options**
- By creation date
- By due date
- By priority
- By completion status
- Alphabetical by description

### Bulk Operations

**Multiple Task Actions**
- Select multiple tasks
- Mark as complete/incomplete
- Change priority levels
- Update due dates
- Move to different projects
- Delete completed tasks

## Advanced Task Features

### Templates

**Task List Templates**
```yaml
---
template: "project-kickoff"
---

# Project Kickoff Tasks

## Planning
- [ ] Define project scope
- [ ] Identify stakeholders
- [ ] Set timeline and milestones
- [ ] Allocate resources

## Setup
- [ ] Create project repository
- [ ] Set up development environment
- [ ] Configure CI/CD pipeline
- [ ] Create documentation structure

## Communication
- [ ] Kickoff meeting
- [ ] Weekly status meetings
- [ ] Stakeholder updates
- [ ] Project retrospective
```

### Recurring Tasks

**Daily Tasks**
```markdown
# Daily Routine - {{ date }}

- [ ] Morning standup meeting
- [ ] Check and respond to emails
- [ ] Review daily priorities
- [ ] End-of-day task review
```

**Weekly Tasks**
```markdown
# Weekly Review - Week of {{ week }}

- [ ] Review previous week accomplishments
- [ ] Plan upcoming week priorities
- [ ] Update project status
- [ ] Team check-ins
- [ ] Clear completed tasks
```

### Task Dependencies

**Sequential Tasks**
```markdown
# Website Launch Sequence

1. [ ] Complete development
   - [ ] Frontend complete
   - [ ] Backend complete
   - [ ] Testing passed

2. [ ] Staging deployment ⬅️ *Depends on #1*
   - [ ] Deploy to staging
   - [ ] Stakeholder review
   - [ ] Performance testing

3. [ ] Production launch ⬅️ *Depends on #2*
   - [ ] Final deployment
   - [ ] Monitor performance
   - [ ] Announce launch
```

## Time Management

### Due Dates and Deadlines

**Date Formats**
```markdown
- [ ] 📅 2024-01-15: Project deadline
- [ ] 🗓️ Tomorrow: Team meeting
- [ ] ⏰ Next Friday: Code review
- [ ] 📆 End of month: Monthly report
```

**Visual Indicators**
- 🔴 Overdue tasks
- 🟡 Due today
- 🟢 Due this week
- ⚪ Future tasks

### Time Blocking

**Schedule Integration**
```yaml
---
events:
  focused-work:
    start: "2024-01-15 09:00"
    end: "2024-01-15 11:00"
    note: "Deep work on priority tasks"
---

# Deep Work Session

## Priority Tasks (2 hours)
- [ ] 🕐 1h: Complete feature implementation
- [ ] 🕐 30m: Write tests
- [ ] 🕐 30m: Update documentation
```

### Productivity Tracking

**Progress Indicators**
```markdown
# Project Progress

## Sprint 1 (Week 1-2) ✅ Complete
- [x] Requirements gathering
- [x] Initial design
- [x] Development setup

## Sprint 2 (Week 3-4) 🔄 In Progress (60%)
- [x] Core functionality
- [x] User interface
- [ ] Testing and refinement
- [ ] Documentation

## Sprint 3 (Week 5-6) ⏳ Planned
- [ ] Performance optimization
- [ ] User acceptance testing
- [ ] Final deployment
```

## Integration with Other Features

### Task-Note Linking

**Reference Tasks in Notes**
```markdown
# Meeting Notes - 2024-01-15

## Discussion Points
- Project timeline review
- Resource allocation
- Next steps

## Action Items
See tasks in [Project Tasks](tasks/project-x.md):
- [ ] Follow up with client (Alice)
- [ ] Update project timeline (Bob)
- [ ] Schedule next review meeting (Me)
```

### Calendar Integration

**Task Deadlines as Events**
```yaml
---
events:
  project-deadline:
    start: "2024-01-30"
    note: "Project X final deliverables due"
    color: "red"
tags: ["project-x", "deadline"]
---

# Project X Tasks

- [ ] 📅 2024-01-30: Submit final deliverables
- [ ] Complete testing by 2024-01-28
- [ ] Client review by 2024-01-25
```

### File Attachments

**Task-Related Files**
```markdown
# Design Review Tasks

- [ ] Review mockup files
  - ![Mockup 1](files/designs/mockup-v1.png)
  - ![Mockup 2](files/designs/mockup-v2.png)
  
- [ ] Provide feedback document
  - [Feedback Template](files/templates/design-feedback.docx)
  
- [ ] Update design specifications
  - [Current Specs](files/docs/design-specs.pdf)
```

## Task Views and Interfaces

### Classic Tasks View

**List-Based Interface**
- Traditional task list display
- Checkbox completion
- Basic filtering and sorting
- Simple creation and editing

### Tasks Next Interface

**Modern Task Management**
- Card-based layout
- Drag and drop reordering
- Advanced filtering options
- Rich task properties
- Project grouping
- Visual priority indicators

### Choosing Your Interface

**Classic Tasks - Best for:**
- Simple task lists
- Note-integrated tasks
- Minimal interface preference
- Quick task entry

**Tasks Next - Best for:**
- Complex project management
- Visual organization
- Team collaboration
- Advanced task properties

## Keyboard Shortcuts

### Task Creation
- `Ctrl/Cmd + T` - New task
- `Enter` - Create task in list
- `Tab` - Indent task (create subtask)
- `Shift + Tab` - Unindent task

### Task Management
- `Space` - Toggle task completion
- `Ctrl/Cmd + D` - Duplicate task
- `Delete` - Remove task
- `Ctrl/Cmd + Up/Down` - Move task priority

### Navigation
- `Arrow Keys` - Navigate task list
- `Enter` - Edit task
- `Escape` - Cancel editing
- `Ctrl/Cmd + F` - Search tasks

## Best Practices

### Task Writing

1. **Be Specific** - Clear, actionable descriptions
2. **Use Active Language** - Start with verbs (Complete, Review, Send)
3. **Include Context** - Add enough detail for future reference
4. **Set Realistic Scope** - Break large tasks into smaller ones

### Organization

1. **Consistent Structure** - Develop personal organization patterns
2. **Regular Reviews** - Weekly task list cleanup and planning
3. **Priority Management** - Focus on high-impact tasks first
4. **Project Grouping** - Keep related tasks together

### Workflow Integration

1. **Daily Planning** - Start each day by reviewing tasks
2. **Weekly Reviews** - Assess progress and plan ahead
3. **Project Milestones** - Break projects into measurable tasks
4. **Time Boxing** - Estimate and track task completion times

## Troubleshooting

### Common Issues

**Tasks Not Saving**
- Check note syntax for proper markdown
- Verify file permissions
- Ensure network connectivity for sync

**Missing Tasks**
- Check if tasks are in different notes
- Verify filter settings
- Search for task content

**Drag & Drop Not Working**
- Refresh browser page
- Check for JavaScript errors
- Try using keyboard shortcuts instead

**Performance Issues**
- Large numbers of tasks may slow interface
- Consider archiving completed tasks
- Break large task lists into separate notes

### Data Management

**Task Backup**
- Tasks stored in markdown notes are backed up with Git
- Export tasks by copying note content
- Use version control for task history

**Task Migration**
- Move tasks between notes by cut/paste
- Use templates for consistent task structure
- Bulk operations for large task moves

## Getting Help

For additional task management support:
- Review [Notes guide](notes.md) for markdown task syntax
- Check [Configuration](configuration.md) for task settings
- See [Calendar guide](calendar.md) for deadline integration
- Report issues on [GitHub](https://github.com/yuttie/mory/issues)