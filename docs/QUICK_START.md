# mory Quick Start Guide

This guide will help you get mory up and running for development or production use.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Development Setup](#development-setup)
- [Production Deployment](#production-deployment)
- [Configuration](#configuration)
- [Basic Usage Examples](#basic-usage-examples)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### System Requirements
- **Node.js**: Version 16 or higher
- **Rust**: Latest stable version
- **Git**: For repository management
- **ImageMagick**: For image optimization (optional but recommended)

### Environment Setup
```bash
# Install Node.js (via nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Install ImageMagick (Ubuntu/Debian)
sudo apt-get install imagemagick

# Install ImageMagick (macOS)
brew install imagemagick
```

## Development Setup

### 1. Clone the Repository
```bash
git clone https://github.com/yuttie/mory.git
cd mory
```

### 2. Initialize Data Repository
Create a separate Git repository for your data:
```bash
mkdir ~/mory-data
cd ~/mory-data
git init
git config user.name "Your Name"
git config user.email "your.email@example.com"

# Create initial commit
echo "# My mory Data" > README.md
git add README.md
git commit -m "Initial commit"
```

### 3. Backend Setup
```bash
cd backend

# Copy environment template
cp .env.template .env

# Edit .env file with your settings
# Required variables:
# - MORIED_GIT_DIR: Path to your data repository
# - MORIED_SECRET: JWT secret key
# - MORIED_USER_NAME: Your username
# - MORIED_USER_EMAIL: Your email
# - MORIED_USER_HASH: Argon2 password hash

# Generate password hash
cargo run --bin hash-password
# Enter your desired password when prompted

# Install dependencies and run
cargo run
```

### 4. Frontend Setup
```bash
cd frontend

# Install dependencies
npm install

# Copy environment template
cp .env.template .env

# Edit .env file:
# VITE_APP_APPLICATION_ROOT=/
# VITE_APP_API_URL=http://127.0.0.1:3030/

# Run development server
npm run dev
```

### 5. Access the Application
- Frontend: http://localhost:5173
- Backend API: http://localhost:3030

## Production Deployment

### Docker Deployment (Recommended)

#### 1. Build Docker Images
```bash
# Build backend
cd backend
docker build -t mory-backend .

# Build frontend
cd frontend
docker build -t mory-frontend .
```

#### 2. Create Docker Compose Configuration
```yaml
# docker-compose.yml
version: '3.8'
services:
  backend:
    image: mory-backend
    ports:
      - "3030:3030"
    volumes:
      - /path/to/your/data:/repo
      - ./image-cache:/cache
    environment:
      - MORIED_LISTEN=0.0.0.0:3030
      - MORIED_ROOT_PATH=/
      - MORIED_GIT_DIR=/repo
      - MORIED_SECRET=your-secret-key
      - MORIED_USER_NAME=yourusername
      - MORIED_USER_EMAIL=your@email.com
      - MORIED_USER_HASH=your-argon2-hash
      - MORIED_ORIGIN_ALLOWED=http://localhost:8080
      - MORIED_IMAGE_CACHE_DIR=/cache
    user: "1000:1000"
    
  frontend:
    image: mory-frontend
    ports:
      - "8080:80"
    environment:
      - VITE_APP_APPLICATION_ROOT=/
      - VITE_APP_API_URL=http://localhost:3030/
```

#### 3. Deploy
```bash
docker-compose up -d
```

### Manual Deployment

#### 1. Backend Production Build
```bash
cd backend
cargo build --release
./target/release/mory
```

#### 2. Frontend Production Build
```bash
cd frontend
npm run build
# Serve dist/ directory with your preferred web server
```

## Configuration

### Backend Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `MORIED_LISTEN` | Yes | Server bind address | `127.0.0.1:3030` |
| `MORIED_ROOT_PATH` | Yes | API root path | `/` or `/api/` |
| `MORIED_GIT_DIR` | Yes | Path to Git repository | `/path/to/repo` |
| `MORIED_SECRET` | Yes | JWT secret key | `your-secret-key` |
| `MORIED_USER_NAME` | Yes | Username for login | `admin` |
| `MORIED_USER_EMAIL` | Yes | User email | `admin@example.com` |
| `MORIED_USER_HASH` | Yes | Argon2 password hash | `$argon2i$v=19$...` |
| `MORIED_ORIGIN_ALLOWED` | Yes | CORS origin | `http://localhost:8080` |
| `MORIED_SESSION_DURATION` | No | Session duration (minutes) | `360` (6 hours) |
| `MORIED_IMAGE_CACHE_DIR` | No | Image cache directory | `/tmp/cache` |

### Frontend Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `VITE_APP_APPLICATION_ROOT` | Yes | App root path | `/` |
| `VITE_APP_API_URL` | Yes | Backend API URL | `http://localhost:3030/` |

### Generating Password Hash

Use the backend utility to generate password hashes:
```bash
cd backend
cargo run --bin hash-password
```

Or use any Argon2 tool:
```bash
# Using argon2 CLI
echo -n "yourpassword" | argon2 $(openssl rand -base64 32) -id
```

## Basic Usage Examples

### Creating Your First Note

1. **Login** to the web interface
2. **Click "New Note"** or use the keyboard shortcut
3. **Add content** with optional YAML frontmatter:

```markdown
---
tags:
  - example
  - getting-started
---

# My First Note

This is my first note in mory!

## Features I want to try:
- [ ] Task management
- [ ] Calendar events
- [ ] File uploads
```

### Creating a Task

Create a task note in the `.tasks/` directory:

```markdown
---
tags:
  - work
  - project
task:
  status:
    kind: todo
  progress: 0
  importance: 3
  urgency: 2
  scheduled_dates:
    - "2023-12-01"
---

# Complete Project Documentation

Need to finish writing the user documentation for the new project.

## Requirements:
- API documentation
- User guide
- Installation instructions
```

### Creating an Event

Create an event note in the `.events/` directory:

```markdown
---
tags:
  - meeting
  - work
events:
  team_standup:
    start: "2023-12-01T09:00:00+00:00"
    end: "2023-12-01T09:30:00+00:00"
    color: "#2196f3"
    note: "Daily team standup meeting"
---

# Daily Standup

Regular team synchronization meeting.

## Agenda:
- Yesterday's progress
- Today's plan
- Blockers and challenges
```

### API Usage Examples

#### Authenticate
```bash
curl -X POST http://localhost:3030/login \
  -H "Content-Type: application/json" \
  -d '{"user": "admin", "password": "yourpassword"}'
```

#### List Notes
```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:3030/notes
```

#### Get Tasks
```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3030/v2/tasks?format=tree"
```

#### Search Notes
```bash
curl -X POST http://localhost:3030/notes \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"pattern": "project"}'
```

## Troubleshooting

### Common Issues

#### Backend Won't Start
**Problem**: "failed to open repository"
**Solution**: 
```bash
# Ensure Git repository is properly initialized
cd /path/to/your/data
git status
git config user.name "Your Name"
git config user.email "your@email.com"
```

#### Authentication Fails
**Problem**: "401 Unauthorized"
**Solutions**:
1. Check password hash is correct
2. Verify environment variables are set
3. Check JWT secret is consistent

#### CORS Errors
**Problem**: Cross-origin request blocked
**Solution**: 
```bash
# Set correct CORS origin in backend
export MORIED_ORIGIN_ALLOWED=http://localhost:8080
```

#### Image Processing Fails
**Problem**: Images not optimizing
**Solution**:
```bash
# Install ImageMagick
sudo apt-get install imagemagick  # Ubuntu/Debian
brew install imagemagick          # macOS

# Verify installation
convert --version
```

### Debug Mode

Enable debug logging:
```bash
# Backend
RUST_LOG=debug cargo run

# View logs
tail -f logs/mory.log
```

### Performance Issues

#### Slow Search
- Check Git repository size
- Consider using Git LFS for large files
- Monitor system resources

#### Slow Image Loading
- Verify ImageMagick is installed
- Check image cache directory permissions
- Monitor disk space

### Getting Help

1. **Check Logs**: Always check backend logs first
2. **Verify Configuration**: Double-check environment variables
3. **Test API**: Use curl to test API endpoints directly
4. **Repository State**: Verify Git repository integrity

For additional help, refer to the [API Documentation](API.md) and [Data Format Specifications](DATA_FORMATS.md).