/**
 * dsh-llm-multi-rate-limiter — Host (server-side) entry point.
 *
 * Intercepts the `llm/stream` waterfall and enforces per-model rate limits.
 *
 * Configuration is the profile ENTRY's own `config` (this module's exported
 * {@link Config} schema), read through the volatile references Cordis builds
 * for it. `dsh-settings` projects the volatile fields of every active entry
 * into a form the browser can edit, so the plugin ships no settings service
 * of its own. (DSH 0.1.5 had a `ctx.settings.register()` namespace API; 0.1.7
 * removed it, and its browser half dropped `settingsScope` for `configForms`.
 * The migration record lives in CHANGELOG.md under `[0.3.0]`.)
 *
 * The `llm/stream` waterfall signature is:
 *   (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => AsyncIterable<StreamChunk>
 *
 * where `options` always has `.provider` (string) and `.model` (string).
 *
 * @module dsh-llm-multi-rate-limiter
 */

import { TokenBucketStrategy } from "./strategies/token-bucket.js";
import { SlidingWindowStrategy } from "./strategies/sliding-window.js";
import { Config } from "./types/config.js";
import {
  CooldownTracker,
  resolveModelConfig,
  scaleConfig,
} from "./config-resolve.js";
import { CHANNEL, createChannelRoute, createStatusChannel } from "./status-rpc.js";

const name = "llm-multi-rate-limiter";
/**
 * Settings namespace / profile entry id.
 *
 * `dsh-settings` keys every form by `entry.options.id` (`lib/index.js:432`),
 * which is the `id` this plugin's `cordis.patch.yml` row declares. Renaming
 * that row id therefore renames this namespace too — keep the two in step.
 */
const SETTINGS_NS = "llm-multi-rate-limiter";

/** Maximum retained events in the status ring (bounded memory). */
const EVENT_RING_LIMIT = 64;
/** Events carried by one snapshot (the panel shows these). */
const SNAPSHOT_EVENT_COUNT = 8;
/** How often idle, unconfigured limiters are dropped from the map. */
const IDLE_SWEEP_MS = 60_000;
/** A limiter with no override and no activity for this long is released. */
const IDLE_LIMITER_MS = 10 * 60_000;

/* ── Helpers ─────────────────────────────────────────────────────────── */

/** Built-in defaults, used when a reference yields nothing (or no config at all). */
const FALLBACK = {
  enabled: true,
  strategy: "token-bucket",
  defaults: { maxConcurrent: 5, maxRpm: 60, burstSize: 10, refillRate: 1 },
  providers: {},
  models: {},
  cooldown: { enabled: true, cooldownMs: 30_000, factor: 0.5, recoverAfter: 3 },
  onThrottled: "queue",
  maxQueueWaitMs: 60_000,
};

/**
 * Read one volatile reference from the parsed Config.
 *
 * The loader mutates volatile references IN PLACE when only raw config values
 * changed (`cordis-plugin-loader/lib/index.js:393` `_commitVolatile()`), so
 * the reference object stays valid for the plugin's whole lifetime and its
 * `get()` always yields the current value. Call this at each use rather than
 * caching the unwrapped value.
 *
 * @param ref - a `.volatile()` field of the parsed Config, or undefined when
 *   the entry was mounted with no config at all.
 * @param fallback - value used when the reference is absent.
 * @returns the current plain value.
 */
function read(ref, fallback) {
  if (ref === undefined || ref === null) return fallback;
  if (typeof ref.get === "function") {
    const value = ref.get();
    return value === undefined || value === null ? fallback : value;
  }
  return ref;
}

/**
 * Ensure a rate-limiting strategy instance exists (or is updated) for `key`.
 *
 * @param {Map<string, TokenBucketStrategy | SlidingWindowStrategy>} limiters
 * @param {string} key
 * @param {ReturnType<typeof resolveModelConfig>} merged resolved tier config
 * @param {string} strategyName
 */
function ensureLimiter(limiters, key, merged, strategyName) {
  const existing = limiters.get(key);
  if (existing) {
    existing.update(merged);
    return existing;
  }
  const strategy = strategyName === "sliding-window"
    ? new SlidingWindowStrategy(merged)
    : new TokenBucketStrategy(merged);
  limiters.set(key, strategy);
  return strategy;
}

