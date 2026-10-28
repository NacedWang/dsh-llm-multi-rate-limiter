# @naced/llm-multi-rate-limiter

[![npm version](https://img.shields.io/npm/v/@naced/llm-multi-rate-limiter.svg)](https://www.npmjs.com/package/@naced/llm-multi-rate-limiter)
[![npm downloads](https://img.shields.io/npm/dm/@naced/llm-multi-rate-limiter.svg)](https://www.npmjs.com/package/@naced/llm-multi-rate-limiter)
[![license](https://img.shields.io/npm/l/@naced/llm-multi-rate-limiter.svg)](LICENSE)
[![ci](https://github.com/NacedWang/dsh-llm-multi-rate-limiter/actions/workflows/ci.yml/badge.svg)](https://github.com/NacedWang/dsh-llm-multi-rate-limiter/actions/workflows/ci.yml)

Per-`provider/model` LLM rate limiting for DeepSeek Harness, with an editable **Settings** page (Settings → Multi-model limits), a sidebar entry and a live status panel.

Forked from [`@leaf233/dsh-llm-rate-limiter`](https://github.com/Leafyezi233/dsh-llm-rate-limiter) 0.3.0 (MIT, © the upstream contributors). The configuration surface moved from the "built-in plugin config" card to a `settings.section` page and a sidebar entry; the card entry is gone.

## Features

- **Two strategies**: token bucket (bursts allowed) or sliding window (strict N per minute).
- **Per-model overrides**, keyed `provider/model`, e.g. `openai/gpt-5.1`.
- **Queue or reject** throttled calls (`onThrottled`, bounded by `maxQueueWaitMs`).
- **Live panel**: polls the `/llm-multi-rate-limiter` status channel once per second — per-model token/window usage, granted calls, average wait, recent events.

## Configuration

`~/.dsh/profiles/desktop/cordis.patch.yml`:

```yaml
- id: llm-multi-rate-limiter
  name: "@naced/llm-multi-rate-limiter"
  config:
    enabled: true
    strategy: sliding-window
    defaults:
      maxConcurrent: 5
      maxRpm: 60
      burstSize: 10
      refillRate: 1
    models:
      openai/gpt-5.1:
        maxRpm: 20
        maxConcurrent: 2
      deepseek/deepseek-chat:
        maxRpm: 60
        maxConcurrent: 5
    onThrottled: queue
    maxQueueWaitMs: 240000
```

- The row `id` is also the settings namespace (`dsh-settings` keys forms by `entry.options.id`), so keep it in step with the row.
- `models[<key>]` only needs the fields you override; the rest inherits `defaults`.
- Under the token bucket, an omitted `refillRate` (tokens/second) is derived from `maxRpm / 60`.

Edits made in the Settings page are written back to `cordis.patch.yml` immediately and hot-reload through `dsh-hmr`.

## Install

From the npm registry (recommended):

1. Add the dependency to your DSH profile's `package.json` (`~/.dsh/profiles/desktop/package.json`):
   ```json
   "@naced/llm-multi-rate-limiter": "^0.1.1"
   ```
   then install it in the profile directory (`pnpm install`, or the DSH plugin manager's install action).
2. Add `"@naced/llm-multi-rate-limiter"` to `dsh.profile.bundles`.
3. Append the `cordis.patch.yml` row above, then restart DSH.

From a local checkout (development): point the dependency at the folder instead of a version —
`"@naced/llm-multi-rate-limiter": "file:./packages/llm-multi-rate-limiter"` — and keep the same `bundles` entry.

## Security

This plugin intercepts the `llm/stream` waterfall, so it sits in front of every model call. What it actually does with that position:

- Reads only `options.provider`, `options.model` and `options.signal`. Prompts, messages, responses and credentials are never inspected, logged or transmitted.
- Makes no outbound network calls. The only HTTP surface is its own status channel (`/llm-multi-rate-limiter`), which is fenced by `connection.requestRejection()`, accepts `POST` + `application/json` only, and returns counters plus `provider/model` keys — no conversation content.
- Makes no filesystem or process calls (`fs`, `child_process`, `eval` are not imported); configuration is written through the host's settings service.
- Ships no install scripts.

If the limiter itself throws, the call is passed through untouched rather than failing, so a bug here cannot take the assistant offline.

## Development

```bash
git clone https://github.com/NacedWang/dsh-llm-multi-rate-limiter.git
cd dsh-llm-multi-rate-limiter
npm install
npm run build     # node --check on both entry points
npm pack --dry-run
```

There is no build step: `lib/` is hand-written ESM plus a browser bundle, shipped as-is so the published artifact matches what runs.

## Releasing

1. Bump `version` and add a `CHANGELOG.md` entry.
2. `git commit -am "chore: release vX.Y.Z" && git tag vX.Y.Z && git push --follow-tags`
3. The [`publish`](.github/workflows/publish.yml) workflow publishes to npm via **Trusted Publishing (OIDC)** — no `NPM_TOKEN` secret exists — and creates the matching GitHub release.

Because publishing is tied to this repository, the workflow filename in the npm Trusted Publisher settings must stay `publish.yml`.

## License

MIT. Based on `@leaf233/dsh-llm-rate-limiter`; see [LICENSE](LICENSE) for both copyright lines.
