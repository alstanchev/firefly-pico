# Firefly Pico add-on

Mobile-friendly companion app for Firefly III, built from this fork's source
on your Home Assistant host. The first install and every update compile the
app locally; expect a few minutes on x86 hardware.

## Options

- `firefly_url`: address of your Firefly III instance as seen from the
  Home Assistant host, for example `http://192.168.1.10:8080`. Required; the add-on will not start until it is set.

## First use

1. In Firefly III: Options > Profile > OAuth > Personal Access Tokens, create
   a token and copy it.
2. Open the add-on's Web UI (port 6976), go to Settings > Setup, paste the
   token. Leave the backend URL unchanged.

## Data

Pico's own SQLite database is stored in the add-on's config folder
(`/addon_configs/<repo>_firefly_pico`), so it survives updates and is part
of Home Assistant backups.

## Releasing a new version (for the maintainer)

Edit `version` in `config.yaml` at the repository root, commit, push.
Home Assistant shows the update on its next repository refresh and rebuilds
from the new commit.