/**
 * Build a terminal StreamChunk for rate-limiting failures.
 *
 * The failure code matters: `dsh-llm-retry` only retries the codes its policy
 * lists (by default `RATE_LIMIT`, `SERVER`, `TIMEOUT`, `TRANSPORT`,
 * `EMPTY_RESPONSE`). A queue timeout is a LOCAL decision — retrying it just
 * parks the caller in another queue — so it carries its own code, which no
 * default policy retries. A provider-side 429 keeps `RATE_LIMIT`, because
 * retrying THAT is exactly what the retry plugin is for.
 *
 * `kind: "aborted"` is used when the caller's AbortSignal fired, so the agent
 * loop treats it as a cancellation rather than a failure.
 */
function terminalChunk(modelKey, code, signal) {
  const aborted = signal?.aborted === true;
  const failure = {
    code,
    message: aborted
      ? `Rate limit: ${modelKey} (aborted while waiting)`
      : `Rate limit: ${modelKey} was not granted a slot in time`,
  };
  return {
    type: "finish",
    reason: aborted ? { kind: "aborted", failure } : { kind: "error", failure },
  };
}

/** True when a stream chunk reports that the PROVIDER throttled the call. */
function isProviderRateLimit(chunk) {
  return chunk?.type === "finish"
    && chunk.reason?.kind === "error"
    && chunk.reason?.failure?.code === "RATE_LIMIT";
}

/** Optional `retryAfterMs` hint carried by a provider failure, when present. */
function retryAfterOf(chunk) {
  const hint = chunk?.reason?.failure?.retryAfterMs;
  return Number.isFinite(hint) && hint > 0 ? hint : undefined;
}

/* ── Plugin entry ────────────────────────────────────────────────────── */

/**
 * @param {import("@deepseek-ai/cordis").Context} ctx
 * @param {object} [config] - parsed Config; volatile fields are live references.
 */
