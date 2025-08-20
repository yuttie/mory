# Configuration Guide

mory offers extensive customization options to tailor the application to your preferences and workflow. This guide covers all available configuration settings and how to customize your mory experience.

## Configuration Overview

### Configuration Areas

- **Appearance** - Themes, colors, and visual preferences
- **Editor** - Editor behavior, themes, and keybindings
- **Content** - Default settings for notes, tasks, and files
- **Performance** - Optimization and caching settings
- **Integration** - API settings and external connections
- **Workflow** - Personal preferences and shortcuts

### Access Configuration

Click the **Config** tab in the navigation to open the configuration interface.

## Editor Configuration

### Editor Themes

**Available Themes**
```
Light Themes:
- default          # Standard light theme
- github           # GitHub-style theme
- ascetic          # Minimal light theme
- atom-one-light   # Atom One Light

Dark Themes:
- atom-one-dark    # Atom One Dark (popular)
- monokai          # Monokai theme
- vs-dark          # Visual Studio Dark
- material         # Material Design Dark

High Contrast:
- base16/3024      # Base16 3024 theme
- base16/ashes     # Base16 Ashes theme
- terminal         # Terminal-style theme
```

**Setting Editor Theme**
1. Navigate to **Config** → **Editor**
2. Select preferred theme from dropdown
3. Preview changes in real-time
4. Save settings

### Editor Behavior

**Font and Display**
```
Font Family: 
- Monaco, Menlo (macOS)
- 'Courier New', monospace (Windows)
- 'DejaVu Sans Mono' (Linux)
- Custom font family

Font Size: 12px - 20px
Line Height: 1.2 - 2.0
Tab Size: 2, 4, or 8 spaces
```

**Editor Features**
```
✓ Line Numbers          # Show/hide line numbers
✓ Word Wrap             # Enable/disable word wrapping
✓ Auto-indent           # Automatic indentation
✓ Bracket Matching      # Highlight matching brackets
✓ Auto-completion       # Code and markdown completion
✓ Vim Mode              # Vim keybindings (optional)
✓ Emacs Mode            # Emacs keybindings (optional)
```

**Auto-Save Settings**
```
Auto-save Interval: 1-30 seconds
Save on Focus Loss: On/Off
Save on Tab Switch: On/Off
Backup Frequency: Every save/hourly/daily
```

### Keybinding Customization

**Default Keybindings**
```
Ctrl/Cmd + N        New note
Ctrl/Cmd + S        Save
Ctrl/Cmd + F        Find
Ctrl/Cmd + H        Find and replace
Ctrl/Cmd + Z        Undo
Ctrl/Cmd + Y        Redo
Ctrl/Cmd + /        Toggle comment
```

**Custom Keybindings**
```json
{
  "bold": "Ctrl-B",
  "italic": "Ctrl-I", 
  "insertLink": "Ctrl-K",
  "insertImage": "Ctrl-Shift-K",
  "togglePreview": "Ctrl-E",
  "formatTable": "Ctrl-T"
}
```

## Appearance and Themes

### Application Themes

**Theme Options**
- **Light Mode** - Default light interface
- **Dark Mode** - Dark interface for low-light use
- **Auto** - Follow system preference
- **High Contrast** - Accessibility-focused themes

**Color Customization**
```css
/* Custom CSS Variables */
:root {
  --primary-color: #1976d2;
  --secondary-color: #424242;
  --accent-color: #ff4081;
  --background-color: #fafafa;
  --text-color: #212121;
}
```

### Content Rendering

**Syntax Highlighting Themes**
```
Code Block Themes:
- github           # GitHub-style highlighting
- atom-one-dark    # Popular dark theme
- monokai          # Classic theme
- vs               # Visual Studio light
- rainbow          # Colorful theme
```

**Custom CSS for Notes**
```css
/* Custom note styling */
.note-content {
  font-family: 'Georgia', serif;
  line-height: 1.6;
  max-width: 800px;
  margin: 0 auto;
}

.note-content h1 {
  color: #2c3e50;
  border-bottom: 2px solid #3498db;
}

.note-content blockquote {
  border-left: 4px solid #3498db;
  background: #f8f9fa;
  padding: 1rem;
}
```

**LESS Support**
```less
// Variables
@primary-color: #3498db;
@font-size: 16px;
@line-height: 1.6;

// Mixins
.rounded-corners(@radius: 4px) {
  border-radius: @radius;
}

// Styles
.custom-box {
  .rounded-corners(8px);
  background: @primary-color;
  font-size: @font-size;
  line-height: @line-height;
}
```

