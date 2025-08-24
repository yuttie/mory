# Calendar & Events Guide

mory's calendar system seamlessly integrates event management with your notes, allowing you to schedule and track events while keeping related content together.

## Calendar Overview

### Key Features

- **Note-Integrated Events** - Events are defined within note metadata
- **Multiple Event Types** - Single events, recurring events, and complex schedules
- **Visual Calendar** - Month, week, and day views
- **Event Notifications** - Service worker notifications for upcoming events
- **Flexible Scheduling** - Support for all-day events, time ranges, and repeating patterns

### Access Calendar

Click the **Calendar** tab in the navigation to open the calendar interface.

## Creating Events

Events in mory are created by adding metadata to any note. This keeps event information connected to relevant content.

### Basic Event Structure

Add events to the frontmatter of any note:

```yaml
---
events:
  event-name:
    start: "2024-01-15 14:00"
    end: "2024-01-15 15:00"
    note: "Brief description"
---

# Meeting Notes

Content related to this event...
```

### Event Properties

#### Required Properties

**start** - Event start time
```yaml
start: "2024-01-15 14:00"        # Date and time
start: "2024-01-15"              # All-day event
start: "14:00"                   # Time only (today)
```

#### Optional Properties

**end** - Event end time
```yaml
end: "2024-01-15 15:00"          # Absolute end time
end: "+1h"                       # Relative to start (1 hour later)
end: "+30m"                      # 30 minutes later
end: "+2h30m"                    # 2 hours 30 minutes later
```

**note** - Event description
```yaml
note: "Team planning session in conference room A"
```

**color** - Visual indicator
```yaml
color: "blue"                    # Named colors
color: "#ff5722"                 # Hex colors
color: "rgb(255, 87, 34)"        # RGB colors
```

**finished** - Mark event as completed
```yaml
finished: true                   # Event is done
finished: false                  # Event is pending (default)
```

## Event Types

### Single Events

Simple one-time events:

```yaml
---
events:
  dentist-appointment:
    start: "2024-01-15 10:00"
    end: "2024-01-15 11:00"
    note: "Annual checkup"
    color: "green"
  
  birthday-party:
    start: "2024-01-20"
    note: "Sarah's birthday celebration"
    color: "purple"
---
```

### Multiple Instance Events

Events with several occurrences:

```yaml
---
events:
  weekly-meeting:
    color: "blue"
    note: "Team standup meeting"
    times:
      - start: "2024-01-15 09:00"
        end: "2024-01-15 09:30"
      - start: "2024-01-22 09:00"
        end: "2024-01-22 09:30"
      - start: "2024-01-29 09:00"
        end: "2024-01-29 09:30"
        note: "Last meeting before deadline"
        finished: true
---
```

### Complex Events

Events with shared properties and individual customization:

```yaml
---
events:
  project-milestones:
    color: "red"
    note: "Project checkpoint meetings"
    times:
      - start: "2024-01-10 15:00"
        end: "2024-01-10 16:00"
        note: "Kickoff meeting"
        finished: true
      - start: "2024-01-24 15:00" 
        end: "2024-01-24 16:00"
        note: "Mid-project review"
      - start: "2024-02-07 15:00"
        end: "2024-02-07 16:00"
        note: "Final presentation"
        color: "purple"  # Override default color
---
```

## Calendar Views

### Month View

- **Default view** showing the full month
- **Event indicators** on relevant dates
- **Click dates** to see event details
- **Navigation** between months using arrows or scroll

### Day/Week Views

Access detailed views:
- Click on specific dates for day view
- Use navigation controls for week view
- View event times and descriptions
- Quick access to related notes

### Event Colors

Visual organization with color coding:

**Predefined Colors**
- `red`, `blue`, `green`, `yellow`, `purple`, `orange`
- `pink`, `cyan`, `teal`, `brown`, `gray`

**Custom Colors**
- Hex: `#ff5722`, `#2196f3`
- RGB: `rgb(255, 87, 34)`
- Named: `darkblue`, `lightgreen`

**Color Strategies**
- **By type**: meetings (blue), personal (green), deadlines (red)
- **By project**: project A (purple), project B (orange)
- **By priority**: urgent (red), normal (blue), low (gray)

## Time Formats

### Date Formats

```yaml
# Full date and time
start: "2024-01-15 14:30"
start: "2024-01-15T14:30:00"

# Date only (all-day event)
start: "2024-01-15"

# Time only (defaults to today)
start: "14:30"
start: "2:30 PM"
```

### Relative Times

For end times, use relative notation:

```yaml
# Duration-based
end: "+1h"          # 1 hour later
end: "+30m"         # 30 minutes later
end: "+2h30m"       # 2 hours 30 minutes later
end: "+1d"          # 1 day later (for multi-day events)

# Combined
end: "+1h30m"       # 1 hour 30 minutes
```

### Time Zones

mory uses your system timezone by default. For specific timezones:

```yaml
start: "2024-01-15 14:00+09:00"  # Japan Standard Time
start: "2024-01-15 14:00Z"       # UTC
```