function apply(ctx, config) {
  const logger = ctx.logger?.("rate-limiter");

  /**
   * Snapshot the whole config as one plain object, reading each reference at
   * call time. Derived settings are not cached: a volatile-only change updates
   * the references in place without re-running `apply`.
   */
  function readConfig() {
    return {
      enabled: read(config?.enabled, FALLBACK.enabled),
      strategy: read(config?.strategy, FALLBACK.strategy),
      defaults: read(config?.defaults, FALLBACK.defaults),
      providers: read(config?.providers, FALLBACK.providers),
      models: read(config?.models, FALLBACK.models),
      cooldown: read(config?.cooldown, FALLBACK.cooldown),
      onThrottled: read(config?.onThrottled, FALLBACK.onThrottled),
      maxQueueWaitMs: read(config?.maxQueueWaitMs, FALLBACK.maxQueueWaitMs),
    };
  }

  /** @type {Map<string, TokenBucketStrategy | SlidingWindowStrategy>} */
  const limiters = new Map();
  /** Adaptive back-off state after provider 429s. */
  const cooldown = new CooldownTracker(FALLBACK.cooldown);

  // ── Live statistics (read by the status RPC channel) ───────
  // Counters are plain numbers so a snapshot is always JSON-safe.
  const totals = {
    requests: 0,
    granted: 0,
    rejected: 0,
    timeouts: 0,
    aborted: 0,
    throttledByProvider: 0,
    totalWaitMs: 0,
  };
  /** Bumped on every recorded event and on reset — the panel's change cursor. */
  let rev = 0;
  /** Bounded ring of recent events (newest last). */
  const eventRing = [];

  function recordEvent(event) {
    eventRing.push({ ...event, ts: Date.now() });
    if (eventRing.length > EVENT_RING_LIMIT) eventRing.shift();
    rev += 1;
  }

  /** Build the JSON-safe snapshot served on the "snapshot" endpoint. */
  function buildSnapshot() {
    const cfg = readConfig();
    const models = {};
    for (const [key, limiter] of limiters) {
      try {
        const status = limiter.getStatus();
        const factor = cooldown.factorFor(key);
        models[key] = {
          ...status,
          // Effective limit after any 429 penalty — what the panel should show.
          effectiveMaxRpm: factor < 1 ? Math.max(1, Math.round((status.maxRpm ?? 0) * factor)) : status.maxRpm,
          cooling: cooldown.isCooling(key),
          cooldownRemainingMs: cooldown.remainingMs(key),
        };
      } catch {
        // A strategy that cannot report status must not break the whole panel.
      }
    }
    return {
      rev,
      ts: Date.now(),
      enabled: cfg.enabled !== false,
      strategy: cfg.strategy,
      onThrottled: cfg.onThrottled,
      cooldown: {
        enabled: cfg.cooldown?.enabled !== false,
        models: cooldown.snapshot(),
      },
      totals: { ...totals },
      models,
      events: eventRing.slice(-SNAPSHOT_EVENT_COUNT),
    };
  }

  /** Zero every counter and drop retained events (the panel's clear button). */
  function resetTotals() {
    for (const key of Object.keys(totals)) totals[key] = 0;
    eventRing.length = 0;
    cooldown.clear();
    rev += 1;
  }

  /** Drop limiters that no tier configures and nothing has touched for a while. */
  function sweepIdleLimiters() {
    if (limiters.size === 0) return;
    const cfg = readConfig();
    const now = Date.now();
    for (const [key, limiter] of limiters) {
      if (now - (limiter.lastUsedAt ?? 0) < IDLE_LIMITER_MS) continue;
      let status;
      try {
        status = limiter.getStatus();
      } catch {
        status = undefined;
      }
      // Never drop a limiter with work in flight or queued behind it.
      if (status && ((status.concurrent ?? 0) > 0 || (status.reserved ?? 0) > 0 || (status.queued ?? 0) > 0)) continue;
      // A model that still has an explicit override stays visible even when idle.
      if (resolveModelConfig(cfg, key).source !== "defaults") continue;
      try {
        limiter.dispose();
      } catch {
        // Disposal is best-effort; dropping the map entry is what matters.
      }
      limiters.delete(key);
      cooldown.forget(key);
      rev += 1;
    }
  }

  const sweepTimer = setInterval(sweepIdleLimiters, IDLE_SWEEP_MS);
  // Node's unref keeps the timer from holding the process open on shutdown.
  sweepTimer.unref?.();

  // ── Settings presentation (dynamic inject) ─────────────────
  // This plugin ships its own browser page, so it opts out of any
  // schema-generated page. Wrapped in ctx.inject so a host WITHOUT a settings
  // service still runs the limiter — the callback simply never runs. The
  // optional child ctx names the plugin fiber the policy belongs to, which is
  // why `ctx.fiber` is passed explicitly (`dsh-settings/lib/index.js:370`).
  ctx.inject(["settings"], (scopedCtx) => {
    if (typeof scopedCtx.settings?.configure !== "function") return; // older/foreign settings seam: keep running
    scopedCtx.effect(
      () => scopedCtx.settings.configure({ auto: false }, ctx.fiber),
      "rate-limiter: settings presentation",
    );
  });

  // ── Status channel (dynamic inject) ────────────────────────
  // Same defensive shape as the settings wiring: on a host without a
  // connection service the callback never runs and the plugin stays silent.
  // Either path below registers inside an effect owned by this fiber, so
  // unloading the plugin withdraws the channel automatically.
  //
  // Two mounting paths exist, and both speak the same wire protocol, so the
  // browser half never needs to know which one is live:
  //
  //   1. connection.rpc.handle(channel, handler) — the framework's generic
  //      channel registry (preferred: the framework owns the route, the
  //      request validation, and the withdrawal).
  //
  //   2. a self-registered prefix route reusing connection.requestRejection()
  //      — the fallback for hosts where path 1 is broken. DSH 0.1.5-rc.3
  //      changed dsh-client-connection's own `inject` from
  //      ["webServer", "credentials"] to ["credentials"] while its
  //      HostConnectionService.register() still dereferences
  //      `owner.webServer`, and Cordis rebinds a cross-fiber service's `ctx`
  //      to the *reader's* fiber — so rpc.handle() throws
  //      'cannot get property "webServer" without inject'. Registering the
  //      route on our own fiber (which injects webServer below) avoids that
  //      while still using the framework's own 403/401 fence.
  //      Still unfixed in 0.2.1-rc.2 (dsh-client-connection/lib/index.js:1013
  //      keeps `inject = ["credentials"]`), so the fallback still fires.
  ctx.inject(["connection"], (scopedCtx) => {
    const connection = scopedCtx.get("connection");
    const channel = createStatusChannel({ buildSnapshot, resetTotals });

    // ── Path 1: the framework's generic channel registry ──
    const handle = typeof connection?.rpc?.handle === "function"
      ? connection.rpc.handle.bind(connection.rpc)
      : undefined;

    if (handle !== undefined) {
      try {
        scopedCtx.effect(() => {
          const unregister = handle(CHANNEL, channel);
          return () => { unregister(); };
        }, "rate-limiter: status rpc channel");
        logger?.info("rate limiter status channel mounted via connection.rpc (%s)", CHANNEL);
        return;
      } catch (err) {
        logger?.warn(
          "connection.rpc channel registration failed (%s); falling back to a self-registered route",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // ── Path 2: self-registered route (needs webServer on THIS fiber) ──
    // The fence is mandatory: without connection.requestRejection() we would
    // be publishing an unauthenticated route, so we refuse to mount at all.
    // Probing once here turns a broken fence into a mount-time refusal instead
    // of a per-request surprise.
    try {
      if (typeof connection?.requestRejection !== "function") {
        logger?.warn("connection.requestRejection unavailable; status channel not mounted");
        return;
      }
      connection.requestRejection({ headers: {} });
    } catch (err) {
      logger?.warn(
        "connection.requestRejection unusable (%s); refusing to mount an unfenced status route",
        err instanceof Error ? err.message : String(err),
      );
      return;
    }

    scopedCtx.inject(["webServer"], (webCtx) => {
      const webServer = webCtx.get("webServer");
      if (typeof webServer?.register !== "function") return; // no web carrier: degrade silently

      try {
        webCtx.effect(() => webServer.register(createChannelRoute({
          channel: CHANNEL,
          handler: channel,
          reject: (req) => connection.requestRejection(req),
        })), "rate-limiter: status route (self-registered)");
      } catch (err) {
        logger?.warn("status channel registration failed: %s", err instanceof Error ? err.message : String(err));
        return;
      }

      logger?.info("rate limiter status channel mounted via self-registered route (%s)", CHANNEL);
    });
  });

  // ── Duplicate-limiter guard ────────────────────────────────
  // The upstream plugin hooks the same waterfall. With both installed every call
  // is limited twice: the effective rate becomes the stricter of the two, and a
  // queued call can wait through both queues in sequence.
  if (typeof import.meta.resolve === "function") {
    let upstream;
    try {
      upstream = import.meta.resolve("@leaf233/dsh-llm-rate-limiter");
    } catch {
      upstream = undefined; // not installed next to us — the usual case
    }
    if (upstream !== undefined) {
      logger?.warn(
        "both @naced/llm-multi-rate-limiter and @leaf233/dsh-llm-rate-limiter are installed (%s); every call is limited twice — remove one of them",
        upstream,
      );
    }
  }

  // ── LLM stream interceptor ─────────────────────────────────
  // Reads the live Config on every call, so a settings edit that reaches the
  // loader takes effect on the next request without a restart.
  //
  // Fails open: if config parsing or the limiter itself throws, the call is
  // forwarded untouched. A broken limiter must never take the model offline.
  const disposeLlmListener = ctx.on("llm/stream", async function* rateLimitInterceptor(options, next) {
    const modelKey = `${options.provider}/${options.model}`;

    /** @type {TokenBucketStrategy | SlidingWindowStrategy | null} */
    let limiter = null;
    let slotTaken = false;
    let passThrough = false;
    /** @type {object | null} */
    let refused = null;

    try {
      const cfg = readConfig();
      cooldown.configure(cfg.cooldown);

      if (!cfg.enabled || cfg.models?.[modelKey]?.enabled === false) {
        // Global switch off, or per-model opt-out: zero-touch pass-through.
        passThrough = true;
      } else {
        // Resolve the tier chain (model > provider > defaults) and apply any
        // 429 penalty currently in force for this model.
        const resolved = resolveModelConfig(cfg, modelKey);
        const factor = cooldown.factorFor(modelKey);
        const effective = factor < 1 ? scaleConfig(resolved, factor) : resolved;

        limiter = ensureLimiter(limiters, modelKey, effective, cfg.strategy);
        limiter.lastUsedAt = Date.now();
        totals.requests += 1;

        if (cfg.onThrottled === "reject") {
          // Non-blocking check — if at capacity, refuse the call outright.
          // acquireNonBlocking deducts a token AND takes a concurrent slot, so
          // reject mode still enforces the frequency limit, not just concurrency.
          const permit = limiter.acquireNonBlocking();
          if (permit.granted) {
            slotTaken = true;
            totals.granted += 1;
            recordEvent({ event: "granted", model: modelKey, waitMs: 0 });
          } else {
            totals.rejected += 1;
            recordEvent({ event: "rejected", model: modelKey });
            logger?.warn("model %C rejected — rate limit reached", modelKey);
            // Local decision: not a retryable provider condition.
            refused = terminalChunk(modelKey, "RATE_LIMIT_REJECTED", options.signal);
          }
        } else {
          // Queue mode — park until a slot opens.
          const permit = await limiter.acquire({
            signal: options.signal,
            timeoutMs: cfg.maxQueueWaitMs ?? 60_000,
          });
          if (permit.granted) {
            totals.granted += 1;
            totals.totalWaitMs += permit.waitMs ?? 0;
            recordEvent({ event: "granted", model: modelKey, waitMs: permit.waitMs ?? 0 });
          } else {
            const aborted = options.signal?.aborted === true;
            if (aborted) {
              totals.aborted += 1;
              recordEvent({ event: "aborted", model: modelKey, waitMs: permit.waitMs ?? 0 });
            } else {
              totals.timeouts += 1;
              recordEvent({ event: "timeout", model: modelKey, waitMs: permit.waitMs ?? 0 });
            }
            logger?.warn(
              "model %C %s after %d ms",
              modelKey, aborted ? "aborted" : "queue timeout", permit.waitMs,
            );
            // Own code: a queue timeout must not be retried into another queue.
            refused = terminalChunk(modelKey, "RATE_LIMIT_QUEUE_TIMEOUT", options.signal);
          }
        }
      }
    } catch (err) {
      // Fail open. Release a slot taken earlier in this same attempt, then let
      // the real call proceed unthrottled rather than failing it.
      if (slotTaken && limiter !== null) {
        try {
          limiter.releaseSlot();
        } catch {
          // Ignore: the strategy is already in an unknown state.
        }
      }
      logger?.warn(
        "rate limiter bypassed for %C (%s); forwarding the call unthrottled",
        modelKey,
        err instanceof Error ? err.message : String(err),
      );
      limiter = null;
      slotTaken = false;
      passThrough = true;
    }

    if (refused !== null) {
      yield refused;
      return;
    }

    if (passThrough || limiter === null) {
      yield* next();
      return;
    }

    // ── Phase 2: run the real LLM call ─────────────────────────
    // Queue mode does not take a concurrent slot inside acquire().
    if (!slotTaken) limiter.acquireSlot();
    const activeLimiter = limiter;
    try {
      // Pass chunks straight through while watching for a provider 429: the
      // stream stays streaming, and the cooldown learns from the failure.
      for await (const chunk of next()) {
        if (isProviderRateLimit(chunk)) {
          const retryAfterMs = retryAfterOf(chunk);
          const entry = cooldown.recordFailure(modelKey, Date.now(), retryAfterMs);
          totals.throttledByProvider += 1;
          recordEvent({
            event: "throttled",
            model: modelKey,
            cooldownMs: entry === undefined ? 0 : Math.max(0, entry.until - Date.now()),
          });
          logger?.warn(
            "provider throttled %C; slowing to %d%% for %d ms",
            modelKey,
            Math.round((entry?.factor ?? 1) * 100),
            entry === undefined ? 0 : Math.max(0, entry.until - Date.now()),
          );
        }
        yield chunk;
      }
      cooldown.recordSuccess(modelKey);
    } finally {
      activeLimiter.releaseSlot();
      recordEvent({ event: "completed", model: modelKey });
    }
  });

  // ── Teardown ──
  ctx.effect(() => () => {
    clearInterval(sweepTimer);
    disposeLlmListener();
    for (const limiter of limiters.values()) limiter.dispose();
    limiters.clear();
    cooldown.clear();
  }, "rate-limiter: dispose llm/stream listener");

  logger?.info("rate limiter active — llm/stream interceptor registered");
}

export { apply, name, SETTINGS_NS, Config };
