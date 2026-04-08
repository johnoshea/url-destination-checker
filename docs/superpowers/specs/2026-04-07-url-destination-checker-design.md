# URL Destination Checker — Design

**Date:** 2026-04-07
**Status:** Approved for implementation planning
**Format:** ViolentMonkey userscript for Firefox

## Purpose

When hovering a URL on any web page, reveal the *real* destination and page title for link-shortener URLs (bit.ly, t.co, etc.) and YouTube links — without navigating to them and while leaking the minimum possible information to the destination servers.

The user runs Firefox on macOS with uBlock Origin in advanced mode, blocks egregious external content by default, and wants this primarily as a privacy- and trust-preserving tool when reading link-heavy pages.

## Scope

**In scope:**
- Hardcoded shortener allowlist (bit.ly, t.co, tinyurl.com, buff.ly, ow.ly, goo.gl, lnkd.in, is.gd, shorturl.at, rebrand.ly, cutt.ly, tiny.cc, trib.al, dlvr.it). Editable as a top-of-file constant.
- All YouTube link forms: `youtu.be/<id>`, `youtube.com/watch?v=<id>`, `youtube.com/shorts/<id>`, `youtube.com/live/<id>`, `youtube.com/embed/<id>`, plus `m.youtube.com` and `music.youtube.com` variants.
- Hover-dwell trigger (default 2 seconds, configurable).
- Single floating tooltip with destination URL (clickable, native browser link semantics) and page title.
- Persistent global cache via `GM_setValue`, 7-day TTL, 1000-entry LRU cap.
- Dismiss on Escape, click-outside, or cursor leaving link+tooltip area.

**Out of scope (v1):**
- Decoration of non-shortener, non-YouTube links.
- Vimeo, Twitch, or other platform-specific title fetchers.
- Headless browser e2e tests.
- Settings UI — all configuration is by editing constants at the top of the script.

## High-Level Architecture

Single ViolentMonkey userscript (`url-destination-checker.user.js`) matching `*://*/*`. Built by concatenating modules from `src/` into the userscript header block via a `just build` task — no bundler, no transpiler. Modules in `src/` can be unit-tested with `node:test` against mocked `GM_*` globals.

Five logical components:

1. **Link classifier** — pure function. Given an `<a href>`, returns `{kind: "shortener" | "youtube" | "ignore", videoId?: string}`.
2. **Resolver** — only network-touching component. Two strategies: YouTube oEmbed for YouTube links, manual redirect-chain HEAD requests + ranged GET title scrape for shorteners.
3. **Cache** — `GM_setValue`-backed, in-memory `Map` working layer with debounced persistence. TTL + LRU eviction.
4. **Hover controller** — delegated `mouseover`/`mouseout` listeners on `document`, manages dwell timer and link↔tooltip handoff with grace period.
5. **Tooltip** — single reused DOM element, `position: fixed`, layout-neutral, defended against page CSS bleed.

Data flow on hover:
```
mouseover → classify → start 2s dwell timer
  → timer fires → cache.get(url)
       → hit:  tooltip.show(link, data)
       → miss: tooltip.show(link, {loading: true})
               → resolver.resolve(url)
                   → success: cache.set + tooltip.update(data)
                   → failure: tooltip.update({error: true, message})
```

## Component: Link Classifier

Pure function, no I/O, easily unit-tested.

**Shortener allowlist** (constant `SHORTENER_HOSTS`):
```
bit.ly, t.co, tinyurl.com, buff.ly, ow.ly, goo.gl, lnkd.in,
is.gd, shorturl.at, rebrand.ly, cutt.ly, tiny.cc, trib.al, dlvr.it
```

**YouTube patterns** (matched against URL hostname + path):
- `youtu.be/<id>` — videoId is the path
- `(www|m|music).youtube.com/watch?v=<id>` — videoId from `v` query param
- `(www|m).youtube.com/shorts/<id>` — videoId from path
- `(www|m).youtube.com/live/<id>` — videoId from path
- `(www|m).youtube.com/embed/<id>` — videoId from path

Video IDs validated against `[A-Za-z0-9_-]{11}` before being trusted.

