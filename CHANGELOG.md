# Changelog

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
