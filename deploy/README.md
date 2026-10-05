# Deploying each build

`mory-deploy.timer` asks GitHub every two minutes for the newest successful run of the Docker
images workflow (`.github/workflows/docker.yml`) on main. When there is a new one, it runs
`docker compose up -d --pull always` beside `compose.yaml`. A run succeeds only once every image it
built is under `latest`, so the frontend and the backend change together.

It needs curl, jq and Docker Compose on the host, and runs as root, since `docker compose` needs
Docker's socket.

```sh
install -m 755 deploy/mory-deploy.sh /usr/local/bin/mory-deploy
install -m 644 deploy/mory-deploy.service deploy/mory-deploy.timer /etc/systemd/system/
# Unless compose.yaml and .env are in /srv/mory, set WorkingDirectory= under [Service].
systemctl edit mory-deploy.service
systemctl enable --now mory-deploy.timer
```

`journalctl -u mory-deploy` shows each deploy. The first check deploys what the newest successful
run built, and later ones only a newer run. To deploy that run again, delete
`/var/lib/mory-deploy/deployed-run`.
