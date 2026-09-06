# moried

## Usage

### With Docker

Build a Docker image:
```shell
docker build -t moried .
```

Configure environment variables in `env.list`:
```
MORIED_ROOT_PATH=/
MORIED_SECRET=SERVERSECRETKEY
MORIED_USER_NAME=USERNAME
MORIED_USER_EMAIL=user@example.com
MORIED_USER_HASH=$argon2i$v=19$m=4096,t=3,p=1$MUZxK1p5Y3RrQmpVazM5SFduelZCakxhV0dqSXJEMy8$XcE1aipcYOUd7gIxh8f2+RRLQmlNT96cLyguIZqE128
MORIED_OPENAI_API_KEY=sk-your-openai-api-key-here
MORIED_OPENAI_MODEL=gpt-4o-mini
MORIED_OPENAI_CACHE_HOURS=24
```

### OpenAI Integration

moried talks to OpenAI's chat-completions API from two endpoints. Both require
`MORIED_OPENAI_API_KEY` and `MORIED_OPENAI_MODEL`; neither has a default, and a
request fails if either is unset.

`POST /v2/assess-task` assesses a task. Its responses are cached in the SQLite
database to reduce costs and improve performance:

- **Caching**: Identical requests return cached responses instantly
- **Expiration**: Cache entries expire after `MORIED_OPENAI_CACHE_HOURS` (default: 24 hours)
- **Performance**: Cached responses are served much faster than fresh API calls

`POST /v2/ai-action` runs an **AI Action**: it takes `{"prompt": "..."}`, sends
the prompt as-is, and returns `{"text": "..."}` with the model's reply verbatim.
This endpoint is **not** cached — re-running an action on the same input is meant
to be able to produce a different result.

### Local full-text and semantic search

`POST /v2/search` offers four modes. Grep retains regular-expression search over
every text file. Text uses a local Tantivy index over Markdown outside `.mory/`.
Semantic computes exact cosine similarity over embeddings stored in the local
SQLite cache, and Hybrid combines the best Text and Semantic candidates locally.
No hosted vector store or hosted file-search service is used.

Semantic and image indexing are opt-in and are off by default. Set
`MORIED_SEMANTIC_SEARCH_ENABLED=true` to authorize sending Markdown passages,
Semantic/Hybrid query text, and supported raster image pixels to OpenAI. The
resulting embeddings and descriptions are disposable local cache data; the Git
repository remains the only source of truth. Provider calls can incur usage
charges. Grep and Text do not require this opt-in or send search content to
OpenAI.

Configuration:

- `MORIED_SEARCH_INDEX_DIR` — persistent Tantivy directory (default `search-index/`).
- `MORIED_OPENAI_EMBEDDING_MODEL` — default `text-embedding-3-small`.
- `MORIED_OPENAI_EMBEDDING_DIMENSIONS` — default `1536`.
- `MORIED_OPENAI_VISION_MODEL` — required separately before images are described;
  the chat model is never inherited implicitly.

The Docker image stores the Tantivy index in `/search-index`; mount that volume
to avoid rebuilding Text search after replacing a container. SQLite embeddings
and descriptions live with `cache.sqlite` under `/home`.

Run a container:
```shell
docker run --env-file env.list -p 127.0.0.1:3030:3030 -v /path/to/local/repo:/repo -u $(id -u $USER):$(id -g $USER) moried
```

Please make sure Git's configs `user.name` and `user.email` are set correctly.
When moried make a commit, it doesn't use neither MORIED_USER_NAME nor MORIED_USER_EMAIL.
One way of achieving this is setting repository-local configs:
```
cd /path/to/local/repo
git config user.name "John Doe"
git config user.email "john.doe@example.com"
```
