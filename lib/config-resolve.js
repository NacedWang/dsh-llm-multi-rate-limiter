/**
 * Pure configuration-resolution helpers.
 *
 * Kept free of Cordis, schemastery and timers so the unit tests can exercise
 * the precedence rules, the wildcard matcher and the 429 cooldown machine with
 * plain objects.
 *
 * Precedence for one call (`provider/model`):
 *
 *     models["<provider>/<model>"]      exact model key
 *   > models["<pattern with *>"]        wildcard model key (most specific first)
 *   > providers["<provider>"]           provider-wide tier
 *   > defaults                          global tier
 *
 * @module dsh-llm-multi-rate-limiter/config-resolve
 */

/** Sliding-window width. `maxRpm` is "per minute", so the window is a minute. */
export const WINDOW_MS = 60_000;

/** Chars that would change the meaning of the generated regexp. */
const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;

function escapeRegExp(text) {
  return text.replace(REGEXP_SPECIALS, "\\$&");
}

/**
 * Compile a `*`-wildcard key into a matcher.
 *
 * `*` matches any run of characters that does not cross a `/`, so
 * `openai/*` matches `openai/gpt-5.1` but not `openai/gpt-5.1/turbo`, and
 * `*` alone matches every provider/model pair.
 *
 * @param {string} pattern
 * @returns {RegExp}
 */
export function compilePattern(pattern) {
  const source = pattern.split("*").map(escapeRegExp).join("[^/]*");
  return new RegExp(`^${source}$`);
}

/** True when `key` contains a wildcard and is therefore a pattern, not a key. */
export function isPattern(key) {
  return key.includes("*");
}

/** Number of literal characters a pattern pins down — its specificity score. */
function specificity(pattern) {
  return pattern.length - pattern.split("*").length + 1;
}

/**
 * Find the override that applies to `key` in a `{ key: override }` dict.
 *
 * Exact keys always win over patterns. When several patterns match, the most
 * specific one wins (most literal characters); remaining ties break on the
 * longer pattern so the choice is stable across runs.
 *
 * @param {Record<string, object> | undefined} dict
 * @param {string} key
 * @returns {{ override: object, matched: string } | undefined}
 */
export function matchOverride(dict, key) {
  if (dict === null || typeof dict !== "object") return undefined;

  const exact = dict[key];
  if (exact !== null && typeof exact === "object") return { override: exact, matched: key };

  /** @type {Array<{ pattern: string, override: object, score: number }>} */
  const candidates = [];
  for (const [pattern, override] of Object.entries(dict)) {
    if (!isPattern(pattern)) continue;
    if (override === null || typeof override !== "object") continue;
    if (!compilePattern(pattern).test(key)) continue;
    candidates.push({ pattern, override, score: specificity(pattern) });
  }
  if (candidates.length === 0) return undefined;

  candidates.sort((a, b) => b.score - a.score || b.pattern.length - a.pattern.length);
  return { override: candidates[0].override, matched: candidates[0].pattern };
}

/** Provider half of a `provider/model` key. */
export function providerOf(key) {
  const slash = key.indexOf("/");
  return slash === -1 ? key : key.slice(0, slash);
}

/**
 * Flatten the four config tiers into the flat shape the strategies understand.
 *
 * @param {object} cfg plain config (`{ defaults, providers, models }`)
 * @param {string} key `provider/model` of the call being limited
 * @returns {{ maxConcurrent: number, maxRpm: number, burstSize: number,
 *   refillRate: number, windowMs: number, source: "model" | "provider" | "defaults",
 *   matchedKey: string }}
 */
export function resolveModelConfig(cfg, key) {
  const defaults = cfg?.defaults ?? {};
  const modelHit = matchOverride(cfg?.models, key);
  const providerId = providerOf(key);
  const providerHit = matchOverride(cfg?.providers, providerId);

  const model = modelHit?.override ?? {};
  const provider = providerHit?.override ?? {};
  const source = modelHit !== undefined ? "model" : providerHit !== undefined ? "provider" : "defaults";

  const maxRpm = model.maxRpm ?? provider.maxRpm ?? defaults.maxRpm ?? 60;
  // A model/provider that sets maxRpm but not refillRate gets a refill derived
  // from ITS maxRpm, so "maxRpm: 20" alone behaves as 20 per minute. When the
  // winning tier does not touch maxRpm, the narrower tier's refillRate (if any)
  // is used as-is.
  const explicitRefill = model.refillRate ?? provider.refillRate;
  const refillRate = explicitRefill
    ?? ((model.maxRpm ?? provider.maxRpm) != null
      ? maxRpm / 60
      : defaults.refillRate ?? maxRpm / 60);

  return {
    maxConcurrent: model.maxConcurrent ?? provider.maxConcurrent ?? defaults.maxConcurrent ?? 5,
    maxRpm,
    burstSize: model.burstSize ?? provider.burstSize ?? defaults.burstSize ?? 10,
    refillRate,
    windowMs: WINDOW_MS,
    source,
    matchedKey: modelHit?.matched ?? providerHit?.matched ?? "(defaults)",
  };
}

