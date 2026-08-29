# mory - Personal Memory Management App

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

mory is a personal note-taking and memory management application with Git-powered storage and Markdown-native format. It consists of a Rust backend (moried) and Vue.js frontend, designed for single-user private use.

## Working Effectively

### Prerequisites and Setup
- Install Rust (cargo 1.89+ tested working)
- Install Node.js (v20.19+ tested working) and npm (10.8+ tested working)  
- Install Git (2.51+ tested working)
- For icon generation: install Inkscape (optional, only needed for `tools/generate-icons.sh`)

### Bootstrap and Build
- **Backend build**: `cd backend && cargo build --release`
  - Takes **2m 42s** to complete. **NEVER CANCEL**. Set timeout to **240+ seconds**.
- **Frontend build**: `cd frontend && npm install && npm run build`
  - npm install takes ~23 seconds
  - npm run build takes **21 seconds**. **NEVER CANCEL**. Set timeout to **60+ seconds**.

### Environment Setup
- **Backend**: Copy `backend/.env.template` to `backend/.env` and configure:
  - `MORIED_GIT_DIR`: Path to Git repository for notes storage
  - `MORIED_IMAGE_CACHE_DIR`: Directory for image cache
  - `MORIED_LISTEN`: Server address (default: localhost:3030)
  - `MORIED_SECRET`: Server secret key for JWT
  - `MORIED_USER_NAME`, `MORIED_USER_EMAIL`, `MORIED_USER_HASH`: User credentials
- **Frontend**: Copy `frontend/.env.template` to `frontend/.env` and configure:
  - `VITE_APP_API_URL`: Backend API URL (default: http://localhost:3030/)
  - `VITE_APP_APPLICATION_ROOT`: Application root path (default: /)

### Running the Application
1. **Start Backend Server**: `cd backend && ./target/release/moried`
   - Requires a Git repository at `MORIED_GIT_DIR` path
   - Server starts immediately, listens on configured port
   - API endpoints return 401 without authentication, 404 for undefined routes
2. **Start Frontend Dev Server**: `cd frontend && npm run dev`
   - Starts on http://localhost:8080/
   - Hot reload enabled for development
3. **Production Preview**: `cd frontend && npm run preview`
   - Serves built files on http://localhost:4173/

### Testing and Validation
- **Backend tests**: `cargo test` (currently no tests defined, exits with "0 passed")
- **Backend linting**: `cargo clippy` (reports minor warnings, no errors)
- **Frontend linting**: `npm run lint` - **CURRENTLY FAILS** with 253 errors, 921 warnings
  - Errors include missing global definitions (console, window, document, crypto)
  - TypeScript "any" type warnings
  - Vue 2 component style warnings
  - **Note**: Linting failures are expected in current state

### Manual Validation Scenarios
- **CRITICAL**: Always manually validate the application after making changes:
1. **Backend validation**: 
   - `curl http://localhost:3030/` should return 404
   - `curl http://localhost:3030/notes` should return 401 Unauthorized
2. **Frontend validation**:
   - Navigate to http://localhost:8080/
   - Should show login screen with Username/Password fields
   - Default credentials: Username="USERNAME", Password="password"
   - After login, should show main interface with navigation menu
   - Test navigation between Home, Calendar, Tasks, Files sections

### Build Timing and Expectations
- **Frontend npm install**: ~23 seconds
- **Frontend build**: ~21 seconds
- **Backend build (release)**: ~162 seconds (2m 42s) 
- **Backend clippy**: ~35 seconds
- **NEVER CANCEL** any build commands - always wait for completion

## Common Tasks and Solutions

### Directory Structure
```
mory/
├── README.md
├── backend/          # Rust server (moried)
│   ├── Cargo.toml   # Dependencies: axum, git2, sqlx, tokio, etc.
│   ├── src/main.rs  # Main server implementation
│   ├── .env.template
│   └── Dockerfile
├── frontend/         # Vue.js client application
│   ├── package.json # Dependencies: Vue 2, Vite, Vuetify, etc.
│   ├── src/         # Vue components and stores
│   ├── tools/       # Icon generation script
│   ├── .env.template
│   └── Dockerfile
```

### Key Components
- **Backend (moried)**: 
  - Axum web server with JWT authentication
  - Git repository integration for note storage
  - SQLite cache for metadata and performance
  - Markdown parsing and metadata extraction
- **Frontend (mory)**:
  - Vue 2 + Vuetify UI framework
  - Vite build system with hot reload
  - Axios for API communication
  - Ace Editor for markdown editing

### Troubleshooting
- **Backend won't start**: Check that Git repository exists at `MORIED_GIT_DIR`
- **Frontend build fails**: Ensure Node.js 20+ and npm are installed
- **Login fails**: Verify backend is running and `MORIED_SECRET` matches
- **Linting errors**: Expected in current state - focus on functionality over linting
- **CORS errors**: Ensure `MORIED_ORIGIN_ALLOWED` matches frontend URL

### Development Tools
- **Backend**: Use `bacon` tool (if installed) for continuous checking
  - `bacon check`: Continuous compile checking
  - `bacon clippy`: Continuous linting
  - `bacon serve`: Auto-restart server on changes
- **Frontend**: Vite provides hot module replacement in dev mode

## File Locations

### Frequently Modified Files
- **API definitions**: `frontend/src/api.ts`
- **Main server logic**: `backend/src/main.rs`
- **Frontend routing**: `frontend/src/router/index.ts`
- **Vue stores**: `frontend/src/stores/`

### Configuration Files
- **Backend config**: `backend/.env`, `backend/Cargo.toml`
- **Frontend config**: `frontend/.env`, `frontend/package.json`, `frontend/vite.config.ts`
- **Linting**: `frontend/eslint.config.js`

### Build Outputs
- **Backend binary**: `backend/target/release/moried`
- **Frontend dist**: `frontend/dist/`

Remember: This is a personal productivity tool with single-user focus. Always test login and basic navigation after making changes to ensure the core workflow remains functional.