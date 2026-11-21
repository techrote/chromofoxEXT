/* Model-picker and composer inspection only. Never reads message text or makes network requests. */
(() => {
  'use strict';

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
    'button[aria-label*="reasoning effort" i]',
    '[role="combobox"]'
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
    const value = normalize(label);
    if (!value || PROMOTIONAL.test(value)) return 'unknown';
    if (PRO.test(value)) return 'pro';
    if (NON_PRO.test(value)) return 'non-pro';
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
    const bounds = node.getBoundingClientRect();
    return node.getClientRects().length > 0 && bounds.width > 0 && bounds.height > 0;
  }

  function sendControl(node) {
    return !!node && (node.matches(SEND_CONTROL) || normalize(node.innerText).toLowerCase() === 'send');
  }

  function viableEditor(node) {
    if (!node || !node.matches?.(GENERIC_EDITOR) || !isVisibleActive(node)) return false;
    if (node.matches(EDITOR)) return true;
    // Generic editors must belong to a recognised composer, or a form with a
    // genuine Send control. Never reinterpret a transcript/code block as editor.
    if (node.closest(COMPOSER)) return true;
    const form = node.closest('form');
    return !!form && !!form.querySelector(SEND_CONTROL);
  }

  function visibleEditors(scope) {
    return Array.from(scope.querySelectorAll(GENERIC_EDITOR)).filter(viableEditor);
  }

  function editor(doc) {
    // Legacy no-target convenience for tests/UI diagnostics. Submission logic
    // MUST use the event target instead of whichever editor appears first.
    const active = doc.activeElement;
    const focus = active?.closest?.(GENERIC_EDITOR);
    if (viableEditor(focus)) return focus;
    const editors = visibleEditors(doc);
    return editors.find(node => node.closest(COMPOSER)) || editors.find(node => node.closest('main, [role="main"]')) || editors[0] || null;
  }

  function editorFromTarget(node) {
    if (!node || node.nodeType !== 1) return null;
    const result = node.closest(GENERIC_EDITOR);
    return viableEditor(result) ? result : null;
  }

  function rootFromEditor(input) {
    if (!viableEditor(input)) return null;
    const named = input.closest(COMPOSER);
    // A broad named shell may contain an inline edit form AND the new-message
    // editor. Never give two editors the same approval token by accident.
    if (named && visibleEditors(named).length === 1) return named;
    const form = input.closest('form');
    if (form) {
      const shell = form.parentElement;
      // Share a root with a sibling Send button only when this shell owns
      // exactly one visible editor. Never combine two independently edited forms.
      if (shell && !['MAIN', 'BODY', 'HTML'].includes(shell.tagName) &&
          visibleEditors(shell).length === 1 &&
          Array.from(shell.querySelectorAll('button, [role="button"]')).some(sendControl)) return shell;
      return form;
    }
    let parent = input.parentElement;
    for (let depth = 0; parent && depth < 7 && !['MAIN', 'BODY', 'HTML'].includes(parent.tagName); depth++, parent = parent.parentElement) {
      if (visibleEditors(parent).length === 1 &&
          Array.from(parent.querySelectorAll('button, [role="button"]')).some(sendControl)) return parent;
    }
    return input.parentElement;
  }

  function rootFromForm(form) {
    if (!form?.matches?.('form')) return null;
    const editors = visibleEditors(form);
    if (editors.length === 1) return rootFromEditor(editors[0]);
    if (editors.length > 1) return form; // Ambiguous selection => unknown; never select another composer.
    const named = form.closest(COMPOSER);
    if (named && visibleEditors(named).length === 1) return named;
    return null;
  }

  function rootFromButton(button) {
    if (!button || !isVisibleActive(button) || !sendControl(button)) return null;
    const named = button.closest(COMPOSER);
    if (named && visibleEditors(named).length === 1) return named;
    const form = button.form || button.closest('form');
    if (form) return rootFromForm(form);
    let parent = button.parentElement;
    for (let depth = 0; parent && depth < 7 && !['MAIN', 'BODY', 'HTML'].includes(parent.tagName); depth++, parent = parent.parentElement) {
      if (visibleEditors(parent).length === 1) return rootFromEditor(visibleEditors(parent)[0]);
    }
    return null;
  }

  function composerRoot(doc, target = null) {
    if (!target) return rootFromEditor(editor(doc));
    if (!target.isConnected || target.ownerDocument !== doc) return null;
    if (target.matches?.('form')) return rootFromForm(target);
    const input = editorFromTarget(target);
    if (input) return rootFromEditor(input);
    const button = target.closest?.('button, [role="button"]');
    if (button) return rootFromButton(button);
    const named = target.closest?.(COMPOSER);
    return named && visibleEditors(named).length ? named : null;
  }

  function readableLabels(node) {
    // Small model-control labels only; never inspect prompt or transcript text.
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

  function selectedMode(doc, root = null) {
    // A visible model selector elsewhere in the document is NOT evidence for
    // this composer. In particular, a sidebar's High must never suppress a
    // confirmation for an unrecognised active Pro picker.
    if (!root) {
      // No event target means no authority to pick the first of several
      // visible composers and call its High label the active selection.
      const roots = new Set(visibleEditors(doc).map(rootFromEditor).filter(Boolean));
      if (roots.size > 1) return { mode: 'unknown', label: '' };
    }
    const composer = root || composerRoot(doc);
    if (!composer || composer.ownerDocument !== doc || !isVisibleActive(composer)) return { mode: 'unknown', label: '' };
    if (visibleEditors(composer).length > 1) return { mode: 'unknown', label: '' };
    const candidates = new Map();
    for (const node of composer.querySelectorAll(MODEL_CONTROLS)) {
      if (isCandidate(node, true) && !node.closest(GENERIC_EDITOR)) candidates.set(node, 3);
    }
    for (const node of composer.querySelectorAll('button, [role="button"]')) {
      if (!candidates.has(node) && isCandidate(node, false) && !node.closest(GENERIC_EDITOR)) candidates.set(node, 1);
    }
    // Only a deliberately linked external model selector may supply a
    // non-Pro label. Global visible model controls without provenance are
    // ignored and hence yield unknown (protective default).
    if (composer.id) {
      for (const node of doc.querySelectorAll(MODEL_CONTROLS)) {
        if (composer.contains(node) || !isCandidate(node, true)) continue;
        const ids = (node.getAttribute('aria-controls') || '').split(/\s+/);
        if (ids.includes(composer.id)) candidates.set(node, 2);
      }
    }
    let pro = null; let nonPro = null; let unknown = false;
    for (const [node, weight] of candidates) {
      const labels = readableLabels(node).filter(s => !PROMOTIONAL.test(s));
      if (!labels.length) continue;
      const states = new Set(labels.map(classify));
      if (states.size > 1) { unknown = true; continue; }
      const mode = [...states][0];
      const observation = { mode, label: labels[0], weight };
      if (mode === 'pro' && (!pro || weight > pro.weight)) pro = observation;
      else if (mode === 'non-pro' && (!nonPro || weight > nonPro.weight)) nonPro = observation;
      else if (mode === 'unknown') unknown = true;
    }
    if (unknown || (pro && nonPro)) return { mode: 'unknown', label: '' };
    if (pro) return { mode: 'pro', label: pro.label };
    if (nonPro) return { mode: 'non-pro', label: nonPro.label };
    return { mode: 'unknown', label: '' };
  }

  function closestEditor(node) { return editorFromTarget(node); }

  function isSendButton(node, doc) {
    const button = node?.nodeType === 1 ? node.closest('button, [role="button"]') : null;
    return !!button && !!composerRoot(doc, button) && isVisibleActive(button) && sendControl(button);
  }

  function isComposerForm(node, doc = node?.ownerDocument) {
    return !!node?.matches?.('form') && !!doc && !!composerRoot(doc, node);
  }

  globalThis.ChromofoxProSendLogic = Object.freeze({
    normalize, classify, selectedMode, editor, composerRoot, closestEditor,
    isSendButton, isComposerForm, isVisibleActive
  });
})();
