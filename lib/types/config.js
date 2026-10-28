/**
 * Rate limiter configuration schema.
 *
 * The plugin's Config is the profile entry's own schema: Cordis validates the
 * entry's `config` against it, so the host reads values from the references
 * this schema produces rather than from a settings namespace.
 *
 * Fields marked `.volatile()` become separately addressable live references
 * (`config.enabled.get()`). Only volatile fields appear in the settings form
 * (`dsh-settings`'s `volatileForm()`), and an entry whose Config has NO
 * volatile field is dropped from the form list entirely — so the set of
 * `.volatile()` marks below IS the settings UI's field list.
 *
 * @module dsh-llm-multi-rate-limiter/types/config
 */

import Schema from "@deepseek-ai/schemastery";

/**
 * Per-model overrides — key is `"provider/model"` (e.g. `"deepseek/deepseek-chat"`).
 * Every field is optional; omitted fields inherit from `defaults`.
 *
 * This sub-schema deliberately carries NO `.volatile()`: it is the `inner`
 * of a `dict`, and two volatile layers on one path are rejected
 * (`volatile fields require a fixed object path without an enclosing volatile
 * field`, `schemastery/lib/index.mjs:246`). The whole `models` dict is made
 * volatile instead — see below.
 */
const ModelOverride = Schema.object({
  maxConcurrent: Schema.number().step(1).min(1).description("Max concurrent requests for this model"),
  maxRpm: Schema.number().step(1).min(1).description("Max requests per minute for this model"),
  burstSize: Schema.number().step(1).min(1).description("Burst capacity for this model (token-bucket)"),
  refillRate: Schema.number().min(0.1).description("Tokens refilled per second (token-bucket)"),
  enabled: Schema.boolean().description("Enable/disable rate limiting for this model"),
});

/**
 * Per-provider overrides — key is the provider id (e.g. `"openai"`).
 *
 * Sits between the global `defaults` and the per-model tier: one provider's
 * models usually share a single quota, so this is where that quota belongs.
 * Wildcards are accepted here too (`"mb-int-*"`).
 */
const ProviderOverride = Schema.object({
  maxConcurrent: Schema.number().step(1).min(1).description("Max concurrent requests for this provider"),
  maxRpm: Schema.number().step(1).min(1).description("Max requests per minute for this provider"),
  burstSize: Schema.number().step(1).min(1).description("Burst capacity for this provider (token-bucket)"),
  refillRate: Schema.number().min(0.1).description("Tokens refilled per second (token-bucket)"),
});

/**
 * Per-model defaults — applied to every model unless overridden.
 * The object is volatile AS A WHOLE so `config.defaults.get()` yields one
 * plain object and the settings form edits `["defaults", field]` paths.
 */
const Defaults = Schema.object({
  maxConcurrent: Schema.number().step(1).min(1).default(5).description("Max concurrent requests"),
  maxRpm: Schema.number().step(1).min(1).default(60).description("Max requests per minute"),
  burstSize: Schema.number().step(1).min(1).default(10).description("Burst capacity (token-bucket)"),
  refillRate: Schema.number().min(0.1).default(1).description("Tokens per second (token-bucket)"),
});

/**
 * Adaptive back-off after the provider answers 429.
 *
 * The limiter cannot see the provider's own quota arithmetic, so a `RATE_LIMIT`
 * failure is treated as a hint: the model's rate is scaled by `factor` for
 * `cooldownMs`, then restored after `recoverAfter` clean calls.
 */
const Cooldown = Schema.object({
  enabled: Schema.boolean().default(true).description("Slow a model down after the provider returns 429"),
  cooldownMs: Schema.number().step(1).min(1000).default(30_000).description("How long the reduced rate lasts"),
  factor: Schema.number().min(0.05).max(0.9).step(0.05).default(0.5).description("Rate multiplier while cooling"),
  recoverAfter: Schema.number().step(1).min(1).default(3).description("Clean calls before the full rate returns"),
});

export const Config = Schema.object({
  /** Master switch */
  enabled: Schema.boolean().default(true).volatile().description("Enable the rate limiter globally"),

  /** Default strategy */
  strategy: Schema.union([
    Schema.const("token-bucket").description("Token Bucket — allows bursts up to burstSize"),
    Schema.const("sliding-window").description("Sliding Window — smooth, fixed requests-per-minute"),
  ]).default("token-bucket").volatile().description("Rate limiting algorithm"),

  /** Global defaults — applied to every model unless overridden */
  defaults: Defaults.default({}).volatile().description("Default limits applied to all models"),

  /**
   * Per-provider overrides — key is the provider id, wildcards allowed.
   *
   * Volatile as a whole block, for the same reason as `models` below: two
   * volatile layers on one path are rejected by schemastery.
   */
  providers: Schema.dict(ProviderOverride).default({}).volatile()
    .description("Per-provider rate limit overrides"),

  /**
   * Per-model overrides — key is "provider/model"; `*` matches any run of
   * characters inside one path segment, so `openai/*` covers every OpenAI model.
   *
   * WHOLE-BLOCK volatile: `dict(inner).volatile()`, never
   * `dict(inner.volatile())`. The latter marks the dict's `inner` while the
   * `sKey`/`inner` nodes are "blocked" (`schemastery/lib/index.mjs:249-250`),
   * which throws at validation time.
   *
   * Because `isVolatilePath` (`dsh-settings/lib/index.js:153-158`) returns
   * true on reaching ANY volatile node without inspecting its descendants,
   * paths such as `["models", "provider/model", "maxRpm"]` remain writable
   * through the settings form under this whole-block mark.
   */
  models: Schema.dict(ModelOverride).default({}).volatile().description("Per-model rate limit overrides"),

  /** Adaptive back-off after a provider-side 429 */
  cooldown: Cooldown.default({}).volatile().description("Slow down after the provider returns 429"),

  /** Queue behaviour when a request is throttled */
  onThrottled: Schema.union([
    Schema.const("queue").description("Wait in queue until a slot opens"),
    Schema.const("reject").description("Immediately return an error"),
  ]).default("queue").volatile().description("What happens when a request exceeds the limit"),

  /** Maximum time a request waits in queue before being rejected */
  maxQueueWaitMs: Schema.number().step(1).min(1000).default(60_000).volatile().description("Max queue wait (ms)"),
}).description("LLM call rate limiter settings");
