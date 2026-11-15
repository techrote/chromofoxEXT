/* Content script. Diagnostic-only until an explicit user action; never reads messages. */
(() => {
  'use strict';
  if (globalThis.__chatRescueInstalled) return;
  globalThis.__chatRescueInstalled = true;

  const L = globalThis.ChatRescueLogic;
  const INTERACTIVE = 'button, a, input, textarea, select, form, [role="button"], [role="link"], [contenteditable="true"], [contenteditable=""]';
  const TURNS = '[data-testid^="conversation-turn"], [data-message-author-role], [data-message-id]';
  const SPINNERS = '[role="progressbar"], .animate-spin, [class*="animate-spin"], [data-testid*="spinner"], [data-testid*="loading"]';
  const ERRORS = '[role="alert"], [data-testid*="error"]';

  let current = null;
  let last = null;
  let overlay = null;
  let overlayElements = null;
  let serial = 0;

  function candidateRoot() {
    return document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
  }

  function isShown(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.width > 240 || r.height > 240) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
  }

  function findSpinner() {
    const root = candidateRoot();
    const candidates = [...root.querySelectorAll(SPINNERS)].slice(0, 80);
    // Prefer central spinner rather than sidebar or composer activity.
    const viewportX = (root.getBoundingClientRect().left + innerWidth) / 2;
    const viewportY = innerHeight / 2;
    const ranked = candidates.filter(isShown).map(el => {
      const r = el.getBoundingClientRect();
      const midX = r.x + r.width / 2;
      const midY = r.y + r.height / 2;
      return { el, center: { x: midX, y: midY }, distance: Math.hypot(midX - viewportX, midY - viewportY) };
    }).sort((a, b) => a.distance - b.distance);
    return ranked[0] || null;
  }

  function evidence() {
    const id = L.conversationId(location.href);
    const root = candidateRoot();
    const spinner = findSpinner();
    // Only count message element markers; do NOT read or collect conversation text.
    const turnCount = root.querySelectorAll(TURNS).length;
    const hasError = [...root.querySelectorAll(ERRORS)].slice(0, 12)
      .some(el => /could not load (?:this )?(?:chatgpt )?conversation|unable to load (?:this )?conversation|conversation not found/i.test(el.textContent || ''));
    return {
      eligible: Boolean(id), conversationId: id, turnCount,
      spinnerFound: Boolean(spinner), hasError,
      state: L.stateFromEvidence({ eligible: Boolean(id), turnCount, spinnerFound: Boolean(spinner), hasError }),
      spinner: spinner ? spinner.center : null,
      pageVisible: document.visibilityState === 'visible',
      timestamp: new Date().toISOString()
    };
  }

  function publicState() {
    const e = evidence();
    if (current && current.conversationId !== e.conversationId) {
      cancel('Conversation changed; operation cancelled');
      destroyOverlay();
    }
    return {
      ...e,
      active: current ? { approach: current.approach, startedAt: current.startedAt, clicksNear: current.clicksNear, clicksElsewhere: current.clicksElsewhere, detail: current.detail } : null,
      // A SPA navigation must never display results from a different thread.
      last: last && last.conversationId === e.conversationId ? { ...last } : null
    };
  }

  function makeOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'chromofox-chat-rescue-ui';
    overlay.style.cssText = 'all:initial;position:fixed;top:80px;right:18px;z-index:2147483647;pointer-events:auto;';
    const shadow = overlay.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .panel { box-sizing:border-box;width:290px;padding:13px;border-radius:12px;box-shadow:0 6px 28px #000a;
        color:#f1f1f4;background:#232128;border:1px solid #77678d;font:13px/1.45 system-ui, sans-serif; }
      .heading {font-weight:700;font-size:14px;margin-bottom:5px;}
      .note {color:#d0cbd7;white-space:pre-wrap;}
      .buttons {display:flex;gap:8px;justify-content:flex-end;margin-top:11px;}
      button {cursor:pointer;background:#3d3650;color:#fff;border:1px solid #8879a1;border-radius:6px;padding:6px 11px;font:inherit;}
      button:focus-visible {outline:2px solid #fff;outline-offset:2px;}
      button:disabled {opacity:.5;cursor:not-allowed;}
    `;
    const panel = document.createElement('section');
    panel.className = 'panel'; panel.setAttribute('role','status');
    const heading = document.createElement('div'); heading.className='heading'; heading.textContent='Conversation Rescue';
    const note = document.createElement('div'); note.className='note';
    const buttons = document.createElement('div'); buttons.className='buttons';
    const stop = document.createElement('button'); stop.textContent='Stop'; stop.addEventListener('click', () => cancel('Stopped by user'));
    const close = document.createElement('button'); close.textContent='Close'; close.addEventListener('click', () => { if (current) cancel('Stopped by closing overlay'); destroyOverlay(); });
    buttons.append(stop, close);panel.append(heading,note,buttons);shadow.append(style,panel);
    overlayElements={note,stop};document.documentElement.appendChild(overlay);
  }

  function updateOverlay(message) {
    makeOverlay();
    overlayElements.note.textContent = message;
    overlayElements.stop.disabled = !current;
  }

  function destroyOverlay() {
    if (overlay) overlay.remove();
    overlay = null;overlayElements = null;
  }

  function cancelledError() { return new Error('Stopped'); }
  function assertActive(run) {
    if (run.cancelled || current !== run) throw cancelledError();
    if (L.conversationId(location.href) !== run.conversationId) {
      throw new Error('Conversation changed; operation cancelled');
    }
  }
  function delay(ms, run) {
    return new Promise((resolve, reject) => {
      const id = setTimeout(() => { run.pending.delete(id); try { assertActive(run); resolve(); } catch (err) { reject(err); } }, ms);
      run.pending.set(id, reject);
    });
  }

  function cancel(message = 'Stopped') {
    if (!current) return;
    const run = current;
    run.cancelled = true;
    for (const [id, reject] of run.pending) { clearTimeout(id); reject(cancelledError()); }
    run.pending.clear();
    finish(run, 'cancelled', message);
  }

  function finish(run, outcome, detail) {
    if (current !== run) return;
    current = null;
    if (run.cleanup) run.cleanup();
    const now = evidence();
    last = {
      approach: run.approach, outcome, detail, conversationId: run.conversationId,
      startedAt: run.startedAt, finishedAt: new Date().toISOString(),
      beforeState: run.beforeState, afterState: now.state,
      clicksNear: run.clicksNear, clicksElsewhere: run.clicksElsewhere,
      beforeTurnCount: run.beforeTurnCount, afterTurnCount: now.turnCount
    };
    updateOverlay(`${detail}\nState: ${now.state}. This does not establish that the entire thread loaded.`);
  }

  function spinnerCenter() {
    const spinner = findSpinner();
    if (spinner) return spinner.center;
    const root = candidateRoot();
    const r = root.getBoundingClientRect();
    return { x: L.clippedNumber(r.left + r.width / 2, 25, innerWidth - 25), y: L.clippedNumber(r.top + r.height / 2, 25, innerHeight - 25) };
  }

  async function watch(run, ms) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      assertActive(run);
      if (evidence().state === 'messages-visible') return true;
      await delay(300, run);
    }
    return evidence().state === 'messages-visible';
  }

  function wake() {
    // Non-destructive input/focus/layout nudge. Synthetic events are not trusted.
    const root = candidateRoot();
    try { window.focus(); } catch (_) { /* browser may deny */ }
    const candidates = [root, ...root.querySelectorAll('[data-testid*="scroll"], [class*="overflow-y-auto"]')].slice(0, 30);
    const scroller = candidates.find(el => el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 100);
    if (scroller) {
      const before = scroller.scrollTop;
      scroller.scrollTop = before + (before < scroller.scrollHeight - scroller.clientHeight ? 1 : -1);
      void scroller.getBoundingClientRect();
      scroller.scrollTop = before;
    }
    void document.documentElement.getBoundingClientRect();
    window.dispatchEvent(new Event('resize'));
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function clickPulse(run) {
    const spinner = findSpinner();
    if (!spinner) throw new Error('No spinner detected: synthetic pulse intentionally not fired');
    const points = L.ringPoints(spinner.center, 25, L.PULSE_COUNT);
    let sent = 0;
    for (const p of points) {
      assertActive(run);
      if (p.x < 0 || p.y < 0 || p.x > innerWidth || p.y > innerHeight) continue;
      const el = document.elementFromPoint(p.x, p.y);
      if (!el || el.closest(INTERACTIVE) || el.closest('#chromofox-chat-rescue-ui')) continue;
      const options = { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, buttons: 1, view: window };
      if (typeof PointerEvent === 'function') {
        el.dispatchEvent(new PointerEvent('pointerdown', { ...options, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new PointerEvent('pointerup', { ...options, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      }
      el.dispatchEvent(new MouseEvent('mousedown', options));
      el.dispatchEvent(new MouseEvent('mouseup', { ...options, buttons: 0 }));
      el.dispatchEvent(new MouseEvent('click', { ...options, buttons: 0 }));
      sent++;
    }
    run.detail = `Sent ${sent} untrusted synthetic click sequences in non-interactive spinner area`;
    if (!sent) throw new Error('All pulse targets were interactive or outside the viewport');
  }

  async function guided(run) {
    const center = spinnerCenter();
    const radius = 125;
    updateOverlay('Guided REAL-click test: click rapidly around the visible spinner for up to 16 seconds. The extension counts trusted clicks but never clicks for you. Stop at any time.');
    const handler = event => {
      if (!event.isTrusted || event.button !== 0 || overlay?.contains(event.target)) return;
      if (L.withinRadius(event.clientX, event.clientY, center, radius)) run.clicksNear++;
      else run.clicksElsewhere++;
      run.detail = `${run.clicksNear} nearby real clicks; ${run.clicksElsewhere} elsewhere`;
      if (overlayElements) overlayElements.note.textContent = `Click near spinner (radius 125px).\n${run.detail}\nStop at any time.`;
    };
    document.addEventListener('click', handler, true);
    run.cleanup = () => document.removeEventListener('click', handler, true);
    let finished = false;
    const start = Date.now();
    while (Date.now() - start < L.MAX_DURATION_MS && run.clicksNear + run.clicksElsewhere < L.MAX_CLICKS) {
      assertActive(run);
      if (evidence().state === 'messages-visible') { finished = true; break; }
      await delay(250, run);
    }
    return finished || evidence().state === 'messages-visible';
  }

  async function runOperation(run) {
    try {
      let visible = false;
      if (run.approach === 'guided') visible = await guided(run);
      else if (run.approach === 'wake') {
        updateOverlay('Focus/scroll/reflow nudge. No navigation or network request.');
        await wake(); visible = await watch(run, 3000);
      } else if (run.approach === 'pulse') {
        updateOverlay('Experimental synthetic pointer pulses. These are NOT equivalent to real mouse clicks.');
        clickPulse(run); visible = await watch(run, 3000);
      } else if (run.approach === 'safe-sequence') {
        updateOverlay('Safe sequence: wake → observe → synthetic pointer pulses if spinner remains. No reloads.');
        await wake();visible = await watch(run, 1500);
        if (!visible && findSpinner()) {
          clickPulse(run);visible = await watch(run, 3000);
        }
      } else throw new Error('Unsupported approach');
      assertActive(run);
      finish(run, visible ? 'messages-visible' : 'not-confirmed', visible ? 'Message elements appeared. Save/export this conversation while accessible.' : 'No visible message elements confirmed in the observation window.');
    } catch (err) {
      if (current === run) {
        const detail = String(err?.message || err);
        finish(run, detail === 'Conversation changed; operation cancelled' ? 'cancelled' : 'error', detail);
        if (detail === 'Conversation changed; operation cancelled') destroyOverlay();
      }
    }
  }

  function start(approach) {
    const allowed = ['guided', 'wake', 'pulse', 'safe-sequence'];
    if (!allowed.includes(approach)) return { ok: false, error: 'Unknown approach' };
    const before = evidence();
    if (!before.eligible) return { ok: false, error: 'Open a specific /c/<conversation-id> ChatGPT thread' };
    if (current) return { ok: false, error: 'Another rescue operation is running. Stop it first.' };
    if (before.turnCount > 0) return { ok: false, error: 'Message elements already visible. Rescue action not needed.' };
    const run = {
      id: ++serial, approach, conversationId: before.conversationId,
      startedAt: new Date().toISOString(), beforeState: before.state,
      beforeTurnCount: before.turnCount, cancelled: false, pending: new Map(),
      clicksNear: 0, clicksElsewhere: 0, detail: 'Starting', cleanup: null
    };
    current = run;
    // Starting an operation never navigates the page or makes a fetch request.
    void runOperation(run);
    return { ok: true, state: publicState() };
  }

  chrome.runtime.onMessage.addListener((request, _sender, respond) => {
    if (!request || request.protocol !== 'CHAT_RESCUE_V1') return false;
    if (request.command === 'state') respond({ ok: true, state: publicState() });
    else if (request.command === 'start') respond(start(request.approach));
    else if (request.command === 'stop') { cancel('Stopped by user'); respond({ ok: true, state: publicState() }); }
    else if (request.command === 'close-overlay') { destroyOverlay();respond({ ok: true }); }
    else respond({ ok: false, error: 'Unknown command' });
    return false;
  });
})();
