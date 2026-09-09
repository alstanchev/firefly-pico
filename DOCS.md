# Firefly Pico add-on

Mobile-friendly companion app for Firefly III, built from this fork's source
on your Home Assistant host. The first install and every update compile the
app locally; expect a few minutes on x86 hardware.

## Options

- `firefly_url`: address of your Firefly III instance as seen from the
  Home Assistant host, for example `http://192.168.1.10:8080`. Required; the add-on will not start until it is set.

The remaining options enable the AI assistant (dictated rambles and receipt
scanning). They map one to one to the `ASSISTANT_*` environment variables of
the plain Docker image and are all optional. Leave an option empty to use the
built-in default; the assistant stays hidden in the app until at least
`assistant_llm_api_key` is set.

- `assistant_llm_api_key`: API key for an OpenAI-compatible chat completions
  service. Setting only this option is enough for OpenAI.
- `assistant_llm_endpoint`: chat completions URL. Default
  `https://api.openai.com/v1/chat/completions`.
- `assistant_llm_model`: model id, for example `gpt-4o-mini` (the default).
  Users can also pick a model per profile under Settings > Assistant.
- `assistant_llm_context`: extra instructions appended to every request, for
  example household accounts or naming conventions.
- `assistant_transcription_api_key`, `assistant_transcription_endpoint`,
  `assistant_transcription_model`, `assistant_transcription_language`: the same
  for voice transcription of rambles. Defaults are
  `https://api.openai.com/v1/audio/transcriptions` and `gpt-4o-mini-transcribe`.

After changing options restart the add-on. Settings > Assistant in the app has
test buttons that show the exact response from the provider.

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