**Returns `"ignore"` for:**
- Missing/empty href, or `javascript:`, `mailto:`, `tel:`, `#`-prefixed.
- Same-origin shortener links (you don't need to resolve a `bit.ly` link from within `bit.ly`).
- YouTube links are **always** classified, regardless of current origin (so hovering a `youtu.be` link from within `youtube.com` still works).
- Hostnames not in the shortener allowlist and not matching any YouTube pattern.

## Component: Resolver

Only component that touches the network. All requests via `GM_xmlhttpRequest` with `anonymous: true` (strips cookies) and no `Referer` header. IP and User-Agent still leak — this is acknowledged as unavoidable without a proxy.

### Strategy A — YouTube (oEmbed)

For any YouTube-classified link:

1. Build canonical inner URL: `https://www.youtube.com/watch?v=<videoId>` regardless of how the original link appeared (shorts, embed, youtu.be, etc.).
2. Build oEmbed URL: `https://www.youtube.com/oembed?url=<canonical>&format=json`.
3. Issue:
   ```
   method: "GET"
   url: <oembed url>
   anonymous: true
   headers: { "Accept": "application/json" }
   timeout: OEMBED_TIMEOUT_MS (5000)
   ```
4. Parse JSON response. Return:
   ```
   {
     finalUrl: <original href as it appeared on the page>,
     title:    response.title
   }
   ```

The `finalUrl` returned for display is the **original** href the user hovered, not the canonical watch URL. The canonical form is used only internally to talk to oEmbed. This preserves the link as it appeared on the page when the user clicks through from the tooltip.

### Strategy B — Shorteners

**Step 1: Manual redirect chain (HEAD).**

Loop, capped at `MAX_REDIRECT_HOPS` (10):
```
method: "HEAD"
url: <current url>
anonymous: true
redirect: "manual"
headers: { }
timeout: HEAD_TIMEOUT_MS (5000)
```

If response is 3xx and has a `Location` header → recurse with the new URL.
If response is 2xx (or any non-3xx) → current URL is the final destination.
If response has no `Location` despite being 3xx → treat current URL as final.
If hop cap exceeded → use the last URL reached, log a warning, proceed.

**Step 2: Ranged GET title scrape.**

```
method: "GET"
url: <final url>
anonymous: true
headers: { "Range": "bytes=0-16383", "Accept": "text/html" }
timeout: GET_TIMEOUT_MS (8000)
```

Servers honoring `Range` return 206 with the slice; servers ignoring it return the full body, but we abort the connection as soon as our handler sees `</title>` or processes 16KB.

**Title parsing:**
- Regex: `/<title[^>]*>([\s\S]*?)<\/title>/i`
- Decode HTML entities via small lookup table: `&amp; &lt; &gt; &quot; &#39; &#x27;` plus numeric `&#NNN;` and `&#xHH;`.
- Trim and collapse internal whitespace.

**Encoding handling:**
- Inspect `Content-Type` response header for `charset=`.
- If present and not UTF-8, decode body bytes with `TextDecoder(charset)`.
- If absent or unrecognized, assume UTF-8.
- Won't catch sites that declare charset only via `<meta>` — accepted limitation.

**Returns:** `{finalUrl, title}` where `title` may be `null` if no `<title>` tag was found.

### Aborting

Each call returns an object with an `.abort()` method that cancels the underlying `GM_xmlhttpRequest` (and any in-flight redirect-chain hop). The hover controller stores this and calls it when the tooltip closes mid-fetch.

## Component: Cache

**Storage key:** `"udc.cache.v1"` — single `GM_setValue` blob containing the entire cache as JSON.

**Schema:**
```json
{
  "schemaVersion": 1,
  "entries": {
    "<original-url>": {
      "finalUrl": "...",
      "title": "..." | null,
      "fetchedAt": <epoch ms>,
      "lastUsedAt": <epoch ms>
    }
  }
}
```

Keyed by **original URL** (the href as it appeared on the page), not the resolved URL. This means the same destination reached via two different shorteners is cached twice — intentional, keeps the lookup path simple.

**Working layer:** On script load, parse the blob from `GM_getValue` once into a JS `Map`. All hot-path reads/writes go against the in-memory `Map`. Persist back to `GM_setValue` on a debounced write (`CACHE_PERSIST_DEBOUNCE_MS`, default 2000ms after the last mutation), and unconditionally on `pagehide`.

**TTL:** `CACHE_TTL_MS` (7 days). On `get()`, if `now - fetchedAt > TTL`, treat as miss and return `null`. No background pruning — expired entries are overwritten on next fetch or evicted by LRU pressure.

**LRU eviction:** On `set()`, if the entries count would exceed `CACHE_MAX_ENTRIES` (1000), sort by `lastUsedAt` ascending and evict the oldest `CACHE_EVICT_BATCH` (50). Batched eviction avoids re-sorting on every write.

**Resilience:** If the cache JSON fails to parse on load, wipe and start fresh. If `GM_setValue` persist fails, log a warning and continue with in-memory-only cache for the session.

**Public API (the only surface the rest of the code uses):**
```
cache.get(url) → entry | null    // null if missing or expired
cache.set(url, {finalUrl, title})
cache.touch(url)                 // bumps lastUsedAt without changing data
```

All async to handle ViolentMonkey's Promise-based `GM_*` API.

## Component: Hover Controller

**Listeners:** Two delegated, passive listeners on `document`:
- `mouseover` — finds `event.target.closest("a[href]")`, classifies, starts dwell timer for qualifying links.
- `mouseout` — cancels dwell timer when cursor leaves the link (with `relatedTarget` check to avoid cancellation when crossing into a child element of the same link).

**State:**
```
hoverState = {
  link: <Element> | null,
  dwellTimer: <id> | null,
  inflightAbort: () => void,
}
```

**Transitions:**

1. **mouseover on qualifying link:**
   - If `hoverState.link === thisLink`: ignore (re-entry from child bubble).
   - Otherwise: cancel any existing dwell timer, set `hoverState.link = thisLink`, start `setTimeout(DWELL_MS, fire)`.

2. **mouseout on link:**
   - If `event.target.closest("a") === hoverState.link` AND `event.relatedTarget` is not inside that same link: cancel dwell timer, clear `hoverState.link`.

3. **fire (dwell timer elapses):**
   - Call `cache.get(url)`.
   - Hit → `tooltip.show(link, data)` immediately.
   - Miss → `tooltip.show(link, {loading: true})`; kick off resolver; on success → `cache.set` + `tooltip.update(data)`; on failure → `tooltip.update({error: true, message})`.
   - Store the resolver's abort function in `hoverState.inflightAbort`.

**Link↔tooltip handoff:**

The tooltip has its own `mouseenter`/`mouseleave` listeners. The controller tracks `cursorOnLink` and `cursorOnTooltip`. When **both** become false, start a `GRACE_MS` (200ms) timer; if either becomes true again before it fires, cancel the timer. If the timer fires, close the tooltip. This handles diagonal traversal between link and tooltip without flicker.

**New-link override:** If a different qualifying link is hovered while a tooltip is open, close the current tooltip immediately (no grace), abort any in-flight fetch, start a fresh dwell timer on the new link.

## Component: Tooltip

**Single element, reused.** On script load, create `<div id="udc-tooltip">` and append to `document.body`. Hidden by default (`display: none`). Show/hide toggles visibility and rewrites contents — never create a second one. This structurally enforces "only one tooltip onscreen ever."

**Layout-neutral:** `position: fixed` (out of document flow, cannot reflow page), `z-index: 2147483647`.

**Styling:** Injected once via `GM_addStyle`. All rules scoped to `#udc-tooltip` and descendants. Root uses `all: initial` then re-sets the wanted properties to defend against page CSS bleed-in. Visual: small rounded box, dark background, light text, ~320px max-width, padding, subtle shadow.

**Contents (two lines):**
1. Page title (or "Loading…" / "(no title found)" / error message depending on state).
2. Destination URL as a clickable `<a href={finalUrl}>` with `rel="noopener noreferrer"`. Native browser link behavior handles left-click, cmd-click, middle-click correctly with no additional JS. Long URLs are CSS-truncated with ellipsis; full URL available via the anchor's native `title` attribute on hover.

**Render states** (single `render(data)` entry point):
- `{loading: true}` → "Loading…" (no animation, just text).
- `{finalUrl, title}` → title + clickable link. If `title === null`, show "(no title found)" muted.
- `{error: true, message}` → "Could not resolve link" + muted error detail.

**Positioning:** On show, read `link.getBoundingClientRect()`. Default: just below-and-right of the link. If that overflows the right edge, shift left to fit. If it overflows the bottom, place above the link. Recompute on `window.resize` and `window.scroll` while open, throttled to `requestAnimationFrame`.

**Dismiss handlers** (attached on show, removed on hide):
- `keydown` on `document` → close on Escape.
- `click` on `document` (capture phase) → close on any click outside the tooltip.
- The grace-period mouse handlers from the hover controller.

**Known caveat:** uBlock Origin advanced mode occasionally interacts oddly with injected elements. If issues arise during testing, fall back to attaching to `document.documentElement` or using a Shadow DOM root for full style isolation. Not designing for this preemptively.

## Configuration Constants

All at the top of the userscript, easy to edit:

```
DWELL_MS                  = 2000
GRACE_MS                  = 200
CACHE_TTL_MS              = 7 * 24 * 60 * 60 * 1000   // 7 days
CACHE_MAX_ENTRIES         = 1000
CACHE_EVICT_BATCH         = 50
CACHE_PERSIST_DEBOUNCE_MS = 2000
HEAD_TIMEOUT_MS           = 5000
GET_TIMEOUT_MS            = 8000
OEMBED_TIMEOUT_MS         = 5000
MAX_REDIRECT_HOPS         = 10
TITLE_SCRAPE_BYTES        = 16384
DEBUG                     = false
SHORTENER_HOSTS           = [...]
```

## Error Handling

Every failure mode produces *some* tooltip state — never silent. Console messages prefixed `[udc]`.

| Failure | Behavior |
|---|---|
| Network error / timeout on HEAD | Tooltip: "Could not resolve link" + reason |
| Redirect chain exceeds `MAX_REDIRECT_HOPS` | Use last URL reached, console warn, proceed to title scrape |
| Final URL non-2xx on title GET | Show finalUrl + title="(unavailable)" |
| Title regex finds nothing in 16KB | Show finalUrl + "(no title found)" |
| oEmbed non-200 (deleted/private video) | Show YouTube URL + "(video unavailable)" |
| oEmbed malformed JSON | Show YouTube URL + "(could not load title)" |
| `GM_xmlhttpRequest` throws | Tooltip: "Could not resolve link" + error |
| Cache JSON parse fails on load | Wipe and start fresh |
| `GM_setValue` persist fails | Console warn, continue in-memory only |

## Logging

Per user's global preferences (log at I/O boundaries, structured-ish):
- **DEBUG** (gated on `DEBUG` constant, off by default): every classify, every cache hit/miss, every fetch start/end with timing.
- **WARN**: timeouts, max-hops exceeded, persist failures.
- **ERROR**: unexpected exceptions in event handlers.

## Privacy Posture

- All cross-origin requests use `GM_xmlhttpRequest` with `anonymous: true` (no cookies).
- No `Referer` header sent.
- IP address and User-Agent **do** leak — unavoidable without a proxy. Acknowledged.
- Cache persists hovered URLs to ViolentMonkey's storage on disk (not transmitted anywhere). User accepted this.
- No requests fire until the dwell timer elapses — i.e. no hover < 2s causes any network activity.
- Same-origin shortener links are not classified, eliminating one trivial leak vector (e.g. you on bit.ly hovering bit.ly links).

## Testing Strategy

**Pure-function unit tests** (TDD, written first) for:
- Link classifier (all shortener variants, all YouTube URL forms, ignore cases).
- YouTube video ID extraction and validation.
- HTML entity decoder (named + numeric).
- Title regex (well-formed, weird whitespace, attributes on `<title>`, missing).
- Cache eviction logic (LRU order, batch size, TTL expiry).
- Encoding detection from `Content-Type`.

Run via `node:test` (built-in, no deps). `GM_*` globals mocked. These cover the highest-bug-risk surface.

**Manual test checklist** (documented in README, run before each release):
- Hover dwell timing feels right at 2s.
- Tooltip positioning at all four viewport edges.
- Dismiss on Escape, click-outside, cursor-away with grace.
- Real network resolution for: a known bit.ly, a known t.co, a `youtu.be/<id>`, a `youtube.com/shorts/<id>`, a `youtube.com/watch?v=<id>`, a deleted YouTube video, a 404 destination, a non-UTF-8 page, a redirect chain longer than 3 hops.
- Cache hit on second hover (no network activity).
- Cache persistence across browser restart.
- Tooltip rendering on a CSS-aggressive page (e.g. one that sets `* { all: revert }` or similar).
- uBlock Origin advanced mode does not break the tooltip.

**No e2e/headless tests in v1.** Wiring up headless Firefox + ViolentMonkey is more infrastructure than this project warrants.

This is a deliberate deviation from "TDD for every feature" — the DOM and network glue are tested manually rather than in code. Approved by John during brainstorming.

## Repository Structure

```
url_destination_checker/
  url-destination-checker.user.js   # the shipped userscript (built artifact)
  src/
    classifier.js                   # link classifier (pure)
    cache.js                        # cache wrapper around GM_setValue
    resolver.js                     # YouTube oEmbed + shortener resolution
    parsing.js                      # title regex, entity decoder, encoding helpers
    hover.js                        # hover controller + state machine
    tooltip.js                      # tooltip element, render, dismiss
    config.js                       # all top-of-file constants
    main.js                         # wires everything together, entry point
  test/
    classifier.test.js
    cache.test.js
    parsing.test.js
  docs/superpowers/specs/
    2026-04-07-url-destination-checker-design.md  # this file
  README.md                         # install + manual test checklist
  justfile                          # test, lint, build
```

**Build step:** `just build` concatenates `src/*.js` (in dependency order, with `main.js` last) into the body of `url-destination-checker.user.js`, prefixed with the `// ==UserScript==` metadata block declaring the `@grant`s (`GM_xmlhttpRequest`, `GM_getValue`, `GM_setValue`, `GM_addStyle`), match pattern (`*://*/*`), and run-at (`document-idle`). No bundler, no transpiler — modern Firefox runs ES2022 fine.

This lets the testable modules and the shipped script stay in sync (the shipped script is generated from the tested sources) while still producing a single drop-in `.user.js` file installable via ViolentMonkey's "install from file."
