# Search Guide

mory's search functionality helps you quickly find any content across your notes, tasks, files, and events. With powerful search capabilities, you can locate information efficiently in your growing knowledge base.

## Search Overview

### Key Features

- **Full-Text Search** - Search content within all notes and files
- **Multi-Type Search** - Find notes, tasks, events, and files in one search
- **Advanced Filters** - Narrow results by type, date, tags, and more
- **Real-Time Results** - See results as you type
- **Context Preview** - See relevant snippets in search results
- **Quick Navigation** - Jump directly to content from search results

### Access Search

Click the **Search** tab in the navigation or use the keyboard shortcut `Ctrl/Cmd + K` for quick search.

## Basic Search

### Simple Text Search

**Search Across All Content**
```
project meeting
website design
user research
database optimization
```

**Search Results Include**
- Notes containing the search terms
- Task descriptions and content
- Event names and descriptions
- File names and linked content
- Metadata and frontmatter

### Search Interface

**Search Bar Features**
- Real-time search suggestions
- Recently searched terms
- Quick filters and options
- Clear/reset search functionality

**Results Display**
- Relevance-based ranking
- Content type indicators
- Snippet previews
- Direct links to content
- Creation/modification dates

## Advanced Search Techniques

### Exact Phrase Search

**Use Quotes for Exact Matches**
```
"user interface design"
"quarterly business review"
"API documentation"
```

### Boolean Operators

**AND (Default)**
```
project AND deadline
meeting AND notes AND action
```

**OR Operator**
```
design OR mockup OR wireframe
meeting OR standup OR review
```

**NOT Operator**
```
project NOT archived
meeting NOT cancelled
design NOT draft
```

**Complex Combinations**
```
(design OR mockup) AND project
meeting AND (weekly OR monthly) NOT cancelled
```

### Wildcard Search

**Partial Matching**
```
design*          # Finds: design, designs, designer, designing
*ment            # Finds: document, development, management
proj*ct          # Finds: project, protect
```

## Search Filters

### Content Type Filters

**Filter by Type**
```
type:note            # Only notes
type:task            # Only tasks
type:event           # Only events
type:file            # Only files
```

**File Type Specific**
```
filetype:pdf         # PDF documents
filetype:image       # Image files
filetype:markdown    # Markdown files
filetype:doc         # Word documents
```

### Date-Based Filters

**Creation Date**
```
created:2024-01      # Created in January 2024
created:2024-01-15   # Created on specific date
created:today        # Created today
created:yesterday    # Created yesterday
created:this-week    # Created this week
created:this-month   # Created this month
```

**Modification Date**
```
modified:today       # Modified today
modified:last-week   # Modified in the last week
modified:2024-01     # Modified in January 2024
```

**Date Ranges**
```
created:2024-01-01..2024-01-31   # Date range
modified:last-month              # Previous month
```

### Tag-Based Filters

**Search by Tags**
```
tag:work             # Tagged with "work"
tag:urgent           # Tagged with "urgent"
tag:project-x        # Tagged with "project-x"
```

**Multiple Tags**
```
tag:work tag:urgent              # Has both tags
tag:work OR tag:personal         # Has either tag
tag:project NOT tag:completed    # Has project tag but not completed
```

### Status and Properties

**Task Status**
```
status:completed     # Completed tasks
status:pending       # Pending tasks
status:in-progress   # Tasks in progress
```

**Note Properties**
```
has:frontmatter      # Notes with YAML frontmatter
has:events           # Notes containing events
has:tasks            # Notes containing task lists
has:attachments      # Notes with file attachments
```

## Search in Specific Areas

### Note Content Search

**Search Within Notes**
```
# Find specific content in notes
markdown syntax
code examples
user requirements

# Search note titles
title:"Project Planning"
title:meeting*

# Search in note metadata
author:"Alice"
project:"website"
```

### Task Search

**Find Tasks**
```
# Search task descriptions
"fix bug in login"
"review pull request"
"schedule meeting"

# Search by task properties
assignee:alice
priority:high
due:this-week
```

### Event Search

**Find Events**
```
# Search event names
"team meeting"
"project deadline"
"client presentation"

# Search event properties
location:"conference room"
attendees:alice
color:red
```

### File Search

**Find Files**
```
# Search file names
screenshot.png
proposal.pdf
design-*.jpg

# Search file content (where supported)
"API documentation"
"user manual"
```

## Search Results and Navigation

### Understanding Results

**Result Components**
- **Title** - Note title, task description, event name, or filename
- **Type Badge** - Visual indicator (Note, Task, Event, File)
- **Snippet** - Relevant content preview with highlighted search terms
- **Metadata** - Creation date, tags, file size, etc.
- **Context** - Location within larger documents

**Relevance Ranking**
Results are ranked by:
1. Exact phrase matches
2. Multiple search term matches
3. Title/heading matches
4. Recent content
5. Frequently accessed content

### Navigation from Results

**Quick Actions**
- **Click Title** - Open content directly
- **Preview** - View content in preview pane
- **Context Menu** - Additional actions (edit, delete, copy link)
- **Open in New Tab** - Keep search results open

**Keyboard Navigation**
- `Arrow Keys` - Navigate between results
- `Enter` - Open selected result
- `Ctrl/Cmd + Enter` - Open in new tab
- `Escape` - Return to search input

## Advanced Search Features

### Saved Searches

