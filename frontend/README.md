# mory

## Usage

### With Docker

Build a Docker image:
```shell
docker build -t mory .
```

Configure environment variables in `env.list`:
```
VUE_APP_APPLICATION_ROOT=/
VUE_APP_API_URL=http://127.0.0.1:3030/
```

Run a container:
```shell
docker run --env-file env.list -p 127.0.0.1:8080:80 mory
```