## Content Configuration

### Default Note Settings

**Note Templates**
```yaml
# Default frontmatter template
---
title: "{{ title }}"
created: "{{ date }}"
tags: []
status: "draft"
---

# {{ title }}

## Notes

## Tasks
- [ ] 

## References
```

**Note Naming Conventions**
```
Date-based: YYYY-MM-DD-title.md
Topic-based: category/subcategory/title.md
Project-based: projects/project-name/title.md
```

### Task Configuration

**Default Task Properties**
```yaml
task_defaults:
  priority: "medium"
  status: "pending"
  estimate: null
  assignee: null
  due_date: null
```

**Task Display Options**
```
✓ Show completed tasks
✓ Group by project
✓ Sort by priority
✓ Show due dates
✓ Display assignees
```

### File Organization

**Default File Locations**
```
images/           # Image uploads
documents/        # Document files
attachments/      # General attachments
projects/         # Project-specific files
archive/          # Archived files
temp/             # Temporary files
```

**File Naming Patterns**
```javascript
// File naming templates
{
  "images": "images/{{ date }}/{{ filename }}",
  "documents": "documents/{{ category }}/{{ filename }}",
  "uploads": "uploads/{{ year }}/{{ month }}/{{ filename }}"
}
```

## Performance Settings

### Caching Configuration

**Browser Cache Settings**
```
Content Cache: 24 hours
Image Cache: 7 days
File Cache: 30 days
Search Index Cache: 1 hour
```

**Memory Management**
```
Max Notes in Memory: 100
Image Thumbnail Cache: 50MB
Search Index Size: 20MB
Auto-cleanup Interval: 1 hour
```

### Optimization Settings

**Content Loading**
```
✓ Lazy load images
✓ Incremental note loading
✓ Background sync
✓ Compress large files
✓ Enable service worker caching
```

**Search Performance**
```
Index Update Frequency: Real-time/Every 5 minutes
Max Search Results: 50/100/200
Search Result Caching: On/Off
Full-text Search Depth: All/Recent/Custom
```

## Integration Configuration

### API Settings

**Backend Configuration**
```bash
# Environment variables
VITE_APP_API_URL=http://127.0.0.1:3030/
VITE_APP_APPLICATION_ROOT=/
VITE_APP_FILES_URL=http://127.0.0.1:3030/files/
```

**Authentication**
```
Auth Type: Bearer Token/Basic Auth/OAuth
Token Storage: LocalStorage/SessionStorage
Auto-refresh: On/Off
Session Timeout: 30 minutes/1 hour/4 hours
```

### Git Integration

**Repository Settings**
```bash
# Git configuration
git config user.name "Your Name"
git config user.email "your.email@example.com"

# Auto-commit settings
auto_commit: true
commit_message_template: "Update {{ filename }}"
commit_frequency: "on_save" # or "hourly", "daily"
```

**Backup Configuration**
```yaml
backup:
  remote_url: "git@github.com:username/notes.git"
  auto_push: true
  push_frequency: "daily"
  branch: "main"
```

## Workflow Configuration

### Shortcuts and Hotkeys

**Global Shortcuts**
```json
{
  "quick_search": "Ctrl+K",
  "new_note": "Ctrl+N",
  "toggle_sidebar": "Ctrl+\\",
  "focus_editor": "Ctrl+E",
  "toggle_preview": "Ctrl+P"
}
```

**Context-Specific Shortcuts**
```json
{
  "note_editor": {
    "bold": "Ctrl+B",
    "italic": "Ctrl+I",
    "link": "Ctrl+L",
    "image": "Ctrl+Shift+I",
    "table": "Ctrl+T"
  },
  "task_view": {
    "new_task": "Ctrl+T",
    "complete_task": "Space",
    "edit_task": "Enter"
  }
}
```

### Interface Preferences

**Layout Options**
```
Sidebar Position: Left/Right/Hidden
Panel Layout: Horizontal/Vertical/Auto
Compact Mode: On/Off
Full-width Content: On/Off
```

**Navigation Preferences**
```
Default View: Home/Notes/Tasks/Calendar
Show Recent Files: 5/10/20
Quick Access Items: Configurable list
Breadcrumb Navigation: On/Off
```

## Advanced Configuration

### Custom CSS and Styling

**Application-wide CSS**
```css
/* Custom application styling */
.app-container {
  font-family: 'Inter', sans-serif;
}

.sidebar {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.note-editor {
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
}
```

