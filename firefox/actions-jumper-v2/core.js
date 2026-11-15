/* Shared, pure logic for toolbar popup, omnibox and tests. */
(function (root, factory) {
  const api = factory();
  root.ActionsJumperCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DAY = 86400000;
  const HALF_LIFE_DAYS = 30;
  const MAX_SUGGESTIONS = 8;
  const DEFAULT_PRESETS = [
    { label: "Running", query: "is:in_progress" },
    { label: "Queued", query: "is:queued" },
    { label: "Failed", query: "conclusion:failure" },
    { label: "All runs", query: "" },
  ];

  function validOwner(value) {
    return typeof value === "string" &&
      /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(value) &&
      !value.includes("--");
  }

  function validRepo(value) {
    return typeof value === "string" &&
      value.length <= 100 &&
      /^[a-z0-9_.-]+$/i.test(value) &&
      value !== "." && value !== "..";
  }

  function keyFor(owner, repo) {
    return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
  }

  function normaliseQuery(query) {
    return String(query || "").trim().replace(/\s+/g, " ");
  }

  function buildActionsUrl(owner, repo, query = "") {
    if (!validOwner(owner) || !validRepo(repo)) {
      throw new Error("Invalid GitHub owner or repository name.");
    }
    const path = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions`;
    const filter = normaliseQuery(query);
    return filter ? `${path}?query=${encodeURIComponent(filter)}` : path;
  }

  function parsePresets(text) {
    const lines = String(text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lines.length || lines.length > 30) {
      throw new Error("Specify 1 to 30 filter presets.");
    }
    return lines.map((line, index) => {
      const separator = line.indexOf("|");
      if (separator < 1) throw new Error(`Invalid filter preset on line ${index + 1}. Use Label | query.`);
      const label = line.slice(0, separator).trim();
      const query = normaliseQuery(line.slice(separator + 1));
      if (!label || label.length > 60 || query.length > 500) {
        throw new Error(`Invalid preset label or query length on line ${index + 1}.`);
      }
      return { label, query };
    });
  }

  function presetsText(presets) {
    return presets.map(p => `${p.label} | ${p.query}`).join("\n");
  }

  function settingsFromStorage(value = {}) {
    // Migrate transparently from v1's "filters" settings on upgrade.
    let presets = DEFAULT_PRESETS;
    if (typeof value.presets === "string") {
      try { presets = parsePresets(value.presets); } catch (_e) { /* defaults */ }
    } else if (typeof value.filters === "string") {
      try { presets = parsePresets(value.filters); } catch (_e) { /* defaults */ }
    }
    const owner = validOwner(value.owner) ? value.owner : "techrote";
    const activeQuery = typeof value.activeQuery === "string"
      ? normaliseQuery(value.activeQuery)
      : presets[0].query;
    return { owner, activeQuery, presets };
  }

  function popularityScore(record, now = Date.now()) {
    if (!record || !Number.isFinite(record.score) || !Number.isFinite(record.lastUsed)) return 0;
    const elapsed = Math.max(0, now - record.lastUsed);
    return Math.max(0, record.score) * Math.pow(0.5, elapsed / (HALF_LIFE_DAYS * DAY));
  }

  function incrementUsage(record, now = Date.now(), name = "") {
    const oldCount = Number.isSafeInteger(record?.count) ? record.count : 0;
    return {
      count: oldCount + 1,
      score: popularityScore(record, now) + 1,
      lastUsed: now,
      // Original casing is retained for private or deleted repositories.
      name: name || record?.name || "",
    };
  }

  function rankRepositories(names, history, owner, input, limit = MAX_SUGGESTIONS, now = Date.now()) {
    const needle = String(input || "").trim().toLowerCase();
    if (needle && !/^[a-z0-9_.-]+$/.test(needle)) return [];
    const seen = new Map();
    for (const name of names || []) {
      if (validRepo(name)) seen.set(name.toLowerCase(), name);
    }
    // Always include previously visited private repositories as candidates.
    const prefix = `${owner.toLowerCase()}/`;
    for (const [key, entry] of Object.entries(history || {})) {
      if (!key.startsWith(prefix)) continue;
      const fallback = key.slice(prefix.length);
      const name = validRepo(entry?.name) ? entry.name : fallback;
      if (validRepo(name) && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    }
    const items = [];
    for (const name of seen.values()) {
      const lower = name.toLowerCase();
      const record = (history || {})[keyFor(owner, name)];
      // Don't fill the empty query with hundreds of alphabetical unknowns.
      if (!needle && !(record?.count > 0)) continue;
      const starts = lower.startsWith(needle);
      if (needle && !lower.includes(needle)) continue;
      const matchClass = lower === needle ? 0 : starts ? 1 : 2;
      items.push({
        name,
        count: Math.max(0, Number(record?.count) || 0),
        score: popularityScore(record, now),
        lastUsed: Number(record?.lastUsed) || 0,
        matchClass,
      });
    }
    const shortQuery = needle.length <= 2;
    items.sort((a, b) => {
      if (!shortQuery && a.matchClass !== b.matchClass) return a.matchClass - b.matchClass;
      // Short queries are *primarily* sorted by the user's visit rate.
      if (Math.abs(a.score - b.score) > 1e-8) return b.score - a.score;
      if (a.count !== b.count) return b.count - a.count;
      if (a.lastUsed !== b.lastUsed) return b.lastUsed - a.lastUsed;
      // Prefix is a secondary signal for short queries; never alphabetical-first.
      if (shortQuery && a.matchClass !== b.matchClass) return a.matchClass - b.matchClass;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
    });
    return items.slice(0, Math.max(0, limit));
  }

  function ghostSuffix(typed, candidate) {
    const text = String(typed || "");
    const match = String(candidate || "");
    return match.toLowerCase().startsWith(text.toLowerCase()) && match.length > text.length
      ? match.slice(text.length) : "";
  }

  return {
    HALF_LIFE_DAYS, MAX_SUGGESTIONS, DEFAULT_PRESETS,
    validOwner, validRepo, keyFor, normaliseQuery, buildActionsUrl,
    parsePresets, presetsText, settingsFromStorage,
    popularityScore, incrementUsage, rankRepositories, ghostSuffix,
  };
});
