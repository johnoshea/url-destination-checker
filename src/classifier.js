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
