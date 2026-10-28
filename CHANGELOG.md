# Changelog

## [0.2.0] - 2026-10-28

Concurrency accounting fix, provider-wide tiers, wildcard keys, adaptive 429 backoff, and a tested toolchain.

### Fixed

- **Queue drain over-granted concurrency**: a waiter released by `releaseSlot()` counted against neither `#concurrent` nor any reservation, so one release could admit the entire queue at once. Both strategies now reserve a slot when they grant one, and `#drain()` compares `#concurrent + #reserved` against `maxConcurrent`.
- **Timeout and drain could settle the same waiter twice**: `acquire()` now guards its settlement with a `settled` flag.
- **Retry storm after a queue timeout**: a queue timeout now fails with `RATE_LIMIT_QUEUE_TIMEOUT` instead of the retryable `RATE_LIMIT`, so `dsh-llm-retry` no longer replays the same saturated model six times. Reject mode uses `RATE_LIMIT_REJECTED`.
- **Limiter instances leaked**: idle limiters with no override are swept every minute (10-minute idle window) once they have no concurrency, reservations or waiters.

### Added

- **Provider tier** (`providers.<provider>`): one cap for every model of a provider, below per-model overrides and above `defaults`.
- **Wildcard model keys** (`openai/*`, `*/*`): `*` compiles to `[^/]*`, so it stays inside one path segment and cannot silently cover another provider. The most specific pattern wins.
- **Adaptive 429 backoff** (`cooldown`): when the provider answers 429, that model's limits are scaled by `factor` for `cooldownMs` (or the response's `Retry-After`, if longer) and recover after `recoverAfter` consecutive successes. Counted in the status snapshot as `effectiveMaxRpm` / `cooling`.
- **Settings page**: model search filter, delete confirmation, and whole-config JSON import/export.
- **Tests**: `node --test` suites for tier resolution, wildcard matching, cooldown bookkeeping and both strategies — including a regression test that one release admits exactly one waiter.
- **Type declarations** (`lib/index.d.ts`) and an **ESLint** flat config; `npm run check` runs syntax, lint and tests.
- CI now runs the full check on both Ubuntu and Windows.

### Changed

- `lib/config-resolve.js` holds tier resolution and the cooldown tracker as pure functions, shared by the host entry and the tests.
- The status snapshot reports `reserved` slots per model and `throttledByProvider` in totals.

## [0.1.1] - 2026-10-28

Repository and release plumbing; no behavioural change to the limiter.

### Added

- `repository`, `homepage`, `bugs` and `author` metadata, so the npm page links back to GitHub.
- `publishConfig.access: "public"` — a plain `npm publish` on this scoped package no longer needs `--access public`.
- GitHub Actions: [`ci.yml`](.github/workflows/ci.yml) runs the syntax check and `npm pack --dry-run` on every push and PR; [`publish.yml`](.github/workflows/publish.yml) publishes on `v*` tags through npm Trusted Publishing (OIDC) with provenance, and creates the GitHub release. No npm token is stored in the repository.
- `prepublishOnly` runs the same syntax check, so a broken `lib/` can never be published.

### Changed

- README (both languages) gained npm/CI badges, install-from-registry instructions, and development/release sections.

## [0.1.0] - 2026-10-26

Fork of `@leaf233/dsh-llm-rate-limiter` 0.3.0, retargeted at the DSH 0.2.1 client contract.

### Changed

- **Settings UI**: the configuration form is now a `settings.section` entry (Settings → 多模型限速) instead of a `plugins.item` card. The old card never rendered on 0.2.1 shells whose sidebar comes from a third-party bundle, because `.dsh/market/*` page ownership — not this plugin — decides which page hosts `plugins.item`.
- The page owns its own `ConfigFormController` through `ctx.configForms.get("llm-multi-rate-limiter")` and binds it with `hooks: { snapshot: form.store }`, so it no longer depends on a host page passing `props.form`.
- Package renamed to `@naced/llm-multi-rate-limiter`; client no longer injects `dsh-client-ui-plugin-manager`.
- `plugins.row.config` entry point removed.

### Added

- Model picker with a text field (`provider/model`) plus per-row RPM / concurrency / burst inputs and enable-remove actions.
- Effective-limit readout per model (override or inherited default).
- Bilingual dictionaries (zh/en) registered for the section, so labels follow the UI locale instead of hard-coded Chinese.
- Sidebar entry: `sidebar.panellist` registration (`order: 40`) plus the matching `main` panel, so the page is reachable from the app sidebar on shells that draw navigation there. Both surfaces share one `inject` factory.

### Fixed

- **Fail-open interceptor**: if config parsing or a strategy throws, the call is now forwarded unthrottled with a warning instead of failing. Previously an exception escaped the `llm/stream` generator and every model call failed.
- Duplicate-limiter warning when `@leaf233/dsh-llm-rate-limiter` is also installed (both hook `llm/stream`, so calls would be limited twice).

### Security

- README documents exactly what the `llm/stream` position touches: `options.provider`, `options.model`, `options.signal` only; no prompt, response or credential access; no outbound network calls; no `fs` / `child_process` / `eval`; no install scripts.
- `engines.dsh` (`>=0.2.1-rc.2`) now states the tested runtime, so DSH's compatibility check has a real range to evaluate instead of relying on an unbounded peer range.
- `exports` gained `./package.json` (consistent with other DSH plugins; the loader's directory walk no longer has to carry it).
- Internal provider names removed from the README samples and the model input placeholder.
- LICENSE carries both copyright lines (upstream MIT + this fork).

### Unchanged

- Host half: `llm/stream` waterfall interception, token-bucket and sliding-window strategies, `/llm-multi-rate-limiter` status channel with its self-registered fallback route, queueing with `maxQueueWaitMs`.
- Settings storage: the profile entry's volatile `Config` references, written through `settings.mutate` into `cordis.patch.yml`.
