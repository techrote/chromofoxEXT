/* Shared, dependency-free data/format helpers. No ChatGPT messages are stored. */
(() => {
  "use strict";
  const PREFIX = "cgpt-timestamp:v1:";
  const SETTINGS_KEY = "cgpt-timestamp:settings:v1";
  const DEFAULTS = Object.freeze({
    enabled: true,
    showSeconds: false,
    firstSeen: false
  });
  const SOURCES = Object.freeze({
    sent: 4,
    "reply-start": 4,
    observed: 2,
    "first-seen": 1
  });
  function conversationId(pathname) {
    const parts = String(pathname || "").split("/").filter(Boolean);
    for (let i = 0; i + 1 < parts.length; ++i) {
      // Both /c/<id> and /g/<gpt>/c/<id> are supported.
      if (parts[i] === "c" && /^[a-zA-Z0-9_-]{8,}$/.test(parts[i + 1])) {
        return parts[i + 1];
      }
    }
    return null;
  }
  function recordKey(conversation, role, turnId) {
    if (!conversation || !turnId || !["user", "assistant"].includes(role)) return null;
    return PREFIX + encodeURIComponent(conversation) + ":" + role + ":" + encodeURIComponent(turnId);
  }
  function validRecord(value) {
    return value && typeof value === "object" &&
      Number.isSafeInteger(value.at) && value.at >= 946684800000 &&
      value.at < 4102444800000 && Object.hasOwn(SOURCES, value.source);
  }
  function chooseRecord(oldValue, newValue) {
    if (!validRecord(newValue)) return validRecord(oldValue) ? oldValue : null;
    if (!validRecord(oldValue)) return newValue;
    const oldRank = SOURCES[oldValue.source];
    const newRank = SOURCES[newValue.source];
    if (newRank > oldRank) return newValue;
    if (oldRank > newRank) return oldValue;
    return newValue.at < oldValue.at ? newValue : oldValue;
  }
  function normalSettings(raw) {
    const result = { ...DEFAULTS };
    if (raw && typeof raw === "object") {
      for (const key of Object.keys(DEFAULTS)) {
        if (typeof raw[key] === "boolean") result[key] = raw[key];
      }
    }
    return result;
  }
  function formatTimestamp(record, showSeconds) {
    const value = new Intl.DateTimeFormat(undefined, {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
      ...(showSeconds ? { second: "2-digit" } : {}),
      hour12: false
    }).format(new Date(record.at));
    return record.source === "first-seen" ? "First seen: " + value : value;
  }
  globalThis.CGPTTimestamp = Object.freeze({
    PREFIX, SETTINGS_KEY, DEFAULTS, SOURCES,
    conversationId, recordKey, validRecord, chooseRecord,
    normalSettings, formatTimestamp
  });
})();
