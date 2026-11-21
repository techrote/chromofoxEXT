/* Model-picker and composer inspection only. Never reads message text or makes network requests. */
(() => {
  'use strict';

  // Specific, current ChatGPT selectors first; conservative fallbacks only within
  // a visible composer. The ProseMirror and named-textarea variants have no role/testid.
  const EDITOR = [
    '#prompt-textarea', '[data-testid="prompt-textarea"]',
    '[data-testid="composer-input"]', 'textarea[name="prompt-textarea"]',
    'textarea[data-testid*="prompt"]',
    '.ProseMirror[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][data-testid*="input"]'
  ].join(', ');
  const GENERIC_EDITOR = 'textarea, [contenteditable="true"]';
  const COMPOSER = '[data-testid="composer"], [data-testid="chat-composer"], [data-testid="composer-container"], #composer';
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
    'button#composer-submit-button',
    'button[data-testid="send-button"]',
    'button[data-testid="composer-send-button"]',
    'button[data-testid*="send-message"]',
    'button[aria-label="Send" i]',
    'button[aria-label="Send message" i]',
    'button[aria-label="Send prompt" i]',
    'button[title="Send" i]',
    'button[title="Send message" i]',
    'button[type="submit"]',
    '[role="button"][aria-label="Send" i]',
    '[role="button"][aria-label="Send message" i]'
  ].join(', ');
  const PROMOTIONAL = /(?:\b(?:upgrade|subscribe|purchase|buy|unlock|try|get|switch to|choose|your|account|subscription|plan|quota|usage|limit|remaining|free)\b.{0,30}\bpro\b|\bpro\b.{0,20}\b(?:plan|account|subscription|quota|usage|limit|remaining|membership)\b)/i;
  const PRO = /\bpro\b/i;
  const NON_PRO = /\b(?:instant|thinking|medium|high|extra\s+high|sol|luna)\b/i;
  const EXCLUDED = '[role="menu"], [role="listbox"], [role="dialog"], [aria-modal="true"]';

  function normalize(value) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 100); }
  function classify(label) {
    const text = normalize(label);
    if (!text || PROMOTIONAL.test(text)) return 'unknown';
    if (PRO.test(text)) return 'pro';
    if (NON_PRO.test(text)) return 'non-pro';
    return 'unknown';
  }

  function isVisibleActive(node) {
    if (!node || !node.isConnected || node.nodeType !== 1) return false;
    if (node.disabled || node.getAttribute('aria-disabled') === 'true') return false;
    if (node.closest(EXCLUDED)) return false;
    for (let item = node; item && item.nodeType === 1; item = item.parentElement) {
      if (item.hidden || item.inert || item.hasAttribute('inert') || item.getAttribute('aria-hidden') === 'true') return false;
      const style = item.ownerDocument.defaultView?.getComputedStyle(item);
      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0)) return false;
    }
    // CSS display:none on a parent and zero-size retired controls must not count.
    return node.getClientRects().length > 0 && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
  }

  function editor(doc) {
    const nodes = Array.from(doc.querySelectorAll(EDITOR));
    const identified = nodes.filter(isVisibleActive);
    const active = doc.activeElement;
    // The active, visible composer editor is preferable to any retired duplicate.
    const focused = identified.find(node => node === active || node.contains(active));
    if (focused) return focused;
    const inComposer = identified.find(node => node.closest(COMPOSER));
    if (inComposer) return inComposer;
    const inMain = identified.find(node => node.closest('main, [role="main"]'));
    if (inMain) return inMain;
    if (identified.length) return identified[0];

    // Only accept a generic editor when its visible ancestry looks like a real
    // composer. Never treat a transcript/code block as the message editor.
    const generic = Array.from(doc.querySelectorAll(GENERIC_EDITOR)).filter(isVisibleActive);
    return generic.find(node => node.closest(COMPOSER) ||
      (node.closest('form') && node.closest('form').querySelector('button[type="submit"], #composer-submit-button, [aria-label="Send" i]'))) || null;
  }

  function composerRoot(doc) {
    const input = editor(doc);
    if (!input) return null;
    const identified = input.closest(COMPOSER);
    if (identified) return identified;
    const form = input.closest('form');
    // A Send button can be a sibling of the form, and requestSubmit() may be
    // called from that sibling. Use the enclosing shell consistently.
    if (form?.parentElement && !['MAIN', 'BODY', 'HTML'].includes(form.parentElement.tagName)) return form.parentElement;
    if (form) return form;
    let parent = input.parentElement;
    for (let i = 0; parent && i < 7 && !['MAIN', 'BODY', 'HTML'].includes(parent.tagName); i++, parent = parent.parentElement) {
      if (parent.querySelector(SEND_CONTROL)) return parent;
    }
    return input.parentElement;
  }

  function readableLabels(node) {
    // Read only short labels on model-picker controls, never the user's prompt.
    if (!isVisibleActive(node)) return [];
    const labels = [normalize(node.innerText), normalize(node.getAttribute('aria-label')), normalize(node.getAttribute('title'))];
    return [...new Set(labels.filter(Boolean).filter(s => s.length < 90))];
  }

  function isCandidate(node, explicit) {
    if (!isVisibleActive(node)) return false;
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
    for (const node of doc.querySelectorAll(MODEL_CONTROLS)) {
      if (isCandidate(node, true)) candidates.set(node, 3);
    }
    for (const node of root.querySelectorAll('button, [role="button"]')) {
      if (!candidates.has(node) && isCandidate(node, false)) candidates.set(node, 1);
    }
    let pro = null; let nonPro = null; let unknown = false;
    for (const [node, weight] of candidates) {
      const labels = readableLabels(node).filter(label => !PROMOTIONAL.test(label));
      if (!labels.length) continue; // Ignore upgrades, plan ads and empty controls.
      const states = new Set(labels.map(classify));
      if (states.size > 1) { unknown = true; continue; }
      const mode = [...states][0];
      const observation = { mode, label: labels[0], weight };
      if (mode === 'pro' && (!pro || weight > pro.weight)) pro = observation;
      else if (mode === 'non-pro' && (!nonPro || weight > nonPro.weight)) nonPro = observation;
      else if (mode === 'unknown') unknown = true;
    }
    // Conflicting or incompletely identified *visible* selection controls must
    // never be interpreted as a certain non-Pro model.
    if (unknown || (pro && nonPro)) return { mode: 'unknown', label: '' };
    if (pro) return { mode: 'pro', label: pro.label };
    if (nonPro) return { mode: 'non-pro', label: nonPro.label };
    return { mode: 'unknown', label: '' };
  }

  function closestEditor(node) {
    if (!node || node.nodeType !== 1) return null;
    const found = node.closest(`${EDITOR}, ${GENERIC_EDITOR}`);
    return found && isVisibleActive(found) && found === editor(node.ownerDocument) ? found : null;
  }
  function isSendButton(node, doc) {
    const button = node && node.nodeType === 1 ? node.closest('button, [role="button"]') : null;
    if (!button || !isVisibleActive(button)) return false;
    const root = composerRoot(doc);
    if (!root || !root.contains(button)) return false;
    return button.matches(SEND_CONTROL) || normalize(button.innerText).toLowerCase() === 'send';
  }
  function isComposerForm(node, doc = node?.ownerDocument) {
    if (!node || !node.matches?.('form') || !doc) return false;
    const input = editor(doc);
    const root = composerRoot(doc);
    return !!input && !!root && (node.contains(input) || root === node || root.contains(node));
  }

  globalThis.ChromofoxProSendLogic = Object.freeze({ normalize, classify, selectedMode, editor, composerRoot, closestEditor, isSendButton, isComposerForm, isVisibleActive });
})();
