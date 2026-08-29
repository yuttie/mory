# mory Features Guide

This guide provides a comprehensive overview of all features available in mory, organized by functionality area.

## Table of Contents

- [Core Features](#core-features)
- [Note Management](#note-management)
- [Task Management](#task-management)
- [Calendar & Events](#calendar--events)
- [File Management](#file-management)
- [Search & Discovery](#search--discovery)
- [Git Integration](#git-integration)
- [User Interface](#user-interface)

## Core Features

### Git-Powered Storage
- **Versioned Data**: All content is stored in a Git repository, providing complete version history
- **Branching Support**: Work with different branches for different contexts
- **Conflict Resolution**: Handle merge conflicts when working across devices
- **Backup & Sync**: Easy backup and synchronization through Git remotes

### Markdown-Native Format
- **Human Readable**: All data stored as plain Markdown files
- **Future Proof**: Content remains accessible without mory
- **Extensible**: Rich metadata through YAML frontmatter
- **Portable**: Easy migration to other systems

### Local-First Design
- **Offline Capable**: Full functionality without internet connection
- **Private by Default**: All data remains on your device
- **No Cloud Dependencies**: Works entirely offline
- **Fast Performance**: No network latency for operations

## Note Management

### Creating Notes
- **Quick Creation**: Generate new notes with UUIDv4 filenames
- **Template Support**: Use note templates for consistent structure
- **YAML Frontmatter**: Rich metadata including tags, tasks, and events
- **Markdown Support**: Full GitHub Flavored Markdown (GFM) compatibility

### Editing Features
- **Live Preview**: Real-time Markdown rendering
- **Syntax Highlighting**: Code block highlighting with theme selection
- **Math Rendering**: LaTeX math equations with MathJax
- **Table of Contents**: Auto-generated TOC with scroll sync
- **Image Embedding**: Drag & drop image support with optimization

### Organization
- **Hierarchical Structure**: Organize notes in folders and subfolders
- **Tag System**: Flexible tagging for cross-cutting organization
- **Search Integration**: Full-text search across all notes
- **Title Extraction**: Automatic title detection from H1 headers

### File Operations
- **Rename Notes**: Change file paths while preserving Git history
- **Delete Notes**: Safe deletion with Git tracking
- **Duplicate Detection**: Prevent overwriting with conflict detection
- **Bulk Operations**: Select and operate on multiple notes

## Task Management

### Task Creation & Structure
- **UUID-Based IDs**: Unique identifiers for task tracking
- **Rich Metadata**: Comprehensive task properties and attributes
- **Hierarchical Tasks**: Parent-child relationships with subtasks
- **Template Generation**: Auto-generate task structure from templates

### Status Workflow
mory provides a sophisticated task status system with defined workflows:

#### Status Types:
1. **Todo**: Initial state for new tasks
2. **In Progress**: Active work state
3. **Waiting**: Blocked on external factors
4. **Blocked**: Cannot proceed due to dependencies
5. **On Hold**: Temporarily paused
6. **Done**: Successfully completed
7. **Canceled**: Abandoned or no longer needed

#### Status Transitions:
```
Todo → In Progress, Waiting, Blocked, Canceled
In Progress → Waiting, Blocked, On Hold, Done, Canceled
Waiting → In Progress, Done, Canceled
Blocked → In Progress, Waiting, Canceled
On Hold → In Progress, Canceled
Done → (final state)
Canceled → (final state)
```

### Task Properties
- **Progress Tracking**: 0-100% completion percentage
- **Priority Matrix**: Importance (1-5) and Urgency (1-5) ratings
- **Time Management**: Start dates, due dates, and hard deadlines
- **Scheduling**: Assign tasks to specific dates
- **Context**: Rich notes and descriptions

### Advanced Task Features
- **Conditional GET**: Efficient data loading with ETag caching
- **Tree View**: Hierarchical task visualization
- **Search & Filter**: Find tasks by status, tags, dates, or content
- **Bulk Updates**: Modify multiple tasks simultaneously
- **Progress Tracking**: Visual progress indicators and completion stats

### Task Scheduling
- **Date Assignment**: Schedule tasks for specific dates
- **Recurring Tasks**: Support for repeating task patterns
- **Deadline Management**: Hard deadlines vs. soft due dates
- **Calendar Integration**: Tasks appear in calendar views

## Calendar & Events

### Event Types
#### Single Events
- **One-time Occurrences**: Meetings, appointments, deadlines
- **Time Ranges**: Start and optional end times
- **Status Tracking**: Mark events as finished/completed
- **Rich Metadata**: Colors, notes, and additional properties

#### Recurring Events
- **Multiple Occurrences**: Repeating meetings, habits, routines
- **Flexible Scheduling**: Define multiple time slots
- **Series Management**: Manage entire series or individual instances
- **Override Support**: Modify individual occurrences

### Event Properties
- **Timezone Support**: Full timezone awareness with offsets
- **Color Coding**: Visual organization with hex color codes
- **Notes & Context**: Detailed descriptions and metadata
- **Integration**: Link events to tasks and notes

### Calendar Views
- **Month View**: Traditional calendar grid layout
- **Day View**: Detailed daily schedule
- **Week View**: Weekly planning perspective
- **Agenda View**: List-based upcoming events

### Calendar Features
- **Navigation**: Keyboard shortcuts (PageUp/Down for years, Home for today)
- **Event Creation**: Quick event creation with templates
- **Conflict Detection**: Identify scheduling conflicts
- **Export Support**: Standard calendar format exports

## File Management

### File Upload & Storage
- **Drag & Drop**: Easy file uploads through web interface
- **Size Limits**: 16MB maximum file size per upload
- **Batch Upload**: Multiple files in single operation
- **UUID Naming**: Automatic UUID generation for file organization

### Image Optimization
- **Automatic Conversion**: Images converted to WebP format
- **Size Reduction**: Optimized file sizes with quality settings
- **Format Detection**: Automatic MIME type detection
- **Caching System**: Optimized images cached for performance

### File Organization
- **Path-Based Storage**: Hierarchical file organization
- **MIME Type Detection**: Automatic content type identification
- **Metadata Extraction**: Extract titles and metadata from files
- **Size Tracking**: File size monitoring and reporting

### File Access
- **Direct URLs**: Direct access to files via URL paths
- **Conditional GET**: Efficient loading with ETag support
- **HEAD Requests**: Metadata-only requests for efficiency
- **CORS Support**: Cross-origin resource sharing for web access

## Search & Discovery

### Full-Text Search
- **Git Grep Integration**: Leverages Git's fast grep functionality
- **Pattern Matching**: Regex and plain text search patterns
- **File Scope**: Search across all notes and content
- **Line Numbers**: Precise location information in results

### Search Features
- **Context Display**: Show surrounding text for search matches
- **Relevance Ranking**: Results ordered by relevance and recency
- **Search History**: Track and revisit previous searches
- **Quick Access**: Keyboard shortcuts for instant search

### Discovery Tools
- **Tag Clouds**: Visual representation of tag usage
- **Recent Files**: Quick access to recently modified content
- **Related Content**: Find related notes through tags and content
- **Navigation History**: Track and revisit viewed content

### Advanced Search
- **Boolean Operators**: Combine search terms with AND/OR/NOT
- **Field-Specific**: Search within specific metadata fields
- **Date Ranges**: Filter results by creation or modification dates
- **File Types**: Restrict search to specific file types

## Git Integration

### Version Control
- **Automatic Commits**: Every change automatically committed
- **Commit Messages**: Descriptive commit messages for all operations
- **History Tracking**: Complete history of all changes
- **Branch Support**: Work with Git branches and merging

### Conflict Resolution
- **Merge Detection**: Identify and handle merge conflicts
- **Manual Resolution**: Tools for resolving conflicts manually
- **Safe Merging**: Prevent data loss during conflict resolution
- **Backup Creation**: Automatic backups before conflict resolution

### Synchronization
- **Remote Support**: Push/pull to Git remotes
- **Multi-Device**: Sync content across multiple devices
- **Conflict Prevention**: Strategies to minimize conflicts
- **Backup Integration**: Regular backups to remote repositories

### Advanced Git Features
- **Delta Updates**: Efficient incremental updates
- **Commit ID Tracking**: ETag support using commit hashes
- **Ancestor Checking**: Verify commit relationships
- **Tree Rebuilding**: Rebuild cache from Git history

## User Interface

### Responsive Design
- **Mobile Friendly**: Optimized for mobile devices and tablets
- **Desktop Experience**: Full-featured desktop interface
- **Adaptive Layouts**: Interface adapts to screen size
- **Touch Support**: Touch-friendly controls and gestures

### Customization
- **Theme Selection**: Multiple UI themes and color schemes
- **Editor Themes**: Customizable code editor appearance
- **Keybinding Options**: Different keybinding schemes (Vim, Emacs, etc.)
- **Custom CSS**: Support for custom styling with LESS

### Navigation
- **Sidebar Navigation**: Collapsible main navigation
- **Right Sidebar**: Context-sensitive secondary navigation
- **Breadcrumbs**: Clear navigation path indicators
- **Quick Actions**: Keyboard shortcuts for common actions

### Editor Features
- **Split View**: Side-by-side edit and preview
- **Live Preview**: Real-time Markdown rendering
- **Scroll Sync**: Synchronized scrolling between edit and preview
- **Line Numbers**: Optional line numbering in editor

### Performance Optimizations
- **Lazy Loading**: Load content as needed
- **Caching**: Intelligent caching for improved performance
- **Incremental Updates**: Only update changed content
- **Optimized Rendering**: Efficient DOM updates and rendering

### Accessibility
- **Keyboard Navigation**: Full keyboard accessibility
- **Screen Reader Support**: ARIA labels and semantic markup
- **High Contrast**: High contrast mode support
- **Zoom Support**: Text scaling and zoom functionality

### Error Handling
- **Graceful Degradation**: Handle errors without data loss
- **User Feedback**: Clear error messages and status indicators
- **Recovery Options**: Options to recover from errors
- **Validation**: Real-time validation with helpful messages