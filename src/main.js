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
    onClose: () => hoverRef && hoverRef.notifyTooltipClosed(),
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
