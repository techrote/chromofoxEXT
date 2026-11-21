/* Shared extension-only protocol validation. No webpage receives this script. */
(function (root) {
  "use strict";
  const profiles = Object.freeze(["powershell", "cmd", "pwsh", "wsl"]);
  const validSize = (c, r) => Number.isInteger(c) && c >= 20 && c <= 500 &&
    Number.isInteger(r) && r >= 5 && r <= 250;
  const validSessionId = (id) => Number.isSafeInteger(id) && id > 0;
  const validUI = (m) => {
    if (!m || typeof m !== "object" || Array.isArray(m) ||
        !validSessionId(m.sessionId)) return false;
    switch (m.type) {
      case "start":
        return profiles.includes(m.profile) && validSize(m.cols, m.rows);
      case "input":
        return typeof m.data === "string" && new TextEncoder().encode(m.data).length <= 8192 &&
          !m.data.includes("\0");
      case "resize":
        return validSize(m.cols, m.rows);
      case "ack":
      case "close":
        return true;
      default:
        return false;
    }
  };
  const validNative = (m) => {
    if (!m || typeof m !== "object" || Array.isArray(m)) return false;
    switch (m.type) {
      case "started": return true;
      case "data":
        return typeof m.data === "string" && m.data.length <= 8192 &&
          m.data.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(m.data);
      case "exit": return Number.isSafeInteger(m.code) && m.code >= 0;
      case "error": return typeof m.message === "string" && m.message.length <= 2000;
      default: return false;
    }
  };
  const api = Object.freeze({ profiles, validSize, validSessionId, validUI, validNative });
  root.ChromoTerminalProtocol = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
