# mory API Documentation

This document provides comprehensive documentation for all mory API endpoints and their functionality.

## Table of Contents

- [Authentication](#authentication)
- [Notes API](#notes-api)
- [Files API](#files-api)
- [Tasks API v2](#tasks-api-v2)
- [Events API v2](#events-api-v2)
- [Commits API v2](#commits-api-v2)
- [Error Responses](#error-responses)

## Authentication

All API endpoints except `/login` require authentication using JWT tokens.

### POST /login

Authenticate a user and receive a JWT token.

**Request Body:**
```json
{
  "user": "username",
  "password": "password"
}
```

**Response:**
- **200 OK**: Returns JWT token as plain text
- **401 Unauthorized**: Invalid credentials
- **503 Service Unavailable**: Rate limited (max 1 request per 3 seconds)

**Example:**
```bash
curl -X POST http://localhost:3030/login \
  -H "Content-Type: application/json" \
  -d '{"user": "myuser", "password": "mypassword"}'
```

**Authentication Header:**
Use the returned token in subsequent requests:
```
Authorization: Bearer <jwt_token>
```

## Notes API

### GET /notes

List all notes in the repository.

**Response:**
```json
[
  {
    "path": "note1.md",
    "size": 1024,
    "mime_type": "text/markdown",
    "metadata": {
      "tags": ["work", "project"],
      "task": null,
      "events": null
    },
    "title": "My First Note",
    "time": "2023-12-01T10:30:00+00:00"
  }
]
```

### POST /notes

Search notes using git grep functionality.

**Request Body:**
```json
{
  "pattern": "search term"
}
```

**Response:**
```json
[
  {
    "file": "note1.md",
    "line": 5,
    "content": "This line contains the search term"
  }
]
```

### GET /notes/{path}

Retrieve the content of a specific note.

**Parameters:**
- `path`: The file path of the note

**Response:**
- **200 OK**: Returns note content as text/markdown
- **404 Not Found**: Note doesn't exist

### PUT /notes/{path}

Create or update a note.

**Request Body (Save):**
```json
{
  "Save": {
    "content": "# My Note\n\nContent here...",
    "message": "Update note1.md"
  }
}
```

**Request Body (Rename):**
```json
{
  "Rename": {
    "from": "old-path.md"
  }
}
```

**Response:**
- **200 OK**: Returns `true` on success
- **404 Not Found**: Source file not found (for rename operation)

### DELETE /notes/{path}

Delete a note.

**Response:**
- **200 OK**: Returns `true` on success
- **404 Not Found**: Note doesn't exist

## Files API

### POST /files

Upload one or more files using multipart form data.

**Request:**
- Content-Type: `multipart/form-data`
- Maximum file size: 16MB
- Each file field should have a UUID as the field name

**Response:**
```json
[
  ["uuid1", "success"],
  ["uuid2", "success"]
]
```

**Example:**
```bash
curl -X POST http://localhost:3030/files \
  -H "Authorization: Bearer <token>" \
  -F "550e8400-e29b-41d4-a716-446655440000=@image.jpg"
```

### GET /files/{path}

Retrieve a file's content.

**Features:**
- Automatic image optimization (converts to WebP format)
- Proper MIME type detection
- Image caching

**Response:**
- **200 OK**: Returns file content with appropriate Content-Type header
- **404 Not Found**: File doesn't exist

## Tasks API v2

### GET /v2/tasks

Retrieve tasks with optional formatting.

**Query Parameters:**
- `format`: Optional. Set to `tree` for hierarchical structure

**Headers:**
- `If-None-Match`: Optional ETag for conditional requests

**Response (List format):**
```json
[
  {
    "path": ".tasks/550e8400-e29b-41d4-a716-446655440000.md",
    "size": 1024,
    "mime_type": "text/markdown",
    "metadata": {
      "task": {
        "status": {"kind": "todo"},
        "progress": 0,
        "importance": 3,
        "urgency": 2,
        "scheduled_dates": []
      },
      "tags": ["work"]
    },
    "title": "Complete documentation",
    "time": "2023-12-01T10:30:00+00:00"
  }
]
```

**Response (Tree format):**
```json
[
  {
    "uuid": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Complete documentation",
    "path": ".tasks/550e8400-e29b-41d4-a716-446655440000.md",
    "size": 1024,
    "mime_type": "text/markdown",
    "metadata": {
      "task": {...},
      "tags": ["work"]
    },
    "title": "Complete documentation",
    "mtime": "2023-12-01T10:30:00+00:00",
    "children": []
  }
]
```

**Response Headers:**
- `ETag`: Current commit hash for caching
- `Access-Control-Expose-Headers`: ETag

**Status Codes:**
- **200 OK**: Tasks retrieved successfully
- **304 Not Modified**: No changes since ETag (when If-None-Match matches)

## Events API v2

### GET /v2/events

Retrieve events/calendar entries.

**Headers:**
- `If-None-Match`: Optional ETag for conditional requests

**Response:**
```json
[
  {
    "path": ".events/550e8400-e29b-41d4-a716-446655440000.md",
    "size": 512,
    "mime_type": "text/markdown",
    "metadata": {
      "events": {
        "meeting": {
          "start": "2023-12-01T14:00:00+00:00",
          "end": "2023-12-01T15:00:00+00:00",
          "color": "#ff5722",
          "note": "Weekly team sync"
        }
      },
      "tags": ["meeting", "work"]
    },
    "title": "Team Meeting",
    "time": "2023-12-01T10:30:00+00:00"
  }
]
```

## Commits API v2

### GET /v2/commits/head

Get the current HEAD commit ID.

**Response:**
```json
"a1b2c3d4e5f6789012345678901234567890abcd"
```

## Files API v2

### GET /v2/files/{path}

Enhanced file retrieval with conditional GET support.

**Headers:**
- `If-None-Match`: Optional ETag for conditional requests

**Response:**
- **200 OK**: File content with ETag header
- **304 Not Modified**: No changes since ETag
- **404 Not Found**: File doesn't exist

### HEAD /v2/files/{path}

Get file metadata without content.

**Response:**
- Same as GET but with empty body
- Includes ETag and other headers

## Error Responses

### Common HTTP Status Codes

- **400 Bad Request**: Malformed request
- **401 Unauthorized**: Missing or invalid authentication
- **404 Not Found**: Resource doesn't exist
- **500 Internal Server Error**: Server error
- **503 Service Unavailable**: Rate limited

### Error Response Format

```json
{
  "error": "Error description",
  "details": "Additional error details"
}
```