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
