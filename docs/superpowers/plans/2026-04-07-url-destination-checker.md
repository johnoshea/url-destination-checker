# URL Destination Checker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single ViolentMonkey userscript for Firefox that resolves shortener URLs and fetches YouTube titles on hover-dwell, displaying results in a layout-neutral floating tooltip.

**Architecture:** Modular ES2022 source files in `src/` (testable in isolation against `node:test` with mocked GM globals), concatenated by a `just build` task into a single `.user.js` artifact for ViolentMonkey installation. Network/storage I/O is dependency-injected so all logic-heavy modules are pure-function-testable.

**Tech Stack:** Vanilla ES2022 JavaScript, Node's built-in `node:test` runner (no test framework deps), `just` task runner, ViolentMonkey GM API (`GM_xmlhttpRequest`, `GM_getValue`, `GM_setValue`, `GM_addStyle`).

---

## File Structure

```
url_destination_checker/
  url-destination-checker.user.js   # built artifact (gitignored output of `just build`)
  package.json                      # "type": "module", node:test scripts
  justfile                          # test, lint (eslint optional), build
  .gitignore                        # node_modules/, the .user.js build artifact
  README.md                         # install + manual test checklist
  src/
    config.js                       # all configuration constants
    parsing.js                      # HTML entity decoder, title extractor, encoding detection
    classifier.js                   # link classifier (pure)
    cache.js                        # cache with TTL + LRU + injected storage
    resolver.js                     # YouTube oEmbed + shortener resolution
    tooltip.js                      # tooltip element, render, positioning, dismiss
    hover.js                        # hover controller, dwell timer, grace period
    main.js                         # entry point — wires everything to GM_*
  test/
    parsing.test.js
    classifier.test.js
    cache.test.js
  scripts/
    build.js                        # concatenates src/ into the userscript artifact
  docs/superpowers/
    specs/2026-04-07-url-destination-checker-design.md
    plans/2026-04-07-url-destination-checker.md
```

**Module dependency order** (used by build script): `config.js` → `parsing.js` → `classifier.js` → `cache.js` → `resolver.js` → `tooltip.js` → `hover.js` → `main.js`.

**ES modules vs. userscript IIFE:** Source files use `export` for testability. The build script concatenates files in dependency order, stripping `^export ` and `^import .*$` lines, then wraps the whole thing in an IIFE inside the `// ==UserScript==` block.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `justfile`
- Create: `README.md`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "url-destination-checker",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test test/"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
url-destination-checker.user.js
```

(The built userscript is gitignored — only `src/` is the source of truth. Users build locally.)

- [ ] **Step 3: Create `justfile`**

```just
default: test

test:
    node --test test/

build:
    node scripts/build.js

check: test
```

(The `scripts/build.js` referenced here is created in Task 11. Don't try to run `just build` yet.)

- [ ] **Step 4: Create `README.md` skeleton**

```markdown
# URL Destination Checker

A ViolentMonkey userscript for Firefox that reveals the real destination URL and page title for link-shortener URLs and YouTube links on hover, without navigating to them.

## Install

1. Install [ViolentMonkey](https://violentmonkey.github.io/) in Firefox.
2. Run `just build` to produce `url-destination-checker.user.js`.
3. Open the built file in Firefox; ViolentMonkey will offer to install it.

## Configuration

All knobs live as constants at the top of `src/config.js`. Edit and rebuild.

## Development

- `just test` — run unit tests
- `just build` — produce the userscript artifact
- `just check` — run tests (alias)

## Manual Test Checklist

(Filled in by Task 12.)
```

- [ ] **Step 5: Verify scaffolding**

Run: `just test`
Expected: `node --test test/` runs and reports zero tests (no tests yet, no error).

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore justfile README.md
git commit -m "Scaffold project: package.json, justfile, gitignore, README"
```

---

## Task 2: Configuration constants

**Files:**
- Create: `src/config.js`

- [ ] **Step 1: Write `src/config.js`**

```javascript
// All knobs live here. Edit and rebuild with `just build`.

export const DWELL_MS = 2000;
export const GRACE_MS = 200;

export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const CACHE_MAX_ENTRIES = 1000;
export const CACHE_EVICT_BATCH = 50;
export const CACHE_PERSIST_DEBOUNCE_MS = 2000;
export const CACHE_STORAGE_KEY = "udc.cache.v1";

export const HEAD_TIMEOUT_MS = 5000;
export const GET_TIMEOUT_MS = 8000;
export const OEMBED_TIMEOUT_MS = 5000;
export const MAX_REDIRECT_HOPS = 10;
export const TITLE_SCRAPE_BYTES = 16384;

export const DEBUG = false;

export const SHORTENER_HOSTS = [
  "bit.ly",
  "t.co",
  "tinyurl.com",
  "buff.ly",
  "ow.ly",
  "goo.gl",
  "lnkd.in",
  "is.gd",
  "shorturl.at",
  "rebrand.ly",
  "cutt.ly",
  "tiny.cc",
  "trib.al",
  "dlvr.it",
];
```

- [ ] **Step 2: Commit**

```bash
git add src/config.js
git commit -m "Add config constants module"
```

---

## Task 3: Parsing module (HTML entities, title extraction, encoding detection)

**Files:**
- Create: `src/parsing.js`
- Create: `test/parsing.test.js`

This module is pure-function and is the highest-bug-risk surface. Strict TDD.

- [ ] **Step 1: Write failing tests for `decodeEntities`**

Create `test/parsing.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeEntities,
  extractTitle,
  detectCharset,
} from "../src/parsing.js";

test("decodeEntities: named entities", () => {
  assert.equal(decodeEntities("Tom &amp; Jerry"), "Tom & Jerry");
  assert.equal(decodeEntities("&lt;tag&gt;"), "<tag>");
  assert.equal(decodeEntities("she said &quot;hi&quot;"), 'she said "hi"');
  assert.equal(decodeEntities("it&#39;s"), "it's");
  assert.equal(decodeEntities("it&#x27;s"), "it's");
});

test("decodeEntities: numeric decimal entities", () => {
  assert.equal(decodeEntities("&#65;&#66;&#67;"), "ABC");
  assert.equal(decodeEntities("&#8212;"), "—");
});

test("decodeEntities: numeric hex entities", () => {
  assert.equal(decodeEntities("&#x41;&#x42;"), "AB");
  assert.equal(decodeEntities("&#x2014;"), "—");
});

test("decodeEntities: leaves unknown entities alone", () => {
  assert.equal(decodeEntities("&unknownthing;"), "&unknownthing;");
});

test("decodeEntities: empty and plain strings", () => {
  assert.equal(decodeEntities(""), "");
  assert.equal(decodeEntities("plain text"), "plain text");
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `just test`
Expected: FAIL — `Cannot find module '../src/parsing.js'`

- [ ] **Step 3: Implement `decodeEntities`**

Create `src/parsing.js`:

```javascript
const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

export function decodeEntities(input) {
  return input.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (Number.isFinite(code)) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    const named = NAMED_ENTITIES[body];
    return named !== undefined ? named : match;
  });
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `just test`
Expected: PASS — 5 tests passing for `decodeEntities`.

