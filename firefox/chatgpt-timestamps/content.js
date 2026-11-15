/* ChatGPT Message Timestamps: DOM-only observation, no remote requests. */
(() => {
  "use strict";
  if (globalThis.__CGPTTimestampStarted) return;
  globalThis.__CGPTTimestampStarted = true;

  const C = globalThis.CGPTTimestamp;
  const storage = browser.storage.local;
  const TURN_SELECTOR = 'main article[data-turn-id], main article[data-testid^="conversation-turn"], main [data-message-author-role][data-message-id]';
  const SEND_SELECTOR = [
    'button[data-testid="send-button"]',
    'button[data-testid="composer-send-button"]',
    'button#composer-submit-button',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Send"]'
  ].join(',');
  const REPLY_SELECTOR = [
    'button[data-testid="regenerate-button"]',
    'button[aria-label*="Regenerate"]',
    'button[aria-label*="Retry"]',
    'button[aria-label*="Try again"]'
  ].join(',');

  let settings = C.normalSettings();
  const records = new Map();
  const writes = new Map();
  let writeTimer = null;
  let observer = null;
  let scanTimer = null;
  let scanning = false;
  let rescan = false;
  let activeConversation = C.conversationId(location.pathname);
  let seen = new Set();
  let states = new WeakMap();
  let ready = false;
  let pendingSends = [];
  let lastIntentAt = 0;
  let replyUntil = 0;
  let replyConversation = activeConversation;
  let navigationPauseUntil = 0;

  function isInComposer(node) {
    const el = node instanceof Element ? node : node?.parentElement;
    if (!el) return false;
    return Boolean(el.closest('#prompt-textarea, [data-testid="composer-input"], [data-testid="composer-textarea"]'));
  }

  function addSendIntent() {
    const now = Date.now();
    if (now - lastIntentAt < 650) return; // click + submit/keydown are one action
    lastIntentAt = now;
    pendingSends.push({ at: now, fromConversation: activeConversation, expires: now + 20000 });
    pendingSends = pendingSends.slice(-5);
    scheduleScan();
  }

  function onKeydown(event) {
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey ||
        event.metaKey || event.isComposing || event.keyCode === 229) return;
    if (isInComposer(event.target)) addSendIntent();
  }

  function onClick(event) {
    const el = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (!el) return;
    const send = el.closest(SEND_SELECTOR);
    if (send && !send.disabled && send.getAttribute("aria-disabled") !== "true") {
      addSendIntent();
      return;
    }
    if (el.closest(REPLY_SELECTOR)) {
      replyUntil = Date.now() + 10 * 60 * 1000;
      replyConversation = activeConversation;
      return;
    }
    // A navigation click can briefly show the next chat's DOM under the old URL.
    if (el.closest('a[href*="/c/"]')) navigationPauseUntil = Date.now() + 1400;
  }

  function onSubmit(event) {
    const form = event.target;
    if (form instanceof Element && form.querySelector('#prompt-textarea, [data-testid="composer-input"], [data-testid="composer-textarea"]')) {
      addSendIntent();
    }
  }

  document.addEventListener("keydown", onKeydown, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("submit", onSubmit, true);

  function turns() {
    const result = [];
    const seenNodes = new Set();
    for (const el of document.querySelectorAll(TURN_SELECTOR)) {
      // Prefer one label per visible turn over one per sub-message.
      const ancestor = el.closest('article[data-turn-id], article[data-testid^="conversation-turn"]');
      const root = ancestor || el;
      if (seenNodes.has(root)) continue;
      seenNodes.add(root);
      const msg = root.matches('[data-message-author-role]') ? root : root.querySelector('[data-message-author-role]');
      const role = root.getAttribute('data-turn') || msg?.getAttribute('data-message-author-role');
      if (role !== 'user' && role !== 'assistant') continue;
      const id = root.getAttribute('data-turn-id') || msg?.getAttribute('data-message-id') || null;
      result.push({ el: root, role, id });
    }
    return result;
  }

  function onRouteChange() {
    const next = C.conversationId(location.pathname);
    if (activeConversation === next) return;
    const previous = activeConversation;
    activeConversation = next;
    seen = new Set();
    states = new WeakMap();
    // Preserve a send from a new-chat page to its newly-created /c/... URL.
    if (previous) pendingSends = pendingSends.filter(p => p.fromConversation === next);
    if (!previous && replyUntil > Date.now()) replyConversation = next;
    else if (previous !== next) replyUntil = 0;
  }

  function nextSend() {
    const now = Date.now();
    pendingSends = pendingSends.filter(p => p.expires > now);
    const index = pendingSends.findIndex(p => p.fromConversation === activeConversation || p.fromConversation === null);
    if (index < 0) return null;
    return pendingSends.splice(index, 1)[0];
  }

  function persist(key, value) {
    if (!key || !C.validRecord(value)) return;
    const merged = C.chooseRecord(records.get(key), value);
    if (merged === records.get(key)) return;
    records.set(key, merged);
    writes.set(key, merged);
    if (writeTimer !== null) return;
    writeTimer = setTimeout(async () => {
      writeTimer = null;
      const batch = Object.fromEntries(writes);
      writes.clear();
      try { await storage.set(batch); }
      catch (error) { console.warn('[ChatGPT Timestamps] Save failed:', error); }
    }, 35);
  }

  function paint(turn, record) {
    const existing = Array.from(turn.el.children).find(n => n.classList?.contains('cgpt-timestamp-label'));
    if (!settings.enabled || !record) {
      if (existing) existing.remove();
      return;
    }
    const label = existing || document.createElement('div');
    const formatted = C.formatTimestamp(record, settings.showSeconds);
    if (label.textContent !== formatted) label.textContent = formatted;
    label.className = 'cgpt-timestamp-label';
    label.dataset.cgptRole = turn.role;
    label.dataset.cgptTimestamp = String(record.at);
    label.title = ({
      sent: 'Recorded when the message was sent in this Firefox browser (local clock).',
      'reply-start': 'Recorded when the assistant reply first appeared in this Firefox browser (local clock).',
      observed: 'Time first observed in this browser; may not be the original creation time.',
      'first-seen': 'First seen in this browser. Original message creation time is unknown.'
    })[record.source];
    if (!existing) turn.el.appendChild(label);
  }

  function scan() {
    if (!ready || !document.body) return;
    if (scanning) { rescan = true; return; }
    scanning = true;
    try {
      onRouteChange();
      const visible = turns();
      for (const turn of visible) {
        const signature = turn.role + ':' + (turn.id || '<pending>');
        const isNew = !seen.has(signature);
        seen.add(signature);
        const key = C.recordKey(activeConversation, turn.role, turn.id);
        const oldState = states.get(turn.el);
        let record = key ? records.get(key) : null;

        const sendAvailable = pendingSends.some(p => p.expires > Date.now() &&
          (p.fromConversation === activeConversation || p.fromConversation === null));
        const newIdentity = !oldState || oldState.id !== turn.id;
        const canRecognizeNew = isNew && Date.now() >= navigationPauseUntil;

        // Actual send events trump possible ID changes and historic fallbacks.
        if (canRecognizeNew && turn.role === 'user' && sendAvailable &&
            (!record || record.source === 'first-seen') && (newIdentity || !oldState?.record)) {
          const sent = nextSend();
          if (sent) {
            record = { at: sent.at, source: 'sent' };
            replyUntil = Date.now() + 10 * 60 * 1000;
            replyConversation = activeConversation;
          }
        }

        if (canRecognizeNew && turn.role === 'assistant' &&
            replyUntil >= Date.now() && replyConversation === activeConversation &&
            (!record || record.source === 'first-seen') && newIdentity) {
          record = { at: Date.now(), source: 'reply-start' };
        }

        // Keep a timestamp if ChatGPT swaps a temporary ID for a stable ID.
        if (!record && oldState?.record && oldState.role === turn.role &&
            oldState.id !== turn.id) {
          record = oldState.record;
        }
        if (!record && settings.firstSeen && key) {
          record = { at: Date.now(), source: 'first-seen' };
        }
        if (key && record) persist(key, record);
        states.set(turn.el, { id: turn.id, role: turn.role, record });
        paint(turn, record);
      }
    } finally {
      scanning = false;
      if (rescan) { rescan = false; scheduleScan(); }
    }
  }

  function scheduleScan() {
    if (scanTimer !== null) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 45);
  }

  function relevantMutation(mutation) {
    if (mutation.type === 'attributes') return true;
    for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
      if (!(node instanceof Element)) continue;
      if (node.classList.contains('cgpt-timestamp-label')) continue;
      if (node.matches('article, [data-message-author-role], main') ||
          node.querySelector('article[data-turn-id], article[data-testid^="conversation-turn"], [data-message-author-role]')) {
        return true;
      }
    }
    return false;
  }

  async function init() {
    try {
      const data = await storage.get(null);
      settings = C.normalSettings(data[C.SETTINGS_KEY]);
      for (const [key, value] of Object.entries(data)) {
        if (key.startsWith(C.PREFIX) && C.validRecord(value)) records.set(key, value);
      }
    } catch (error) {
      console.warn('[ChatGPT Timestamps] Loading saved timestamps failed:', error);
    }
    if (!document.body) return;
    activeConversation = C.conversationId(location.pathname);
    // Existing messages are not given fictitious creation times.
    seen = new Set(turns().map(t => t.role + ':' + (t.id || '<pending>')));
    ready = true;
    scan();
    observer = new MutationObserver(changes => {
      if (changes.some(relevantMutation)) scheduleScan();
    });
    observer.observe(document.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['data-turn-id', 'data-message-id', 'data-turn', 'data-message-author-role']
    });
    // ChatGPT navigates with pushState, which does not emit popstate.
    setInterval(() => {
      if (C.conversationId(location.pathname) !== activeConversation) scheduleScan();
    }, 450);
    addEventListener('popstate', scheduleScan);
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const [key, change] of Object.entries(changes)) {
        if (key === C.SETTINGS_KEY) settings = C.normalSettings(change.newValue);
        if (!key.startsWith(C.PREFIX)) continue;
        if (C.validRecord(change.newValue)) records.set(key, change.newValue);
        else records.delete(key);
      }
      scheduleScan();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