/** Scale one resolved config down by `factor` (never below the usable floor). */
export function scaleConfig(resolved, factor) {
  if (!(factor < 1)) return resolved;
  return {
    ...resolved,
    maxRpm: Math.max(1, Math.round(resolved.maxRpm * factor)),
    burstSize: Math.max(1, Math.round(resolved.burstSize * factor)),
    refillRate: Math.max(0.01, resolved.refillRate * factor),
  };
}

/**
 * Per-model 429 cooldown.
 *
 * A rate limiter that only counts requests cannot know that the provider
 * throttled us for a reason of its own (a shared quota, a burst it did not
 * like). Treating a `RATE_LIMIT` failure from the provider as a signal keeps
 * the next calls from walking into the same wall: the model's rate is scaled
 * down for `cooldownMs`, then restored after `recoverAfter` clean calls.
 *
 * Pure state machine: the caller supplies `now`, so tests need no clock.
 */
export class CooldownTracker {
  /** @type {Map<string, { until: number, factor: number, clean: number }>} */
  #state = new Map();

  /**
   * @param {{ enabled?: boolean, cooldownMs?: number, factor?: number, recoverAfter?: number }} options
   */
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    /** How long a throttled model stays slowed down. */
    this.cooldownMs = Number.isFinite(options.cooldownMs) ? options.cooldownMs : 30_000;
    /** Rate multiplier applied while cooling (0 < factor < 1). */
    this.factor = Number.isFinite(options.factor) ? Math.min(0.9, Math.max(0.05, options.factor)) : 0.5;
    /** Clean calls required before the full rate is restored. */
    this.recoverAfter = Number.isFinite(options.recoverAfter) ? Math.max(1, options.recoverAfter) : 3;
  }

  /** Re-read policy fields from the live config. */
  configure(options = {}) {
    if (typeof options.enabled === "boolean") this.enabled = options.enabled;
    if (Number.isFinite(options.cooldownMs)) this.cooldownMs = options.cooldownMs;
    if (Number.isFinite(options.factor)) this.factor = Math.min(0.9, Math.max(0.05, options.factor));
    if (Number.isFinite(options.recoverAfter)) this.recoverAfter = Math.max(1, options.recoverAfter);
  }

  /**
   * Current rate multiplier for `key` (1 when not cooling).
   *
   * @param {string} key
   * @param {number} [now]
   */
  factorFor(key, now = Date.now()) {
    const entry = this.#state.get(key);
    if (entry === undefined) return 1;
    if (entry.until > now) return entry.factor;
    // Cooldown elapsed: stay scaled down until enough clean calls have passed.
    return entry.clean >= this.recoverAfter ? 1 : entry.factor;
  }

  /**
   * Record a provider-side `RATE_LIMIT` failure.
   *
   * @param {string} key
   * @param {number} [now]
   * @param {number} [retryAfterMs] provider hint, when known
   * @returns {{ until: number, factor: number } | undefined}
   */
  recordFailure(key, now = Date.now(), retryAfterMs = undefined) {
    if (!this.enabled) return undefined;
    const hold = Number.isFinite(retryAfterMs) && retryAfterMs > 0
      ? Math.max(this.cooldownMs, retryAfterMs)
      : this.cooldownMs;
    const entry = { until: now + hold, factor: this.factor, clean: 0 };
    this.#state.set(key, entry);
    return entry;
  }

  /**
   * Record a call that completed without a provider-side 429, retiring the
   * cooldown once enough of them have accumulated.
   *
   * @param {string} key
   * @param {number} [now]
   */
  recordSuccess(key, now = Date.now()) {
    const entry = this.#state.get(key);
    if (entry === undefined) return;
    if (entry.until > now) return; // still cooling: a success does not end it early
    entry.clean += 1;
    if (entry.clean >= this.recoverAfter) this.#state.delete(key);
  }

  /** True while `key` is inside its cooldown window. */
  isCooling(key, now = Date.now()) {
    const entry = this.#state.get(key);
    return entry !== undefined && entry.until > now;
  }

  /** Milliseconds until the cooldown ends (0 when not cooling). */
  remainingMs(key, now = Date.now()) {
    const entry = this.#state.get(key);
    return entry === undefined ? 0 : Math.max(0, entry.until - now);
  }

  /** Drop every cooldown (config reset / panel action). */
  clear() {
    this.#state.clear();
  }

  /** Drop the state of one model. */
  forget(key) {
    this.#state.delete(key);
  }

  /** JSON-safe view for the status channel. */
  snapshot(now = Date.now()) {
    const models = {};
    for (const [key, entry] of this.#state) {
      models[key] = {
        cooling: entry.until > now,
        remainingMs: Math.max(0, entry.until - now),
        factor: entry.factor,
      };
    }
    return models;
  }
}