- [ ] **Step 5: Write failing tests for `extractTitle`**

Append to `test/parsing.test.js`:

```javascript
test("extractTitle: simple title", () => {
  assert.equal(extractTitle("<html><head><title>Hello</title></head>"), "Hello");
});

test("extractTitle: title with attributes", () => {
  assert.equal(
    extractTitle('<title lang="en">My Page</title>'),
    "My Page",
  );
});

test("extractTitle: collapses internal whitespace and trims", () => {
  assert.equal(
    extractTitle("<title>\n  Lots   of\n  space  \n</title>"),
    "Lots of space",
  );
});

test("extractTitle: decodes entities", () => {
  assert.equal(
    extractTitle("<title>Tom &amp; Jerry</title>"),
    "Tom & Jerry",
  );
});

test("extractTitle: returns null when no title tag", () => {
  assert.equal(extractTitle("<html><body>nothing</body></html>"), null);
});

test("extractTitle: returns null for empty title", () => {
  assert.equal(extractTitle("<title></title>"), null);
  assert.equal(extractTitle("<title>   </title>"), null);
});

test("extractTitle: case-insensitive tag matching", () => {
  assert.equal(extractTitle("<TITLE>Caps</TITLE>"), "Caps");
});
```

- [ ] **Step 6: Run tests, verify failure**

Run: `just test`
Expected: FAIL — `extractTitle is not a function`.

- [ ] **Step 7: Implement `extractTitle`**

Append to `src/parsing.js`:

```javascript
export function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  const decoded = decodeEntities(match[1]);
  const collapsed = decoded.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : null;
}
```

- [ ] **Step 8: Run tests, verify pass**

Run: `just test`
Expected: PASS — all 12 tests so far passing.

- [ ] **Step 9: Write failing tests for `detectCharset`**

Append to `test/parsing.test.js`:

```javascript
test("detectCharset: returns utf-8 when no charset present", () => {
  assert.equal(detectCharset("text/html"), "utf-8");
  assert.equal(detectCharset(""), "utf-8");
  assert.equal(detectCharset(null), "utf-8");
});

test("detectCharset: extracts charset from content-type", () => {
  assert.equal(
    detectCharset("text/html; charset=iso-8859-1"),
    "iso-8859-1",
  );
  assert.equal(
    detectCharset("text/html;charset=Shift_JIS"),
    "shift_jis",
  );
});

test("detectCharset: handles quoted charset values", () => {
  assert.equal(
    detectCharset('text/html; charset="utf-8"'),
    "utf-8",
  );
});
```

- [ ] **Step 10: Implement `detectCharset`**

Append to `src/parsing.js`:

```javascript
export function detectCharset(contentType) {
  if (!contentType) return "utf-8";
  const match = contentType.match(/charset\s*=\s*"?([^";\s]+)"?/i);
  if (!match) return "utf-8";
  return match[1].toLowerCase();
}
```

- [ ] **Step 11: Run tests, verify all pass**

Run: `just test`
Expected: PASS — 15 tests total.

- [ ] **Step 12: Commit**

```bash
git add src/parsing.js test/parsing.test.js
git commit -m "Add parsing module: entity decoder, title extractor, charset detection"
```

---

## Task 4: Link classifier

**Files:**
- Create: `src/classifier.js`
- Create: `test/classifier.test.js`

- [ ] **Step 1: Write failing tests for shortener classification**

Create `test/classifier.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../src/classifier.js";

const PAGE_ORIGIN = "https://news.ycombinator.com";

test("classify: known shortener returns shortener kind", () => {
  assert.deepEqual(classify("https://bit.ly/abc123", PAGE_ORIGIN), {
    kind: "shortener",
  });
  assert.deepEqual(classify("https://t.co/xyz", PAGE_ORIGIN), {
    kind: "shortener",
  });
});

test("classify: shortener on same origin is ignored", () => {
  assert.deepEqual(classify("https://bit.ly/abc", "https://bit.ly"), {
    kind: "ignore",
  });
});

test("classify: unknown host is ignored", () => {
  assert.deepEqual(
    classify("https://example.com/some-page", PAGE_ORIGIN),
    { kind: "ignore" },
  );
});

test("classify: empty / non-http hrefs are ignored", () => {
  assert.deepEqual(classify("", PAGE_ORIGIN), { kind: "ignore" });
  assert.deepEqual(classify("javascript:void(0)", PAGE_ORIGIN), {
    kind: "ignore",
  });
  assert.deepEqual(classify("mailto:foo@bar.com", PAGE_ORIGIN), {
    kind: "ignore",
  });
  assert.deepEqual(classify("tel:+15551234", PAGE_ORIGIN), {
    kind: "ignore",
  });
  assert.deepEqual(classify("#section", PAGE_ORIGIN), { kind: "ignore" });
});

test("classify: malformed URL is ignored", () => {
  assert.deepEqual(classify("not a url", PAGE_ORIGIN), { kind: "ignore" });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `just test`
Expected: FAIL — `Cannot find module '../src/classifier.js'`.

- [ ] **Step 3: Implement classifier (shortener + YouTube)**

Create `src/classifier.js`:

```javascript
import { SHORTENER_HOSTS } from "./config.js";

