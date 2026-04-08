import {
  CACHE_TTL_MS,
  CACHE_MAX_ENTRIES,
  CACHE_EVICT_BATCH,
  CACHE_PERSIST_DEBOUNCE_MS,
  CACHE_STORAGE_KEY,
} from "./config.js";

const SCHEMA_VERSION = 1;

export async function createCache({ storage, clock, schedule }) {
  const entries = new Map();
  let pendingPersist = null;

  // Load existing entries from storage on construction.
  const raw = await storage.get(CACHE_STORAGE_KEY);
  if (raw && typeof raw === "object" && raw.schemaVersion === SCHEMA_VERSION) {
    for (const [k, v] of Object.entries(raw.entries || {})) {
      entries.set(k, v);
    }
  }

  function schedulePersist() {
    if (!schedule) {
      // No scheduler — fire-and-forget persist (tests use _flush() to wait).
      void persistNow();
      return;
    }
    if (pendingPersist) schedule.cancel(pendingPersist);
    pendingPersist = schedule.after(CACHE_PERSIST_DEBOUNCE_MS, persistNow);
  }

  async function persistNow() {
    pendingPersist = null;
    const obj = { schemaVersion: SCHEMA_VERSION, entries: {} };
    for (const [k, v] of entries) obj.entries[k] = v;
    try {
      await storage.set(CACHE_STORAGE_KEY, obj);
    } catch (err) {
      console.warn("[udc] cache persist failed:", err);
    }
  }

  function evictIfNeeded() {
    if (entries.size <= CACHE_MAX_ENTRIES) return;
    const sorted = [...entries.entries()].sort(
      (a, b) => a[1].lastUsedAt - b[1].lastUsedAt,
    );
    for (let i = 0; i < CACHE_EVICT_BATCH && i < sorted.length; i++) {
      entries.delete(sorted[i][0]);
    }
  }

  return {
    async get(url) {
      const entry = entries.get(url);
      if (!entry) return null;
      const now = clock.now();
      if (now - entry.fetchedAt > CACHE_TTL_MS) {
        entries.delete(url);
        schedulePersist();
        return null;
      }
      entry.lastUsedAt = now;
      schedulePersist();
      return entry;
    },

    async set(url, { finalUrl, title }) {
      const now = clock.now();
      entries.set(url, {
        finalUrl,
        title,
        fetchedAt: now,
        lastUsedAt: now,
      });
      evictIfNeeded();
      schedulePersist();
    },

    async touch(url) {
      const entry = entries.get(url);
      if (!entry) return;
      entry.lastUsedAt = clock.now();
      schedulePersist();
    },

    // Test/internal access:
    _size: () => entries.size,
    _flush: persistNow,
  };
}
