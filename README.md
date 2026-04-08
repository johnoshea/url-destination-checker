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
