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


## Usage

### With Docker

Build a Docker image:
```shell
docker build -t mory .
```

Configure environment variables in `env.list`:
```
VITE_APP_APPLICATION_ROOT=/
VITE_APP_API_URL=http://127.0.0.1:3030/
```

Run a container:
```shell
docker run --env-file env.list -p 127.0.0.1:8080:80 mory
```
