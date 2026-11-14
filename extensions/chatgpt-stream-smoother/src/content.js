(() => {
  "use strict";

  if (window.top !== window || !globalThis.CFSSConfig || !globalThis.CFSSMotion) return;

  const api = typeof browser !== "undefined" ? browser : chrome;
  const { normalize, DEFAULTS } = globalThis.CFSSConfig;
  const { MotionEngine } = globalThis.CFSSMotion;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let settings = normalize(DEFAULTS);
  let scroller = null;
  let mover = null;
  let anchor = null;
  let observer = null;
  let oldTranslate = "";
  let motion = null;
  let applied = 0;
  let previousRawTop = null;
  let recentMutationAt = -Infinity;
  let suspendedUntil = 0;
  let lastFrameTime = 0;
  let scheduledFrame = 0;
  let route = location.href;

  function eligible(now) {
    if (!settings.enabled || document.hidden || now < suspendedUntil ||
        (settings.respectReducedMotion && reducedMotion.matches)) return false;
    return scroller !== null && distanceFromBottom(scroller) <= settings.bottomThresholdPx;
  }

  function distanceFromBottom(node) {
    // ChatGPT currently uses both ordinary and column-reverse containers.
    if (getComputedStyle(node).flexDirection === "column-reverse") {
      return Math.abs(node.scrollTop);
    }
    return Math.max(0, node.scrollHeight - node.clientHeight - node.scrollTop);
  }

  function latestAssistant() {
    const direct = document.querySelectorAll(
      'section[data-turn="assistant"], section[data-testid^="conversation-turn"][data-message-author-role="assistant"]');
    if (direct.length) return direct[direct.length - 1];
    const nested = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (nested.length) {
      const last = nested[nested.length - 1];
      return last.closest("section, article") || last;
    }
    return null;
  }

  function findScroller(node) {
    const preferred = node.closest("[data-app-action-timeline-scroll]");
    if (preferred && preferred.clientHeight > 0) return preferred;
    for (let parent = node.parentElement; parent && parent !== document.body;
         parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (/(auto|scroll)/.test(style.overflowY) && parent.clientHeight > 0 &&
          parent.scrollHeight > parent.clientHeight + 1) return parent;
    }
    // Fail closed rather than move the whole page, sidebar or composer.
    return null;
  }

  function findMover(node, scrollElement) {
    let candidate = node;
    while (candidate.parentElement && candidate.parentElement !== scrollElement) {
      candidate = candidate.parentElement;
    }
    if (candidate === scrollElement || candidate.parentElement !== scrollElement) return null;
    const composer = document.querySelector("#prompt-textarea");
    if (composer && candidate.contains(composer)) return null;
    if (candidate !== mover && candidate.style.translate) return null; // Never overwrite ChatGPT's own translation.
    return candidate;
  }

  function estimatedLineHeight(node) {
    if (settings.lineHeightPx > 0) return settings.lineHeightPx;
    const text = node.querySelector("p") || node;
    const style = getComputedStyle(text);
    const height = parseFloat(style.lineHeight);
    const font = parseFloat(style.fontSize);
    return Number.isFinite(height) && height >= 8 && height <= 90 ?
      height : (Number.isFinite(font) ? Math.min(90, font * 1.5) : 24);
  }

  function restoreTranslation() {
    if (mover) mover.style.translate = oldTranslate;
    applied = 0;
  }

  function applyTranslation(amount) {
    const next = amount > 0.25 ? Math.max(0, amount) : 0;
    if (!mover || Math.abs(next - applied) < 0.01) return;
    mover.style.translate = next ? "0px " + next.toFixed(3) + "px" : oldTranslate;
    applied = next;
  }

  function resetMotion() {
    if (motion) motion.clear();
    restoreTranslation();
    if (anchor && anchor.isConnected) previousRawTop = anchor.getBoundingClientRect().top;
    else previousRawTop = null;
    lastFrameTime = 0;
  }

  function detach() {
    if (observer) observer.disconnect();
    if (scroller) scroller.removeEventListener("scroll", onScroll);
    if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
    scheduledFrame = 0;
    resetMotion();
    observer = null;
    scroller = null;
    mover = null;
    anchor = null;
    motion = null;
    oldTranslate = "";
    previousRawTop = null;
  }

  function suspendForManualScroll() {
    if (!scroller) return;
    suspendedUntil = performance.now() + settings.suspendAfterScrollMs;
    resetMotion();
  }

  function onScroll() {
    const now = performance.now();
    // Native streaming scrolls are expected. A scroll unrelated to recent
    // streamed content is treated as navigation and immediately releases us.
    if (now - recentMutationAt > 500) suspendForManualScroll();
    else sampleGeometry(now);
  }

  function sampleGeometry(now) {
    if (!anchor || !anchor.isConnected || !mover || !motion) return;
    const rawTop = anchor.getBoundingClientRect().top - applied;
    if (previousRawTop === null) {
      previousRawTop = rawTop;
      return;
    }
    const displacement = previousRawTop - rawTop;
    previousRawTop = rawTop;
    if (!eligible(now)) {
      if (applied) resetMotion();
      return;
    }
    // Only compensate small upward movements associated with DOM streaming.
    // Large navigation, virtualization and layout changes must pass through.
    if (displacement > 0.6 && displacement < Math.max(250, motion.maxLagPx * 2) &&
        now - recentMutationAt < 650) {
      motion.feed(displacement);
      // MutationObserver runs before paint: cancel the hard step immediately.
      applyTranslation(motion.remaining);
    }
  }

  function scheduleFrame() {
    if (!scheduledFrame) scheduledFrame = requestAnimationFrame(frame);
  }

  function frame(now) {
    scheduledFrame = 0;
    sampleGeometry(now);
    if (!motion) return;
    if (eligible(now)) {
      const dt = lastFrameTime ? now - lastFrameTime : 16;
      applyTranslation(motion.advance(dt));
    } else if (applied) {
      resetMotion();
    }
    lastFrameTime = now;
    // Keep measuring briefly after a mutation to catch deferred native scrolling.
    if (motion.remaining > 0 || now - recentMutationAt < 700) scheduleFrame();
    else lastFrameTime = 0;
  }

  function onMutations(records) {
    if (!anchor || !anchor.isConnected) {
      refreshTarget();
      return;
    }
    const relevant = records.some((record) =>
      anchor.contains(record.target) ||
      (record.type === "childList" && Array.from(record.addedNodes).some((node) =>
        node.nodeType === 1 && node.contains(anchor))));
    if (!relevant) {
      if (records.some((record) => record.type === "childList")) refreshTarget();
      return;
    }
    const now = performance.now();
    recentMutationAt = now;
    sampleGeometry(now);
    scheduleFrame();
  }

  function refreshTarget() {
    if (!settings.enabled || (settings.respectReducedMotion && reducedMotion.matches)) {
      if (scroller) detach();
      return;
    }
    const last = latestAssistant();
    const nextScroller = last && findScroller(last);
    const nextMover = nextScroller && findMover(last, nextScroller);
    if (!last || !nextScroller || !nextMover) {
      if (scroller) detach();
      return;
    }
    if (scroller === nextScroller && mover === nextMover && anchor === last) return;
    detach();
    scroller = nextScroller;
    mover = nextMover;
    anchor = last;
    oldTranslate = mover.style.translate;
    motion = new MotionEngine(settings, estimatedLineHeight(anchor));
    previousRawTop = anchor.getBoundingClientRect().top;
    observer = new MutationObserver(onMutations);
    observer.observe(scroller, { subtree: true, childList: true, characterData: true });
    scroller.addEventListener("scroll", onScroll, { passive: true });
  }

  function manualInput(event) {
    if (scroller && (scroller === event.target || scroller.contains(event.target))) {
      suspendForManualScroll();
    }
  }

  document.addEventListener("wheel", manualInput, { capture: true, passive: true });
  document.addEventListener("touchstart", manualInput, { capture: true, passive: true });
  document.addEventListener("pointerdown", (event) => {
    if (event.target === scroller) suspendForManualScroll();
  }, true);
  document.addEventListener("keydown", (event) => {
    const key = event.key;
    if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(key)) return;
    const target = event.target;
    if (target && target.closest("input, textarea, select, [contenteditable=true], [role=textbox]")) return;
    suspendForManualScroll();
  }, true);

  function onSettingsChange(next) {
    settings = normalize(next);
    detach();
    refreshTarget();
  }

  api.storage.local.get(DEFAULTS).then(onSettingsChange).catch(() => {});
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !Object.keys(changes).some((key) => key in DEFAULTS)) return;
    api.storage.local.get(DEFAULTS).then(onSettingsChange).catch(() => {});
  });
  if (reducedMotion.addEventListener) {
    reducedMotion.addEventListener("change", () => {
      detach();
      refreshTarget();
    });
  }

  window.addEventListener("resize", resetMotion, { passive: true });
  window.addEventListener("pagehide", detach);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) resetMotion();
  });

  // ChatGPT navigates via its SPA router; do not retain stale observers/transforms.
  setInterval(() => {
    if (location.href !== route) {
      route = location.href;
      detach();
    }
    refreshTarget();
  }, 900);
})();
