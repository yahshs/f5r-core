#!/bin/sh
set -eu
# Railway mounts volumes as root. Initialize only the fixed database location,
# then replace this process with the unprivileged application.
if [ "${DB_PATH:-}" != "/data/app.sqlite" ]; then
  echo "This image requires DB_PATH=/data/app.sqlite and a volume at /data" >&2
  exit 1
fi
if [ -n "${RAILWAY_ENVIRONMENT_ID:-}${RAILWAY_PROJECT_ID:-}" ] && [ "${RAILWAY_VOLUME_MOUNT_PATH:-}" != "/data" ]; then
  echo "Railway requires a persistent volume mounted at /data" >&2
  exit 1
fi
if [ "$(id -u)" = "0" ]; then
  for target in /data /data/app.sqlite /data/app.sqlite-wal /data/app.sqlite-shm; do
    if [ -L "$target" ]; then
      echo "Refusing a symlink in the database location" >&2
      exit 1
    fi
    if [ -e "$target" ]; then chown node:node "$target"; fi
  done
  chmod 700 /data
  exec gosu node "$@"
fi
exec "$@"
