/**
 * Strategy tests.
 *
 * The regression that motivated this file: `#drain()` used to grant EVERY
 * queued waiter the moment one slot was released, because the loop condition
 * only looked at `#concurrent` while the waiters took their slots a microtask
 * later. With maxConcurrent = 2 and ten queued calls, one release fired all ten
 * requests at once — straight through the account's RPM limit.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { TokenBucketStrategy } from "../lib/strategies/token-bucket.js";
import { SlidingWindowStrategy } from "../lib/strategies/sliding-window.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Build one representative instance of each strategy with the same shape. */
function bothStrategies({ maxConcurrent = 2, maxRpm = 100 } = {}) {
  return [
    ["token-bucket", new TokenBucketStrategy({ burstSize: 100, refillRate: 0.001, maxConcurrent })],
    ["sliding-window", new SlidingWindowStrategy({ windowMs: 60_000, maxRpm, maxConcurrent })],
  ];
}

for (const [label, make] of [
  ["token-bucket", (opts) => new TokenBucketStrategy({ burstSize: 100, refillRate: 0.001, maxConcurrent: opts.maxConcurrent })],
  ["sliding-window", (opts) => new SlidingWindowStrategy({ windowMs: 60_000, maxRpm: opts.maxRpm ?? 100, maxConcurrent: opts.maxConcurrent })],
]) {
  test(`${label}: one release must not unlock the whole queue`, async () => {
    const limiter = make({ maxConcurrent: 2 });
    try {
      // Two live slots.
      for (let i = 0; i < 2; i += 1) {
        const permit = await limiter.acquire({ timeoutMs: 1_000 });
        assert.equal(permit.granted, true);
        limiter.acquireSlot();
      }
      assert.equal(limiter.getStatus().concurrent, 2);

      // Ten calls queue behind the saturated model.
      let granted = 0;
      const pending = [];
      for (let i = 0; i < 10; i += 1) {
        pending.push(limiter.acquire({ timeoutMs: 1_000 }).then((permit) => {
          if (permit.granted) granted += 1;
          return permit;
        }));
      }
      await sleep(20);
      assert.equal(granted, 0, "nothing may be granted while saturated");
      assert.equal(limiter.getStatus().queued, 10);

      limiter.releaseSlot();
      await sleep(30);

      // Exactly ONE waiter may be granted: the freed slot, and only that slot.
      assert.equal(granted, 1, "a single release must grant a single waiter");
      assert.equal(limiter.getStatus().reserved, 1);

      // The granted waiter takes its slot; the reservation becomes live.
      limiter.acquireSlot();
      assert.equal(limiter.getStatus().reserved, 0);
      assert.equal(limiter.getStatus().concurrent, 2);
      assert.equal(limiter.getStatus().queued, 9);
    } finally {
      limiter.dispose();
    }
  });

  test(`${label}: a queued call is refused after its timeout`, async () => {
    const limiter = make({ maxConcurrent: 1 });
    try {
      const first = await limiter.acquire({ timeoutMs: 1_000 });
      assert.equal(first.granted, true);
      limiter.acquireSlot();

      const permit = await limiter.acquire({ timeoutMs: 30 });
      assert.equal(permit.granted, false);
      assert.ok(permit.waitMs >= 25, `waitMs should reflect the wait, got ${permit.waitMs}`);
      assert.equal(limiter.getStatus().queued, 0);
    } finally {
      limiter.dispose();
    }
  });

  test(`${label}: a queued call is refused when its signal aborts`, async () => {
    const limiter = make({ maxConcurrent: 1 });
    try {
      const first = await limiter.acquire({ timeoutMs: 1_000 });
      limiter.acquireSlot();
      assert.equal(first.granted, true);

      const controller = new AbortController();
      const waiting = limiter.acquire({ signal: controller.signal, timeoutMs: 5_000 });
      setTimeout(() => controller.abort(), 20);

      const permit = await waiting;
      assert.equal(permit.granted, false);
      assert.equal(limiter.getStatus().queued, 0);
    } finally {
      limiter.dispose();
    }
  });

  test(`${label}: an already-aborted signal fails fast`, async () => {
    const limiter = make({ maxConcurrent: 1 });
    try {
      const controller = new AbortController();
      controller.abort();
      const permit = await limiter.acquire({ signal: controller.signal, timeoutMs: 1_000 });
      assert.equal(permit.granted, false);
    } finally {
      limiter.dispose();
    }
  });

  test(`${label}: non-blocking acquisition respects the concurrency cap`, async () => {
    const limiter = make({ maxConcurrent: 1 });
    try {
      const permit = limiter.acquireNonBlocking();
      assert.equal(permit.granted, true);
      assert.equal(limiter.acquireNonBlocking().granted, false);
      limiter.releaseSlot();
      assert.equal(limiter.acquireNonBlocking().granted, true);
    } finally {
      limiter.dispose();
    }
  });
}

test("token-bucket: the bucket refills and eventually grants a waiter", async () => {
  const limiter = new TokenBucketStrategy({ burstSize: 1, refillRate: 50, maxConcurrent: 5 });
  try {
    const first = await limiter.acquire({ timeoutMs: 1_000 });
    assert.equal(first.granted, true);
    limiter.acquireSlot();

    // Bucket is empty; the waiter must be woken by the refill timer.
    const second = await limiter.acquire({ timeoutMs: 1_000 });
    assert.equal(second.granted, true);
  } finally {
    limiter.dispose();
  }
});

test("sliding-window: the window caps requests even with concurrency to spare", async () => {
  const limiter = new SlidingWindowStrategy({ windowMs: 60_000, maxRpm: 2, maxConcurrent: 10 });
  try {
    for (let i = 0; i < 2; i += 1) {
      const permit = await limiter.acquire({ timeoutMs: 1_000 });
      assert.equal(permit.granted, true);
      limiter.releaseSlot();
    }
    // Window count is at maxRpm; the third call must queue and then time out.
    const permit = await limiter.acquire({ timeoutMs: 30 });
    assert.equal(permit.granted, false);
    assert.equal(limiter.getStatus().countInWindow, 2);
  } finally {
    limiter.dispose();
  }
});

test("update() applies new limits to subsequent calls", async () => {
  const limiter = new TokenBucketStrategy({ burstSize: 2, refillRate: 0.001, maxConcurrent: 1 });
  try {
    limiter.update({ maxConcurrent: 3 });
    assert.equal(limiter.getStatus().maxConcurrent, 3);
    const permits = await Promise.all([
      limiter.acquire({ timeoutMs: 50 }),
      limiter.acquire({ timeoutMs: 50 }),
      limiter.acquire({ timeoutMs: 50 }),
    ]);
    assert.equal(permits.filter((permit) => permit.granted).length, 2, "burstSize still caps at 2 tokens");
  } finally {
    limiter.dispose();
  }
});

test("bothStrategies helper stays in sync with the constructors", () => {
  const pairs = bothStrategies();
  assert.deepEqual(pairs.map(([label]) => label), ["token-bucket", "sliding-window"]);
  for (const [, limiter] of pairs) limiter.dispose();
});
