# Installation & Setup

This guide will help you get mory up and running on your system.

## Prerequisites

Before installing mory, ensure you have:

- **Docker** (recommended) or Node.js environment
- **Git repository** for storing your notes and data
- A web browser (Chrome, Firefox, Safari, or Edge)

## Installation Methods

### Method 1: Docker (Recommended)

Docker is the easiest way to run mory as it handles all dependencies automatically.

#### Step 1: Clone or Download

```bash
# Clone the repository
git clone https://github.com/yuttie/mory.git
cd mory
```

#### Step 2: Build Docker Image

```bash
docker build -t mory .
```

#### Step 3: Configure Environment

Create an `env.list` file with your configuration:

```bash
# Example env.list
VITE_APP_APPLICATION_ROOT=/
VITE_APP_API_URL=http://127.0.0.1:3030/
```

#### Step 4: Run Container

```bash
docker run --env-file env.list -p 127.0.0.1:8080:80 mory
```

#### Step 5: Access mory

Open your browser and navigate to `http://127.0.0.1:8080`

### Method 2: Development Setup

For development or if you prefer not to use Docker:

#### Step 1: Install Dependencies

```bash
# Clone the repository
git clone https://github.com/yuttie/mory.git
cd mory

# Install dependencies
npm install
```

#### Step 2: Configure Environment

Copy the environment template:

```bash
cp .env.template .env.local
```

Edit `.env.local` with your settings:

```bash
VITE_APP_APPLICATION_ROOT=/
VITE_APP_API_URL=http://127.0.0.1:3030/
```

#### Step 3: Start Development Server

```bash
npm run dev
```

#### Step 4: Build for Production

```bash
npm run build
npm run preview
```

## Initial Setup

### 1. Backend Configuration

mory requires a backend server to handle file operations and Git integration. You'll need to set up:

- A Git repository for storing your notes
- API endpoints for file operations
- Authentication (if required)

### 2. First Launch

When you first access mory:

1. **Configure API URL** - Point to your backend server
2. **Authenticate** - If your setup requires authentication
3. **Test Connection** - Verify mory can access your data repository

### 3. Data Directory Structure

mory expects your data repository to have this structure:

```
your-notes-repo/
├── notes/           # Your markdown notes
├── files/           # Attachments and images
├── templates/       # Note templates (optional)
└── .git/           # Git version control
```

## Troubleshooting

### Common Issues

**Port Already in Use**
```bash
# Change the port in your run command
docker run --env-file env.list -p 127.0.0.1:8081:80 mory
```

**Cannot Connect to API**
- Verify your `VITE_APP_API_URL` is correct
- Check that your backend server is running
- Ensure firewall/network settings allow connections

**Docker Build Fails**
- Ensure Docker is running
- Check you have sufficient disk space
- Try pulling the latest base images

### Getting Help

If you encounter issues:

1. Check the [troubleshooting section](#troubleshooting)
2. Review the configuration in [Configuration Guide](configuration.md)
3. Report bugs on [GitHub Issues](https://github.com/yuttie/mory/issues)

## Next Steps

Once mory is running:

- Read the [Quick Start Guide](quick-start.md) to learn the basics
- Explore the [Notes Guide](notes.md) to start writing
- Set up your [Calendar](calendar.md) for event management
- Configure [Tasks](tasks.md) for project tracking