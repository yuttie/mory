# Files Guide

mory's file management system helps you organize attachments, images, documents, and other assets alongside your notes and tasks.

## File Overview

### Key Features

- **Integrated Storage** - Files stored within your data repository
- **Note Integration** - Easy linking between notes and files
- **Multiple File Types** - Support for images, documents, code, and more
- **Organization Tools** - Folder structure and file management
- **Version Control** - Files tracked with Git alongside notes
- **Direct Access** - Browse and manage files through the Files tab

### Access Files

Click the **Files** tab in the navigation to open the file management interface.

## File Organization

### Directory Structure

mory organizes files in a logical structure:

```
your-notes-repo/
├── files/              # Main file storage
│   ├── images/         # Image files
│   ├── documents/      # PDF, DOC, etc.
│   ├── attachments/    # General attachments
│   ├── uploads/        # Recent uploads
│   └── projects/       # Project-specific files
├── notes/              # Your markdown notes
└── templates/          # Note templates
```

### Folder Management

**Creating Folders**
1. Navigate to the Files tab
2. Click "New Folder" or use the context menu
3. Enter folder name (e.g., "project-x", "images/screenshots")
4. Organize files into logical groups

**Naming Conventions**
```
# Project-based
projects/website-redesign/
projects/mobile-app/assets/
projects/documentation/

# Type-based
images/screenshots/
images/mockups/
documents/contracts/
documents/reports/

# Date-based
2024/january/meeting-notes/
2024/january/presentations/
uploads/2024-01-15/
```

## File Upload and Management

### Uploading Files

**Via File Interface**
1. Open the **Files** tab
2. Navigate to desired folder
3. Click "Upload" or drag files into the interface
4. Select files from your device
5. Files are automatically stored and indexed

**Drag and Drop**
- Drag files directly from your desktop
- Drop into specific folders
- Multiple file upload supported
- Progress indicators show upload status

### Supported File Types

**Images**
- PNG, JPG, JPEG, GIF, SVG
- WebP, TIFF, BMP
- Thumbnail generation
- Preview in file browser

**Documents**
- PDF files
- Microsoft Office (DOC, DOCX, XLS, XLSX, PPT, PPTX)
- Text files (TXT, MD, CSV)
- Rich text (RTF)

**Code and Development**
- Source code files (JS, HTML, CSS, Python, etc.)
- Configuration files (JSON, YAML, XML)
- Archive files (ZIP, TAR, GZ)
- Log files

**Media Files**
- Audio (MP3, WAV, OGG)
- Video (MP4, WebM) - Note: Large files may impact performance
- Archive formats

### File Properties

**File Information**
- File name and extension
- File size and creation date
- MIME type
- Last modified timestamp
- Git tracking status

**File Actions**
- **Download** - Save file to your device
- **Rename** - Change file name
- **Move** - Relocate to different folder
- **Delete** - Remove file (Git tracked)
- **Copy Link** - Get reference for notes

## Linking Files in Notes

### Image Embedding

**Basic Image Syntax**
```markdown
![Alt text](files/images/screenshot.png)
![Project mockup](files/projects/website/mockup.png)
```

**With Captions and Titles**
```markdown
![Dashboard Screenshot](files/images/dashboard.png "Current dashboard design")

*Figure 1: Dashboard layout showing the main navigation and content areas*
```

**Responsive Images**
```markdown
# Small inline image
![Icon](files/icons/warning.svg)

# Full-width image
![](files/images/full-layout.png)

# Image with specific sizing (if supported by CSS)
<img src="files/images/diagram.png" width="500" alt="System diagram">
```

### Document Linking

**Download Links**
```markdown
[Project Proposal](files/documents/proposal.pdf)
[Meeting Minutes](files/documents/2024-01-15-meeting.docx)
[Data Export](files/data/export-2024-01.csv)
```

**Inline References**
```markdown
# Project Documentation

## Resources
- 📄 [Requirements Document](files/docs/requirements.pdf)
- 📊 [Project Timeline](files/docs/timeline.xlsx)
- 🎨 [Design Assets](files/designs/)
- 📝 [Meeting Notes](files/notes/weekly-meetings.md)
```

### File Collections

**Gallery of Images**
```markdown
# Design Gallery

## Mockups
![Homepage](files/designs/homepage.png)
![About Page](files/designs/about.png)
![Contact Form](files/designs/contact.png)

## Screenshots
![Current Site](files/screenshots/current-homepage.png)
![Competitor 1](files/screenshots/competitor-a.png)
![Competitor 2](files/screenshots/competitor-b.png)
```

