#!/bin/sh
# Container entrypoint. Runs as root just long enough to:
#   1. read firefly_url from the Home Assistant add-on options, if present
#   2. make sure the SQLite data dir is writable by www-data
#   3. hand the log pipes to www-data
# then drops privileges and runs the regular start.sh.
# Outside Home Assistant (plain docker / compose) there is no options file,
# FIREFLY_URL comes from the environment and behaviour matches upstream.
set -e

OPTIONS=/data/options.json
DATA_DIR=/var/www/html/database/data

if [ -f "$OPTIONS" ]; then
    FIREFLY_URL="$(php -r 'echo json_decode(file_get_contents($argv[1]))->firefly_url ?? "";' "$OPTIONS")"
    export FIREFLY_URL
    echo "Home Assistant add-on mode, FIREFLY_URL=$FIREFLY_URL"
fi

if [ -z "$FIREFLY_URL" ]; then
    echo "FIREFLY_URL is not set (env var, or firefly_url in the add-on options)." >&2
    exit 1
fi

if [ "$(id -u)" = "0" ]; then
    mkdir -p "$DATA_DIR"
    touch "$DATA_DIR/database.sqlite"
    chown -R www-data:www-data "$DATA_DIR"
    if ! su-exec www-data sh -c "test -w '$DATA_DIR' && test -w '$DATA_DIR/database.sqlite'"; then
        echo "$DATA_DIR is not writable by www-data." >&2
        exit 1
    fi
    # Docker created the log pipes for root; supervisord's children write to
    # /dev/stdout as www-data.
    chown www-data /proc/self/fd/1 /proc/self/fd/2 2>/dev/null || true
    exec su-exec www-data /docker-entrypoint.d/start.sh "$@"
fi

exec /docker-entrypoint.d/start.sh "$@"