const SHORTENER_SET = new Set(SHORTENER_HOSTS);
const YT_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function parseUrl(href) {
  if (!href) return null;
  if (
    href.startsWith("javascript:") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:") ||
    href.startsWith("#")
  ) {
    return null;
  }
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

function sameOrigin(url, pageOrigin) {
  try {
    return new URL(pageOrigin).host === url.host;
  } catch {
    return false;
  }
}

export function classify(href, pageOrigin) {
  const url = parseUrl(href);
  if (!url) return { kind: "ignore" };

  const yt = classifyYouTube(url);
  if (yt) return yt;

  if (SHORTENER_SET.has(url.host)) {
    if (sameOrigin(url, pageOrigin)) return { kind: "ignore" };
    return { kind: "shortener" };
  }

  return { kind: "ignore" };
}

function classifyYouTube(url) {
  const host = url.host.replace(/^www\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return YT_VIDEO_ID.test(id) ? { kind: "youtube", videoId: id } : null;
  }

  if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com"
  ) {
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v");
      return id && YT_VIDEO_ID.test(id) ? { kind: "youtube", videoId: id } : null;
    }
    const segMatch = url.pathname.match(/^\/(shorts|live|embed)\/([A-Za-z0-9_-]{11})/);
    if (segMatch) return { kind: "youtube", videoId: segMatch[2] };
  }

  return null;
}
```

- [ ] **Step 4: Run tests, verify shortener tests pass**

Run: `just test`
Expected: PASS for all 5 shortener tests.

- [ ] **Step 5: Write tests for YouTube classification**

Append to `test/classifier.test.js`:

```javascript
test("classify: youtu.be short link", () => {
  assert.deepEqual(
    classify("https://youtu.be/dQw4w9WgXcQ", PAGE_ORIGIN),
    { kind: "youtube", videoId: "dQw4w9WgXcQ" },
  );
});

test("classify: youtube.com/watch", () => {
  assert.deepEqual(
    classify("https://www.youtube.com/watch?v=dQw4w9WgXcQ", PAGE_ORIGIN),
    { kind: "youtube", videoId: "dQw4w9WgXcQ" },
  );
});

test("classify: youtube.com/watch with extra params", () => {
  assert.deepEqual(
    classify(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=foo",
      PAGE_ORIGIN,
    ),
    { kind: "youtube", videoId: "dQw4w9WgXcQ" },
  );
});

test("classify: youtube.com/shorts", () => {
  assert.deepEqual(
    classify("https://www.youtube.com/shorts/dQw4w9WgXcQ", PAGE_ORIGIN),
    { kind: "youtube", videoId: "dQw4w9WgXcQ" },
  );
});

test("classify: youtube.com/live", () => {
  assert.deepEqual(
    classify("https://www.youtube.com/live/dQw4w9WgXcQ", PAGE_ORIGIN),
    { kind: "youtube", videoId: "dQw4w9WgXcQ" },
  );
});

test("classify: youtube.com/embed", () => {
  assert.deepEqual(
    classify("https://www.youtube.com/embed/dQw4w9WgXcQ", PAGE_ORIGIN),
    { kind: "youtube", videoId: "dQw4w9WgXcQ" },
  );
});

test("classify: m.youtube.com and music.youtube.com", () => {
  assert.deepEqual(
    classify("https://m.youtube.com/watch?v=dQw4w9WgXcQ", PAGE_ORIGIN),
    { kind: "youtube", videoId: "dQw4w9WgXcQ" },
  );
  assert.deepEqual(
    classify("https://music.youtube.com/watch?v=dQw4w9WgXcQ", PAGE_ORIGIN),
    { kind: "youtube", videoId: "dQw4w9WgXcQ" },
  );
});

test("classify: youtube link is classified even on youtube.com origin", () => {
  assert.deepEqual(
    classify(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com",
    ),
    { kind: "youtube", videoId: "dQw4w9WgXcQ" },
  );
});

test("classify: invalid youtube video id is ignored", () => {
  assert.deepEqual(
    classify("https://youtu.be/short", PAGE_ORIGIN),
    { kind: "ignore" },
  );
});
```

- [ ] **Step 6: Run tests, verify all pass**

Run: `just test`
Expected: PASS — all 14 classifier tests pass (the YouTube branch was implemented in Step 3 alongside the shortener branch).

- [ ] **Step 7: Commit**

```bash
git add src/classifier.js test/classifier.test.js
git commit -m "Add link classifier for shorteners and YouTube URL forms"
```

---

## Task 5: Cache module

**Files:**
- Create: `src/cache.js`
- Create: `test/cache.test.js`

The cache takes an injected `storage` object (so tests can pass a fake `Map`-backed implementation, and `main.js` will pass a `GM_*`-backed one).

- [ ] **Step 1: Write failing tests for basic get/set + miss**

Create `test/cache.test.js`:

```javascript
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
```

- [ ] **Step 2: Run tests, verify failure**

Run: `just test`
Expected: FAIL — `Cannot find module '../src/cache.js'`.

- [ ] **Step 3: Implement cache (in-memory + load + persist + TTL + LRU)**

Create `src/cache.js`:

```javascript
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
      // No scheduler available — persist synchronously (used in tests).
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
      if (clock.now() - entry.fetchedAt > CACHE_TTL_MS) {
        entries.delete(url);
        schedulePersist();
        return null;
      }
      entry.lastUsedAt = clock.now();
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
```

- [ ] **Step 4: Run tests, verify the two pass**

Run: `just test`
Expected: PASS — 2 cache tests pass.

- [ ] **Step 5: Write tests for TTL expiry**

Append to `test/cache.test.js`:

```javascript
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
```

- [ ] **Step 6: Run tests, verify pass**

Run: `just test`
Expected: PASS — TTL test passes.

- [ ] **Step 7: Write tests for LRU eviction**

Append to `test/cache.test.js`:

```javascript
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
```

- [ ] **Step 8: Run tests, verify pass**

Run: `just test`
Expected: PASS — LRU test passes.

- [ ] **Step 9: Write tests for persistence (load + schema check + writeback)**

Append to `test/cache.test.js`:

```javascript
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
```

- [ ] **Step 10: Run tests, verify all pass**

Run: `just test`
Expected: PASS — all cache tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/cache.js test/cache.test.js
git commit -m "Add cache with TTL, LRU eviction, and persistent storage"
```

