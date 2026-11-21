/* Fail-closed on unknown model by default. No transcript access, telemetry, network, or synthetic sends. */
(() => {
  'use strict';
  if (globalThis.__chromofoxProSendGuardInstalled) return;
  globalThis.__chromofoxProSendGuardInstalled = true;
  const L = globalThis.ChromofoxProSendLogic;
  if (!L) return;

  const defaults = { enabled: true, protectUnknown: true };
  const settings = { ...defaults };
  let approval = null;

  function updateSettings(values) {
    for (const key of Object.keys(defaults)) if (typeof values?.[key] === 'boolean') settings[key] = values[key];
  }
  try {
    chrome.storage.local.get(defaults, data => {
      if (!chrome.runtime.lastError) updateSettings(data);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const key of Object.keys(defaults)) {
        if (Object.prototype.hasOwnProperty.call(changes, key)) {
          settings[key] = typeof changes[key].newValue === 'boolean' ? changes[key].newValue : defaults[key];
        }
      }
    });
  } catch (_) { /* Defaults remain protective if storage is inaccessible. */ }

  function stop(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function contextFor() {
    // Canonical root: button, editor and form share one identity even when the
    // Send button is outside its form and calls form.requestSubmit().
    return L.composerRoot(document);
  }
  function protect(event, context) {
    if (!settings.enabled) return;
    const state = L.selectedMode(document);
    if (state.mode === 'non-pro' || (state.mode === 'unknown' && !settings.protectUnknown)) return;
    // A click's browser-native default form submission can run after a microtask checkpoint.
    // Suppress exactly ONE follow-on submit for the same composer; never permit a new
    // trusted keydown or click merely because the previous click was confirmed.
    if (event.type === 'submit' && approval && approval.context === context && performance.now() < approval.expiresAt) {
      approval = null;
      return;
    }
    if (event.type === 'click' && !event.isTrusted && approval?.source === 'keydown' && approval.context === context && performance.now() < approval.expiresAt) {
      approval.source = 'click';
      return;
    }
    if (event.type === 'keydown' && event.repeat) { stop(event); return; }

    const prompt = state.mode === 'pro'
      ? `Send this message using ChatGPT ${state.label || 'Pro'}?\n\nThis may consume one of your limited Pro-model messages.\n\nCancel keeps your draft untouched.`
      : 'ChatGPT Pro Send Guard cannot verify the selected model.\n\nSend anyway? This could use a limited Pro-model message.\n\nCancel keeps your draft untouched.';
    let confirmed = false;
    try { confirmed = globalThis.confirm(prompt) === true; } catch (_) { /* Fail closed. */ }
    if (!confirmed) { approval = null; stop(event); return; }

    // This token is usable only by the one browser-generated follow-on submit
    // (or an immediate synthetic click triggered by the approved Enter handler).
    // Every distinct trusted click/keydown still requires its own confirmation.
    const token = { context, source: event.type, expiresAt: performance.now() + 400 };
    approval = token;
    setTimeout(() => { if (approval === token) approval = null; }, 400);
  }

  // Install at document_start in capture phase: the original trusted event continues
  // after approval. Synthetic event replay could break ChatGPT's React event handling.
  window.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.isComposing || event.keyCode === 229) return;
    const input = L.closestEditor(event.target);
    if (!input) return;
    // An open autocomplete/menu should handle Enter, not a prompt submission.
    if (input.getAttribute('aria-expanded') === 'true' || event.target?.closest?.('[role="listbox"], [role="menu"]')) return;
    protect(event, contextFor(input));
  }, true);
  window.addEventListener('click', event => {
    if (!L.isSendButton(event.target, document)) return;
    protect(event, contextFor(event.target));
  }, true);
  window.addEventListener('submit', event => {
    if (!L.isComposerForm(event.target, document)) return;
    protect(event, contextFor());
  }, true);
})();
