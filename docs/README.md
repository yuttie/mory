# mory Documentation Index

Welcome to the complete mory documentation! This index helps you find the information you need quickly.

## Quick Navigation

### Getting Started
- **[🚀 Quick Start Guide](QUICK_START.md)** - Installation, setup, and first steps
- **[💡 Examples](EXAMPLES.md)** - Real-world usage examples and workflows

### Reference Documentation
- **[📚 Features Guide](FEATURES.md)** - Complete feature overview
- **[🔌 API Documentation](API.md)** - REST API reference
- **[📄 Data Format Specifications](DATA_FORMATS.md)** - YAML schemas and formats

## Documentation by Use Case

### For New Users
1. **Start Here**: [Quick Start Guide](QUICK_START.md#prerequisites)
2. **Learn Features**: [Features Guide](FEATURES.md#core-features) 
3. **See Examples**: [Examples - Basic Notes](EXAMPLES.md#basic-notes)

### For Developers
1. **API Reference**: [API Documentation](API.md)
2. **Data Formats**: [Data Format Specifications](DATA_FORMATS.md)
3. **Code Examples**: [Examples - API Usage](EXAMPLES.md#api-usage-examples)

### For Power Users
1. **Advanced Features**: [Features Guide - Advanced](FEATURES.md#advanced-task-features)
2. **Complex Workflows**: [Examples - Advanced Workflows](EXAMPLES.md#advanced-workflows)
3. **Task Management**: [Data Formats - Task Schema](DATA_FORMATS.md#task-metadata-schema)

## Feature-Specific Documentation

### Note Management
- **Basic Usage**: [Examples - Basic Notes](EXAMPLES.md#basic-notes)
- **API Reference**: [API - Notes API](API.md#notes-api)
- **Features**: [Features - Note Management](FEATURES.md#note-management)

### Task Management
- **Getting Started**: [Examples - Task Examples](EXAMPLES.md#task-examples)
- **Status Workflow**: [Data Formats - Task Status Types](DATA_FORMATS.md#task-status-types)
- **API Reference**: [API - Tasks API v2](API.md#tasks-api-v2)
- **Advanced Features**: [Features - Task Management](FEATURES.md#task-management)

### Calendar & Events
- **Event Creation**: [Examples - Event Examples](EXAMPLES.md#event-examples)
- **Data Schema**: [Data Formats - Event Metadata](DATA_FORMATS.md#event-metadata-schema)
- **API Reference**: [API - Events API v2](API.md#events-api-v2)
- **Features**: [Features - Calendar & Events](FEATURES.md#calendar--events)

### File Management
- **Upload Files**: [Examples - File Upload](EXAMPLES.md#api-usage-examples)
- **API Reference**: [API - Files API](API.md#files-api)
- **Features**: [Features - File Management](FEATURES.md#file-management)

### Search & Discovery
- **Search Examples**: [Examples - API Usage](EXAMPLES.md#api-usage-examples)
- **API Reference**: [API - Notes Search](API.md#post-notes)
- **Features**: [Features - Search & Discovery](FEATURES.md#search--discovery)

## Technical Documentation

### Data Formats
- **YAML Frontmatter**: [Data Formats - YAML Structure](DATA_FORMATS.md#yaml-frontmatter-structure)
- **Date/Time Formats**: [Data Formats - Date and Time](DATA_FORMATS.md#date-and-time-formats)
- **File Naming**: [Data Formats - File Naming Conventions](DATA_FORMATS.md#file-naming-conventions)
- **Tags System**: [Data Formats - Tags System](DATA_FORMATS.md#tags-system)

### API Reference
- **Authentication**: [API - Authentication](API.md#authentication)
- **Error Handling**: [API - Error Responses](API.md#error-responses)
- **Rate Limiting**: [Quick Start - Configuration](QUICK_START.md#configuration)
- **Conditional GET**: [API - Files API v2](API.md#files-api-v2)

### Deployment & Configuration
- **Development Setup**: [Quick Start - Development Setup](QUICK_START.md#development-setup)
- **Production Deployment**: [Quick Start - Production Deployment](QUICK_START.md#production-deployment)
- **Docker Configuration**: [Quick Start - Docker Deployment](QUICK_START.md#docker-deployment-recommended)
- **Environment Variables**: [Quick Start - Configuration](QUICK_START.md#configuration)

## Troubleshooting

### Common Issues
- **Setup Problems**: [Quick Start - Troubleshooting](QUICK_START.md#troubleshooting)
- **Authentication Issues**: [API - Authentication](API.md#authentication)
- **Data Format Errors**: [Data Formats - Validation](DATA_FORMATS.md#validation-and-error-handling)

### Debug Information
- **Error Messages**: [API - Error Responses](API.md#error-responses)
- **Debug Mode**: [Quick Start - Debug Mode](QUICK_START.md#debug-mode)
- **Performance Issues**: [Quick Start - Performance Issues](QUICK_START.md#performance-issues)

## Development Resources

### Code Examples
- **Bash Scripts**: [Examples - API Usage Examples](EXAMPLES.md#api-usage-examples)
- **Real Workflows**: [Examples - Advanced Workflows](EXAMPLES.md#advanced-workflows)
- **Data Samples**: [Examples - Task Examples](EXAMPLES.md#task-examples)

### Integration
- **REST API**: [API Documentation](API.md)
- **Webhook Support**: Currently not available
- **Import/Export**: Git-based (clone/push repositories)

## Architecture Overview

### Storage
- **Git Repository**: All data versioned with Git
- **File Structure**: UUID-based naming for uniqueness
- **Metadata**: YAML frontmatter in Markdown files
- **Caching**: SQLite database for performance

### API Design
- **RESTful**: Standard HTTP methods and status codes
- **Authentication**: JWT tokens with configurable expiration
- **Versioning**: v1 and v2 API endpoints
- **Caching**: ETag support for conditional requests

### Frontend
- **Vue.js**: Modern JavaScript framework
- **Responsive**: Mobile and desktop optimized
- **Real-time**: Live preview and editing
- **Customizable**: Themes and editor options

## Contributing

### Documentation
- **Format**: All documentation in Markdown
- **Structure**: Organized by use case and feature
- **Examples**: Include practical, real-world examples
- **Accuracy**: Keep in sync with code changes

### Code
- **Backend**: Rust with Axum framework
- **Frontend**: Vue.js with Vite build system
- **Testing**: See individual component README files
- **Standards**: Follow existing code patterns

## Support

### Getting Help
1. **Check Documentation**: Start with this index
2. **Search Examples**: Look for similar use cases
3. **Review API Docs**: Understand endpoint behavior
4. **Check Logs**: Enable debug mode for details

### Feedback
- **Documentation**: Suggest improvements via issues
- **Features**: Request new functionality
- **Bugs**: Report with detailed reproduction steps
- **Examples**: Contribute real-world use cases

---

**Last Updated**: December 2023  
**Version**: 1.0  
**Coverage**: Complete feature documentation