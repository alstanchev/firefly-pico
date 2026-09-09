# Changelog

## 0.2.0

- Add-on options for the AI assistant: LLM and transcription API key,
  endpoint, model, context and language, mapped to the `ASSISTANT_*`
  environment variables.
- Receipt scanning: attach up to three receipt photos to a ramble; the
  assistant reads them and the photos are attached to the created
  transactions. The camera button sits next to the dictate button.
- Settings > Assistant: pick the LLM model from the models the key can use,
  and see the provider's full response when a test fails.

## 0.1.1

- Build: install git in the composer stage so package downloads fall back to
  cloning when GitHub's zipball API is unreachable.

## 0.1.0

- First release as a Home Assistant add-on, built from source on the host.