---

## Task 6: Resolver — YouTube oEmbed strategy

**Files:**
- Create: `src/resolver.js`

The resolver takes an injected `request` function (a thin wrapper over `GM_xmlhttpRequest`) so it can be tested by passing a fake. We will not write unit tests against the resolver itself — the spec explicitly assigns network code to manual testing — but we keep dependency injection so the door is open later.

- [ ] **Step 1: Write the resolver module with YouTube implemented and shortener stubbed**

Create `src/resolver.js`:

```javascript
import {
  OEMBED_TIMEOUT_MS,
  HEAD_TIMEOUT_MS,
  GET_TIMEOUT_MS,
  MAX_REDIRECT_HOPS,
  TITLE_SCRAPE_BYTES,
} from "./config.js";
import { extractTitle, detectCharset } from "./parsing.js";

/**
 * Create a resolver. `request` must be a function:
 *   request(opts) -> { promise: Promise<{status, responseHeaders, response, responseText}>, abort: () => void }
 * `opts` mirrors GM_xmlhttpRequest options: { method, url, headers, anonymous, redirect, timeout, responseType }.
 */
export function createResolver({ request }) {
  return {
    /**
     * Resolve a classified link. Returns { promise, abort }.
     * `link` is { kind, videoId? } from the classifier.
     * `originalHref` is the href as it appeared on the page.
     */
    resolve(link, originalHref) {
      if (link.kind === "youtube") {
        return resolveYouTube({ request, videoId: link.videoId, originalHref });
      }
      if (link.kind === "shortener") {
        return resolveShortener({ request, originalHref });
      }
      throw new Error(`[udc] resolver: unknown kind ${link.kind}`);
    },
  };
}

function resolveYouTube({ request, videoId, originalHref }) {
  const canonical = `https://www.youtube.com/watch?v=${videoId}`;
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`;

  const req = request({
    method: "GET",
    url: oembedUrl,
    anonymous: true,
    headers: { Accept: "application/json" },
    timeout: OEMBED_TIMEOUT_MS,
    responseType: "text",
  });

  const promise = req.promise.then(
    (resp) => {
      if (resp.status === 200) {
        try {
          const data = JSON.parse(resp.responseText);
          return { finalUrl: originalHref, title: data.title || null };
        } catch {
          return {
            finalUrl: originalHref,
            title: null,
            error: "could not load title",
          };
        }
      }
      if (resp.status === 401 || resp.status === 404) {
        return {
          finalUrl: originalHref,
          title: null,
          error: "video unavailable",
        };
      }
      return {
        finalUrl: originalHref,
        title: null,
        error: `oEmbed returned ${resp.status}`,
      };
    },
    (err) => {
      throw new Error(`oEmbed request failed: ${err.message || err}`);
    },
  );

  return { promise, abort: req.abort };
}

// resolveShortener implemented in Task 7.
function resolveShortener(_args) {
  throw new Error("not yet implemented");
}
```

- [ ] **Step 2: Verify tests still pass**

Run: `just test`
Expected: PASS — no new tests, existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src/resolver.js
git commit -m "Add resolver with YouTube oEmbed strategy"
```

---

## Task 7: Resolver — shortener redirect chain + title scrape

**Files:**
- Modify: `src/resolver.js` (replace `resolveShortener` stub)

- [ ] **Step 1: Replace `resolveShortener` stub**

In `src/resolver.js`, replace the stub:

```javascript
// resolveShortener implemented in Task 7.
function resolveShortener(_args) {
  throw new Error("not yet implemented");
}
```

with:

```javascript
function resolveShortener({ request, originalHref }) {
  let currentRequest = null;
  let aborted = false;

  function abort() {
    aborted = true;
    if (currentRequest) currentRequest.abort();
  }

  const promise = (async () => {
    // Step 1: Follow redirect chain manually with HEAD requests.
    let url = originalHref;
    for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
      if (aborted) throw new Error("aborted");
      currentRequest = request({
        method: "HEAD",
        url,
        anonymous: true,
        redirect: "manual",
        headers: {},
        timeout: HEAD_TIMEOUT_MS,
      });
      let resp;
      try {
        resp = await currentRequest.promise;
      } catch (err) {
        throw new Error(`HEAD failed at ${url}: ${err.message || err}`);
      }
      if (resp.status >= 300 && resp.status < 400) {
        const loc = headerValue(resp.responseHeaders, "location");
        if (!loc) break; // 3xx without Location — treat current as final.
        url = absolutize(loc, url);
        continue;
      }
      // Non-3xx — current url is final.
      break;
    }
    if (aborted) throw new Error("aborted");

    const finalUrl = url;

    // Step 2: Ranged GET title scrape.
    currentRequest = request({
      method: "GET",
      url: finalUrl,
      anonymous: true,
      headers: {
        Range: `bytes=0-${TITLE_SCRAPE_BYTES - 1}`,
        Accept: "text/html",
      },
      timeout: GET_TIMEOUT_MS,
      responseType: "arraybuffer",
    });

    let getResp;
    try {
      getResp = await currentRequest.promise;
    } catch (err) {
      return { finalUrl, title: null, error: `title fetch failed: ${err.message || err}` };
    }

    if (getResp.status >= 400) {
      return { finalUrl, title: null, error: `title fetch returned ${getResp.status}` };
    }

    const charset = detectCharset(headerValue(getResp.responseHeaders, "content-type"));
    let html;
    try {
      const decoder = new TextDecoder(charset, { fatal: false });
      html = decoder.decode(getResp.response);
    } catch {
      // Unknown encoding — fall back to UTF-8.
      html = new TextDecoder("utf-8", { fatal: false }).decode(getResp.response);
    }

    const title = extractTitle(html);
    return { finalUrl, title };
  })();

  return { promise, abort };
}

