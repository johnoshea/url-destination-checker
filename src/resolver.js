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