**Create Saved Searches**
```markdown
# My Saved Searches

## Work Tasks
- [Urgent Work Tasks](search?q=tag:work%20tag:urgent%20type:task)
- [This Week's Meetings](search?q=type:event%20created:this-week)
- [Project X Files](search?q=tag:project-x%20type:file)

## Content Reviews
- [Draft Notes](search?q=status:draft%20type:note)
- [Incomplete Tasks](search?q=status:pending%20type:task)
- [Recent Changes](search?q=modified:this-week)
```

### Search Shortcuts

**Quick Search Patterns**
```
# Quick access to common searches
@alice              # Content assigned to Alice
#urgent             # Urgent tagged content
?incomplete         # Incomplete tasks
!overdue            # Overdue items
```

### Search Templates

**Reusable Search Queries**
```markdown
# Search Templates

## Project Review
Search: `tag:{{project}} modified:{{timeframe}}`
Example: `tag:website modified:this-month`

## Team Member Tasks
Search: `assignee:{{name}} status:pending`
Example: `assignee:alice status:pending`

## File Cleanup
Search: `type:file created:{{date-range}}`
Example: `type:file created:2023-01..2023-12`
```

## Search Integration

### Search in Context

**Contextual Search**
- Search within specific notes
- Find related content
- Discover connected tasks and events
- Locate referenced files

**Cross-Reference Discovery**
```markdown
# Project Alpha

Related content found:
- [Alpha Meeting Notes](search?q=alpha%20type:note)
- [Alpha Tasks](search?q=alpha%20type:task)
- [Alpha Files](search?q=alpha%20type:file)
```

### Search-Driven Workflows

**Research Workflows**
```markdown
# Research Process

1. **Initial Search**: `topic research articles`
2. **Refine by Type**: `topic research type:note`
3. **Filter by Date**: `topic research created:this-month`
4. **Find Related**: `tag:research tag:topic`
```

**Project Management**
```markdown
# Project Status Review

1. **Current Tasks**: `tag:project-x status:pending`
2. **Completed Work**: `tag:project-x status:completed`
3. **Recent Updates**: `tag:project-x modified:this-week`
4. **Related Files**: `tag:project-x type:file`
```

## Search Performance

### Optimizing Search

**Search Best Practices**
1. **Use Specific Terms** - More specific = better results
2. **Combine Filters** - Use type and date filters
3. **Quote Exact Phrases** - For precise matching
4. **Use Tags Effectively** - Consistent tagging improves search

**Performance Considerations**
- Large repositories may have slower search
- Complex queries take longer to process
- File content search depends on file type
- Regular indexing improves search speed

### Search Indexing

**Content Indexing**
- Notes indexed automatically on save
- Files indexed based on type and content
- Metadata included in search index
- Regular re-indexing for optimal performance

## Search Tips and Tricks

### Effective Search Strategies

**Start Broad, Then Narrow**
```
1. Start: "project"
2. Add type: "project type:note"
3. Add date: "project type:note created:this-month"
4. Add tag: "project type:note created:this-month tag:active"
```

**Use Multiple Search Approaches**
- Search by content keywords
- Search by metadata properties
- Search by file names and types
- Search by date ranges

**Leverage Autocomplete**
- Search suggestions based on content
- Recently used search terms
- Popular search patterns
- Tag and filename completion

### Common Search Patterns

**Daily Workflow Searches**
```
# Morning review
modified:today
due:today
tag:urgent status:pending

# Weekly planning
created:this-week
due:this-week
tag:project modified:this-week

# Monthly review
created:this-month
completed:this-month
tag:review
```

**Content Discovery**
```
# Find similar content
related-topic OR similar-keyword
tag:category NOT tag:archived

# Discover connections
mentions-person OR @person
references-document

# Content audit
status:draft
has:no-tags
created:older-than-6-months
```

## Troubleshooting Search

### Common Search Issues

**No Results Found**
- Check spelling and terminology
- Try broader search terms
- Remove unnecessary filters
- Search for partial terms with wildcards

**Too Many Results**
- Add more specific terms
- Use filters to narrow results
- Quote exact phrases
- Combine with boolean operators

**Incorrect Results**
- Verify search syntax
- Check for typos in search terms
- Review filter settings
- Clear and retry search

**Slow Search Performance**
- Simplify complex queries
- Use filters to reduce scope
- Check system performance
- Consider repository size

### Search Debugging

**Understanding Search Behavior**
```markdown
# Search Debugging Checklist

## Query Structure
- [ ] Correct syntax used
- [ ] Proper quote placement
- [ ] Valid filter names
- [ ] Boolean operators correct

## Content Issues
- [ ] Content exists and accessible
- [ ] Correct file permissions
- [ ] Recent content indexed
- [ ] Metadata properly formatted

## Performance
- [ ] Repository size reasonable
- [ ] Network connectivity stable
- [ ] Browser performance adequate
- [ ] Search cache cleared if needed
```

## Search Configuration

### Customizing Search

**Search Preferences**
- Results per page
- Default search scope
- Auto-suggestion settings
- Search history retention

**Search Display**
- Result snippet length
- Highlighting preferences
- Sort order options
- Filter visibility

### Integration Settings

**Search Integration**
- Enable/disable search in specific areas
- Configure search indexing
- Set search update frequency
- Manage search permissions

## Getting Help

For additional search support:
- Review [Notes guide](notes.md) for content organization
- Check [Tasks guide](tasks.md) for task-specific search
- See [Configuration](configuration.md) for search settings
- Report search issues on [GitHub](https://github.com/yuttie/mory/issues)