## Event Management

### Creating Events

1. **Choose a Note** - Events can be added to any note
2. **Add Frontmatter** - Include event metadata at the top
3. **Save** - Events appear automatically in calendar

### Editing Events

1. **Find the Note** - Locate the note containing the event
2. **Edit Metadata** - Modify the frontmatter
3. **Save** - Changes reflect immediately in calendar

### Deleting Events

1. **Open the Note** - Navigate to the relevant note
2. **Remove Metadata** - Delete the event from frontmatter
3. **Save** - Event disappears from calendar

### Marking Events Complete

Set the `finished` property:

```yaml
events:
  meeting:
    start: "2024-01-15 14:00"
    finished: true  # Mark as completed
```

## Event Notifications

mory can send browser notifications for upcoming events.

### Enabling Notifications

1. **Grant Permission** - Allow notifications in your browser
2. **Service Worker** - mory's service worker handles notifications
3. **Background Updates** - Events are checked periodically

### Notification Timing

- Notifications appear for events starting soon
- Only future events trigger notifications
- Events marked as `finished` won't notify

### Notification Content

Notifications include:
- Event name
- Start time
- Note content (if provided)
- Link to related note

## Advanced Features

### Event Templates

Create note templates with common event structures:

```yaml
---
tags: ["meeting"]
events:
  meeting:
    start: "{{ date }} {{ time }}"
    end: "+1h"
    note: "{{ description }}"
    color: "blue"
---

# Meeting: {{ title }}

## Agenda


## Notes


## Action Items

```

### Integration with Tasks

Combine events with task management:

```yaml
---
events:
  project-deadline:
    start: "2024-02-01"
    color: "red"
    note: "Project X submission deadline"
tags: ["project-x", "deadline"]
---

# Project X Completion

## Final Tasks
- [ ] Complete testing
- [ ] Prepare documentation
- [ ] Submit deliverables

Event: {{ events.project-deadline.note }}
```

### Recurring Events

For truly recurring events, create multiple instances:

```yaml
---
events:
  gym:
    color: "green"
    note: "Workout session"
    times:
      - start: "2024-01-15 07:00"
        end: "2024-01-15 08:00"
      - start: "2024-01-17 07:00"
        end: "2024-01-17 08:00"
      - start: "2024-01-19 07:00"
        end: "2024-01-19 08:00"
      # ... continue pattern
---
```

### Event Queries

Search for events:
- **By date**: Find events on specific dates
- **By text**: Search event names and descriptions
- **By status**: Filter completed vs pending events
- **By color**: Organize by visual categories

## Calendar Navigation

### Keyboard Shortcuts

- **Arrow Keys** - Navigate between dates
- **Home** - Go to today
- **Page Up/Down** - Previous/next month
- **Enter** - Open selected date
- **Escape** - Return to month view

### Mouse/Touch Controls

- **Click dates** - View day details
- **Scroll wheel** - Navigate months
- **Drag** - Move between time periods (where supported)
- **Touch gestures** - Swipe on mobile devices

## Best Practices

### Organization Strategies

1. **Consistent Naming** - Use clear, descriptive event names
2. **Color Coding** - Develop a personal color system
3. **Note Integration** - Keep event details in related notes
4. **Regular Review** - Use calendar for weekly/monthly planning

### Event Documentation

1. **Meeting Notes** - Link events to meeting notes
2. **Project Tracking** - Connect events to project milestones
3. **Personal Events** - Include personal reminders and celebrations
4. **Deadlines** - Track important due dates

### Time Management

1. **Buffer Time** - Include travel and preparation time
2. **Realistic Scheduling** - Don't overbook your calendar
3. **Regular Patterns** - Use recurring events for habits
4. **Review Cycles** - Schedule regular review sessions

## Troubleshooting

### Common Issues

**Events Not Appearing**
- Check YAML syntax in frontmatter
- Verify date format is correct
- Ensure note is saved properly

**Notifications Not Working**
- Check browser notification permissions
- Verify service worker is active
- Ensure events have future start times

**Wrong Times Displayed**
- Check system timezone settings
- Verify date format includes timezone if needed
- Review relative time calculations

**Calendar Not Loading**
- Refresh the browser
- Check for JavaScript errors
- Verify network connectivity

### Date Format Issues

Common date format problems:

```yaml
# Incorrect
start: "01/15/2024"     # Wrong format
start: "Jan 15, 2024"   # Not supported

# Correct
start: "2024-01-15"     # ISO format
start: "2024-01-15 14:00"  # With time
```

### Performance Tips

- **Large number of events** may slow calendar loading
- **Consider archiving** old events to separate notes
- **Use event colors** sparingly for better performance
- **Optimize note content** linked to events

## Getting Help

For additional calendar support:
- Review [Notes guide](notes.md) for metadata basics
- Check [Configuration](configuration.md) for calendar settings
- Report issues on [GitHub](https://github.com/yuttie/mory/issues)