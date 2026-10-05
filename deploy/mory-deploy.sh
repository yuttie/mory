#!/bin/sh
# Brings the containers up to date once a run of the Docker images workflow has
# succeeded on main, which is when `latest` holds every image the run built.
# mory-deploy.timer runs it in the directory holding compose.yaml and .env.
#
# Polling GitHub, rather than being called by it, leaves nothing on this host
# for the internet to reach and no key to it in GitHub, and catches up on a run
# that finished while the host was down.
set -eu

runs='https://api.github.com/repos/yuttie/mory/actions/workflows/docker.yml/runs?branch=main&status=success&per_page=1'
# The run last deployed, in the directory StateDirectory= gives the service.
state=${STATE_DIRECTORY:-.}/deployed-run

# Apart from jq, so that a failed request fails the service: sh has no
# pipefail, and jq reads no input as no runs.
response=$(curl -fsS "$runs")
run=$(printf '%s' "$response" | jq -r '.workflow_runs[0].id // empty')
if [ -z "$run" ] || [ "$run" = "$(cat "$state" 2>/dev/null || true)" ]; then
    exit 0
fi
echo "Deploying what https://github.com/yuttie/mory/actions/runs/$run built"
docker compose up -d --pull always
# Only once that succeeded, so a failed deploy is tried again.
echo "$run" > "$state"
