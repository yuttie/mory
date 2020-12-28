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
```

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
