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
