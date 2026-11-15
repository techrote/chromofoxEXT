/* ChatGPT Tab Signal · Firefox content script · deliberately local-only. */
(() => {
  "use strict";
  const core = globalThis.ChatGPTTabSignalCore;
  if (!core || !document.documentElement) return;

  const machine = new core.StateMachine();
  let options = { ...core.DEFAULTS };
  let currentRoute = location.pathname + location.search + location.hash;
  let baseTitle = document.title || "ChatGPT";
  let lastWrittenTitle = null;
  let inspectTimer = null;
  let focusClearTimer = null;
  let autoClearTimer = null;
  let lastMessage = "";
  const originalIcons = new Map();
  let injectedIcon = null;

  const ICONS = Object.freeze({
    working: browser.runtime.getURL("icons/working64.png"),
    done: browser.runtime.getURL("icons/done64.png"),
    stopped: browser.runtime.getURL("icons/stopped64.png"),
    error: browser.runtime.getURL("icons/error64.png")
  });
  const OUR_ICON_URLS = new Set(Object.values(ICONS));

  function isIcon(link) {
    return link.localName === "link" && (link.getAttribute("rel") || "").toLowerCase().split(/\s+/).includes("icon");
  }

  function iconLinks() {
    return Array.from(document.head ? document.head.querySelectorAll('link[rel~="icon"]') : []);
  }

  function snapshotIcon(link) {
    return {
      href: link.getAttribute("href"),
      type: link.getAttribute("type"),
      sizes: link.getAttribute("sizes")
    };
  }

  function restoreAttr(element, name, value) {
    if (value == null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }

  function restoreIcons() {
    if (injectedIcon) {
      injectedIcon.remove();
      injectedIcon = null;
    }
    for (const [link, entry] of originalIcons) {
      if (link.isConnected && OUR_ICON_URLS.has(link.getAttribute("href"))) {
        restoreAttr(link, "href", entry.original.href);
        restoreAttr(link, "type", entry.original.type);
        restoreAttr(link, "sizes", entry.original.sizes);
      }
    }
    originalIcons.clear();
  }

  function syncFavicon() {
    const url = options.faviconIndicator && machine.phase !== "idle" ? ICONS[machine.phase] : null;
    if (!url) {
      if (originalIcons.size || injectedIcon) restoreIcons();
      return;
    }
    const links = iconLinks().filter(link => link !== injectedIcon);
    for (const [link] of originalIcons) {
      if (!link.isConnected || !isIcon(link)) originalIcons.delete(link);
    }
    if (links.length) {
      if (injectedIcon) {
        injectedIcon.remove();
        injectedIcon = null;
      }
      for (const link of links) {
        let entry = originalIcons.get(link);
        if (!entry) {
          entry = { original: snapshotIcon(link) };
          originalIcons.set(link, entry);
        } else if (!OUR_ICON_URLS.has(link.getAttribute("href"))) {
          // Host page changed its favicon while we were active. Preserve that
          // update, so an idle transition restores the *new* original.
          entry.original = snapshotIcon(link);
        }
        if (link.getAttribute("href") !== url) link.setAttribute("href", url);
        if (link.getAttribute("type") !== "image/png") link.setAttribute("type", "image/png");
        if (link.hasAttribute("sizes")) link.removeAttribute("sizes");
      }
    } else if (!injectedIcon && document.head) {
      injectedIcon = document.createElement("link");
      injectedIcon.rel = "icon";
      injectedIcon.type = "image/png";
      injectedIcon.href = url;
      document.head.appendChild(injectedIcon);
    } else if (injectedIcon && injectedIcon.href !== url) {
      injectedIcon.href = url;
    }
  }

  function syncTitle() {
    const observed = document.title;
    if (observed && observed !== lastWrittenTitle) baseTitle = observed;
    const wanted = options.titleIndicator ? core.PREFIX[machine.phase] + baseTitle : baseTitle;
    if (observed !== wanted) document.title = wanted;
    lastWrittenTitle = wanted;
  }

  function sendStatus() {
    const message = {
      kind: "chatgpt-tab-signal/status",
      phase: machine.phase,
      toolbarBadge: options.toolbarBadge
    };
    const key = JSON.stringify(message);
    if (key === lastMessage) return;
    lastMessage = key;
    browser.runtime.sendMessage(message).catch(() => {
      // Extension reload/unload while a page stays open; don't affect ChatGPT.
    });
  }

  function applyPresentation() {
    syncTitle();
    syncFavicon();
    sendStatus();
  }

  function clearState() {
    if (machine.reset()) applyPresentation();
  }

  function maybeScheduleClear() {
    clearTimeout(autoClearTimer);
    autoClearTimer = null;
    if (!options.latchUntilVisited && machine.phase !== "working" && machine.phase !== "idle") {
      autoClearTimer = setTimeout(clearState, 6000);
    }
  }

  function inspectPage() {
    inspectTimer = null;
    const route = location.pathname + location.search + location.hash;
    if (route !== currentRoute) {
      currentRoute = route;
      clearTimeout(focusClearTimer);
      clearTimeout(autoClearTimer);
      machine.reset();
    }
    const changed = machine.observe(core.inspect(document));
    if (changed) maybeScheduleClear();
    applyPresentation();
  }

  function scheduleInspect() {
    if (inspectTimer !== null) return;
    inspectTimer = setTimeout(inspectPage, 110);
  }

  function onVisit() {
    clearTimeout(focusClearTimer);
    if (document.visibilityState === "visible" && machine.phase !== "idle" && machine.phase !== "working") {
      if (options.latchUntilVisited) {
        // Keep the status visible long enough to read the tab label on return.
        focusClearTimer = setTimeout(() => {
          if (document.visibilityState === "visible" && document.hasFocus()) clearState();
        }, 2500);
      }
    }
    scheduleInspect();
  }

  function onUserInput(event) {
    const button = event.target.closest && event.target.closest("button");
    if (button && core.isStopButton(button)) {
      machine.markStopRequested();
      scheduleInspect();
    } else if (machine.phase !== "working" && machine.phase !== "idle" && document.visibilityState === "visible") {
      // Acknowledged a finished conversation by interacting with the page.
      if (event.isTrusted) clearState();
    }
  }

  function onTitleOrIconMutation(mutations) {
    let needsSync = false;
    for (const mutation of mutations) {
      const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
      if ((target && target.closest("title")) ||
          (target && target.closest('link[rel~="icon"]')) ||
          Array.from(mutation.addedNodes).some(node => node.nodeType === Node.ELEMENT_NODE &&
            (node.localName === "title" || isIcon(node)))) {
        needsSync = true;
        break;
      }
    }
    if (needsSync) scheduleInspect();
  }

  // Watch UI changes, without polling on every animation frame or reading chats.
  const bodyObserver = new MutationObserver(scheduleInspect);
  if (document.body) {
    bodyObserver.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["aria-label", "data-testid", "disabled", "hidden", "style", "class"]
    });
  }

  const headObserver = new MutationObserver(onTitleOrIconMutation);
  if (document.head) {
    headObserver.observe(document.head, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ["href", "rel", "type", "sizes"]
    });
  }

  // Capture before ChatGPT handles Stop. No interference with native click events.
  document.addEventListener("click", onUserInput, true);
  document.addEventListener("keydown", event => {
    if (event.isTrusted && machine.phase !== "working" && machine.phase !== "idle") clearState();
  }, true);
  document.addEventListener("visibilitychange", onVisit);
  window.addEventListener("focus", onVisit);
  window.addEventListener("popstate", scheduleInspect);
  window.addEventListener("hashchange", scheduleInspect);

  // Some SPA navigations don't mutate a watched UI node. Check infrequently.
  setInterval(() => {
    if (location.pathname + location.search + location.hash !== currentRoute) scheduleInspect();
  }, 2000);

  browser.runtime.onMessage.addListener(message => {
    if (!message || message.kind !== "chatgpt-tab-signal/query") return;
    if (message.action === "clear") {
      if (machine.phase === "working") return Promise.resolve({ phase: "working", cleared: false });
      clearState();
      return Promise.resolve({ phase: machine.phase, cleared: true });
    }
    return Promise.resolve({ phase: machine.phase });
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const name of Object.keys(core.DEFAULTS)) {
      if (changes[name]) options[name] = !!changes[name].newValue;
    }
    maybeScheduleClear();
    applyPresentation();
  });

  browser.storage.local.get(core.DEFAULTS).then(saved => {
    options = { ...core.DEFAULTS, ...saved };
    inspectPage();
  }).catch(() => inspectPage());
})();
