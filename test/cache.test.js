import { test } from "node:test";
import assert from "node:assert/strict";
import { createCache } from "../src/cache.js";

function fakeStorage() {
  const data = new Map();
  return {
    async get(key) {
      return data.has(key) ? data.get(key) : undefined;
    },
    async set(key, value) {
      data.set(key, value);
    },
    _raw: data,
  };
}

function fakeClock(start = 1_000_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
  };
}

test("cache: miss returns null", async () => {
  const cache = await createCache({
    storage: fakeStorage(),
    clock: fakeClock(),
  });
  assert.equal(await cache.get("https://bit.ly/x"), null);
});

test("cache: set then get returns the entry", async () => {
  const cache = await createCache({
    storage: fakeStorage(),
    clock: fakeClock(),
  });
  await cache.set("https://bit.ly/x", {
    finalUrl: "https://example.com",
    title: "Example",
  });
  const entry = await cache.get("https://bit.ly/x");
  assert.equal(entry.finalUrl, "https://example.com");
  assert.equal(entry.title, "Example");
});

test("cache: entry expires after TTL", async () => {
  const clock = fakeClock();
  const cache = await createCache({ storage: fakeStorage(), clock });
  await cache.set("https://bit.ly/x", {
    finalUrl: "https://example.com",
    title: "Example",
  });

  // Advance just under 7 days — still valid.
  clock.advance(7 * 24 * 60 * 60 * 1000 - 1);
  assert.notEqual(await cache.get("https://bit.ly/x"), null);

  // Advance past 7 days — expired.
  clock.advance(2);
  assert.equal(await cache.get("https://bit.ly/x"), null);
});

test("cache: LRU eviction when over capacity", async () => {
  const { CACHE_MAX_ENTRIES, CACHE_EVICT_BATCH } = await import(
    "../src/config.js"
  );
  const clock = fakeClock();
  const cache = await createCache({ storage: fakeStorage(), clock });

  // Fill to capacity.
  for (let i = 0; i < CACHE_MAX_ENTRIES; i++) {
    clock.advance(1);
    await cache.set(`https://bit.ly/${i}`, {
      finalUrl: `https://example.com/${i}`,
      title: `T${i}`,
    });
  }
  assert.equal(cache._size(), CACHE_MAX_ENTRIES);

  // Touch the first one so it becomes most-recently-used.
  clock.advance(1);
  await cache.get("https://bit.ly/0");

  // Add one more — triggers eviction batch.
  clock.advance(1);
  await cache.set("https://bit.ly/new", {
    finalUrl: "https://example.com/new",
    title: "New",
  });

  // Size should drop by CACHE_EVICT_BATCH - 1 (we added 1, evicted batch).
  assert.equal(
    cache._size(),
    CACHE_MAX_ENTRIES + 1 - CACHE_EVICT_BATCH,
  );

  // Entry 0 (recently touched) should still be present.
  assert.notEqual(await cache.get("https://bit.ly/0"), null);

  // Entry 1 (oldest by lastUsedAt) should be gone.
  assert.equal(await cache.get("https://bit.ly/1"), null);
});

test("cache: loads existing entries from storage", async () => {
  const storage = fakeStorage();
  await storage.set("udc.cache.v1", {
    schemaVersion: 1,
    entries: {
      "https://bit.ly/persisted": {
        finalUrl: "https://example.com/p",
        title: "Persisted",
        fetchedAt: 1_000_000_000,
        lastUsedAt: 1_000_000_000,
      },
    },
  });
  const cache = await createCache({
    storage,
    clock: fakeClock(),
  });
  const entry = await cache.get("https://bit.ly/persisted");
  assert.equal(entry.finalUrl, "https://example.com/p");
  assert.equal(entry.title, "Persisted");
});

test("cache: ignores blob with wrong schema version", async () => {
  const storage = fakeStorage();
  await storage.set("udc.cache.v1", {
    schemaVersion: 999,
    entries: { "https://bit.ly/x": { finalUrl: "x", title: "x" } },
  });
  const cache = await createCache({ storage, clock: fakeClock() });
  assert.equal(await cache.get("https://bit.ly/x"), null);
});

test("cache: persists writes back to storage", async () => {
  const storage = fakeStorage();
  const cache = await createCache({ storage, clock: fakeClock() });
  await cache.set("https://bit.ly/x", {
    finalUrl: "https://example.com",
    title: "Example",
  });
  await cache._flush();
  const blob = await storage.get("udc.cache.v1");
  assert.equal(blob.schemaVersion, 1);
  assert.equal(
    blob.entries["https://bit.ly/x"].finalUrl,
    "https://example.com",
  );
});
