#!/bin/sh
# Container entrypoint. Runs as root just long enough to:
#   1. read the Home Assistant add-on options, if present, into the same
#      environment variables the plain docker image uses
#   2. make sure the SQLite data dir is writable by www-data
#   3. hand the log pipes to www-data
# then drops privileges and runs the regular start.sh.
# Outside Home Assistant (plain docker / compose) there is no options file,
# the variables come from the environment and behaviour matches upstream.
set -e

OPTIONS=/data/options.json
DATA_DIR=/var/www/html/database/data

# Print the named add-on option, or nothing when it is absent or empty.
addon_option() {
    php -r 'echo trim((string)(json_decode(file_get_contents($argv[1]))->{$argv[2]} ?? ""));' "$OPTIONS" "$1"
}

# Export VAR from the add-on option only when the option is set, so an empty
# option leaves the backend's own defaults (and any env var) untouched.
export_addon_option() {
    value="$(addon_option "$2")"
    if [ -n "$value" ]; then
        export "$1=$value"
    fi
}

if [ -f "$OPTIONS" ]; then
    export_addon_option FIREFLY_URL firefly_url
    export_addon_option ASSISTANT_LLM_API_KEY assistant_llm_api_key
    export_addon_option ASSISTANT_LLM_ENDPOINT assistant_llm_endpoint
    export_addon_option ASSISTANT_LLM_MODEL assistant_llm_model
    export_addon_option ASSISTANT_LLM_CONTEXT assistant_llm_context
    export_addon_option ASSISTANT_TRANSCRIPTION_API_KEY assistant_transcription_api_key
    export_addon_option ASSISTANT_TRANSCRIPTION_ENDPOINT assistant_transcription_endpoint
    export_addon_option ASSISTANT_TRANSCRIPTION_MODEL assistant_transcription_model
    export_addon_option ASSISTANT_TRANSCRIPTION_LANGUAGE assistant_transcription_language
    echo "Home Assistant add-on mode, FIREFLY_URL=$FIREFLY_URL, assistant LLM key: $([ -n "$ASSISTANT_LLM_API_KEY" ] && echo set || echo not set)"
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
