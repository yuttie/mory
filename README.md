# mory

*mory is designed to be a part of your memory.*

With mory, you can capture notes, manage your calendar, and track tasks—freeing
your mind to focus on what matters. Think of it as: **my memory = me + mory**.

The core design principle is simple: your content should always be accessible
and editable locally, without relying on a web app. To achieve this, mory is
built on two key ideas:

- **Git-powered storage** — all data is versioned and managed through a Git
  repository instead of a traditional database.  
- **Markdown-native format** — everything is stored as plain Markdown files,
  ensuring your data stays portable, human-readable, and future-proof.

mory is a **personal tool for private use only**. It is intentionally designed
without multi-user support or collaboration features. This single-user focus
helps keep the app **simple** and ensures your data remains **private and under
your control**, making it a dependable companion for personal productivity.

## Key Features

### 📝 **Advanced Note Management**
- **Rich Markdown Support**: GitHub Flavored Markdown with live preview
- **YAML Frontmatter**: Structured metadata for tags, tasks, and events
- **Real-time Editing**: Side-by-side edit and preview with scroll sync
- **Image Optimization**: Automatic WebP conversion and caching
- **Full-text Search**: Git grep-powered search across all content

### ✅ **Sophisticated Task Management**
- **Status Workflow**: 7-state task lifecycle (todo → in_progress → done, etc.)
- **Rich Properties**: Progress tracking, importance/urgency ratings, deadlines
- **Hierarchical Tasks**: Parent-child relationships with UUID-based organization
- **Smart Scheduling**: Assign tasks to specific dates with calendar integration
- **Conditional Updates**: Efficient data loading with ETag caching

### 📅 **Flexible Calendar & Events**
- **Single & Recurring Events**: One-time appointments and repeating schedules
- **Timezone Support**: Full timezone awareness with offset handling
- **Visual Organization**: Color coding and rich metadata
- **Multiple Views**: Month, week, day, and agenda perspectives
- **Task Integration**: Events linked to task management system

### 🗂️ **Powerful File Management**
- **Drag & Drop Upload**: Easy file uploads up to 16MB
- **Smart Organization**: UUID-based naming with hierarchical structure
- **Image Processing**: Automatic optimization and format conversion
- **Direct Access**: File serving with proper MIME type detection
- **Version Control**: All files tracked in Git with complete history

### 🔍 **Advanced Search & Discovery**
- **Git-powered Search**: Leverages Git grep for fast, accurate results
- **Pattern Matching**: Regex and plain text search capabilities
- **Context Display**: See surrounding text for search matches
- **Tag-based Discovery**: Flexible tagging system for organization

### ⚙️ **Technical Excellence**
- **Local-first Design**: Full offline functionality, no cloud dependencies
- **RESTful API**: Comprehensive API with v1 and v2 endpoints
- **Performance Optimized**: Caching, lazy loading, and efficient updates
- **Git Integration**: Complete version control with branching support
- **Security**: JWT authentication with rate limiting

## Documentation

- **[🚀 Quick Start Guide](docs/QUICK_START.md)** - Get up and running with mory
- **[📚 Features Guide](docs/FEATURES.md)** - Comprehensive overview of all mory features
- **[🔌 API Documentation](docs/API.md)** - Complete API reference with examples
- **[📄 Data Format Specifications](docs/DATA_FORMATS.md)** - YAML frontmatter, task schemas, and data formats
- **[💡 Examples](docs/EXAMPLES.md)** - Real-world usage examples and workflows

## Quick Start

For detailed setup instructions including Docker deployment, environment configuration, and usage examples, see the **[Quick Start Guide](docs/QUICK_START.md)**.

### Development (Simple)
```bash
# Backend
cd backend && cargo run

# Frontend (in another terminal)
cd frontend && npm install && npm run dev
```

Access the application at http://localhost:5173