function headerValue(rawHeaders, name) {
  if (!rawHeaders) return null;
  const lower = name.toLowerCase();
  for (const line of rawHeaders.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    if (line.slice(0, idx).trim().toLowerCase() === lower) {
      return line.slice(idx + 1).trim();
    }
  }
  return null;
}

function absolutize(location, base) {
  try {
    return new URL(location, base).href;
  } catch {
    return location;
  }
}
```

- [ ] **Step 2: Verify tests still pass**

Run: `just test`
Expected: PASS — existing tests unaffected.

- [ ] **Step 3: Commit**

```bash
git add src/resolver.js
git commit -m "Add shortener resolution: redirect chain HEAD + ranged GET title scrape"
```

---

## Task 8: Tooltip module

**Files:**
- Create: `src/tooltip.js`

The tooltip module is browser-only (creates DOM elements, attaches listeners). Not unit-tested per the strategy in the spec — manual checklist only. Build the DOM with `createElement`/`textContent` (not innerHTML) so the structure is unambiguously safe.

- [ ] **Step 1: Write the tooltip module**

Create `src/tooltip.js`:

```javascript
const TOOLTIP_CSS = `
#udc-tooltip {
  all: initial;
  position: fixed;
  z-index: 2147483647;
  display: none;
  max-width: 320px;
  padding: 8px 10px;
  background: #1f1f1f;
  color: #f0f0f0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  line-height: 1.4;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
}
#udc-tooltip .udc-title {
  font-weight: 600;
  margin-bottom: 4px;
  word-wrap: break-word;
  color: #f0f0f0;
}
#udc-tooltip .udc-title.udc-muted {
  font-weight: 400;
  color: #999;
  font-style: italic;
}
#udc-tooltip .udc-url {
  display: block;
  color: #6cb6ff;
  text-decoration: none;
  word-break: break-all;
  font-size: 11px;
}
#udc-tooltip .udc-url:hover {
  text-decoration: underline;
}
#udc-tooltip .udc-error {
  color: #ff8080;
}
`;

/**
 * Create the tooltip controller. Returns an object exposing show/update/hide.
 *
 * `host` is a DOM injection target (typically `document.body`).
 * `addStyle` is a function that injects CSS into the page (typically GM_addStyle).
 * `onClose` is called whenever the tooltip becomes hidden, for any reason.
 * `onMouseEnter`/`onMouseLeave` notify the hover controller about cursor events
 *   on the tooltip body, so it can manage the link↔tooltip grace period.
 */
export function createTooltip({ host, addStyle, onClose, onMouseEnter, onMouseLeave }) {
  addStyle(TOOLTIP_CSS);

  // Build the DOM with safe primitives — no innerHTML.
  const el = document.createElement("div");
  el.id = "udc-tooltip";
  const titleEl = document.createElement("div");
  titleEl.className = "udc-title";
  const urlEl = document.createElement("a");
  urlEl.className = "udc-url";
  urlEl.target = "_blank";
  urlEl.rel = "noopener noreferrer";
  el.appendChild(titleEl);
  el.appendChild(urlEl);
  host.appendChild(el);

  let visible = false;
  let currentLink = null;
  let onKeyDown = null;
  let onDocClick = null;
  let onScrollOrResize = null;
  let positionRafId = null;

  el.addEventListener("mouseenter", () => onMouseEnter && onMouseEnter());
  el.addEventListener("mouseleave", () => onMouseLeave && onMouseLeave());

  function render(data) {
    titleEl.classList.remove("udc-muted", "udc-error");
    if (data.loading) {
      titleEl.textContent = "Loading…";
      titleEl.classList.add("udc-muted");
      urlEl.style.display = "none";
      return;
    }
    if (data.error) {
      titleEl.textContent = data.message || "Could not resolve link";
      titleEl.classList.add("udc-error");
      if (data.finalUrl) {
        urlEl.style.display = "block";
        urlEl.href = data.finalUrl;
        urlEl.textContent = data.finalUrl;
      } else {
        urlEl.style.display = "none";
      }
      return;
    }
    if (data.title) {
      titleEl.textContent = data.title;
    } else {
      titleEl.textContent = "(no title found)";
      titleEl.classList.add("udc-muted");
    }
    urlEl.style.display = "block";
    urlEl.href = data.finalUrl;
    urlEl.textContent = data.finalUrl;
  }

  function position() {
    if (!visible || !currentLink) return;
    const rect = currentLink.getBoundingClientRect();
    const margin = 6;

    // Make el measurable.
    el.style.left = "0px";
    el.style.top = "0px";
    const elRect = el.getBoundingClientRect();

    let left = rect.left;
    let top = rect.bottom + margin;

    // Clamp right edge.
    if (left + elRect.width > window.innerWidth - margin) {
      left = window.innerWidth - elRect.width - margin;
    }
    if (left < margin) left = margin;

    // Flip above if it overflows the bottom.
    if (top + elRect.height > window.innerHeight - margin) {
      top = rect.top - elRect.height - margin;
      if (top < margin) top = margin;
    }

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function schedulePosition() {
    if (positionRafId) cancelAnimationFrame(positionRafId);
    positionRafId = requestAnimationFrame(() => {
      positionRafId = null;
      position();
    });
  }

  function show(link, data) {
    currentLink = link;
    render(data);
    if (!visible) {
      visible = true;
      el.style.display = "block";
      attachDismissHandlers();
    }
    schedulePosition();
  }

  function update(data) {
    if (!visible) return;
    render(data);
    schedulePosition();
  }

  function hide() {
    if (!visible) return;
    visible = false;
    el.style.display = "none";
    currentLink = null;
    detachDismissHandlers();
    if (onClose) onClose();
  }

  function attachDismissHandlers() {
    onKeyDown = (e) => {
      if (e.key === "Escape") hide();
    };
    onDocClick = (e) => {
      if (!el.contains(e.target)) hide();
    };
    onScrollOrResize = () => schedulePosition();
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onDocClick, true);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
  }

  function detachDismissHandlers() {
    if (onKeyDown) document.removeEventListener("keydown", onKeyDown);
    if (onDocClick) document.removeEventListener("click", onDocClick, true);
    if (onScrollOrResize) {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    }
    onKeyDown = onDocClick = onScrollOrResize = null;
  }

  return {
    show,
    update,
    hide,
    isVisible: () => visible,
    getElement: () => el,
  };
}
```

- [ ] **Step 2: Verify tests still pass**

Run: `just test`
Expected: PASS — tooltip is not imported by anything tested.

- [ ] **Step 3: Commit**

```bash
git add src/tooltip.js
git commit -m "Add tooltip module: render states, positioning, dismiss handlers"
```

---

## Task 9: Hover controller

**Files:**
- Create: `src/hover.js`

- [ ] **Step 1: Write the hover controller**

Create `src/hover.js`:

```javascript
import { DWELL_MS, GRACE_MS } from "./config.js";
import { classify } from "./classifier.js";