**Note-specific CSS**
```css
/* Note content styling */
.note-content h1 {
  color: #2c3e50;
  font-size: 2.5rem;
  margin-bottom: 1rem;
}

.note-content code {
  background: #f8f8f8;
  padding: 2px 4px;
  border-radius: 3px;
}

.note-content table {
  border-collapse: collapse;
  width: 100%;
}
```

### Environment Configuration

**Development Settings**
```bash
# .env.development
VITE_APP_API_URL=http://localhost:3030/
VITE_APP_DEBUG=true
VITE_APP_LOG_LEVEL=debug
```

**Production Settings**
```bash
# .env.production
VITE_APP_API_URL=https://api.yourdomain.com/
VITE_APP_DEBUG=false
VITE_APP_LOG_LEVEL=error
VITE_APP_CACHE_DURATION=86400
```

### Plugin Configuration

**Markdown Extensions**
```json
{
  "markdown_extensions": {
    "math": true,
    "mermaid": true,
    "definition_lists": true,
    "task_lists": true,
    "tables": true,
    "footnotes": true
  }
}
```

**Editor Plugins**
```json
{
  "editor_plugins": {
    "vim_mode": false,
    "emacs_mode": false,
    "auto_completion": true,
    "bracket_matching": true,
    "code_folding": true
  }
}
```

## Configuration Management

### Exporting Configuration

**Export Settings**
```javascript
// Export current configuration
const config = mory.exportConfig();
console.log(JSON.stringify(config, null, 2));
```

**Configuration File Format**
```json
{
  "version": "1.0",
  "editor": {
    "theme": "atom-one-dark",
    "fontSize": 14,
    "tabSize": 2,
    "wordWrap": true
  },
  "appearance": {
    "theme": "dark",
    "syntaxHighlight": "atom-one-dark"
  },
  "content": {
    "defaultTemplate": "basic",
    "autoSave": true,
    "saveInterval": 5
  }
}
```

### Importing Configuration

**Import from File**
1. Export configuration from another mory instance
2. Navigate to **Config** → **Import/Export**
3. Select configuration file
4. Review changes before applying
5. Apply configuration

**Sharing Configurations**
```markdown
# Team Configuration

## Shared Settings
- [Editor Config](files/config/team-editor.json)
- [Theme Config](files/config/team-theme.json)
- [Workflow Config](files/config/team-workflow.json)

## Setup Instructions
1. Download configuration files
2. Import in Config → Import/Export
3. Restart mory if needed
```

### Configuration Backup

**Automatic Backup**
- Configuration automatically backed up with Git
- Settings stored in repository metadata
- Version-controlled configuration changes

**Manual Backup**
```bash
# Export configuration
mory --export-config > mory-config-backup.json

# Import configuration
mory --import-config mory-config-backup.json
```

## Troubleshooting Configuration

### Common Issues

**Configuration Not Saving**
- Check browser local storage permissions
- Verify file system permissions
- Clear browser cache and reload

**Theme Not Applied**
- Refresh browser after theme change
- Check for CSS conflicts
- Verify theme files are accessible

**Editor Issues**
- Reset editor to default settings
- Clear editor cache
- Check for conflicting browser extensions

**Performance Problems**
- Reduce cache sizes
- Disable unnecessary features
- Check system resources

### Reset Configuration

**Reset to Defaults**
1. Navigate to **Config** → **Reset**
2. Choose specific areas or complete reset
3. Confirm reset action
4. Restart mory

**Manual Reset**
```javascript
// Clear all configuration
localStorage.removeItem('mory-config');
sessionStorage.clear();
location.reload();
```

## Configuration Best Practices

### Team Coordination

1. **Shared Settings** - Use common editor and formatting settings
2. **Documentation** - Document team configuration choices
3. **Version Control** - Include configuration in repository
4. **Regular Reviews** - Periodically review and update settings

### Personal Optimization

1. **Start Simple** - Begin with default settings
2. **Incremental Changes** - Adjust one setting at a time
3. **Document Changes** - Keep notes on customizations
4. **Regular Backup** - Export configuration regularly

### Performance Tuning

1. **Monitor Performance** - Watch for slowdowns after changes
2. **Cache Management** - Adjust cache settings based on usage
3. **Feature Toggle** - Disable unused features
4. **Regular Cleanup** - Clear old cache and temporary files

## Getting Help

For configuration assistance:
- Review specific feature guides for detailed settings
- Check [Getting Started](getting-started.md) for initial setup
- See [Troubleshooting](#troubleshooting-configuration) section above
- Report configuration issues on [GitHub](https://github.com/yuttie/mory/issues)