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

### MCP server

moried serves an [MCP](https://modelcontextprotocol.io/) endpoint at
`{MORIED_ROOT_PATH}v2/mcp`, so Claude and ChatGPT can search and read the notes
directly. It is **off unless `MORIED_PUBLIC_URL` is set**; without that variable
none of its routes are registered.

```
MORIED_PUBLIC_URL=https://notes.example.com
```

That one value is the origin every discovery URL is derived from, and it must be
the origin clients actually reach — not the address moried binds to. Add the
connector by URL:

```
https://notes.example.com/api/v2/mcp
```

claude.ai and ChatGPT both refuse a static bearer token for a connector added by
URL, so moried is also a small OAuth 2.1 authorization server: adding the
connector opens a consent page that asks for the same username and password the
web app uses. Tokens are signed with `MORIED_SECRET`, so **rotating that secret
disconnects every connector** — and ends the web session too. There is no other
way to revoke one.

For a command-line client:

```shell
claude mcp add --transport http mory https://notes.example.com/api/v2/mcp
```

#### Reverse proxy

**The rule you already have is enough.** Whatever forwards `{MORIED_ROOT_PATH}`
to moried also serves discovery: the `WWW-Authenticate` challenge points clients
at `{MORIED_ROOT_PATH}.well-known/oauth-protected-resource/v2/mcp`, below the
mount, and RFC 8414's last fallback for a path-bearing issuer is
`{MORIED_ROOT_PATH}.well-known/openid-configuration`. Both are behind that one
rule. A typical block needs nothing added:

```nginx
location /api/ {
    proxy_pass       http://backend;   # no trailing slash: keep the prefix
    proxy_set_header Host $host;       # rmcp validates this
}
```

Verified against a real deployment behind nginx with exactly that one rule and no
`/.well-known/` rules at all: claude.ai follows the `resource_metadata` pointer
and then reads `{MORIED_ROOT_PATH}.well-known/openid-configuration`, both of
which sit under the mount. Claude Code instead builds the site-root paths, so it
wants the optional rules below — or the `{MORIED_ROOT_PATH}` fallback, which it
also accepts. Both identify themselves by client ID metadata document rather
than by registering.

`Host` matters: rmcp checks it against the authority in `MORIED_PUBLIC_URL` to
stop DNS rebinding. Pass it through as above, or name the internal hostname in
`MORIED_MCP_ALLOWED_HOSTS`, or every MCP request is refused with 403.

Optionally, these three put discovery on the path a client tries *first*, saving
a round trip:

```
https://<host>/.well-known/oauth-authorization-server*  → moried
https://<host>/.well-known/oauth-protected-resource*    → moried
https://<host>/.well-known/openid-configuration*        → moried
```

Match them narrowly rather than proxying all of `/.well-known/`, or you will
break `acme-challenge` and your certificate renewals:

```nginx
location ~ ^/\.well-known/(oauth-authorization-server|oauth-protected-resource|openid-configuration) {
    proxy_pass       http://backend;
    proxy_set_header Host $host;
}
```

Without them those paths reach whatever serves `/`. If that is a single-page
app, it answers **200 with its index page** rather than 404 — which is why the
challenge points below the mount instead: a client following it cannot be
handed HTML by a route that was never meant to answer.

Checking a deployment by hand:

```shell
curl -s https://notes.example.com/.well-known/oauth-protected-resource/api/v2/mcp | jq
curl -si -X POST https://notes.example.com/api/v2/mcp | head -3
```

The first must report a `resource` byte-identical to the URL typed into the
connector dialog; the second must be a 401 carrying `WWW-Authenticate: Bearer
… resource_metadata="…"`.

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
