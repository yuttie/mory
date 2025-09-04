# API Key Authentication for Mory

This document describes how to use the new API key authentication feature for programmatic access to mory.

## Overview

Mory now supports two authentication methods:
1. **JWT tokens** - Used by the web frontend, obtained via `/login` endpoint
2. **API keys** - Used for programmatic access (curl, CLI tools, etc.)

## Configuration

Add the `MORIED_API_KEY` environment variable to enable API key authentication:

```bash
# In your .env file or environment
MORIED_API_KEY='your-secret-api-key-here'
```

**Important:**
- Keep your API key secure and don't commit it to version control
- Use a strong, random API key (consider using `openssl rand -hex 32`)
- API keys don't expire (unlike JWT tokens)

## Usage Examples

### Basic Authentication
```bash
curl -H "Authorization: Bearer your-api-key" http://localhost:3030/notes
```

### Common Operations

**List all notes:**
```bash
curl -H "Authorization: Bearer your-api-key" \
     http://localhost:3030/notes
```

**Get a specific note:**
```bash
curl -H "Authorization: Bearer your-api-key" \
     http://localhost:3030/notes/my-note.md
```

**Create or update a note:**
```bash
curl -X PUT \
     -H "Authorization: Bearer your-api-key" \
     -H "Content-Type: application/json" \
     -d '{"Save":{"content":"# My Note\n\nContent here","message":"Update note"}}' \
     http://localhost:3030/notes/my-note.md
```

**Delete a note:**
```bash
curl -X DELETE \
     -H "Authorization: Bearer your-api-key" \
     http://localhost:3030/notes/my-note.md
```

**Upload a file:**
```bash
curl -X POST \
     -H "Authorization: Bearer your-api-key" \
     -F "file=@document.pdf" \
     http://localhost:3030/files
```

**Get system information:**
```bash
# Get HEAD commit ID
curl -H "Authorization: Bearer your-api-key" \
     http://localhost:3030/v2/commits/head

# List tasks
curl -H "Authorization: Bearer your-api-key" \
     http://localhost:3030/v2/tasks

# List calendar events
curl -H "Authorization: Bearer your-api-key" \
     http://localhost:3030/v2/events
```

## CLI Wrapper Function

For easier command-line usage, create a wrapper function:

```bash
# Add to ~/.bashrc or ~/.zshrc
mory() {
    curl -H "Authorization: Bearer $MORIED_API_KEY" "$@"
}

# Usage:
export MORIED_API_KEY='your-api-key'
mory http://localhost:3030/notes
mory -X PUT -H "Content-Type: application/json" \
     -d '{"Save":{"content":"# Test","message":"test"}}' \
     http://localhost:3030/notes/test.md
```

## Security Notes

- API keys are checked before JWT tokens, so they take precedence
- If `MORIED_API_KEY` is not set or empty, only JWT authentication works
- The existing JWT authentication for the web frontend is unchanged
- Invalid API keys return HTTP 401 Unauthorized
- API keys are compared using simple string equality (constant-time comparison would be better for production use)

## Implementation Details

The implementation adds API key validation to the existing `token_is_valid()` function:

1. Extract token from `Authorization: Bearer <token>` header
2. Check if token matches `MORIED_API_KEY` environment variable
3. If no match, fall back to JWT validation (existing behavior)
4. Both authentication methods use the same authorization middleware

This minimal approach preserves all existing functionality while adding the requested programmatic access capability.