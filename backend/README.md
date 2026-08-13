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