/**
 * Create the hover controller. Wires document-level mouse events to the
 * dwell timer, cache, resolver, and tooltip.
 */
export function createHoverController({ cache, resolver, tooltip, pageOrigin }) {
  const state = {
    link: null,
    href: null,
    dwellTimer: null,
    inflightAbort: null,
    cursorOnLink: false,
    cursorOnTooltip: false,
    graceTimer: null,
  };

  function clearDwell() {
    if (state.dwellTimer) {
      clearTimeout(state.dwellTimer);
      state.dwellTimer = null;
    }
  }

  function clearGrace() {
    if (state.graceTimer) {
      clearTimeout(state.graceTimer);
      state.graceTimer = null;
    }
  }

  function abortInflight() {
    if (state.inflightAbort) {
      try {
        state.inflightAbort();
      } catch {
        /* ignore */
      }
      state.inflightAbort = null;
    }
  }

  function closeTooltip() {
    abortInflight();
    clearGrace();
    if (tooltip.isVisible()) tooltip.hide();
    state.cursorOnLink = false;
    state.cursorOnTooltip = false;
    state.link = null;
    state.href = null;
  }

  function maybeStartGrace() {
    if (state.cursorOnLink || state.cursorOnTooltip) return;
    clearGrace();
    state.graceTimer = setTimeout(() => {
      state.graceTimer = null;
      if (!state.cursorOnLink && !state.cursorOnTooltip) closeTooltip();
    }, GRACE_MS);
  }

  function onMouseOver(e) {
    const link = e.target.closest && e.target.closest("a[href]");
    if (!link) return;

    if (link === state.link) {
      state.cursorOnLink = true;
      clearGrace();
      return;
    }

    const href = link.href;
    const verdict = classify(href, pageOrigin);
    if (verdict.kind === "ignore") return;

    // New qualifying link — reset any prior state.
    if (tooltip.isVisible()) closeTooltip();
    clearDwell();

    state.link = link;
    state.href = href;
    state.cursorOnLink = true;

    state.dwellTimer = setTimeout(() => {
      state.dwellTimer = null;
      void fire(verdict, href, link);
    }, DWELL_MS);
  }

  function onMouseOut(e) {
    const link = e.target.closest && e.target.closest("a[href]");
    if (!link || link !== state.link) return;

    // If the cursor is moving to a child of the same link, ignore.
    const related = e.relatedTarget;
    if (related && link.contains(related)) return;

    state.cursorOnLink = false;

    if (state.dwellTimer) {
      // Dwell hasn't fired yet — cancel and forget.
      clearDwell();
      state.link = null;
      state.href = null;
      return;
    }

    if (tooltip.isVisible()) {
      maybeStartGrace();
    } else {
      // Lookup is in flight but tooltip not yet shown — abort.
      closeTooltip();
    }
  }

  async function fire(verdict, href, link) {
    // Check cache first.
    const cached = await cache.get(href);
    if (cached) {
      tooltip.show(link, { finalUrl: cached.finalUrl, title: cached.title });
      return;
    }

    tooltip.show(link, { loading: true });

    const req = resolver.resolve(verdict, href);
    state.inflightAbort = req.abort;

    try {
      const data = await req.promise;
      state.inflightAbort = null;
      // Only update if this is still the active link.
      if (state.link !== link) return;
      await cache.set(href, { finalUrl: data.finalUrl, title: data.title });
      if (data.error) {
        tooltip.update({
          finalUrl: data.finalUrl,
          title: data.title,
          error: true,
          message: data.error,
        });
      } else {
        tooltip.update({ finalUrl: data.finalUrl, title: data.title });
      }
    } catch (err) {
      state.inflightAbort = null;
      if (state.link !== link) return;
      tooltip.update({
        error: true,
        message: `Could not resolve link: ${err.message || err}`,
      });
    }
  }

  function notifyTooltipMouseEnter() {
    state.cursorOnTooltip = true;
    clearGrace();
  }

  function notifyTooltipMouseLeave() {
    state.cursorOnTooltip = false;
    maybeStartGrace();
  }

  function attach() {
    document.addEventListener("mouseover", onMouseOver, { passive: true });
    document.addEventListener("mouseout", onMouseOut, { passive: true });
  }

  return {
    attach,
    notifyTooltipMouseEnter,
    notifyTooltipMouseLeave,
    _state: state,
  };
}
```

- [ ] **Step 2: Verify tests still pass**

Run: `just test`
Expected: PASS — hover not yet imported.

- [ ] **Step 3: Commit**

```bash
git add src/hover.js
git commit -m "Add hover controller: dwell timer, cache lookup, link-tooltip handoff"
```

---

## Task 10: Main entry point

**Files:**
- Create: `src/main.js`

This is the only module that touches `GM_*` directly. It builds adapters for storage, scheduling, and HTTP requests, then wires the modules together.

- [ ] **Step 1: Write `src/main.js`**

Create `src/main.js`:

```javascript
import { createCache } from "./cache.js";
import { createResolver } from "./resolver.js";
import { createTooltip } from "./tooltip.js";
import { createHoverController } from "./hover.js";

