/* Pure detection/state logic, shared between the Firefox content script and tests.
 * No dependency on page scripts, message content, network calls or OpenAI APIs.
 */
(function (global) {
  "use strict";

  const PREFIX = Object.freeze({
    idle: "",
    working: "⏳ ",
    done: "✓ ",
    stopped: "■ ",
    error: "! "
  });

  const DEFAULTS = Object.freeze({
    titleIndicator: true,
    faviconIndicator: true,
    toolbarBadge: true,
    latchUntilVisited: true
  });

  // Verified icon-only Stop control observed in an October 2026 ChatGPT build:
  // restrict the square glyph to the composer rather than matching arbitrary SVGs.
  const STOP_GLYPH_PATH = "M4.5 5.75C4.5 5.05964 5.05964 4.5 5.75 4.5H14.25C14.9404 4.5 15.5 5.05964 15.5 5.75V14.25C15.5 14.9404 14.9404 15.5 14.25 15.5H5.75C5.05964 15.5 4.5 14.9404 4.5 14.25V5.75Z";

  const STOP_SELECTOR = [
    'button[data-testid="stop-button"]',
    'button[data-testid="composer-stop-button"]',
    'button[id="composer-stop-button"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop response"]',
    'button[aria-label="Stop thinking"]',
    `form[data-chatgpt-composer] button[type="button"].size-token-button-composer:has(svg.icon-primary-action > path[d="${STOP_GLYPH_PATH}"])`
  ].join(", ");

  const ERROR_PATTERN = /(?:something went wrong|network error|connection lost|response failed|generation failed|failed to (?:generate|respond|send)|error generating|an error occurred|rate limit exceeded|request timed out)/i;

  function visible(element) {
    if (!element || !element.isConnected || element.hidden) return false;
    if (element.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
    const view = element.ownerDocument.defaultView;
    if (view && typeof view.getComputedStyle === "function") {
      const css = view.getComputedStyle(element);
      if (css.display === "none" || css.visibility === "hidden" || css.visibility === "collapse") return false;
    }
    if (typeof element.getClientRects === "function" && !element.getClientRects().length) return false;
    return true;
  }

  function isStopButton(button) {
    if (!button || button.localName !== "button" || !visible(button)) return false;
    if (button.matches(STOP_SELECTOR)) return true;
    const label = (button.getAttribute("aria-label") || button.getAttribute("title") || "").trim();
    // Avoid matching a Stop button in unrelated UI (e.g. voice playback or a modal).
    if (!/^stop(?: (?:generating|streaming|response|thinking|responding))?$/i.test(label)) return false;
    return !!button.closest('form, [data-testid*="composer"], #thread-bottom, [class*="composer"]');
  }

  function inspect(document) {
    if (!document || !document.body) return { stopVisible: false, errorVisible: false };
    const known = Array.from(document.querySelectorAll(STOP_SELECTOR));
    let stopVisible = known.some(isStopButton);
    if (!stopVisible) {
      const buttons = document.querySelectorAll("button[aria-label], button[title]");
      stopVisible = Array.from(buttons).some(isStopButton);
    }
    // Error classification requires an explicit visible failure message. A generic
    // Retry/Regenerate button is not enough: normal completed chats have them too.
    let errorVisible = false;
    const alerts = document.querySelectorAll('[role="alert"], [data-testid*="error"], [class*="error-message"]');
    for (const el of alerts) {
      if (visible(el) && ERROR_PATTERN.test((el.textContent || "").slice(0, 350))) {
        errorVisible = true;
        break;
      }
    }
    return { stopVisible, errorVisible };
  }

  class StateMachine {
    constructor() {
      this.phase = "idle";
      this.stopRequested = false;
      this.lastTransitionAt = 0;
    }

    observe(signal, now = Date.now()) {
      const before = this.phase;
      if (signal.stopVisible) {
        if (this.phase !== "working") {
          this.phase = "working";
          this.stopRequested = false;
        }
      } else if (this.phase === "working") {
        this.phase = this.stopRequested ? "stopped" : signal.errorVisible ? "error" : "done";
        this.stopRequested = false;
      } else if (this.phase === "done" && signal.errorVisible && now - this.lastTransitionAt < 4000) {
        // Error alerts may appear one or two DOM mutations after Stop disappears.
        this.phase = "error";
      }
      if (this.phase !== before) this.lastTransitionAt = now;
      return this.phase !== before;
    }

    markStopRequested() {
      if (this.phase === "working") this.stopRequested = true;
    }

    reset(now = Date.now()) {
      if (this.phase === "idle") return false;
      this.phase = "idle";
      this.stopRequested = false;
      this.lastTransitionAt = now;
      return true;
    }
  }

  const api = Object.freeze({ PREFIX, DEFAULTS, STOP_SELECTOR, STOP_GLYPH_PATH, visible, isStopButton, inspect, StateMachine });
  global.ChatGPTTabSignalCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
