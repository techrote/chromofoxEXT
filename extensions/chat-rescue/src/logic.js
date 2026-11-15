/* CHAT-RESCUE-001: small shared helpers; no network, storage or transcript access. */
(function (root) {
  'use strict';
  const MAX_CLICKS = 30;
  const MAX_DURATION_MS = 16000;
  const PULSE_COUNT = 16;

  function conversationId(href) {
    try {
      const url = new URL(href);
      if (url.protocol !== 'https:' || !['chatgpt.com', 'chat.openai.com'].includes(url.hostname)) return null;
      const match = /^\/c\/([a-z0-9-]{8,})(?:\/|$)/i.exec(url.pathname);
      return match ? match[1] : null;
    } catch (_) { return null; }
  }

  function stateFromEvidence(evidence) {
    if (!evidence.eligible) return 'not-conversation';
    // An explicit load failure must not be masked by stale DOM message markers.
    if (evidence.hasError) return 'error-visible';
    if (evidence.turnCount > 0) return 'messages-visible';
    if (evidence.spinnerFound) return 'loading-indicator';
    return 'unconfirmed';
  }

  function ringPoints(center, radius, count) {
    const points = [];
    for (let i = 0; i < count; ++i) {
      const theta = (i / count) * Math.PI * 2;
      points.push({ x: Math.round(center.x + radius * Math.cos(theta)), y: Math.round(center.y + radius * Math.sin(theta)) });
    }
    return points;
  }

  function withinRadius(x, y, center, radius) {
    return ((x - center.x) ** 2 + (y - center.y) ** 2) <= radius * radius;
  }

  function clippedNumber(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  root.ChatRescueLogic = Object.freeze({
    conversationId, stateFromEvidence, ringPoints, withinRadius, clippedNumber,
    MAX_CLICKS, MAX_DURATION_MS, PULSE_COUNT
  });
})(globalThis);
