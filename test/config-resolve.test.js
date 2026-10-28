/**
 * Tier-resolution tests: precedence, wildcards, penalty scaling, 429 cooldown.
 *
 * These cover the parts that decide WHICH limit applies — the place where a
 * silent mistake costs you a throttled account rather than a failing test.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  CooldownTracker,
  compilePattern,
  isPattern,
  matchOverride,
  providerOf,
  resolveModelConfig,
  scaleConfig,
} from "../lib/config-resolve.js";

const DEFAULTS = { maxConcurrent: 5, maxRpm: 60, burstSize: 10, refillRate: 1 };

test("providerOf splits on the first slash only", () => {
  assert.equal(providerOf("openai/gpt-5.1"), "openai");
  assert.equal(providerOf("openai/gpt-5.1/turbo"), "openai");
  assert.equal(providerOf("local"), "local");
});

test("wildcards match inside one path segment and nothing else", () => {
  assert.equal(compilePattern("openai/*").test("openai/gpt-5.1"), true);
  assert.equal(compilePattern("openai/*").test("openai/gpt-5.1/turbo"), false);
  assert.equal(compilePattern("*/gpt-5.1").test("azure/gpt-5.1"), true);
  assert.equal(compilePattern("*").test("anything"), true);
  // `*` never crosses a slash, so it cannot accidentally cover every provider.
  assert.equal(compilePattern("*").test("anything/at-all"), false);
  assert.equal(compilePattern("*/*").test("anything/at-all"), true);
  // Dots must not behave as regexp wildcards.
  assert.equal(compilePattern("a.b/*").test("axb/model"), false);
  assert.equal(isPattern("openai/*"), true);
  assert.equal(isPattern("openai/gpt-5.1"), false);
});

test("exact keys beat patterns, and the most specific pattern wins among patterns", () => {
  const dict = {
    "openai/*": { maxRpm: 30 },
    "openai/gpt-5*": { maxRpm: 20 },
    "openai/gpt-5.1": { maxRpm: 5 },
  };
  assert.equal(matchOverride(dict, "openai/gpt-5.1").override.maxRpm, 5);
  assert.equal(matchOverride(dict, "openai/gpt-5.2").override.maxRpm, 20);
  assert.equal(matchOverride(dict, "openai/gpt-4").override.maxRpm, 30);
  assert.equal(matchOverride(dict, "azure/gpt-4"), undefined);
});

test("model tier outranks provider tier, which outranks defaults", () => {
  const cfg = {
    defaults: DEFAULTS,
    providers: { openai: { maxRpm: 40, maxConcurrent: 3 } },
    models: { "openai/gpt-5.1": { maxRpm: 20 } },
  };

  const model = resolveModelConfig(cfg, "openai/gpt-5.1");
  assert.equal(model.source, "model");
  assert.equal(model.maxRpm, 20);
  // Not set by the model tier: inherited from the provider tier.
  assert.equal(model.maxConcurrent, 3);

  const provider = resolveModelConfig(cfg, "openai/gpt-5.2");
  assert.equal(provider.source, "provider");
  assert.equal(provider.maxRpm, 40);

  const plain = resolveModelConfig(cfg, "anthropic/claude");
  assert.equal(plain.source, "defaults");
  assert.equal(plain.maxRpm, 60);
});

test("a tier that sets maxRpm also derives its refill rate", () => {
  const cfg = { defaults: DEFAULTS, models: { "p/m": { maxRpm: 20 } } };
  const resolved = resolveModelConfig(cfg, "p/m");
  assert.equal(resolved.maxRpm, 20);
  assert.ok(Math.abs(resolved.refillRate - 20 / 60) < 1e-9);

  // An explicit refillRate in the winning tier is honoured as-is.
  const explicit = resolveModelConfig({ defaults: DEFAULTS, models: { "p/m": { maxRpm: 20, refillRate: 2 } } }, "p/m");
  assert.equal(explicit.refillRate, 2);

  // Untouched model: defaults keep their own refill rate.
  const inherited = resolveModelConfig({ defaults: DEFAULTS }, "p/other");
  assert.equal(inherited.refillRate, 1);
});

test("scaleConfig never drops a limit below a usable floor", () => {
  const scaled = scaleConfig({ maxRpm: 20, burstSize: 4, refillRate: 0.33, maxConcurrent: 2 }, 0.5);
  assert.equal(scaled.maxRpm, 10);
  assert.equal(scaled.burstSize, 2);
  assert.ok(Math.abs(scaled.refillRate - 0.165) < 1e-9);

  const floored = scaleConfig({ maxRpm: 1, burstSize: 1, refillRate: 0.01, maxConcurrent: 1 }, 0.1);
  assert.equal(floored.maxRpm, 1);
  assert.equal(floored.burstSize, 1);
  assert.ok(floored.refillRate > 0);

  // A factor of 1 is a no-op, returning the same object.
  const base = { maxRpm: 20, burstSize: 4, refillRate: 1, maxConcurrent: 2 };
  assert.equal(scaleConfig(base, 1), base);
});

test("cooldown slows a model after a 429 and recovers after clean calls", () => {
  const tracker = new CooldownTracker({ enabled: true, cooldownMs: 1_000, factor: 0.5, recoverAfter: 2 });
  const key = "p/m";
  const t0 = 1_000_000;

  assert.equal(tracker.factorFor(key, t0), 1);
  assert.equal(tracker.isCooling(key, t0), false);

  const entry = tracker.recordFailure(key, t0);
  assert.equal(entry.factor, 0.5);
  assert.equal(tracker.factorFor(key, t0), 0.5);
  assert.equal(tracker.isCooling(key, t0), true);
  assert.equal(tracker.remainingMs(key, t0), 1_000);
  assert.equal(tracker.remainingMs(key, t0 + 400), 600);

  // Still cooling: a success does not end it early.
  tracker.recordSuccess(key, t0 + 500);
  assert.equal(tracker.factorFor(key, t0 + 500), 0.5);

  // Cooling elapsed, but not enough clean calls yet.
  assert.equal(tracker.factorFor(key, t0 + 1_001), 0.5);
  tracker.recordSuccess(key, t0 + 1_100);
  assert.equal(tracker.factorFor(key, t0 + 1_100), 0.5);
  tracker.recordSuccess(key, t0 + 1_200);
  assert.equal(tracker.factorFor(key, t0 + 1_200), 1);
});

test("a Retry-After hint longer than the cooldown wins", () => {
  const tracker = new CooldownTracker({ cooldownMs: 1_000, factor: 0.5 });
  const t0 = 5_000;
  tracker.recordFailure("p/m", t0, 4_000);
  assert.equal(tracker.remainingMs("p/m", t0), 4_000);
});

test("a disabled tracker records nothing, and clear()/forget() drop state", () => {
  const tracker = new CooldownTracker({ enabled: false });
  assert.equal(tracker.recordFailure("p/m", 0), undefined);
  assert.equal(tracker.factorFor("p/m", 0), 1);

  const active = new CooldownTracker({ cooldownMs: 1_000 });
  active.recordFailure("a/b", 0);
  active.recordFailure("c/d", 0);
  assert.deepEqual(Object.keys(active.snapshot(0)).sort(), ["a/b", "c/d"]);
  active.forget("a/b");
  assert.deepEqual(Object.keys(active.snapshot(0)), ["c/d"]);
  active.clear();
  assert.deepEqual(active.snapshot(0), {});
});
