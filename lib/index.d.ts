/**
 * Type declarations for the host entry point.
 *
 * The plugin ships no build step, so these are hand-written against the shapes
 * `lib/index.js` actually uses. The `Config` export is a schemastery schema
 * (validated at load time by Cordis); it is typed as `unknown` rather than
 * pretending to model schemastery's builder.
 */

/** Limits shared by the `defaults`, `providers` and `models` tiers. */
export interface RateLimitTier {
  /** Max concurrent in-flight requests for this tier. */
  maxConcurrent?: number;
  /** Max requests per minute for this tier. */
  maxRpm?: number;
  /** Burst capacity (token-bucket only). */
  burstSize?: number;
  /** Tokens refilled per second (token-bucket only). */
  refillRate?: number;
}

/** A `models` override. Keys may be exact (`provider/model`) or wildcarded (`provider/*`). */
export interface ModelOverride extends RateLimitTier {
  /** Set `false` to exempt this model (or pattern) from limiting entirely. */
  enabled?: boolean;
}

/** Adaptive back-off applied after the provider answers 429. */
export interface CooldownConfig {
  /** Master switch for the 429 cooldown. */
  enabled?: boolean;
  /** How long the reduced rate lasts, in milliseconds. */
  cooldownMs?: number;
  /** Rate multiplier while cooling, in `(0, 1)`. Defaults to `0.5`. */
  factor?: number;
  /** Clean calls required before the full rate is restored. */
  recoverAfter?: number;
}

/** Shape of this plugin's profile-entry config (all fields optional). */
export interface RateLimiterConfig {
  /** Master switch for the limiter. */
  enabled?: boolean;
  /** Algorithm used for every model unless a tier says otherwise. */
  strategy?: "token-bucket" | "sliding-window";
  /** Global tier, applied when neither a provider nor a model tier matches. */
  defaults?: RateLimitTier;
  /** Per-provider tier, keyed by provider id (wildcards accepted). */
  providers?: Record<string, RateLimitTier>;
  /** Per-model tier, keyed by `provider/model` (wildcards accepted). */
  models?: Record<string, ModelOverride>;
  /** Adaptive back-off after provider-side throttling. */
  cooldown?: CooldownConfig;
  /** `queue` waits for capacity; `reject` fails the call immediately. */
  onThrottled?: "queue" | "reject";
  /** How long a queued call may wait before it is refused. */
  maxQueueWaitMs?: number;
}

/**
 * Structural subset of the Cordis `Context` that `apply` relies on.
 *
 * Declared locally so consumers do not need `@deepseek-ai/cordis` installed to
 * type-check against this package.
 */
export interface HostContext {
  logger?: (scope: string) => {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
  };
  on(event: string, listener: (...args: any[]) => any): () => void;
  effect(effect: () => (() => void) | void, label?: string): void;
  inject(dependencies: string[], callback: (ctx: any) => void): void;
  fiber?: unknown;
  [key: string]: unknown;
}

/** Plugin name as registered in `cordis.patch.yml`. */
export declare const name: string;

/** Settings namespace / profile entry id. */
export declare const SETTINGS_NS: string;

/** schemastery schema for the profile entry's `config`. */
export declare const Config: unknown;

/**
 * Cordis plugin entry point. Registers the `llm/stream` interceptor, the
 * settings presentation opt-out and the status RPC channel.
 */
export declare function apply(ctx: HostContext, config?: RateLimiterConfig): void;
