/* Model-picker inspection only. Never inspects conversation content or sends network requests. */
(() => {
  'use strict';
  const EDITOR = '#prompt-textarea, [data-testid="prompt-textarea"], [data-testid="composer-input"], textarea[data-testid*="prompt"], [contenteditable="true"][role="textbox"], [contenteditable="true"][data-testid*="input"]';
  const MODEL_CONTROLS = [
    '[data-testid="model-switcher-dropdown-button"]',
    '[data-testid="model-switcher-button"]',
    '[data-testid*="model-switcher"] button',
    'button[data-testid*="model-picker"]',
    'button[data-testid*="model-selector"]',
    'button[data-testid*="reasoning-effort"]',
    'button[data-testid*="thinking-effort"]',
    'button[aria-label*="current model" i]',
    'button[aria-label*="model selector" i]',
    'button[aria-label*="thinking effort" i]',
    'button[aria-label*="reasoning effort" i]'
  ].join(', ');
  const SEND_CONTROL = [
    'button[data-testid="send-button"]',
    'button[data-testid="composer-send-button"]',
    'button[data-testid*="send-message"]',
    'button[aria-label="Send message" i]',
    'button[aria-label="Send prompt" i]',
    'button[title="Send message" i]',
    'button[type="submit"]',
    '[role="button"][aria-label="Send message" i]'
  ].join(', ');
  const PROMOTIONAL = /(?:\b(?:upgrade|subscribe|purchase|buy|unlock|try|get|switch to|choose|your|account|subscription|plan|quota|usage|limit|remaining|free)\b.{0,30}\bpro\b|\bpro\b.{0,20}\b(?:plan|account|subscription|quota|usage|limit|remaining|membership)\b)/i;
  const PRO = /\bpro\b/i;
  const NON_PRO = /\b(?:instant|thinking|medium|high|extra\s+high|sol|luna)\b/i;

  function normalize(value) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 100); }
  function classify(label) {
    const text = normalize(label);
    if (!text || PROMOTIONAL.test(text)) return 'unknown';
    if (PRO.test(text)) return 'pro';
    if (NON_PRO.test(text)) return 'non-pro';
    return 'unknown';
  }
  function editor(doc) { return doc.querySelector(EDITOR); }
  function composerRoot(doc) {
    const input = editor(doc);
    if (!input) return null;
    const identified = input.closest('[data-testid="composer"], [data-testid="chat-composer"], [data-testid="composer-container"]');
    if (identified) return identified;
    const form = input.closest('form');
    // Model controls can be siblings of the form inside the composer shell.
    if (form && form.parentElement && form.parentElement !== doc.body && form.parentElement !== doc.documentElement && !['MAIN', 'BODY'].includes(form.parentElement.tagName)) return form.parentElement;
    if (form) return form;
    let parent = input.parentElement;
    for (let i = 0; parent && i < 5 && !['MAIN', 'BODY', 'HTML'].includes(parent.tagName); i++, parent = parent.parentElement) {
      if (parent.querySelector('button')) return parent;
    }
    return input.parentElement;
  }
  function readableLabels(node) {
    // Only read small model-picker controls, never text from the document or the user's prompt.
    if (!node || !node.isConnected) return [];
    const labels = [normalize(node.textContent), normalize(node.getAttribute('aria-label')), normalize(node.getAttribute('title'))];
    return labels.filter(Boolean).filter(s => s.length < 90);
  }
  function isCandidate(node, explicit) {
    if (!node || !node.isConnected) return false;
    if (node.closest('[role="menu"], [role="listbox"], [role="dialog"]')) return false;
    if (node.disabled || node.getAttribute('aria-hidden') === 'true') return false;
    if (explicit) return true;
    return readableLabels(node).some(label => {
      if (PROMOTIONAL.test(label)) return false;
      return /^(?:(?:gpt[\s-]?\d+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s+sol)?\s*)?(?:pro|thinking|instant|medium|high|extra\s+high)(?:\s*[·(\-/]\s*\w.*|\s+(?:standard|extended))?$/i.test(label) ||
        /^(?:gpt[-\s]?\d+(?:\.\d+)?(?:\s+sol)?|\d+\.\d+\s+sol)$/i.test(label);
    });
  }
  function selectedMode(doc) {
    const root = composerRoot(doc);
    if (!root) return { mode: 'unknown', label: '' };
    const candidates = new Map();
    for (const el of doc.querySelectorAll(MODEL_CONTROLS)) {
      if (el.closest('[role="menu"], [role="listbox"], [role="dialog"]')) continue;
      candidates.set(el, 3);
    }
    for (const el of root.querySelectorAll('button, [role="button"]')) {
      if (!candidates.has(el) && isCandidate(el, false)) candidates.set(el, 1);
    }
    let bestPro = null; let bestNonPro = null;
    for (const [node, weight] of candidates) {
      if (!isCandidate(node, weight === 3)) continue;
      for (const label of readableLabels(node)) {
        const mode = classify(label);
        const candidate = { mode, label, weight };
        if (mode === 'pro' && (!bestPro || weight > bestPro.weight)) bestPro = candidate;
        if (mode === 'non-pro' && (!bestNonPro || weight > bestNonPro.weight)) bestNonPro = candidate;
      }
    }
    // A separate Pro reasoning-effort button overrides the general model family label.
    const winner = bestPro || bestNonPro;
    return winner ? { mode: winner.mode, label: winner.label } : { mode: 'unknown', label: '' };
  }
  function closestEditor(node) {
    return node && node.nodeType === 1 ? node.closest(EDITOR) : null;
  }
  function isSendButton(node, doc) {
    const button = node && node.nodeType === 1 ? node.closest('button, [role="button"]') : null;
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
    const root = composerRoot(doc);
    if (!root || !root.contains(button)) return false;
    return button.matches(SEND_CONTROL);
  }
  function isComposerForm(node) {
    return !!node && node.matches?.('form') && !!node.querySelector(EDITOR);
  }
  globalThis.ChromofoxProSendLogic = Object.freeze({ normalize, classify, selectedMode, editor, composerRoot, closestEditor, isSendButton, isComposerForm });
})();