**Resource Lists**
```markdown
# Project Resources

## Documentation
- [API Specification](files/docs/api-spec.pdf)
- [User Manual](files/docs/user-manual.docx)
- [Technical Requirements](files/docs/tech-requirements.md)

## Assets
- [Logo Files](files/assets/logos/)
- [Brand Guidelines](files/assets/brand-guide.pdf)
- [Color Palette](files/assets/colors.png)

## Templates
- [Email Template](files/templates/email.html)
- [Report Template](files/templates/report.docx)
```

## File Workflows

### Project File Organization

**Project Structure Example**
```
files/projects/website-redesign/
├── requirements/
│   ├── initial-brief.pdf
│   ├── stakeholder-feedback.docx
│   └── user-research.xlsx
├── designs/
│   ├── wireframes/
│   ├── mockups/
│   └── final-designs/
├── assets/
│   ├── images/
│   ├── icons/
│   └── fonts/
└── documentation/
    ├── technical-spec.md
    ├── user-guide.pdf
    └── deployment-notes.txt
```

**Corresponding Note Structure**
```markdown
# Website Redesign Project

## Requirements
See [requirements folder](files/projects/website-redesign/requirements/)

- [Initial Brief](files/projects/website-redesign/requirements/initial-brief.pdf)
- [Stakeholder Feedback](files/projects/website-redesign/requirements/stakeholder-feedback.docx)

## Current Progress
- [x] Gather requirements ✅
- [x] Create wireframes ✅ [View](files/projects/website-redesign/designs/wireframes/)
- [ ] Design mockups 🎨 [In Progress](files/projects/website-redesign/designs/mockups/)
- [ ] Final design approval
```

### Document Workflows

**Meeting Documentation**
```markdown
# Team Meeting - 2024-01-15

## Attendees
- Alice (Project Manager)
- Bob (Developer)
- Carol (Designer)

## Agenda
1. Project status review
2. Design feedback
3. Next steps

## Documents Shared
- [Q4 Report](files/reports/q4-summary.pdf)
- [Design Mockups](files/designs/latest-mockups.zip)
- [Budget Proposal](files/finance/budget-2024.xlsx)

## Action Items
- [ ] Alice: Update project timeline
- [ ] Bob: Review technical requirements
- [ ] Carol: Revise designs based on feedback

## Recording
[Meeting Recording](files/recordings/2024-01-15-team-meeting.mp4)
```

### Research and Reference Management

**Research Collection**
```markdown
# Research: User Experience Trends

## Articles and Papers
- [UX Trends 2024](files/research/ux-trends-2024.pdf)
- [Mobile Design Patterns](files/research/mobile-patterns.pdf)
- [Accessibility Guidelines](files/research/accessibility-wcag.pdf)

## Case Studies
- [Company A Redesign](files/case-studies/company-a.pdf)
- [App B User Research](files/case-studies/app-b-research.docx)

## Screenshots and Examples
![Example 1](files/examples/good-ux-example1.png)
![Example 2](files/examples/good-ux-example2.png)

## Notes
Based on the research above, key trends include...
```

## File Search and Discovery

### Finding Files

**Search Capabilities**
- Search by filename
- Filter by file type
- Sort by date, size, or name
- Navigate folder hierarchy

**Search Examples**
```
# Find specific files
screenshot
proposal.pdf
*.png

# Filter by type
type:image
type:document
type:code

# Date-based search
created:2024-01
modified:today
```

### File References in Search

When searching notes, mory can find:
- File links and references
- Image captions and alt text
- Document titles mentioned in notes
- File-related task items

## Advanced File Features

### File Versioning

**Git Integration**
- All file changes tracked with Git
- View file history and changes
- Restore previous versions
- Branch for experimental file changes

**Version Management**
```markdown
# Document Versions

## Current
[Project Proposal v3](files/docs/proposal-v3.pdf)

## Previous Versions
- [Proposal v2](files/archive/proposal-v2.pdf) - Client feedback incorporated
- [Proposal v1](files/archive/proposal-v1.pdf) - Initial draft
```

### File Templates

**Template Files**
Create reusable file templates:

```
files/templates/
├── meeting-agenda.docx
├── project-proposal.pdf
├── weekly-report.xlsx
└── presentation-template.pptx
```

**Using Templates in Notes**
```markdown
# New Project Setup

## Templates Available
- [Meeting Agenda Template](files/templates/meeting-agenda.docx)
- [Proposal Template](files/templates/project-proposal.pdf)
- [Report Template](files/templates/weekly-report.xlsx)

## Next Steps
1. [ ] Copy proposal template for new project
2. [ ] Customize with project details
3. [ ] Share with stakeholders
```

### Batch Operations

**File Management Tasks**
- Select multiple files for batch operations
- Move groups of files between folders
- Rename files with patterns
- Archive completed project files

**Organization Scripts**
```markdown
# File Cleanup Tasks

## Monthly Cleanup
- [ ] Archive old meeting recordings
- [ ] Organize uploaded files into proper folders
- [ ] Delete duplicate files
- [ ] Update file naming conventions

## Project Closure
- [ ] Move project files to archive folder
- [ ] Create project summary document
- [ ] Backup important files
- [ ] Clean up temporary files
```

## File Security and Backup

### Access Control

**Repository-Level Security**
- Files inherit Git repository access controls
- No separate file permissions system
- Backup and sync through Git remotes

### Backup Strategies

**Git-Based Backup**
- Regular Git commits include file changes
- Push to remote repositories for off-site backup
- Use Git LFS for large file management (if needed)

**File Organization for Backup**
```markdown
# Backup Strategy

## Critical Files (Daily Backup)
- `files/documents/` - Important documents
- `files/projects/active/` - Current project files

## Archive Files (Weekly Backup)
- `files/archive/` - Completed project files
- `files/references/` - Reference materials

## Temporary Files (No Backup Needed)
- `files/temp/` - Temporary work files
- `files/cache/` - Generated thumbnails
```

## Performance and Storage

### Large File Management

**File Size Considerations**
- Large files may slow interface performance
- Consider compression for archive files
- Use external storage for very large media files

**Optimization Tips**
- Compress images for web use
- Archive old project files
- Use file links instead of embedding large files
- Regular cleanup of temporary files

### Storage Monitoring

**Monitoring Usage**
```markdown
# Storage Review

## Current Usage
- Total files: ~500 files
- Storage used: ~2.5 GB
- Largest files: [Video files](files/media/)

## Cleanup Tasks
- [ ] Compress old presentation videos
- [ ] Archive 2023 project files
- [ ] Remove duplicate screenshots
- [ ] Optimize image file sizes
```

## Troubleshooting

### Common Issues

**Upload Failures**
- Check file size limits
- Verify network connectivity
- Ensure sufficient storage space
- Try uploading smaller batches

**Missing Files**
- Check if file was moved to different folder
- Search by filename
- Verify Git repository status
- Check file permissions

**Broken Links in Notes**
- Verify file path is correct
- Ensure file exists in repository
- Check for case sensitivity in filenames
- Update links after file moves

**Performance Issues**
- Large files may slow page loading
- Consider file compression
- Organize files into smaller folders
- Archive old files regularly

### File Recovery

**Recovering Deleted Files**
```bash
# If using Git, restore deleted files
git checkout HEAD -- files/path/to/deleted-file.pdf

# View file history
git log --follow files/path/to/file.pdf

# Restore file from specific commit
git checkout <commit-hash> -- files/path/to/file.pdf
```

## Best Practices

### File Organization

1. **Consistent Naming** - Use clear, descriptive filenames
2. **Logical Folders** - Organize by project, type, or date
3. **Version Control** - Include version numbers in filenames when needed
4. **Regular Cleanup** - Archive or delete obsolete files

### Integration with Notes

1. **Meaningful Links** - Use descriptive link text
2. **Context** - Explain file relevance in surrounding text
3. **Organization** - Group related files and notes together
4. **Updates** - Keep file references current when files move

### Workflow Integration

1. **Project Structure** - Align file organization with project structure
2. **Task Integration** - Link file tasks to project management
3. **Review Cycles** - Include file organization in regular reviews
4. **Backup Planning** - Ensure important files are backed up

## Getting Help

For additional file management support:
- Review [Notes guide](notes.md) for linking files in notes
- Check [Configuration](configuration.md) for file-related settings
- See [Getting Started](getting-started.md) for initial setup
- Report issues on [GitHub](https://github.com/yuttie/mory/issues)