// Adapters wrapping GM_* APIs into the shapes our modules expect.

const storage = {
  async get(key) {
    return await GM_getValue(key, undefined);
  },
  async set(key, value) {
    await GM_setValue(key, value);
  },
};

const clock = { now: () => Date.now() };

const schedule = {
  after(ms, fn) {
    return setTimeout(fn, ms);
  },
  cancel(handle) {
    clearTimeout(handle);
  },
};

/**
 * Adapter that wraps GM_xmlhttpRequest into the {promise, abort} shape
 * used by the resolver.
 */
function request(opts) {
  let resolveFn, rejectFn;
  const promise = new Promise((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  const handle = GM_xmlhttpRequest({
    method: opts.method,
    url: opts.url,
    headers: opts.headers || {},
    anonymous: !!opts.anonymous,
    redirect: opts.redirect,
    timeout: opts.timeout,
    responseType: opts.responseType,
    onload(resp) {
      resolveFn({
        status: resp.status,
        responseHeaders: resp.responseHeaders,
        response: resp.response,
        responseText: resp.responseText,
      });
    },
    onerror(err) {
      rejectFn(new Error(`network error: ${err.error || err.statusText || "unknown"}`));
    },
    ontimeout() {
      rejectFn(new Error("timeout"));
    },
    onabort() {
      rejectFn(new Error("aborted"));
    },
  });
  return {
    promise,
    abort() {
      try {
        handle.abort();
      } catch {
        /* GM_xmlhttpRequest may not return an abortable handle in older managers */
      }
    },
  };
}

(async function main() {
  const cache = await createCache({ storage, clock, schedule });
  const resolver = createResolver({ request });

  // Forward ref so the tooltip can notify the hover controller about
  // its own mouse events without a circular import.
  let hoverRef = null;

  const tooltip = createTooltip({
    host: document.body,
    addStyle: GM_addStyle,
    onClose: () => {
      /* hover controller drives this; nothing to do here */
    },
    onMouseEnter: () => hoverRef && hoverRef.notifyTooltipMouseEnter(),
    onMouseLeave: () => hoverRef && hoverRef.notifyTooltipMouseLeave(),
  });

  const hover = createHoverController({
    cache,
    resolver,
    tooltip,
    pageOrigin: window.location.origin,
  });
  hoverRef = hover;
  hover.attach();

  // Persist cache on page unload.
  window.addEventListener("pagehide", () => {
    void cache._flush();
  });
})().catch((err) => {
  console.error("[udc] init failed:", err);
});
```

- [ ] **Step 2: Verify tests still pass**

Run: `just test`
Expected: PASS — `main.js` references DOM/`GM_*` APIs but isn't imported by tests.

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "Add main entry point wiring modules to GM APIs"
```

---

## Task 11: Build script

**Files:**
- Create: `scripts/build.js`

The build concatenates `src/*.js` in dependency order, strips ES module syntax, and wraps the result in an IIFE inside a userscript metadata block.

- [ ] **Step 1: Create `scripts/build.js`**

```javascript
#!/usr/bin/env node
// Build the ViolentMonkey userscript by concatenating src/ modules.
//
// Strips ES module `import` and `export` syntax. The resulting body is
// wrapped in an IIFE and prefixed with the userscript metadata block.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

// Order matters: dependencies first.
const SOURCES = [
  "src/config.js",
  "src/parsing.js",
  "src/classifier.js",
  "src/cache.js",
  "src/resolver.js",
  "src/tooltip.js",
  "src/hover.js",
  "src/main.js",
];

const HEADER = `// ==UserScript==
// @name         URL Destination Checker
// @namespace    https://github.com/johno/url_destination_checker
// @version      0.1.0
// @description  Hover a shortener or YouTube link to see its destination URL and page title.
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @noframes
// ==/UserScript==
`;

function stripModuleSyntax(src) {
  // Remove import lines entirely.
  let out = src.replace(/^\s*import[^;]*;?\s*$/gm, "");
  // Strip leading `export ` from declarations.
  out = out.replace(/^\s*export\s+(const|let|var|function|class|async\s+function)/gm, "$1");
  return out;
}

function buildBody() {
  const parts = [];
  for (const rel of SOURCES) {
    const src = readFileSync(join(repoRoot, rel), "utf8");
    parts.push(`// ===== ${rel} =====`);
    parts.push(stripModuleSyntax(src));
  }
  return parts.join("\n\n");
}

