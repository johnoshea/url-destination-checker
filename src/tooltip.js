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

  function setUrl(href) {
    // Defense in depth: only http(s) URLs are linkable. Anything else
    // (javascript:, data:, etc.) is shown as plain text.
    if (typeof href === "string" && /^https?:\/\//i.test(href)) {
      urlEl.href = href;
    } else {
      urlEl.removeAttribute("href");
    }
    urlEl.textContent = href;
  }

  function render(data) {
    titleEl.classList.remove("udc-muted", "udc-error");
    if (data.loading) {
      titleEl.textContent = "Loading\u2026";
      titleEl.classList.add("udc-muted");
      urlEl.style.display = "none";
      return;
    }
    if (data.error) {
      titleEl.textContent = data.message || "Could not resolve link";
      titleEl.classList.add("udc-error");
      if (data.finalUrl) {
        urlEl.style.display = "block";
        setUrl(data.finalUrl);
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
    setUrl(data.finalUrl);
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
    if (positionRafId) {
      cancelAnimationFrame(positionRafId);
      positionRafId = null;
    }
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
