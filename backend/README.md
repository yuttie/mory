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

**Two rules.** One forwards `{MORIED_ROOT_PATH}` to moried, which a deployment
already has; the other forwards the three discovery documents at the site root.
Both pass `Host` through:

```nginx
location /api/ {
    proxy_pass       http://backend;   # no trailing slash: keep the prefix
    proxy_set_header Host $host;       # rmcp validates this
}

location ~ ^/\.well-known/(oauth-authorization-server|oauth-protected-resource|openid-configuration) {
    proxy_pass       http://backend;
    proxy_set_header Host $host;
}
```

Match the second narrowly rather than proxying all of `/.well-known/`, or you
will break `acme-challenge` and your certificate renewals.

`Host` matters: rmcp checks it against the authority in `MORIED_PUBLIC_URL` to
stop DNS rebinding. Pass it through as above, or name the internal hostname in
`MORIED_MCP_ALLOWED_HOSTS`, or every MCP request is refused with 403.

**Why the second rule is required.** Every client built on the MCP TypeScript
SDK needs it, Claude Code and OpenClaw among them. With `MORIED_ROOT_PATH=/api/`
the issuer is `https://<host>/api`, and for an issuer with a path the SDK tries
three metadata URLs in this order, moving on to the next when one answers 4xx:

```
https://<host>/.well-known/oauth-authorization-server/api
https://<host>/.well-known/openid-configuration/api
https://<host>/api/.well-known/openid-configuration
```

Without the second rule the first reaches whatever serves `/`. If that is a
single-page app, it answers **200 with its index page** rather than 404, the
SDK fails to parse it as JSON, and it never tries the other two. Where `/`
answers 404 instead, the SDK does reach the third, but reads it as an OpenID
Connect document, which must name `jwks_uri`, `subject_types_supported` and
`id_token_signing_alg_values_supported`. moried is not an OpenID provider and
names none of them, so that fails too. Either way the client gives up before
it reaches the consent page, with an error that names neither cause:
OpenClaw's says only "Sign-in did not finish".

claude.ai is the one client known to manage with the `/api/` rule alone.
Verified against a real deployment behind nginx with exactly that one rule and
no `/.well-known/` rules at all: it follows the `resource_metadata` pointer and
then reads `{MORIED_ROOT_PATH}.well-known/openid-configuration`, both of which
sit under the mount, and it accepts that last document without the OpenID
fields the SDK requires. claude.ai and Claude Code identify themselves by
client ID metadata document rather than by registering.

The `WWW-Authenticate` challenge still points below the mount, at
`{MORIED_ROOT_PATH}.well-known/oauth-protected-resource/v2/mcp`, so a client
following it reads the protected-resource document through the first rule
however `/` behaves. It is the authorization server's document that the SDK
looks for at the site root.

Checking a deployment by hand:

```shell
curl -s https://notes.example.com/.well-known/oauth-authorization-server/api | jq .issuer
curl -s https://notes.example.com/.well-known/oauth-protected-resource/api/v2/mcp | jq
curl -si -X POST https://notes.example.com/api/v2/mcp | head -3
```

The first must print exactly `"https://notes.example.com/api"`: a parse error
from jq means the request reached whatever serves `/`, and newer versions of
the SDK refuse a document whose `issuer` is not the one they asked for. The
second must report a `resource` byte-identical to the URL typed into the
connector dialog; the third must be a 401 carrying `WWW-Authenticate: Bearer
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
