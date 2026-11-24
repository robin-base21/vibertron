#!/usr/bin/env bash
# Build the Docker images here and copy them to a server over SSH (no registry needed).
#
#   bun run ship user@server [dir]
#
# - builds backend, frontend and site for the server's CPU (x86_64 or arm64);
# - streams them, compressed, into the server's Docker (`docker load`);
# - with [dir] (the folder holding docker-compose.yml and .env on the server) also restarts the
#   containers there with the new images: `docker compose up -d` (COMPOSE_FILE in that .env decides
#   whether docker-compose.pangolin.yml is included).
set -euo pipefail

host="${1:-}"
dir="${2:-}"
if [[ -z "$host" ]]; then
	echo "usage: bun run ship user@server [dir-on-server]" >&2
	exit 1
fi
cd "$(dirname "$0")/.."

images=(vibertron-backend:latest vibertron-frontend:latest vibertron-site:latest)

# One SSH connection for every step: a key passphrase is asked for once (or not at all with ssh-agent).
control="$(mktemp -d)/ssh-%C"
ssh_() { ssh -o ControlMaster=auto -o ControlPath="$control" -o ControlPersist=10m "$@"; }
trap 'ssh -o ControlPath="$control" -O exit "$host" 2>/dev/null || true' EXIT

echo "→ checking $host"
arch="$(ssh_ "$host" uname -m)"
case "$arch" in
	x86_64 | amd64) platform=linux/amd64 ;;
	aarch64 | arm64) platform=linux/arm64 ;;
	*) echo "unsupported server CPU: $arch" >&2; exit 1 ;;
esac
ssh_ "$host" 'docker version --format "{{.Server.Version}}"' >/dev/null

echo "→ building for $platform"
DOCKER_DEFAULT_PLATFORM="$platform" docker compose -f docker-compose.yml build backend frontend site

echo "→ sending images (shared layers go once)"
start=$(date +%s)
docker save "${images[@]}" | gzip -1 | ssh_ "$host" 'gunzip | docker load'
echo "  sent in $(( $(date +%s) - start ))s"

if [[ -n "$dir" ]]; then
	echo "→ restarting in $host:$dir"
	# --no-build: never rebuild on the server; the images just arrived.
	ssh_ "$host" "cd $(printf '%q' "$dir") && docker compose up -d --no-build && docker image prune -f >/dev/null"
	ssh_ "$host" "cd $(printf '%q' "$dir") && docker compose ps"
else
	echo "→ done. On the server: docker compose up -d --no-build"
fi