const body = buildBody();
const out = `${HEADER}\n(function () {\n"use strict";\n\n${body}\n\n})();\n`;

const outPath = join(repoRoot, "url-destination-checker.user.js");
writeFileSync(outPath, out, "utf8");
console.log(`built ${outPath} (${out.length} bytes)`);
```

- [ ] **Step 2: Run the build**

Run: `just build`
Expected: prints `built /Users/johno/src/me/url_destination_checker/url-destination-checker.user.js (<some byte count>)` and creates the file.

- [ ] **Step 3: Sanity-check the built file**

Run: `head -20 url-destination-checker.user.js`
Expected: starts with `// ==UserScript==` header, then `(function ()`, then `// ===== src/config.js =====`.

Run: `wc -l url-destination-checker.user.js`
Expected: a few hundred lines, not empty.

Run: `node -e "const c=require('fs').readFileSync('url-destination-checker.user.js','utf8'); if(/^\\s*export\\s/m.test(c)) throw new Error('export survived strip'); if(/^\\s*import\\b/m.test(c)) throw new Error('import survived strip'); console.log('strip ok');"`
Expected: prints `strip ok`.

- [ ] **Step 4: Commit**

```bash
git add scripts/build.js
git commit -m "Add build script: concatenate src/ into userscript artifact"
```

---

## Task 12: README manual test checklist

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the placeholder section in `README.md`**

Replace the line `(Filled in by Task 12.)` in `README.md` with the following:

```markdown
Run through this list before each release. Each item should pass on a fresh Firefox profile with ViolentMonkey + uBlock Origin (advanced mode) installed.

### Hover dwell timing
- [ ] Hover a `bit.ly` link for less than 2 seconds → no tooltip appears, no network requests fire.
- [ ] Hover a `bit.ly` link for ≥2 seconds → tooltip appears within ~100ms after the dwell completes.
- [ ] Move cursor away during dwell → no fetch happens.

### Tooltip positioning
- [ ] Tooltip appears below-and-right of a link in the middle of the viewport.
- [ ] Tooltip appears above a link near the bottom of the viewport.
- [ ] Tooltip clamps to the right edge for a link near the right side.
- [ ] Tooltip stays positioned on `window.scroll` and `window.resize`.

### Dismiss
- [ ] Press Escape → tooltip closes.
- [ ] Click outside the tooltip → tooltip closes.
- [ ] Move the cursor off the link → tooltip closes after ~200ms grace.
- [ ] Move from link to tooltip diagonally → tooltip stays open.
- [ ] Hover a different qualifying link while tooltip is open → previous tooltip closes immediately and new dwell timer starts.

### Real network resolution
- [ ] A known live `bit.ly` link → resolves to expected destination + title.
- [ ] A known live `t.co` link → resolves to expected destination + title.
- [ ] `https://youtu.be/dQw4w9WgXcQ` → tooltip shows the song title; the URL stays as `youtu.be/...`.
- [ ] `https://www.youtube.com/shorts/<id>` (any current short) → tooltip shows the short's title.
- [ ] `https://www.youtube.com/watch?v=<id>` → tooltip shows the video title.
- [ ] A deleted/private YouTube video → tooltip shows "video unavailable".
- [ ] A shortener pointing to a 404 page → tooltip shows "(no title found)" or the error state.
- [ ] A non-UTF-8 destination page (e.g. a Shift_JIS Japanese site) → title displays without mojibake.
- [ ] A redirect chain longer than 3 hops → tooltip resolves to the final URL.

### Cache
- [ ] Hover a link a second time → no network activity, tooltip appears instantly.
- [ ] Restart Firefox, hover the same link → still cached (no network activity).

### Robustness
- [ ] Hovering links on a CSS-aggressive page (e.g. a site that sets `* { all: revert }`) → tooltip still renders correctly.
- [ ] Hovering links on youtube.com (same-origin) → YouTube links still classified, shorteners still classified.
- [ ] uBlock Origin advanced mode does not block the oEmbed call (whitelist if needed and document the rule here).

### Privacy
- [ ] Open Firefox devtools Network tab. Hover a `bit.ly` link past the dwell. Verify the recorded requests have no `Cookie` header and no `Referer` header.
- [ ] Verify `GM_xmlhttpRequest` requests in the ViolentMonkey log show `anonymous: true`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Document manual test checklist in README"
```

---

## Self-Review Notes

- **Spec coverage:** Every section of the design doc is implemented by at least one task. Classifier (Task 4), cache (Task 5), resolver YouTube + shortener (Tasks 6 & 7), tooltip (Task 8), hover (Task 9), config (Task 2), parsing (Task 3), main wiring (Task 10), build (Task 11), README + manual checklist (Task 12).
- **TDD coverage:** All pure-function modules (parsing, classifier, cache) are TDD with full test code inline. Resolver, tooltip, hover, main are not unit-tested per the spec's deliberate deviation, which John approved during brainstorming.
- **No placeholders:** Every code block contains real code. No "TBD" or "implement appropriate error handling" deferrals.
- **Type/name consistency:** `cache.get/set/touch/_flush/_size`, `tooltip.show/update/hide/isVisible/getElement`, `hover.attach/notifyTooltipMouseEnter/notifyTooltipMouseLeave`, `resolver.resolve` — these names appear consistently across the modules that consume them.
- **Build strip safety:** The build script's regex strips `^export ` from declaration starts and `^import ...;` lines. Task 11 Step 3 includes a sanity check that runs after the build to verify neither survives.
- **Privacy guarantees:** Resolver requests pass `anonymous: true`, no Referer header, and the manual checklist (Task 12) explicitly verifies this in devtools.
- **Safe DOM construction:** Task 8's tooltip uses `createElement` + `textContent` exclusively (no `innerHTML`), so even though all displayed strings come from controlled sources, there's structurally no XSS surface.
