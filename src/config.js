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
