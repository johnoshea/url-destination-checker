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
