/* Chrome callback API is compatible with Firefox; no persistent background privileges. */
(() => {
  'use strict';
  const api = chrome;
  const $ = id => document.getElementById(id);
  let tab = null;
  let state = null;
  let poller = null;
  let sending = false;

  function queryTab() {
    return new Promise((resolve, reject) => api.tabs.query({ active: true, currentWindow: true }, tabs => {
      const error = api.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tabs[0] || null);
    }));
  }
  function send(command, extra = {}) {
    return new Promise((resolve, reject) => api.tabs.sendMessage(tab.id, { protocol: 'CHAT_RESCUE_V1', command, ...extra }, response => {
      const error = api.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    }));
  }
  function reload(hard) {
    return new Promise((resolve, reject) => api.tabs.reload(tab.id, { bypassCache: Boolean(hard) }, () => {
      const error = api.runtime.lastError;
      if (error) reject(new Error(error.message)); else resolve();
    }));
  }
  function newTab(url) {
    return new Promise((resolve, reject) => api.tabs.create({ url, active: true }, result => {
      const error = api.runtime.lastError;
      if (error) reject(new Error(error.message)); else resolve(result);
    }));
  }
  function note(message) { $('notice').textContent = message || ''; }

  function paint() {
    const eligible = Boolean(tab && ChatRescueLogic.conversationId(tab.url || ''));
    const active = state?.active;
    const st = state?.state || (eligible ? 'No content-script response' : 'Not a ChatGPT conversation');
    $('state').textContent = ({
      'messages-visible':'Message elements visible', 'loading-indicator':'Loading indicator detected',
      'error-visible':'Conversation error detected', 'unconfirmed':'No messages confirmed',
      'not-conversation':'Not a conversation'
    })[st] || st;
    $('pill').textContent = active ? `RUNNING ${active.approach}` : st;
    $('thread').textContent = eligible ? `Thread ${ChatRescueLogic.conversationId(tab.url)}` : 'Open a ChatGPT conversation (/c/<id>)';
    $('metrics').textContent = state ? `${state.turnCount} message markers · spinner ${state.spinnerFound ? 'detected' : 'not detected'} · page ${state.pageVisible ? 'visible' : 'hidden'}` : 'Content script not connected; try reloading the ChatGPT tab.';
    $('result').textContent = active ? `In progress: ${active.detail} · real clicks near/elsewhere: ${active.clicksNear}/${active.clicksElsewhere}` :
      state?.last ? `${state.last.approach}: ${state.last.outcome}. ${state.last.detail} (before ${state.last.beforeState}, after ${state.last.afterState}).` : 'No experiment run in this page.';
    document.querySelectorAll('[data-action]').forEach(button => {
      const action = button.dataset.action;
      button.disabled = sending || !eligible || ((action === 'guided' || action === 'wake' || action === 'pulse' || action === 'safe-sequence') && (!!active || st === 'messages-visible' || !state));
    });
    $('stop').disabled = sending || !active;
    $('copy').disabled = !state;
  }

  async function refresh() {
    if (!tab || !ChatRescueLogic.conversationId(tab.url || '')) { paint(); return; }
    try {
      const response = await send('state');
      if (!response?.ok) throw new Error(response?.error || 'No state returned');
      state = response.state;
      if (state?.state === 'messages-visible' && state?.last?.outcome === 'messages-visible') note('Visible message markers detected. Export the conversation while accessible.');
    } catch (err) { state = null; note(`Content script unreachable: ${err.message}. Reload the ChatGPT tab once after installing the extension.`); }
    paint();
  }

  async function handleAction(action) {
    if (!tab || !ChatRescueLogic.conversationId(tab.url || '')) return;
    sending = true; note(''); paint();
    try {
      if (['guided', 'wake', 'pulse', 'safe-sequence'].includes(action)) {
        const result = await send('start', { approach: action });
        if (!result?.ok) throw new Error(result?.error || 'Failed to start');
        state = result.state;
        note(action === 'guided' ? 'Click around the spinner in the page. A Stop button is available on the page.' : 'Experiment started; no page reload will occur.');
      } else if (action === 'reload' || action === 'hard-reload') {
        if (!confirm('Reload this tab? Any unsent text or in-progress operation might be lost.')) return;
        await reload(action === 'hard-reload');
        note('Reload requested. The extension makes no claim that it will recover the conversation.');
        state = null;
      } else if (action === 'new-tab') {
        const url = new URL(tab.url);
        // Strip query and hash to avoid passing extraneous data on a recovery attempt.
        const safe = `${url.origin}${url.pathname}`;
        await newTab(safe);
        note('Conversation reopened in a new tab. Original tab preserved.');
      }
    } catch (err) { note(`Action failed: ${err.message}`); }
    finally { sending = false; paint(); }
  }

  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => { void handleAction(button.dataset.action); }));
  $('stop').addEventListener('click', async () => {
    if (!tab) return;
    try { const result = await send('stop'); state = result.state; note('Experiment stopped.'); }
    catch(err) { note(`Stop failed: ${err.message}`); }
    paint();
  });
  $('copy').addEventListener('click', async () => {
    if (!state) return;
    const diagnostic = { format: 'CHAT_RESCUE_V1', exportedAt: new Date().toISOString(), conversationId: state.conversationId, state: state.state,
      turnMarkers: state.turnCount, spinnerFound: state.spinnerFound, pageVisible: state.pageVisible, active: state.active, last: state.last };
    try { await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2)); note('Diagnostic copied (no message text).'); }
    catch (err) { note(`Clipboard unavailable: ${err.message}`); }
  });
  (async () => {
    try { tab = await queryTab(); await refresh(); }
    catch (err) { note(`Cannot inspect tab: ${err.message}`); paint(); }
    poller = setInterval(() => { if (!sending) void refresh(); }, 850);
  })();
  window.addEventListener('unload', () => { if (poller) clearInterval(poller); });
})();
