/* Firefox background event page: GitHub cache, omnibox and navigation. */
"use strict";

const Core = globalThis.ActionsJumperCore;
const CACHE_TTL = 30 * 60 * 1000;
const ERROR_RETRY = 5 * 60 * 1000;
const MAX_PAGES = 10;
const fetching = new Map();
let recording = Promise.resolve();

async function stored() {
  return browser.storage.local.get(null);
}

async function snapshot(owner) {
  const all = await stored();
  const settings = Core.settingsFromStorage(all);
  const requestedOwner = owner || settings.owner;
  const entry = all.repoCache?.[requestedOwner.toLowerCase()] || null;
  return {
    owner: requestedOwner,
    activeQuery: settings.activeQuery,
    names: Array.isArray(entry?.names) ? entry.names : [],
    usage: all.usage || {},
    cachedAt: entry?.fetchedAt || 0,
    retryAt: entry?.retryAt || 0,
    cacheError: entry?.error || "",
    truncated: Boolean(entry?.truncated),
  };
}

async function downloadRepos(owner) {
  const names = [];
  let truncated = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100&page=${page}&sort=full_name`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let response;
    try {
      response = await fetch(url, {
        headers: { "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        throw new Error("GitHub API rate limit reached. Existing suggestions remain available.");
      }
      if (response.status === 404) throw new Error("GitHub account not found.");
      throw new Error(`GitHub API returned HTTP ${response.status}.`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("Unexpected repository response from GitHub.");
    for (const repo of payload) {
      if (Core.validRepo(repo?.name)) names.push(repo.name);
    }
    if (payload.length < 100) break;
    if (page === MAX_PAGES) truncated = true;
  }
  return { names: [...new Set(names)].sort((a, b) => a.localeCompare(b)), truncated };
}

async function refreshRepos(owner, force = false) {
  if (!Core.validOwner(owner)) throw new Error("Invalid GitHub owner.");
  const cacheKey = owner.toLowerCase();
  if (fetching.has(cacheKey)) return fetching.get(cacheKey);

  const operation = (async () => {
    const all = await stored();
    const previous = all.repoCache?.[cacheKey] || {};
    const now = Date.now();
    if (!force && ((previous.fetchedAt && now - previous.fetchedAt < CACHE_TTL) ||
        (previous.retryAt && now < previous.retryAt))) {
      return { names: previous.names || [], error: previous.error || "", truncated: !!previous.truncated };
    }
    try {
      const downloaded = await downloadRepos(owner);
      // Merge against the *latest* storage so simultaneous owner refreshes
      // don't erase one another's records.
      const latest = await browser.storage.local.get("repoCache");
      const newCache = { ...(latest.repoCache || {}), [cacheKey]: {
        names: downloaded.names, fetchedAt: Date.now(), truncated: downloaded.truncated,
      }};
      await browser.storage.local.set({ repoCache: newCache });
      return { ...downloaded, error: "" };
    } catch (error) {
      const entry = { ...previous, retryAt: Date.now() + ERROR_RETRY, error: error.message };
      // Don't overwrite newer caches for another owner with an old snapshot.
      const latest = await browser.storage.local.get("repoCache");
      await browser.storage.local.set({ repoCache: { ...(latest.repoCache || {}), [cacheKey]: entry }});
      return { names: entry.names || [], error: error.message, truncated: !!entry.truncated };
    }
  })();
  fetching.set(cacheKey, operation);
  try { return await operation; } finally { fetching.delete(cacheKey); }
}

async function suggestionsFor(text, limit = Core.MAX_SUGGESTIONS) {
  const state = await snapshot();
  const results = Core.rankRepositories(state.names, state.usage, state.owner, text, limit);
  // Non-blocking refresh keeps key-by-key autocomplete fast.
  if (Date.now() - state.cachedAt > CACHE_TTL && Date.now() >= state.retryAt) {
    void refreshRepos(state.owner);
  }
  return results;
}

async function recordUse(owner, repo) {
  recording = recording.catch(() => {}).then(async () => {
    const all = await browser.storage.local.get("usage");
    const usage = all.usage || {};
    const key = Core.keyFor(owner, repo);
    const updated = Core.incrementUsage(usage[key], Date.now(), repo);
    await browser.storage.local.set({ usage: { ...usage, [key]: updated }});
  });
  return recording;
}

async function navigate(repo, disposition = "newForegroundTab") {
  const { owner, activeQuery } = Core.settingsFromStorage(await stored());
  const requested = String(repo || "").trim();
  const parts = requested.split("/");
  const destinationOwner = parts.length === 2 ? parts[0] : owner;
  const destinationRepo = parts.length === 2 ? parts[1] : requested;
  const url = Core.buildActionsUrl(destinationOwner, destinationRepo, activeQuery);

  if (disposition === "currentTab") {
    // No tabs permission required: the omnibox grants a user-initiated navigation.
    await browser.tabs.update({ url });
  } else {
    await browser.tabs.create({ url, active: disposition !== "newBackgroundTab" });
  }
  await recordUse(destinationOwner, destinationRepo);
  return { url };
}

async function openSettings() {
  // A real separate, narrow Firefox window; fall back to the options page.
  try {
    return await browser.windows.create({
      url: browser.runtime.getURL("options.html"), type: "popup", width: 660, height: 730,
    });
  } catch (_error) {
    return browser.runtime.openOptionsPage();
  }
}

browser.runtime.onMessage.addListener(message => {
  if (!message || typeof message !== "object") return undefined;
  switch (message.type) {
    case "snapshot": return snapshot();
    case "suggest": return suggestionsFor(message.text || "");
    case "refresh": return refreshRepos(message.owner || "techrote", !!message.force);
    case "navigate": return navigate(message.repo);
    case "openSettings": return openSettings();
    default: return undefined;
  }
});

let omniboxGeneration = 0;

browser.omnibox.setDefaultSuggestion({
  description: "Jump to GitHub Actions — type a repo name, choose a suggestion, press Enter",
});

browser.omnibox.onInputStarted.addListener(() => {
  void snapshot().then(s => refreshRepos(s.owner)).catch(() => {});
});

browser.omnibox.onInputChanged.addListener((text, suggest) => {
  const generation = ++omniboxGeneration;
  void suggestionsFor(text, 6).then(results => {
    if (generation !== omniboxGeneration) return;
    suggest(results.map(item => ({
      content: item.name,
      description: `${item.name}${item.count ? `  ·  opened ${item.count}×` : ""}`,
    })));
  }).catch(() => { if (generation === omniboxGeneration) suggest([]); });
});

browser.omnibox.onInputCancelled.addListener(() => { omniboxGeneration++; });

browser.omnibox.onInputEntered.addListener((text, disposition) => {
  void navigate(text, disposition).catch(error => console.error("Actions Jumper navigation failed:", error));
});
